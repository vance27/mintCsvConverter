import sys
from csvTools.convert import CsvConverterFactory as ccf
from csvTools.fileInteraction import ImportFileToLines as iftl
from csvTools.fileInteraction import ExportFileToLines as eftl

def convertFile(inputFile, outputFormat, name="Brian"):
    # call factory for specific converter
    print("Converting file: ", inputFile, " in ", outputFormat, " format, for ", name)
    importer = iftl.ImportFileTolines(inputFile)
    lines = importer.get_results()
    converter = ccf.CsvConverterFactory()
    return converter.convert(lines, outputFormat, name)


def main():
    # Inputs
    # file: csvTools file that you want to convert
    # outputType: output file format
    # name: name of person who paid for the expenses
    file = sys.argv[1]
    outputFormat = sys.argv[2]
    if sys.argv[3] is not None:
        name = sys.argv[3]
    else:
        name = "Brian"
        
    print("Starting conversion process", file, outputFormat)
    # call service to convert file
    lines, invalidLines = convertFile(file, outputFormat, name)
    exporter = eftl.ExportFileToLines(lines)
    invalidExporter = eftl.ExportFileToLines(invalidLines)
    exporter.writeFile(name)
    invalidExporter.writeFile(name, "INVALID")
    print("Done with conversion process")

if __name__ == '__main__':
    main()


