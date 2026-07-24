import csv
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from csvTools.fileInteraction.ExportFileToLines import ExportFileToLines
from csvTools.fileInteraction.ImportFileToLines import ImportFileTolines


class ImportFileTolinesTests(unittest.TestCase):
    def _write_mint_csv(self, directory, filename, rows):
        path = os.path.join(directory, filename)
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f, quoting=csv.QUOTE_NONNUMERIC)
            writer.writerows(rows)
        return path

    def test_separate_instances_do_not_share_results(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path_a = self._write_mint_csv(
                tmpdir,
                "a.csv",
                [
                    ["Date", "Description", "Original Description", "Amount"],
                    ["06/20/2024", "Chipotle", "CHIPOTLE", 25.0],
                ],
            )
            path_b = self._write_mint_csv(
                tmpdir,
                "b.csv",
                [
                    ["Date", "Description", "Original Description", "Amount"],
                    ["06/21/2024", "Costco", "COSTCO", 150.0],
                ],
            )

            importer_a = ImportFileTolines(path_a)
            importer_b = ImportFileTolines(path_b)

            results_a = importer_a.get_results()
            results_b = importer_b.get_results()

            self.assertIsNot(results_a, results_b)
            self.assertEqual(len(results_a), 2)
            self.assertEqual(len(results_b), 2)


class ExportFileToLinesTests(unittest.TestCase):
    def test_writefile_produces_safe_filename_and_roundtrips_contents(self):
        lines = [["Chipotle 06/20/2024", "Brian", "25.00", "Equally", "TRUE", "TRUE"]]

        with tempfile.TemporaryDirectory() as tmpdir:
            cwd = os.getcwd()
            os.chdir(tmpdir)
            try:
                ExportFileToLines(lines).writeFile("Brian")
            finally:
                os.chdir(cwd)

            written_files = os.listdir(tmpdir)
            self.assertEqual(len(written_files), 1)
            filename = written_files[0]
            self.assertNotIn(" ", filename)
            self.assertNotIn(":", filename)

            with open(os.path.join(tmpdir, filename), newline="", encoding="utf-8") as f:
                rows = list(csv.reader(f))
            self.assertEqual(rows, lines)


if __name__ == "__main__":
    unittest.main()
