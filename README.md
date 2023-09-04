# Python Mint CSV Converter

This is a simple Python script that converts a CSV file exported from Mint.com into a CSV file that can be imported into google sheets expense splitting.

It removes lines that are not meant to be used in expense splitting or are already shared expenses.

To use:

```
python3 main.py <input_file.csv exported from MINT> EXPENSE_SPLITTING <Person who paid for Expense>
```

```
python3 main.py transactions.csv EXPENSE_SPLITTING Brian 
```
