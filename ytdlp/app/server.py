"""a small http server that gives the api yt-dlp's info about a link.

    POST /extract  {"url": "https://..."}
        -> {"ok": true, "info": {...}}
        -> {"ok": false, "error": "unsupported" | "unsafe" | "busy" | "timeout" | <fetchr error code>}
    GET /health    -> {"ok": true, "version": "<yt-dlp version>"}

it has no authentication: no port is published, only the api reaches it.
each link is looked up in its own process, which is killed when it takes
too long, and only a few run at once.
"""

import json
import multiprocessing
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import yt_dlp.version

from . import extract

PORT = int(os.environ.get("YTDLP_PORT", "4417"))
# links looked up at the same time; each process takes about 50-100 mb
WORKERS = max(1, int(os.environ.get("YTDLP_WORKERS", "2")))
# seconds a lookup may take
TIMEOUT = float(os.environ.get("YTDLP_TIMEOUT", "30"))
# seconds a request waits for a free worker before it's turned away
QUEUE_WAIT = float(os.environ.get("YTDLP_QUEUE_WAIT", "10"))
# hours between checks for a new yt-dlp (sites change often, and so does
# yt-dlp). 0 turns it off.
UPDATE_HOURS = float(os.environ.get("YTDLP_UPDATE_HOURS", "24"))

MAX_BODY = 16 * 1024

VERSION = yt_dlp.version.__version__

# workers start from a process that already has yt-dlp loaded
context = multiprocessing.get_context("forkserver")
context.set_forkserver_preload(["app.extract"])

slots = threading.BoundedSemaphore(WORKERS)


def log(message):
    print(f"[ytdlp] {message}", file=sys.stderr, flush=True)


def run(url):
    if not slots.acquire(timeout=QUEUE_WAIT):
        return {"ok": False, "error": "busy"}

    try:
        receiver, sender = context.Pipe(duplex=False)
        process = context.Process(target=extract.work, args=(url, sender), daemon=True)
        process.start()
        sender.close()

        try:
            if receiver.poll(TIMEOUT):
                result = receiver.recv()
            else:
                result = {"ok": False, "error": "timeout"}
        except (EOFError, OSError):
            result = {"ok": False, "error": "fetch.fail"}
        finally:
            receiver.close()
            if process.is_alive():
                process.kill()
            process.join(5)

        return result
    finally:
        slots.release()


def lookup(url):
    """checks the link before a worker is started for it"""
    if extract.guard.check_url(url):
        return {"ok": False, "error": "unsafe"}

    ie = extract.find_extractor(url)
    if not ie:
        return {"ok": False, "error": "unsupported"}

    started = time.monotonic()
    result = run(url)
    outcome = "ok" if result.get("ok") else result.get("error")
    # links aren't logged, only the site and the outcome
    log(f"{ie.ie_key()}: {outcome} in {time.monotonic() - started:.1f}s")
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "fetchr-ytdlp"
    sys_version = ""

    def log_message(self, format, *args):
        pass

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self.send_json(200, {"ok": True, "version": VERSION})
        self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path != "/extract":
            return self.send_json(404, {"ok": False, "error": "not found"})

        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            length = -1
        if not 0 < length <= MAX_BODY:
            return self.send_json(400, {"ok": False, "error": "bad request"})

        try:
            url = json.loads(self.rfile.read(length)).get("url")
        except (ValueError, AttributeError):
            url = None
        if not isinstance(url, str):
            return self.send_json(400, {"ok": False, "error": "bad request"})

        self.send_json(200, lookup(url))


def installed_version():
    result = subprocess.run(
        [sys.executable, "-c", "import importlib.metadata as m; print(m.version('yt-dlp'))"],
        capture_output=True, text=True, timeout=60,
    )
    return result.stdout.strip()


def update():
    """installs a newer yt-dlp, if there is one. true if it did."""
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", "--upgrade", "--no-cache-dir",
         "--disable-pip-version-check", "yt-dlp[default]"],
        capture_output=True, text=True, timeout=600,
    )
    if result.returncode != 0:
        log(f"couldn't update yt-dlp: {result.stderr.strip().splitlines()[-1:]}")
        return False

    version = installed_version()
    return bool(version) and version != VERSION


def updater():
    # the first check is soon after starting, so an old image gets
    # a current yt-dlp right away
    time.sleep(60)
    while True:
        try:
            if update():
                log(f"yt-dlp {installed_version()} was installed, restarting to use it")
                # waits until no lookup is running, the container restarts by itself
                for _ in range(WORKERS):
                    slots.acquire()
                os._exit(0)
        except Exception as e:
            log(f"couldn't update yt-dlp: {e}")
        time.sleep(UPDATE_HOURS * 3600)


def main():
    if UPDATE_HOURS > 0:
        threading.Thread(target=updater, daemon=True).start()

    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    log(f"yt-dlp {VERSION} listening on port {PORT}, {WORKERS} at a time")
    server.serve_forever()


if __name__ == "__main__":
    main()
