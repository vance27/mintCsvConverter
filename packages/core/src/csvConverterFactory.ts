export type TransactionRow = string[];
export type ConvertResult = [TransactionRow[], TransactionRow[]];

export class CsvConverterFactory {
  // Payer-specific personal spending that should be excluded from the
  // output entirely (not split with anyone).
  static readonly defaultPersonalExclusions: Record<string, string[]> = {
    PATRICE: [
      'CVS/SPECIALTY',
      'BHATTIGI',
      'E-PAYMENT, TARGET.COM',
      'ETSY.COM',
      'Electronic Deposit Target Enterpris',
      'Mobile Banking Transfer Deposit',
      'Mobile Check Deposit',
      'Web Authorized Pmt',
      'Payment Received - Thank You!',
      'LULUS.COM',
      'Auto Transfer to Betterment Account',
    ],
    BRIAN: [
      'BlackRock Lifepath Index 2060 K Fund',
      'CITI CARD',
      'NATIONAL MARROW',
      'ONLINE PAYMENT, THANK YOU',
      'ONLINE BANKING TRANSFER TO SHARE',
      'ONLINE BANKING TRANSFER FROM SHARE',
      'TOCA TRAINING CENTERS',
      'QUALIFIED DIVIDEND',
      'Requested transfer from ',
    ],
  };

  // Classification rules for transactions that DO appear in the output:
  // SHARED vendors are known joint bills, split equally (TRUE/TRUE); this
  // is documentation only (see convertToExpenseSplitting) since ordinary
  // transactions already default to the same Equally split. VARIABLE
  // vendors get a "%"/"%" placeholder split instead.
  static readonly defaultSplitRulesDict: Record<string, string[]> = {
    SHARED: [
      'LTF LIFE TIME MO DUES',
      'HONDA PMT',
      'STATE FARM',
      'TRUPANION',
      'CPENERGY',
      'METRONET',
      'XCEL ENERGY',
      'FLAGSTAR',
      'ROUNDPOINT MTG PAYMENTS',
      'WITHDRAWAL ACH ALLY BANK',
      'ATM Fee Reimbursement',
      'APPLE.COM/BILL',
      'VANGUARD FEDERAL MONEY MARKET FUND (Settlement Fund)',
      'VANGUARD TOTAL STOCK MARKET INDEX',
      'Requested transfer from',
      'Buy Mutual Fund',
      'CURRENT YEAR INDIVIDUAL CONTR',
      'Current Year Individual Contribution',
      'Interest Paid',
      'Interest Payment',
      'Monthly Maintenance Fee',
      'MOBILE PAYMENT - THANK YOU',
      'INTERNET PAYMENT - THANK YOU',
      'AUTOPAY PAYMENT - THANK YOU',
      'PAYMENT THANK YOU',
      'Web Authorized Pmt',
    ],
    VARIABLE: ['Costco', 'TARGET'],
  };

  personalExclusions: Record<string, string[]> = CsvConverterFactory.defaultPersonalExclusions;
  splitRulesDict: Record<string, string[]> = CsvConverterFactory.defaultSplitRulesDict;
  // Groups same-vendor purchases together (sort key is "<description> <date>",
  // so it sorts by description first) instead of the raw reverse-input order.
  // Set to false to restore the old unsorted behavior.
  sorted = true;

  convert(lines: TransactionRow[], outputFormat: string, name: string): ConvertResult {
    const converter = this.getConverter(outputFormat);
    return converter(lines, name);
  }

  getConverter(outputFormat: string): (lines: TransactionRow[], name: string) => ConvertResult {
    console.log('Getting converter', outputFormat);
    if (outputFormat === 'EXPENSE_SPLITTING') {
      return this.convertToExpenseSplitting.bind(this);
    }
    throw new Error(`Unsupported output format: ${outputFormat}`);
  }

  convertToExpenseSplitting(lines: TransactionRow[], name: string): ConvertResult {
    const result: TransactionRow[] = [];
    const invalidLines: TransactionRow[] = [];

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (i === 0) {
        console.log('Skipping header row');
        continue;
      }

      if (this.isValidLine(line, name)) {
        if (this.isVariableSplit(line)) {
          result.push([`${line[1]} ${line[0]}`, name, line[3], 'Variably', '%', '%']);
        } else {
          // Covers ordinary transactions as well as splitRulesDict.SHARED
          // vendors (known joint bills) — both split evenly.
          result.push([`${line[1]} ${line[0]}`, name, line[3], 'Equally', 'TRUE', 'TRUE']);
        }
      } else {
        invalidLines.push(line);
      }
    }

    if (this.sorted) {
      return [[...result].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)), invalidLines];
    }
    return [result, invalidLines];
  }

  isVariableSplit(line: TransactionRow): boolean {
    const variableLines = this.splitRulesDict.VARIABLE;
    if (variableLines === undefined) {
      throw new Error('No variable lines');
    }
    return includesAnyCaseInsensitive(line[1], variableLines);
  }

  isValidLine(line: TransactionRow, name: string): boolean {
    const excludedLines = this.personalExclusions[name.toUpperCase()];
    if (excludedLines === undefined) {
      throw new Error(`No personal exclusions configured for name: ${name}`);
    }
    return !includesAnyCaseInsensitive(line[1], excludedLines);
  }
}

// Real exports (e.g. Citi's, mostly ALL CAPS) don't reliably match the
// mixed/title case used in the vendor lists above, so matching is
// case-insensitive.
function includesAnyCaseInsensitive(description: string, patterns: string[]): boolean {
  const normalizedDescription = description.toLowerCase();
  return patterns.some((pattern) => normalizedDescription.includes(pattern.toLowerCase()));
}
