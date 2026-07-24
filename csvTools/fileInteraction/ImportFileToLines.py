import csv

class ImportFileTolines:
    def __init__(self, file):
        self.file = file
        self.results = []

    def get_results(self):
        print("Importing file, converting to lines")
        # todo check file can be opened
        with open(self.file, newline='', encoding='utf-8') as csvFile:
            reader = csv.reader(csvFile, quoting=csv.QUOTE_NONNUMERIC)  # change contents to floats
            for row in reader:  # each row is a list
                self.results.append(row)
        return self.results
