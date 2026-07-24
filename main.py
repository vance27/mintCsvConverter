import argparse
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


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Convert a Mint.com transaction export CSV into an expense-splitting CSV."
    )
    parser.add_argument("input_file", help="Path to the Mint.com transaction export CSV")
    parser.add_argument("output_format", help="Output format (currently only EXPENSE_SPLITTING is supported)")
    parser.add_argument("name", nargs="?", default="Brian", help="Name of the person who paid (default: Brian)")
    return parser.parse_args(argv)


def main():
    args = parse_args()
    file = args.input_file
    outputFormat = args.output_format
    name = args.name

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


