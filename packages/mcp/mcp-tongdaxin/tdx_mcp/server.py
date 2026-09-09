"""Read-only MCP server backed by TongdaXin's HQ protocol (pytdx)."""

from __future__ import annotations

from collections.abc import Callable
import atexit
import os
from threading import RLock
import time
from typing import Any

from .core import infer_symbol, jsonable, normalize_symbol, parse_server_list, period_category

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:  # pragma: no cover - exercised only when dependencies are absent
    FastMCP = None  # type: ignore[assignment,misc]

try:
    from pytdx.hq import TdxHq_API
except ImportError:  # pragma: no cover - exercised only when dependencies are absent
    TdxHq_API = None  # type: ignore[assignment,misc]


class TongdaXinGateway:
    """Thread-safe pytdx connection with ordered server failover and small TTL cache."""

    def __init__(self, servers: list[tuple[str, int]], timeout: float = 5.0) -> None:
        if TdxHq_API is None:
            raise RuntimeError("pytdx is not installed; run `uv sync` or `pip install -e .`")
        self._servers = servers
        self._timeout = timeout
        self._lock = RLock()
        self._api: Any = None
        self._connected: tuple[str, int] | None = None
        self._cache: dict[tuple[str, str], tuple[float, Any]] = {}

    @property
    def connected_server(self) -> str | None:
        return None if self._connected is None else f"{self._connected[0]}:{self._connected[1]}"

    def _connect(self) -> None:
        last_error: Exception | None = None
        for host, port in self._servers:
            try:
                api = TdxHq_API(auto_retry=True)
                if api.connect(host, port, time_out=self._timeout):
                    self._api = api
                    self._connected = (host, port)
                    return
            except Exception as error:  # pytdx exposes socket errors from several layers
                last_error = error
        self._api = None
        self._connected = None
        raise RuntimeError(f"unable to connect to any TongdaXin server: {last_error or 'connection rejected'}")

    def _call(self, operation: Callable[[Any], Any]) -> Any:
        with self._lock:
            if self._api is None:
                self._connect()
            try:
                return operation(self._api)
            except Exception:
                self.close()
                self._connect()
                return operation(self._api)

    def close(self) -> None:
        with self._lock:
            if self._api is not None:
                try:
                    self._api.disconnect()
                except Exception:
                    pass
            self._api = None
            self._connected = None

    def cached(self, key: tuple[str, str], ttl: float, operation: Callable[[Any], Any]) -> Any:
        now = time.monotonic()
        cached = self._cache.get(key)
        if cached is not None and now - cached[0] < ttl:
            return cached[1]
        value = self._call(operation)
        self._cache[key] = (now, value)
        return value

    def quote(self, symbols: list[tuple[int, str]]) -> list[Any]:
        return self._call(lambda api: api.get_security_quotes(symbols)) or []

    def bars(self, category: int, market: int, code: str, start: int, count: int) -> list[Any]:
        return self._call(lambda api: api.get_security_bars(category, market, code, start, count)) or []

    def best5(self, market: int, code: str) -> list[Any]:
        return self._call(lambda api: api.get_security_best5(market, code)) or []

    def transactions(self, market: int, code: str, start: int, count: int) -> list[Any]:
        return self._call(lambda api: api.get_security_transaction_data(market, code, start, count)) or []

    def security_list(self, market: int, start: int) -> list[Any]:
        return self.cached(
            ("security-list", f"{market}:{start}"), 60.0,
            lambda api: api.get_security_list(market, start) or [],
        )


