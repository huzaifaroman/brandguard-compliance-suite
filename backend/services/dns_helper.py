import socket
import logging
import urllib.request
import json
from urllib.parse import urlparse

logger = logging.getLogger("backend.services.dns_helper")

_dns_cache: dict[str, str] = {}

HOSTS_TO_RESOLVE = []


def _resolve_via_doh(hostname: str) -> str | None:
    try:
        url = f"https://cloudflare-dns.com/dns-query?name={hostname}&type=A"
        req = urllib.request.Request(url, headers={"accept": "application/dns-json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            answers = [a for a in data.get("Answer", []) if a.get("type") == 1]
            if answers:
                ip = answers[-1]["data"]
                logger.info("DoH resolved %s -> %s", hostname, ip)
                return ip
    except Exception as e:
        logger.warning("DoH resolution failed for %s: %s", hostname, e)
    return None


def _can_resolve(hostname: str) -> bool:
    try:
        socket.getaddrinfo(hostname, 443, socket.AF_INET, socket.SOCK_STREAM, 0, socket.AI_NUMERICSERV)
        return True
    except socket.gaierror:
        return False


def patch_dns_for_hosts(hosts: list[str]):
    import socket as _socket

    _original_getaddrinfo = _socket.getaddrinfo

    def _patched_getaddrinfo(host, port, *args, **kwargs):
        if host in _dns_cache:
            ip = _dns_cache[host]
            return [(
                _socket.AF_INET,
                _socket.SOCK_STREAM,
                6,
                "",
                (ip, port if isinstance(port, int) else 443),
            )]
        return _original_getaddrinfo(host, port, *args, **kwargs)

    for hostname in hosts:
        if not _can_resolve(hostname):
            logger.warning("System DNS cannot resolve %s, trying DoH...", hostname)
            ip = _resolve_via_doh(hostname)
            if ip:
                _dns_cache[hostname] = ip
                logger.info("Cached DNS: %s -> %s", hostname, ip)
            else:
                logger.error("Could not resolve %s via any method", hostname)
        else:
            logger.info("System DNS resolves %s OK", hostname)

    if _dns_cache:
        _socket.getaddrinfo = _patched_getaddrinfo
        logger.info("DNS monkey-patch active for %d host(s)", len(_dns_cache))


def init_dns():
    from backend.config import settings

    hosts = set()
    for url in [settings.azure_vision_endpoint, settings.azure_openai_endpoint]:
        if url:
            h = urlparse(url).hostname
            if h:
                hosts.add(h)

    if hosts:
        patch_dns_for_hosts(list(hosts))
