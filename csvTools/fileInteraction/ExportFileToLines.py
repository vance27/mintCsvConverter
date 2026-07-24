import csv
import datetime

class ExportFileToLines:
    def __init__(self, lines):
        self.lines = lines

    def writeFile(self, name, valid="VALID"):
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
        filename = f"{name}_{timestamp}_{valid}_csvConverter.csv"
        with open(filename, 'w+', newline='', encoding='utf-8') as file:
            write = csv.writer(file)
            write.writerows(self.lines)