def _bounded_int(value: int, name: str, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= maximum:
        raise ValueError(f"{name} must be an integer between 1 and {maximum}")
    return value


def create_server() -> Any:
    if FastMCP is None:
        raise RuntimeError("MCP Python SDK is not installed; run `uv sync` or `pip install -e .`")
    servers = parse_server_list(os.getenv("TDX_SERVERS"))
    timeout = float(os.getenv("TDX_TIMEOUT", "5"))
    if not 0.5 <= timeout <= 30:
        raise ValueError("TDX_TIMEOUT must be between 0.5 and 30 seconds")
    gateway = TongdaXinGateway(servers, timeout)
    atexit.register(gateway.close)
    mcp = FastMCP("TongdaXin A-share Market Data")

    @mcp.tool()
    def tdx_quote(symbols: list[str]) -> dict[str, Any]:
        """获取实时行情。symbols 使用 sh.600000、sz.000001 或带交易所的六位代码。"""
        if not symbols or len(symbols) > 100:
            raise ValueError("symbols must contain between 1 and 100 symbols")
        normalized = [normalize_symbol(item) for item in symbols]
        data = gateway.quote(normalized)
        return {"source": "TongdaXin HQ", "server": gateway.connected_server, "data": jsonable(data)}

    @mcp.tool()
    def tdx_kline(symbol: str, period: str = "day", count: int = 120, start: int = 0) -> dict[str, Any]:
        """获取历史 K 线。period 可选 1m/5m/15m/30m/60m/day/week/month。"""
        count = _bounded_int(count, "count", 800)
        if not isinstance(start, int) or start < 0:
            raise ValueError("start must be a non-negative integer")
        market, code = infer_symbol(symbol)
        data = gateway.bars(period_category(period), market, code, start, count)
        return {"source": "TongdaXin HQ", "server": gateway.connected_server, "symbol": symbol, "period": period, "data": jsonable(data)}

    @mcp.tool()
    def tdx_order_book(symbol: str) -> dict[str, Any]:
        """获取五档盘口（买一至买五、卖一至卖五）。"""
        market, code = infer_symbol(symbol)
        data = gateway.best5(market, code)
        return {"source": "TongdaXin HQ", "server": gateway.connected_server, "symbol": symbol, "data": jsonable(data)}

    @mcp.tool()
    def tdx_transactions(symbol: str, count: int = 100, start: int = 0) -> dict[str, Any]:
        """获取近期逐笔成交。数据量受通达信服务器限制。"""
        count = _bounded_int(count, "count", 200)
        if not isinstance(start, int) or start < 0:
            raise ValueError("start must be a non-negative integer")
        market, code = infer_symbol(symbol)
        data = gateway.transactions(market, code, start, count)
        return {"source": "TongdaXin HQ", "server": gateway.connected_server, "symbol": symbol, "data": jsonable(data)}

    @mcp.tool()
    def tdx_search(keyword: str, market: str = "all", limit: int = 50) -> dict[str, Any]:
        """按股票代码或名称搜索 A 股证券。market 可选 all/sh/sz。"""
        keyword = keyword.strip().lower()
        market = market.strip().lower()
        if not keyword:
            raise ValueError("keyword must not be empty")
        limit = _bounded_int(limit, "limit", 200)
        markets = {"sh": 1, "sz": 0} if market == "all" else {market: {"sh": 1, "sz": 0}.get(market, -1)}
        if any(value < 0 for value in markets.values()):
            raise ValueError("market must be all, sh, or sz")
        matches: list[dict[str, Any]] = []
        for exchange, market_id in markets.items():
            for page in range(0, 10000, 100):
                rows = gateway.security_list(market_id, page)
                if not rows:
                    break
                for row in rows:
                    item = jsonable(row)
                    code = str(item.get("code", ""))
                    name = str(item.get("name", ""))
                    if keyword in code.lower() or keyword in name.lower():
                        matches.append({"symbol": f"{exchange}.{code}", "code": code, "name": name})
                        if len(matches) >= limit:
                            return {"source": "TongdaXin HQ", "server": gateway.connected_server, "data": matches}
                if len(rows) < 100:
                    break
        return {"source": "TongdaXin HQ", "server": gateway.connected_server, "data": matches}

    @mcp.tool()
    def tdx_server_status() -> dict[str, Any]:
        """检查 TongdaXin 行情服务器连接状态。"""
        data = gateway.quote([(1, "000001")])
        return {"ok": bool(data), "source": "TongdaXin HQ", "server": gateway.connected_server, "sample_count": len(data)}

    return mcp


def main() -> None:
    server = create_server()
    try:
        server.run(transport="stdio")
    finally:
        # FastMCP owns the event loop; this hook is best effort for the pytdx socket.
        pass


if __name__ == "__main__":
    main()
