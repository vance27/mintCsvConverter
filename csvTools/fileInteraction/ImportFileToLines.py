import csv

class ImportFileTolines:
    results = []
    file = ""

    def __init__(self, file):
        self.file = file


    def get_results(self):
        print("Importing file, converting to lines")
        # todo check file can be opened
        with open(self.file) as csvFile:
            reader = csv.reader(csvFile, quoting=csv.QUOTE_NONNUMERIC)  # change contents to floats
            for row in reader:  # each row is a list
                self.results.append(row)
        return self.results
