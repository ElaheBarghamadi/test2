from __future__ import annotations

import ipaddress
import re
from typing import Any

from django.conf import settings


def _ip(value: str | None) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address((value or "").strip())
    except ValueError:
        return None


def _trusted_proxy_networks() -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for raw in getattr(settings, "TRUSTED_PROXY_CIDRS", []):
        try:
            networks.append(ipaddress.ip_network(raw, strict=False))
        except ValueError:
            # An invalid deployment entry must never make an arbitrary forwarding header trusted.
            continue
    return networks


def _is_trusted(address: ipaddress.IPv4Address | ipaddress.IPv6Address, networks: list[Any]) -> bool:
    return any(address.version == network.version and address in network for network in networks)


def client_ip_from_request(request: Any) -> str | None:
    """Return the direct peer IP unless the peer is an explicitly trusted reverse proxy.

    `X-Forwarded-For` is user-controlled unless a trusted proxy overwrites/appends it. We therefore ignore it
    by default and only inspect it when `REMOTE_ADDR` belongs to `DJANGO_TRUSTED_PROXY_CIDRS`. From a trusted
    chain, the first untrusted address walking right-to-left is the client-facing address.
    """
    peer = _ip(request.META.get("REMOTE_ADDR"))
    if peer is None:
        return None
    networks = _trusted_proxy_networks()
    if not _is_trusted(peer, networks):
        return str(peer)

    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    chain = [parsed for token in forwarded.split(",") if (parsed := _ip(token)) is not None]
    for candidate in reversed(chain):
        if not _is_trusted(candidate, networks):
            return str(candidate)
    # No usable forwarding information: be honest that all we know is the proxy peer.
    return str(peer)


def describe_user_agent(user_agent: str) -> dict[str, str]:
    """A deliberately coarse, best-effort reading of a reported User-Agent (which can be spoofed)."""
    ua = (user_agent or "")[:512]
    browser_rules = (
        ("Microsoft Edge", r"(?:EdgA|EdgiOS|Edg)/([\w.]+)"),
        ("Opera", r"(?:OPR|Opera)/([\w.]+)"),
        ("Samsung Internet", r"SamsungBrowser/([\w.]+)"),
        ("Firefox", r"(?:FxiOS|Firefox)/([\w.]+)"),
        ("Chrome", r"(?:CriOS|Chrome)/([\w.]+)"),
        ("Safari", r"Version/([\w.]+).*Safari/"),
    )
    browser = "نامشخص"
    for name, pattern in browser_rules:
        match = re.search(pattern, ua, re.IGNORECASE)
        if match:
            browser = f"{name} {match.group(1)}"
            break

    lower = ua.lower()
    if "ipad" in lower:
        platform, device = "iPadOS", "تبلت"
    elif "iphone" in lower or "ipod" in lower:
        platform, device = "iOS", "تلفن همراه"
    elif "android" in lower:
        platform = "Android"
        device = "تلفن همراه" if "mobile" in lower else "تبلت یا دستگاه Android"
    elif "windows" in lower:
        platform, device = "Windows", "رایانه"
    elif "mac os x" in lower or "macintosh" in lower:
        platform, device = "macOS", "رایانه"
    elif "linux" in lower:
        platform, device = "Linux", "رایانه"
    else:
        platform, device = "نامشخص", "نامشخص"

    return {"browser": browser, "platform": platform, "device_type": device}
