import unittest
from unittest import mock

from yt_dlp.utils import DownloadError, ExtractorError, GeoRestrictedError

from app import extract, guard


def download_error(cause):
    try:
        raise cause
    except Exception as e:
        import sys
        return DownloadError(f"ERROR: {e}", sys.exc_info())


class FindExtractor(unittest.TestCase):
    def test_sites_with_an_extractor(self):
        for url, key in (
            ("https://www.ted.com/talks/ken_robinson_do_schools_kill_creativity", "TedTalk"),
            ("https://9gag.com/gag/ae5Ag7B", "NineGag"),
            ("https://odysee.com/@Mantega:1/First-day-LBRY:1", "LBRY"),
        ):
            self.assertEqual(extract.find_extractor(url).ie_key(), key, url)

    def test_other_pages_are_left_to_the_api(self):
        # only yt-dlp's "generic" extractor would take these
        for url in ("https://example.com/video", "https://some-blog.example/post/1"):
            self.assertIsNone(extract.find_extractor(url), url)

    def test_disabled_extractors(self):
        with mock.patch.object(extract, "DISABLED", frozenset({"9gag"})):
            self.assertIsNone(extract.find_extractor("https://9gag.com/gag/ae5Ag7B"))


class Trim(unittest.TestCase):
    def test_only_what_the_api_uses(self):
        info = extract.trim({
            "id": "1", "title": "a video", "duration": 60, "extractor_key": "Site",
            "description": "long text", "thumbnails": [{"url": "x"}],
            "formats": [
                {"format_id": "hls-720", "url": "https://cdn/720.m3u8", "protocol": "m3u8_native",
                 "height": 720, "fragments": [{"url": "x"}] * 100,
                 "http_headers": {"Referer": "https://site/"}},
                {"format_id": "storyboard", "protocol": "mhtml"},
            ],
        })
        self.assertEqual(info["type"], "video")
        self.assertNotIn("description", info)
        self.assertNotIn("thumbnails", info)
        self.assertEqual(info["formats"], [{
            "format_id": "hls-720", "url": "https://cdn/720.m3u8", "protocol": "m3u8_native",
            "height": 720, "http_headers": {"Referer": "https://site/"},
        }])

    def test_a_single_file_without_formats(self):
        info = extract.trim({"id": "1", "url": "https://cdn/file.mp4", "ext": "mp4"})
        self.assertEqual(info["formats"], [{"url": "https://cdn/file.mp4", "ext": "mp4"}])

    def test_playlists(self):
        info = extract.trim({
            "_type": "playlist", "id": "album", "title": "an album",
            "entries": [{"id": str(i), "url": f"https://cdn/{i}.mp3"} for i in range(30)] + [None],
        })
        self.assertEqual(info["type"], "playlist")
        self.assertEqual(len(info["entries"]), extract.PLAYLIST_ITEMS)
        self.assertEqual(info["entries"][0]["formats"], [{"url": "https://cdn/0.mp3"}])


class Errors(unittest.TestCase):
    def test_error_codes(self):
        for message, code in (
            ("[site] 1: This video is private", "content.video.private"),
            ("[site] 1: This video is not available in your country", "content.region"),
            ("[site] 1: You need to log in to access this content", "content.video.unavailable"),
            ("[site] 1: HTTP Error 404: Not Found", "content.video.unavailable"),
            ("[site] 1: HTTP Error 429: Too Many Requests", "fetch.rate"),
            ("[site] 1: This content requires a purchase", "content.paid"),
            ("[site] 1: This live event will begin in 2 hours", "content.video.live"),
            ("[site] 1: Unable to download webpage: HTTP Error 403: Forbidden", "fetch.fail"),
            (f"[site] 1: Unable to download webpage: [Errno 13] {guard.MARKER}: 10.0.0.1", "unsafe"),
        ):
            self.assertEqual(extract.error_code(download_error(ExtractorError(message))), code, message)

        self.assertEqual(extract.error_code(download_error(GeoRestrictedError("blocked"))), "content.region")


class Extract(unittest.TestCase):
    def test_links_are_checked_first(self):
        self.assertEqual(extract.extract("https://127.0.0.1/a"), {"ok": False, "error": "unsafe"})
        self.assertEqual(extract.extract("https://example.com/video"), {"ok": False, "error": "unsupported"})

    def test_results(self):
        class FakeYDL:
            def __init__(self, options):
                self.options = options

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def extract_info(self, url, download):
                assert download is False
                assert self.options["simulate"] and self.options["noplaylist"]
                assert "-generic" in self.options["allowed_extractors"]
                if "private" in url:
                    raise download_error(ExtractorError("This video is private"))
                return {"id": "ae5Ag7B", "title": "t", "formats": [{"url": "https://cdn/v.mp4", "ext": "mp4"}]}

        with mock.patch.object(extract.guard, "check_url", return_value=None), \
                mock.patch.object(extract.yt_dlp, "YoutubeDL", FakeYDL):
            result = extract.extract("https://9gag.com/gag/ae5Ag7B")
            self.assertTrue(result["ok"])
            self.assertEqual(result["info"]["formats"], [{"url": "https://cdn/v.mp4", "ext": "mp4"}])

            self.assertEqual(
                extract.extract("https://9gag.com/gag/private1"),
                {"ok": False, "error": "content.video.private"},
            )


if __name__ == "__main__":
    unittest.main()
