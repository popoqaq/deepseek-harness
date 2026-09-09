"""A small read-only weather MCP service using Open-Meteo."""

from __future__ import annotations

from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

WEATHER_CODES = {
    0: "晴",
    1: "基本晴",
    2: "局部多云",
    3: "阴",
    45: "雾",
    48: "冻雾",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "大毛毛雨",
    56: "冻毛毛雨",
    57: "强冻毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    66: "冻雨",
    67: "强冻雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    77: "雪粒",
    80: "小阵雨",
    81: "中阵雨",
    82: "强阵雨",
    85: "小阵雪",
    86: "大阵雪",
    95: "雷雨",
    96: "雷雨伴小冰雹",
    99: "雷雨伴大冰雹",
}


def _number(value: Any) -> Any:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _request_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    try:
        response = httpx.get(url, params=params, timeout=10.0)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise RuntimeError(f"weather provider request failed: {error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError("weather provider returned an invalid response")
    if "error" in payload:
        raise RuntimeError(str(payload.get("reason", "weather provider returned an error")))
    return payload


def _geocode(location: str) -> dict[str, Any]:
    location = location.strip()
    if not location:
        raise ValueError("location must not be empty")
    payload = _request_json(GEOCODING_URL, {
        "name": location,
        "count": 1,
        "language": "zh",
        "format": "json",
    })
    results = payload.get("results")
    if not isinstance(results, list) or not results:
        raise ValueError(f"location not found: {location}")
    result = results[0]
    if not isinstance(result, dict) or "latitude" not in result or "longitude" not in result:
        raise RuntimeError("geocoding response did not contain coordinates")
    return result


def _location_view(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": result.get("name"),
        "country": result.get("country"),
        "admin1": result.get("admin1"),
        "latitude": result.get("latitude"),
        "longitude": result.get("longitude"),
        "timezone": result.get("timezone"),
    }


def _weather_label(code: Any) -> str:
    try:
        return WEATHER_CODES.get(int(code), f"未知天气代码 {code}")
    except (TypeError, ValueError):
        return "未知天气"


def create_server() -> FastMCP:
    mcp = FastMCP("Weather via Open-Meteo")

    @mcp.tool()
    def weather_current(location: str) -> dict[str, Any]:
        """获取指定城市的当前天气。无需 API Key，location 可使用中文或英文城市名。"""
        place = _geocode(location)
        payload = _request_json(FORECAST_URL, {
            "latitude": place["latitude"],
            "longitude": place["longitude"],
            "current": ",".join([
                "temperature_2m", "relative_humidity_2m", "apparent_temperature",
                "is_day", "precipitation", "rain", "weather_code", "wind_speed_10m",
            ]),
            "timezone": "auto",
        })
        current = payload.get("current")
        units = payload.get("current_units")
        if not isinstance(current, dict):
            raise RuntimeError("weather response did not contain current conditions")
        return {
            "provider": "Open-Meteo",
            "location": _location_view(place),
            "observed_at": current.get("time"),
            "timezone": payload.get("timezone"),
            "weather": {
                "condition": _weather_label(current.get("weather_code")),
                "weather_code": current.get("weather_code"),
                "temperature": _number(current.get("temperature_2m")),
                "temperature_unit": units.get("temperature_2m") if isinstance(units, dict) else None,
                "apparent_temperature": _number(current.get("apparent_temperature")),
                "humidity": current.get("relative_humidity_2m"),
                "precipitation": current.get("precipitation"),
                "rain": current.get("rain"),
                "wind_speed": current.get("wind_speed_10m"),
                "is_day": current.get("is_day") == 1,
            },
        }

    @mcp.tool()
    def weather_forecast(location: str, days: int = 3) -> dict[str, Any]:
        """获取指定城市未来 1 到 7 天的每日天气预报。"""
        if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 7:
            raise ValueError("days must be an integer between 1 and 7")
        place = _geocode(location)
        payload = _request_json(FORECAST_URL, {
            "latitude": place["latitude"],
            "longitude": place["longitude"],
            "daily": ",".join([
                "weather_code", "temperature_2m_max", "temperature_2m_min",
                "precipitation_sum", "wind_speed_10m_max", "sunrise", "sunset",
            ]),
            "forecast_days": days,
            "timezone": "auto",
        })
        daily = payload.get("daily")
        if not isinstance(daily, dict):
            raise RuntimeError("weather response did not contain daily forecast")
        dates = daily.get("time", [])
        forecast = []
        for index, day in enumerate(dates):
            code = daily.get("weather_code", [None] * len(dates))[index]
            forecast.append({
                "date": day,
                "condition": _weather_label(code),
                "weather_code": code,
                "temperature_max": _number(daily.get("temperature_2m_max", [None] * len(dates))[index]),
                "temperature_min": _number(daily.get("temperature_2m_min", [None] * len(dates))[index]),
                "precipitation_sum": _number(daily.get("precipitation_sum", [None] * len(dates))[index]),
                "wind_speed_max": _number(daily.get("wind_speed_10m_max", [None] * len(dates))[index]),
                "sunrise": daily.get("sunrise", [None] * len(dates))[index],
                "sunset": daily.get("sunset", [None] * len(dates))[index],
            })
        return {
            "provider": "Open-Meteo",
            "location": _location_view(place),
            "timezone": payload.get("timezone"),
            "forecast": forecast,
        }

    return mcp


def main() -> None:
    create_server().run(transport="stdio")


if __name__ == "__main__":
    main()
