# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small Python 3 script (no external dependencies) that converts a Mint.com transaction export CSV into a CSV formatted for a Google Sheets expense-splitting workflow. It excludes personal-only, payer-specific transactions (transfers, individual purchases, etc.) and classifies every remaining transaction as either "split equally" (including known shared/joint bills) or "split variably" for a configurable set of vendors.

## Running it

```
python3 main.py <input_file.csv> EXPENSE_SPLITTING <PayerName>
```

Example:

```
python3 main.py transactions.csv EXPENSE_SPLITTING Brian
```

`<PayerName>` must exist (case-insensitively) as a key in `personalExclusions` in [csvTools/convert/CsvConverterFactory.py](csvTools/convert/CsvConverterFactory.py) — this determines which set of personal, non-splittable transaction descriptions get excluded for that payer. Currently supported names: `PATRICE`, `BRIAN`. `--help` is also supported (via `argparse`).

`EXPENSE_SPLITTING` is currently the only supported `outputFormat`; any other value raises `ValueError` naming the bad format.

There is no build step or dependency install (uses only the Python standard library). Run the test suite with `make test` (or `python3 -m unittest discover -s tests -t .`).

## Architecture

Three-stage pipeline wired together in [main.py](main.py):

1. **Import** — `ImportFileToLines.ImportFileTolines` ([csvTools/fileInteraction/ImportFileToLines.py](csvTools/fileInteraction/ImportFileToLines.py)) reads the input CSV into a list of row-lists via `csv.reader` with `QUOTE_NONNUMERIC`.
2. **Convert** — `CsvConverterFactory` ([csvTools/convert/CsvConverterFactory.py](csvTools/convert/CsvConverterFactory.py)) is a factory keyed on `outputFormat` string that dispatches to a converter method (currently only `_convert_to_expense_splitting`). That method:
   - Skips the header row (index 0).
   - Iterates rows in reverse, and for each row checks `_valid_line` against `personalExclusions[<PAYER_NAME>]` (substring match against `line[1]`, the Mint description column). Matching lines are personal spending and are routed to `invalidLines`; everything else is kept.
   - For kept lines, checks `_variable_split` against `splitRulesDict["VARIABLE"]` to decide whether the row is tagged `"Variably"` (split `%`/`%`) or `"Equally"` (split `TRUE`/`TRUE`). `splitRulesDict["SHARED"]` is documentation of known joint bills (e.g. mortgage, insurance) that also land in the `"Equally"` bucket — it isn't branched on separately in code since that's already the default for any non-excluded, non-variable transaction.
   - Returns a `(result, invalidLines)` tuple. Output columns are: `date + description`, payer name, amount (`line[3]` from the Mint export), split type, and two split-ratio columns.
3. **Export** — `ExportFileToLines` ([csvTools/fileInteraction/ExportFileToLines.py](csvTools/fileInteraction/ExportFileToLines.py)) writes both `result` and `invalidLines` out as separate CSV files, named `<name>_<timestamp>_<VALID|INVALID>_csvConverter.csv`, into the current working directory.

### Adding a new payer

Add a new uppercase key to `personalExclusions` in `CsvConverterFactory` with a list of Mint description substrings that should be excluded (personal-only spending, transfers, etc.) for that payer. The key must match the `name` CLI arg uppercased.

### Adding a new output format

Add a new `outputFormat` branch in `_get_converter` pointing to a new `_convert_to_*` method following the same `(lines, name) -> (result, invalidLines)` signature.
