import socket
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from app import guard


def resolver(table):
    def resolve(host, port, *args, **kwargs):
        if host not in table:
            raise socket.gaierror("no such host")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port or 0)) for address in table[host]]
    return resolve


class PublicAddresses(unittest.TestCase):
    def test_addresses(self):
        for address in ("1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"):
            self.assertTrue(guard.is_public(address), address)

        for address in (
            "127.0.0.1", "10.0.0.5", "172.17.0.2", "192.168.1.1", "169.254.169.254",
            "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1",
            "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not an address",
        ):
            self.assertFalse(guard.is_public(address), address)


class CheckURL(unittest.TestCase):
    resolve = staticmethod(resolver({
        "example.com": ["93.184.215.14"],
        "internal.example": ["10.0.0.7"],
        "mixed.example": ["93.184.215.14", "127.0.0.1"],
    }))

    def check(self, url):
        return guard.check_url(url, resolve=self.resolve)

    def test_public_links(self):
        self.assertIsNone(self.check("https://example.com/watch/1"))
        self.assertIsNone(self.check("http://example.com:80/a"))
        self.assertIsNone(self.check("https://1.1.1.1/a"))

    def test_links_that_arent_allowed(self):
        for url in (
            "ftp://example.com/a",
            "file:///etc/passwd",
            "https://example.com:8080/a",
            "https://user:pass@example.com/a",
            "https://127.0.0.1/a",
            "http://[::1]/a",
            "https://internal.example/a",
            # every address of a host has to be public
            "https://mixed.example/a",
            "https://unknown.example/a",
            "https://",
            "not a link",
            "https://example.com/" + "a" * 5000,
            None,
        ):
            self.assertIsNotNone(self.check(url), url)


class Proxies(unittest.TestCase):
    def test_proxy_addresses(self):
        resolve = resolver({"warp": ["172.18.0.3"], "127.0.0.1": ["127.0.0.1"]})
        self.assertEqual(
            guard.proxy_addresses({"YTDLP_PROXY": "socks5://warp:1080", "https_proxy": "http://127.0.0.1:3128"}, resolve),
            {("172.18.0.3", 1080), ("127.0.0.1", 3128)},
        )
        self.assertEqual(guard.proxy_addresses({}, resolve), set())


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"internal")

    def log_message(self, *args):
        pass


class Connections(unittest.TestCase):
    """the guard is installed for every test (see app.extract), so a server
    on 127.0.0.1 stands for anything that isn't on the public internet"""

    @classmethod
    def setUpClass(cls):
        guard.install()
        cls.server = HTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_connections_to_private_addresses_are_blocked(self):
        port = self.server.server_address[1]
        with self.assertRaises(guard.BlockedAddress) as error:
            socket.create_connection(("127.0.0.1", port), timeout=2)
        self.assertIn(guard.MARKER, str(error.exception))

        sock = socket.socket()
        with self.assertRaises(guard.BlockedAddress):
            sock.connect_ex(("127.0.0.1", port))
        sock.close()

    def test_urllib_is_blocked_too(self):
        from urllib.request import urlopen
        from urllib.error import URLError

        with self.assertRaises((URLError, guard.BlockedAddress)) as error:
            urlopen(f"http://127.0.0.1:{self.server.server_address[1]}/", timeout=2)
        self.assertIn(guard.MARKER, str(error.exception))


if __name__ == "__main__":
    unittest.main()
