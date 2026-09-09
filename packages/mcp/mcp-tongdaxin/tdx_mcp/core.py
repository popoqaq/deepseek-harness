"""Pure validation and JSON-shaping helpers for the TongdaXin MCP."""

from __future__ import annotations

from datetime import date, datetime
import math
import re
from typing import Any

_MARKET_NAMES = {"sh": 1, "sz": 0}
_CODE_PATTERN = re.compile(r"^[0-9]{6}$")
_PERIODS = {
    "1m": 7,
    "5m": 0,
    "15m": 1,
    "30m": 2,
    "60m": 3,
    "day": 4,
    "week": 5,
    "month": 6,
}


def normalize_symbol(symbol: str) -> tuple[int, str]:
    """Convert ``sh.600000``/``600000`` to pytdx's ``(market, code)``."""
    raw = symbol.strip().lower().replace("_", ".")
    if not raw:
        raise ValueError("symbol must not be empty")
    parts = raw.split(".")
    if len(parts) == 1 and parts[0][:2] in _MARKET_NAMES:
        parts = [parts[0][:2], parts[0][2:]]
    if len(parts) != 2 or parts[0] not in _MARKET_NAMES or not _CODE_PATTERN.fullmatch(parts[1]):
        if len(parts) == 2 and parts[0] == "bj":
            raise ValueError("Beijing Stock Exchange symbols are not supported by pytdx's standard HQ protocol")
        raise ValueError(f"invalid symbol {symbol!r}; use sh.600000, sz.000001, or a six-digit code")
    return _MARKET_NAMES[parts[0]], parts[1]


def infer_symbol(symbol: str) -> tuple[int, str]:
    """Infer Shanghai/Shenzhen from a bare code; explicit prefixes are preferred."""
    raw = symbol.strip().lower()
    if "." in raw or raw[:2] in _MARKET_NAMES:
        return normalize_symbol(raw)
    if not _CODE_PATTERN.fullmatch(raw):
        raise ValueError(f"invalid symbol {symbol!r}")
    if raw.startswith(("5", "6", "68", "689")):
        return 1, raw
    if raw.startswith(("0", "1", "2", "3")):
        return 0, raw
    raise ValueError(f"cannot infer exchange for {symbol!r}; use sh.{raw} or sz.{raw}")


def period_category(period: str) -> int:
    """Return the pytdx bar category for a human-readable period."""
    key = period.strip().lower()
    if key not in _PERIODS:
        raise ValueError(f"unsupported period {period!r}; choose one of {', '.join(_PERIODS)}")
    return _PERIODS[key]


def jsonable(value: Any) -> Any:
    """Convert pytdx's result objects into bounded JSON-compatible values."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def parse_server_list(raw: str | None) -> list[tuple[str, int]]:
    """Parse ``host:port,host:port`` with safe defaults and validation."""
    text = (raw or "").strip()
    values = text.split(",") if text else [
        "119.147.212.81:7709",
        "124.71.187.122:7709",
        "218.108.98.244:7709",
    ]
    servers: list[tuple[str, int]] = []
    for item in values:
        item = item.strip()
        if not item:
            continue
        if ":" not in item:
            raise ValueError(f"invalid TongdaXin server {item!r}; expected host:port")
        host, port_text = item.rsplit(":", 1)
        if not host or not port_text.isdigit():
            raise ValueError(f"invalid TongdaXin server {item!r}; expected host:port")
        port = int(port_text)
        if not 1 <= port <= 65535:
            raise ValueError(f"invalid TongdaXin port {port}")
        servers.append((host, port))
    if not servers:
        raise ValueError("TDX_SERVERS did not contain any usable server")
    return servers
