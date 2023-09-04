import csv
import datetime

class ExportFileToLines:
    lines = []

    def __init__(self, lines):
        self.lines = lines

    def writeFile(self, name, valid="VALID"):
        file = open(r''+name+str(datetime.datetime.now())+valid+'csvConverter.csv', 'w+', newline='')
        with file:
            write = csv.writer(file)
            write.writerows(self.lines)