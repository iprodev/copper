"""gets a link's info with yt-dlp, without downloading anything.

the api picks the formats and downloads them itself (through its own
tunnels), so only the parts it needs are sent back. this module is also
what runs in each worker process (see server.py).
"""

import os
import re
import shutil

import yt_dlp
from yt_dlp.extractor import gen_extractor_classes
from yt_dlp.utils import DownloadError, GeoRestrictedError, UnsupportedError

from . import guard

# every process that imports this only connects to public addresses
guard.install()

# items of a playlist or an album that are looked at, at most
PLAYLIST_ITEMS = 10

# extractors that are never used, e.g. YTDLP_DISABLED_EXTRACTORS=bandcamp,imgur
DISABLED = frozenset(
    name.strip().lower()
    for name in os.environ.get("YTDLP_DISABLED_EXTRACTORS", "").split(",")
    if name.strip()
)

INFO_FIELDS = (
    "id", "title", "uploader", "channel", "artist", "creator", "album", "track",
    "duration", "is_live", "live_status", "extractor", "extractor_key",
    "upload_date", "release_year", "webpage_url",
)

FORMAT_FIELDS = (
    "format_id", "url", "protocol", "ext", "vcodec", "acodec", "width", "height",
    "fps", "tbr", "abr", "vbr", "filesize", "filesize_approx", "format_note",
    "language", "has_drm", "http_headers", "cookies", "preference", "quality",
)


def _is_disabled(ie):
    return ie.IE_NAME.lower() in DISABLED or ie.ie_key().lower() in DISABLED


def find_extractor(url):
    """the extractor yt-dlp would use for the link, if it has one for the site.

    its "generic" extractor (any page) isn't used: the api has its own,
    which checks every address it requests.
    """
    for ie in gen_extractor_classes():
        if not ie.suitable(url):
            continue
        if ie.ie_key() == "Generic" or not ie.working() or _is_disabled(ie):
            return None
        return ie
    return None


class _QuietLogger:
    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        pass


def proxy_for(service):
    """the proxy of the fetchr service the link is from (SERVICE_PROXIES, like
    the api), so its files work for the address the api downloads them from"""
    proxy = guard.service_proxies().get(str(service or "generic").lower())
    if proxy and proxy != "direct":
        return proxy
    return os.environ.get("YTDLP_PROXY") or None


# youtube needs a javascript runtime for its signatures (yt-dlp's "ejs").
# the image has deno, yt-dlp's default
JS_RUNTIMES = {name: {} for name in ("deno", "node") if shutil.which(name)}


def options(service=None):
    proxy = proxy_for(service)
    return {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _QuietLogger(),
        "color": {"stdout": "no_color", "stderr": "no_color"},
        "skip_download": True,
        "simulate": True,
        "noplaylist": True,
        "playlist_items": f"1-{PLAYLIST_ITEMS}",
        "socket_timeout": 15,
        "retries": 1,
        "extractor_retries": 1,
        "check_formats": False,
        "ignore_no_formats_error": True,
        "cachedir": False,
        "allowed_extractors": ["default", "-generic", *(f"-{name}" for name in DISABLED)],
        # e.g. socks5://warp:1080. without it, the usual proxy variables are used
        **({"proxy": proxy} if proxy else {}),
        **({"js_runtimes": JS_RUNTIMES} if JS_RUNTIMES else {}),
    }


def _format(f):
    out = {key: f[key] for key in FORMAT_FIELDS if f.get(key) is not None}
    return out if out.get("url") else None


def trim(info):
    """the parts of yt-dlp's info the api uses"""
    out = {key: info[key] for key in INFO_FIELDS if info.get(key) is not None}
    out["type"] = info.get("_type") or "video"

    if out["type"] == "playlist":
        out["entries"] = [trim(e) for e in (info.get("entries") or []) if e][:PLAYLIST_ITEMS]
        return out

    formats = info.get("formats")
    # some extractors give a single file without a formats list
    if not formats and info.get("url"):
        formats = [info]

    out["formats"] = [f for f in map(_format, formats or []) if f]
    return out


# yt-dlp's messages -> fetchr's error codes (see web/i18n/en/error/api.json)
_MESSAGES = (
    (r"\b(private|members?[- ]only)\b", "content.video.private"),
    (r"\b(age|adult|mature|nsfw|inappropriate)\b", "content.video.age"),
    (r"\b(country|countries|region|geo)", "content.region"),
    (r"\b(paid|purchase|premium|subscri|rent)", "content.paid"),
    (r"\b(is live|live event|livestream|live stream|premieres? in)\b", "content.video.live"),
    (r"\b(429|too many requests|rate.?limit)", "fetch.rate"),
    (r"\b(log ?in|sign ?in|logged|account|cookies|authenticat)", "content.video.unavailable"),
    (r"\b(404|410|not found|no longer|does not exist|doesn't exist|removed|deleted|unavailable|not available)\b",
        "content.video.unavailable"),
)


def error_code(error):
    message = str(error)
    if guard.MARKER in message:
        return "unsafe"

    cause = getattr(error, "exc_info", None)
    cause = cause[1] if cause else error
    if isinstance(cause, GeoRestrictedError):
        return "content.region"
    if isinstance(cause, UnsupportedError):
        return "unsupported"

    lower = message.lower()
    for pattern, code in _MESSAGES:
        if re.search(pattern, lower):
            return code
    return "fetch.fail"


def extract(url, service=None):
    if guard.check_url(url):
        return {"ok": False, "error": "unsafe"}
    if not find_extractor(url):
        return {"ok": False, "error": "unsupported"}

    guard.allow_proxies()
    try:
        with yt_dlp.YoutubeDL(options(service)) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloadError as e:
        return {"ok": False, "error": error_code(e)}
    except guard.BlockedAddress:
        return {"ok": False, "error": "unsafe"}
    except Exception as e:
        return {"ok": False, "error": error_code(e)}

    if not info:
        return {"ok": False, "error": "fetch.empty"}

    return {"ok": True, "info": trim(info)}


def work(url, service, conn):
    """runs in a worker process: sends the result back through the pipe"""
    try:
        result = extract(url, service)
    except BaseException:
        result = {"ok": False, "error": "fetch.fail"}

    try:
        conn.send(result)
    finally:
        conn.close()
