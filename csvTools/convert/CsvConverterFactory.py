class CsvConverterFactory:
    bannedLinesDict = {
        "PATRICE": [
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
    "BRIAN":  [
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
    "SHARED": [
        "LTF LIFE TIME MO DUES",
        "HONDA PMT",
        "STATE FARM",
        "TRUPANION",
        "CPENERGY",
        "METRONET",
        "XCEL ENERGY",
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
        "Monthly Maintenance Fee",
        'MOBILE PAYMENT - THANK YOU',
        'INTERNET PAYMENT - THANK YOU',
        'AUTOPAY PAYMENT - THANK YOU',
        'PAYMENT THANK YOU',
        'Web Authorized Pmt',
        
    ],
    "VARIABLE": [
                'Costco',
        'TARGET'
    ]
    }

    

    sorted=False

    def convert(self, lines, outputFormat, name):
        converter = self._get_converter(outputFormat)
        # print("Converting file", lines)
        return converter(lines, name)

    # Create conversion service by format
    def _get_converter(self, outputFormat):
        print("Getting converter", outputFormat)
        if outputFormat == 'EXPENSE_SPLITTING':
            return self._convert_to_expense_splitting
        else:
            raise ValueError(format)

    def _convert_to_expense_splitting(self, lines, name):
        # print("Convert to expense splitting called", lines)
        # CONCAT date, description -> description (0)
        # DEFAULT brian -> who paid (1)
        # ADD amount -> amount (2)
        result = []
        invalidLines = []

        for i, line in reversed(list(enumerate(lines))):
            if i == 0:
                print("Skipping header row")
            elif self._valid_line(line, name):
                if self._variable_split(line):
                    result.append([
                        line[1] + ' ' + line[0],
                        name,
                        line[3],
                        "Variably",
                        "%",
                        "%"
                    ])
                else:
                    result.append([
                        line[1] + ' ' + line[0],
                        name,
                        line[3],
                        "Equally",
                        "TRUE",
                        "TRUE"
                    ])
            else:
                # print("Not valid line", line)
                invalidLines.append(line)
        if self.sorted:
            return sorted(result, key=lambda x: x[0])
        return (result, invalidLines)

    def _variable_split(self, line):
        variableLines = self.bannedLinesDict.get("VARIABLE")
        if variableLines is None:
            throw("No variable lines")
        for variableLine in variableLines:
            if variableLine in line[1]:
                return True

        return False

    def _valid_line(self, line, name):
        bannedLines = self.bannedLinesDict.get(name.upper())
        sharedLines = self.bannedLinesDict.get("SHARED")
        if bannedLines is None:
            throw("No banned lines for name: ", name)
        if sharedLines is None:
            throw("No shared lines")
        for bannedLine in bannedLines:
            if bannedLine in line[1]:
                return False
        for bannedLine in sharedLines:
            if bannedLine in line[1]:
                return False
        return True

# Conversion logic
