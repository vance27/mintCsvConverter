/** A single line item as extracted from a receipt (pre-persistence). */
export interface ExtractedLineItem {
  /** The store's item number/SKU, when present — the stable dedup key. */
  itemCode: string | null;
  /** The raw (often cryptic/abbreviated) name printed on the receipt. */
  rawName: string;
  quantity: number;
  unitPrice: number;
  /** The extended (printed) price for the line: quantity × unitPrice. */
  lineTotal: number;
  taxable: boolean | null;
  /** Positive dollar amount of any discount applied to the line (0 if none). */
  discountAmount: number;
}

/** A whole receipt as extracted from its PDF (pre-persistence). */
export interface ExtractedReceipt {
  store: string | null;
  /** ISO date (YYYY-MM-DD) of the purchase. */
  purchaseDate: string;
  subtotal: number;
  tax: number;
  total: number;
  items: ExtractedLineItem[];
}
