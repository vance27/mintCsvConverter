# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small Python 3 script (no external dependencies) that converts a Mint.com transaction export CSV into a CSV formatted for a Google Sheets expense-splitting workflow. It filters out transactions that shouldn't be split (personal-only purchases, transfers, already-shared bills) and flags a configurable set of vendors as "split variably" vs "split equally."

## Running it

```
python3 main.py <input_file.csv> EXPENSE_SPLITTING <PayerName>
```

Example:

```
python3 main.py transactions.csv EXPENSE_SPLITTING Brian
```

`<PayerName>` must exist (case-insensitively) as a key in `bannedLinesDict` in [csvTools/convert/CsvConverterFactory.py](csvTools/convert/CsvConverterFactory.py) — this determines which set of "banned" (non-splittable) transaction descriptions apply, in addition to the always-applied `SHARED` list. Currently supported names: `PATRICE`, `BRIAN`.

`EXPENSE_SPLITTING` is currently the only supported `outputFormat`; any other value raises `ValueError` from `_get_converter`.

There is no build step, dependency install, lint, or test suite in this repo (uses only the Python standard library: `csv`, `datetime`, `sys`).

## Architecture

Three-stage pipeline wired together in [main.py](main.py):

1. **Import** — `ImportFileToLines.ImportFileTolines` ([csvTools/fileInteraction/ImportFileToLines.py](csvTools/fileInteraction/ImportFileToLines.py)) reads the input CSV into a list of row-lists via `csv.reader` with `QUOTE_NONNUMERIC`.
2. **Convert** — `CsvConverterFactory` ([csvTools/convert/CsvConverterFactory.py](csvTools/convert/CsvConverterFactory.py)) is a factory keyed on `outputFormat` string that dispatches to a converter method (currently only `_convert_to_expense_splitting`). That method:
   - Skips the header row (index 0).
   - Iterates rows in reverse, and for each row checks `_valid_line` against `bannedLinesDict[<PAYER_NAME>]` and `bannedLinesDict["SHARED"]` (substring match against `line[1]`, the Mint description column). Non-matching (valid) lines are kept; matching lines are routed to `invalidLines`.
   - For valid lines, checks `_variable_split` against `bannedLinesDict["VARIABLE"]` to decide whether the row is tagged `"Variably"` (split `%`/`%`) or `"Equally"` (split `TRUE`/`TRUE`).
   - Returns a `(result, invalidLines)` tuple. Output columns are: `date + description`, payer name, amount (`line[3]` from the Mint export), split type, and two split-ratio columns.
3. **Export** — `ExportFileToLines` ([csvTools/fileInteraction/ExportFileToLines.py](csvTools/fileInteraction/ExportFileToLines.py)) writes both `result` and `invalidLines` out as separate CSV files, named `<name><timestamp><VALID|INVALID>csvConverter.csv`, into the current working directory.

### Adding a new payer

Add a new uppercase key to `bannedLinesDict` in `CsvConverterFactory` with a list of Mint description substrings that should be excluded (personal-only spending, transfers, etc.) for that payer. The key must match the `--name` CLI arg uppercased.

### Adding a new output format

Add a new `outputFormat` branch in `_get_converter` pointing to a new `_convert_to_*` method following the same `(lines, name) -> (result, invalidLines)` signature.

## Known rough edges (be aware, don't "fix" silently)

- `main.py` accesses `sys.argv[3]` unconditionally before checking whether it's `None`, so calling without a payer name argument raises `IndexError` rather than falling back to the `"Brian"` default.
- `CsvConverterFactory._get_converter` raises `ValueError(format)` — `format` is the built-in, not the `outputFormat` parameter, so the error message is wrong.
- `_valid_line` / `_variable_split` call `throw(...)` (not valid Python) instead of `raise`, on the (currently unreachable) missing-key error paths.
- `ExportFileToLines.lines` and `ImportFileTolines.results`/`file` are class attributes rather than being purely instance attributes set in `__init__`; be cautious about shared mutable state if these classes are ever reused across multiple conversions in one process.
