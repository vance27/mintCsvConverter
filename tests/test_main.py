import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import main as main_module


class MainArgvFallbackTests(unittest.TestCase):
    @patch("main.eftl.ExportFileToLines")
    @patch("main.convertFile")
    def test_missing_payer_arg_defaults_to_brian(self, mock_convert, mock_export_cls):
        mock_convert.return_value = ([], [])
        mock_export_cls.return_value = MagicMock()

        with patch.object(sys, "argv", ["main.py", "input.csv", "EXPENSE_SPLITTING"]):
            main_module.main()

        mock_convert.assert_called_once_with("input.csv", "EXPENSE_SPLITTING", "Brian")

    @patch("main.eftl.ExportFileToLines")
    @patch("main.convertFile")
    def test_explicit_payer_arg_is_used(self, mock_convert, mock_export_cls):
        mock_convert.return_value = ([], [])
        mock_export_cls.return_value = MagicMock()

        with patch.object(sys, "argv", ["main.py", "input.csv", "EXPENSE_SPLITTING", "Patrice"]):
            main_module.main()

        mock_convert.assert_called_once_with("input.csv", "EXPENSE_SPLITTING", "Patrice")


if __name__ == "__main__":
    unittest.main()
