import io
import json
import unittest
from unittest import mock

from app import server


class FakeRequest:
    """just enough of a request for the handler"""

    def __init__(self, body):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.rfile = io.BytesIO(data)
        self.headers = {"content-length": str(len(data))}


def post(body):
    handler = server.Handler.__new__(server.Handler)
    request = FakeRequest(body)
    handler.rfile, handler.headers, handler.path = request.rfile, request.headers, "/extract"
    sent = {}
    handler.send_json = lambda status, response: sent.update(status=status, body=response)
    handler.do_POST()
    return sent


class Requests(unittest.TestCase):
    def test_the_service_is_passed_on(self):
        with mock.patch.object(server, "lookup", return_value={"ok": True}) as lookup:
            self.assertEqual(post({"url": "https://a.example/v"})["status"], 200)
            lookup.assert_called_with("https://a.example/v", "generic")

            post({"url": "https://www.youtube.com/watch?v=x", "service": "youtube"})
            lookup.assert_called_with("https://www.youtube.com/watch?v=x", "youtube")

    def test_bad_requests(self):
        with mock.patch.object(server, "lookup") as lookup:
            for body in (
                {"service": "youtube"},
                {"url": 5},
                {"url": "https://a.example/v", "service": "../etc"},
                {"url": "https://a.example/v", "service": "Youtube"},
                {"url": "https://a.example/v", "service": ["youtube"]},
                b"not json",
            ):
                self.assertEqual(post(body)["status"], 400, body)
            lookup.assert_not_called()


if __name__ == "__main__":
    unittest.main()
