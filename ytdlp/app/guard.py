"""keeps yt-dlp on the public internet.

links come from anyone, so a link (or a redirect, or a playlist inside a
page) could point at the server itself, the docker network, or a cloud
metadata address. every connection a python socket makes is checked
against the address it really connects to, which also covers redirects
and dns answers that change between a check and the connection.
"""

import errno
import ipaddress
import os
import re
import socket
from urllib.parse import urlsplit

# shows up in yt-dlp's error message when a connection was blocked
MARKER = "fetchr-blocked-address"

ALLOWED_SCHEMES = {"http", "https"}
ALLOWED_PORTS = {None, 80, 443}


class BlockedAddress(OSError):
    pass


def is_public(address):
    try:
        ip = ipaddress.ip_address(str(address).split("%", 1)[0])
    except ValueError:
        return False

    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped

    return ip.is_global and not ip.is_multicast


def resolves_to_public(host, resolve=socket.getaddrinfo):
    """true if the host is a public address, or every address it resolves to is"""
    if is_public(host):
        return True

    try:
        ipaddress.ip_address(str(host).split("%", 1)[0])
        # an address, but not a public one
        return False
    except ValueError:
        pass

    try:
        addresses = {info[4][0] for info in resolve(host, None)}
    except (OSError, UnicodeError):
        return False

    return bool(addresses) and all(is_public(a) for a in addresses)


def check_url(url, resolve=socket.getaddrinfo):
    """the reason the link can't be used, or None if it can"""
    if not isinstance(url, str) or len(url) > 4096:
        return "invalid url"

    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return "invalid url"

    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        return "scheme isn't allowed"
    if port not in ALLOWED_PORTS:
        return "port isn't allowed"
    if parts.username or parts.password:
        return "credentials aren't allowed"
    if not parts.hostname:
        return "no host"
    if not resolves_to_public(parts.hostname, resolve):
        return "host isn't public"


PROXY_VARIABLES = ("YTDLP_PROXY", "ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY")


def service_proxies(environ=os.environ):
    """SERVICE_PROXIES (the same as the api's): {"youtube": "socks5://warp:1080"}"""
    proxies = {}
    for entry in re.split(r"[,;\s]+", environ.get("SERVICE_PROXIES", "")):
        service, _, proxy = entry.partition("=")
        if service.strip() and proxy.strip():
            proxies[service.strip().lower()] = proxy.strip()
    return proxies


def proxy_addresses(environ=os.environ, resolve=socket.getaddrinfo):
    """(address, port) of the proxies yt-dlp may use.

    behind a proxy, the proxy connects to the sites, so connections to it
    are allowed (and only the link itself is checked, see check_url).
    """
    values = [environ.get(name) for name in PROXY_VARIABLES]
    values += [environ.get(name.lower()) for name in PROXY_VARIABLES]
    values += [p for p in service_proxies(environ).values() if p != "direct"]

    allowed = set()
    for value in values:
        if not value:
            continue
        try:
            parts = urlsplit(value if "://" in value else f"http://{value}")
            port = parts.port or {"https": 443}.get(parts.scheme, 1080 if parts.scheme.startswith("socks") else 80)
            for info in resolve(parts.hostname, port):
                allowed.add((info[4][0], port))
        except (OSError, ValueError, TypeError, UnicodeError):
            continue
    return allowed


_proxies = set()


def _check(sock, address):
    if sock.family not in (socket.AF_INET, socket.AF_INET6):
        return

    host = address[0] if isinstance(address, tuple) else address
    if isinstance(address, tuple) and (host, address[1]) in _proxies:
        return
    if not resolves_to_public(host):
        raise BlockedAddress(errno.EACCES, f"{MARKER}: {host}")


_installed = False


def allow_proxies():
    """(re)reads the proxies' addresses, they can change when a container restarts"""
    global _proxies
    _proxies = proxy_addresses()


def install():
    """checks the address of every connection python makes from now on"""
    global _installed
    if _installed:
        return

    allow_proxies()

    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex

    def connect(self, address):
        _check(self, address)
        return real_connect(self, address)

    def connect_ex(self, address):
        _check(self, address)
        return real_connect_ex(self, address)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    _installed = True
