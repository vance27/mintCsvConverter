import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from csvTools.convert.CsvConverterFactory import CsvConverterFactory


class GetConverterTests(unittest.TestCase):
    def setUp(self):
        self.factory = CsvConverterFactory()

    def test_unsupported_format_raises_value_error_naming_the_format(self):
        with self.assertRaises(ValueError) as ctx:
            self.factory._get_converter("BAD_FORMAT")
        self.assertIn("BAD_FORMAT", str(ctx.exception))


class ValidLineTests(unittest.TestCase):
    def setUp(self):
        self.factory = CsvConverterFactory()

    def test_payer_specific_banned_line_is_excluded(self):
        line = ["06/22/2024", "CITI CARD PAYMENT", "CITI", "500.00"]
        self.assertFalse(self.factory._valid_line(line, "Brian"))

    def test_shared_line_is_excluded(self):
        line = ["06/22/2024", "APPLE.COM/BILL 866-712-7753 CA", "APPLE", "2.99"]
        self.assertFalse(self.factory._valid_line(line, "Brian"))

    def test_ordinary_transaction_is_valid(self):
        line = ["06/20/2024", "Chipotle Mexican Grill", "CHIPOTLE", "25.00"]
        self.assertTrue(self.factory._valid_line(line, "Brian"))

    def test_unregistered_payer_raises_key_error(self):
        line = ["06/20/2024", "Chipotle Mexican Grill", "CHIPOTLE", "25.00"]
        with self.assertRaises(KeyError):
            self.factory._valid_line(line, "Zzz")


class VariableSplitTests(unittest.TestCase):
    def setUp(self):
        self.factory = CsvConverterFactory()

    def test_variable_vendor_is_marked_variable(self):
        line = ["06/21/2024", "Costco Wholesale", "COSTCO", "150.00"]
        self.assertTrue(self.factory._variable_split(line))

    def test_other_vendor_is_not_marked_variable(self):
        line = ["06/20/2024", "Chipotle Mexican Grill", "CHIPOTLE", "25.00"]
        self.assertFalse(self.factory._variable_split(line))

    def test_missing_variable_key_raises_key_error(self):
        self.factory.bannedLinesDict = {}
        line = ["06/20/2024", "Chipotle Mexican Grill", "CHIPOTLE", "25.00"]
        with self.assertRaises(KeyError):
            self.factory._variable_split(line)


class ConvertToExpenseSplittingTests(unittest.TestCase):
    def setUp(self):
        self.factory = CsvConverterFactory()
        self.lines = [
            ["Date", "Description", "Original Description", "Amount"],
            ["06/20/2024", "Chipotle Mexican Grill", "CHIPOTLE", "25.00"],
            ["06/21/2024", "Costco Wholesale", "COSTCO", "150.00"],
            ["06/22/2024", "CITI CARD PAYMENT", "CITI", "500.00"],
        ]

    def test_valid_lines_are_split_and_tagged_correctly(self):
        result, invalidLines = self.factory._convert_to_expense_splitting(self.lines, "Brian")

        self.assertEqual(
            result,
            [
                ["Costco Wholesale 06/21/2024", "Brian", "150.00", "Variably", "%", "%"],
                ["Chipotle Mexican Grill 06/20/2024", "Brian", "25.00", "Equally", "TRUE", "TRUE"],
            ],
        )

    def test_banned_lines_are_routed_to_invalid(self):
        _, invalidLines = self.factory._convert_to_expense_splitting(self.lines, "Brian")

        self.assertEqual(invalidLines, [["06/22/2024", "CITI CARD PAYMENT", "CITI", "500.00"]])


if __name__ == "__main__":
    unittest.main()
