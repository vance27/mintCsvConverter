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

/** How a tender line was paid — constrains what the extractor may emit; see extractReceipt.ts's tenderSchema. */
export type TenderKind = 'CARD' | 'CASH' | 'COSTCO_CASH_REWARD' | 'OTHER';

/** One payment line from the receipt footer (never a card/account number, only method + amount). */
export interface ExtractedTender {
  kind: TenderKind;
  /** Printed method name/label, with any card or account digits redacted. */
  label: string;
  amount: number;
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
  /** Payment breakdown from the footer — usually one CARD line equal to total; more than one means a split payment (e.g. partly cash). */
  tenders: ExtractedTender[];
}
