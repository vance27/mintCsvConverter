const DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** Converts Citi's MM/DD/YYYY date string to a lexically-comparable YYYY-MM-DD. */
export function toIsoDate(dateString: string): string {
  const match = DATE_PATTERN.exec(dateString.trim());
  if (!match) {
    throw new Error(`Unrecognized date format (expected MM/DD/YYYY): ${dateString}`);
  }
  const [, month, day, year] = match;
  return `${year}-${month}-${day}`;
}

/** Converts Citi's MM/DD/YYYY date string to the sheet tab period label MM/YY. */
export function getPeriodLabel(dateString: string): string {
  const match = DATE_PATTERN.exec(dateString.trim());
  if (!match) {
    throw new Error(`Unrecognized date format (expected MM/DD/YYYY): ${dateString}`);
  }
  const [, month, , year] = match;
  return `${month}/${year.slice(2)}`;
}
