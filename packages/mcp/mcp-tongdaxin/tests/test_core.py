import math
import unittest
from datetime import datetime

from tdx_mcp.core import infer_symbol, jsonable, normalize_symbol, parse_server_list, period_category


class CoreTests(unittest.TestCase):
    def test_explicit_and_inferred_symbols(self):
        self.assertEqual(normalize_symbol("sh.600000"), (1, "600000"))
        self.assertEqual(normalize_symbol("sz000001"), (0, "000001"))
        self.assertEqual(infer_symbol("600000"), (1, "600000"))
        self.assertEqual(infer_symbol("000001"), (0, "000001"))

    def test_rejects_ambiguous_or_beijing_symbols(self):
        with self.assertRaises(ValueError):
            normalize_symbol("bj.430047")
        with self.assertRaises(ValueError):
            normalize_symbol("not-a-symbol")

    def test_periods_and_server_list(self):
        self.assertEqual(period_category("day"), 4)
        self.assertEqual(period_category("15M"), 1)
        self.assertEqual(parse_server_list("a.example:7709,b.example:7710"), [("a.example", 7709), ("b.example", 7710)])
        with self.assertRaises(ValueError):
            parse_server_list("bad")

    def test_jsonable_normalizes_dates_and_non_finite_numbers(self):
        value = jsonable({"at": datetime(2025, 1, 2, 3, 4), "nan": math.nan, "rows": (b"A",)})
        self.assertEqual(value, {"at": "2025-01-02T03:04:00", "nan": None, "rows": ["A"]})


if __name__ == "__main__":
    unittest.main()
