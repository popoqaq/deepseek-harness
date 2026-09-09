import unittest
from unittest.mock import patch

from weather_mcp.server import _geocode, _weather_label


class WeatherServerTests(unittest.TestCase):
    def test_weather_code_labels(self):
        self.assertEqual(_weather_label(0), "晴")
        self.assertEqual(_weather_label(95), "雷雨")
        self.assertEqual(_weather_label(999), "未知天气代码 999")

    @patch("weather_mcp.server._request_json")
    def test_geocoding_returns_first_result(self, request):
        request.return_value = {
            "results": [
                {
                    "name": "上海",
                    "latitude": 31.22222,
                    "longitude": 121.45806,
                    "timezone": "Asia/Shanghai",
                }
            ]
        }
        self.assertEqual(_geocode("上海")["latitude"], 31.22222)
        request.assert_called_once()

    @patch("weather_mcp.server._request_json", return_value={"results": []})
    def test_unknown_location_is_rejected(self, _request):
        with self.assertRaises(ValueError):
            _geocode("不存在的地点")


if __name__ == "__main__":
    unittest.main()
