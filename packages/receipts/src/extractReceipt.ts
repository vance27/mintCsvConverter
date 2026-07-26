import { z } from 'zod';
import { renderPdfPages } from './renderPdf.js';
import { defaultOllamaModel, type VisionChatClient } from './ollamaClient.js';
import type { ExtractedReceipt } from './types.js';

const lineItemSchema = z.object({
  itemCode: z.string().nullable().default(null),
  rawName: z.string(),
  quantity: z.coerce.number().default(1),
  unitPrice: z.coerce.number(),
  lineTotal: z.coerce.number(),
  taxable: z.boolean().nullable().default(null),
  discountAmount: z.coerce.number().default(0),
});

const tenderSchema = z.object({
  kind: z.enum(['CARD', 'CASH', 'COSTCO_CASH_REWARD', 'OTHER']),
  label: z.string(),
  amount: z.coerce.number(),
});

const receiptSchema = z.object({
  store: z.string().nullable().default(null),
  purchaseDate: z.string(),
  subtotal: z.coerce.number(),
  tax: z.coerce.number(),
  total: z.coerce.number(),
  items: z.array(lineItemSchema),
  tenders: z.array(tenderSchema).default([]),
});

const RECEIPT_JSON_SCHEMA = z.toJSONSchema(receiptSchema);

// Grounded in a real Costco warehouse receipt (CHASKA #1646 sample, see
// costco-receipt-importer.md): each line is
// `<taxflag> <itemCode> <abbrevName> <extendedPrice> <Y/N taxable>`.
// Multi-quantity items add a separate `N @ unitPrice` annotation on the line
// above, whose product equals the extended price. Instant-savings discounts
// print as separate negative lines referencing an item code. The footer
// gives SUBTOTAL/TAX/TOTAL, followed by one tender line per payment method
// used — usually one card line equal to TOTAL, but a purchase split across
// tender types (e.g. partly cash, partly Costco Cash Rewards) prints more
// than one, and only the card portion is what will match a Citi CSV
// transaction.
const COSTCO_PROMPT = `You are reading a Costco warehouse receipt image. Extract every purchased line item, the receipt totals, and the tender (payment) breakdown as JSON matching the given schema.

Layout notes for Costco receipts:
- Each item line looks like: <tax-flag letter> <item code number> <abbreviated item name> <extended price> <Y or N>. The "Y"/"N" indicates whether the item was taxed — map it to the "taxable" field (Y -> true, N -> false).
- The item code is the numeric SKU (e.g. 1374492, or a short code like 6659) — always extract it as "itemCode", never omit it if present.
- Some items have a separate line above them like "3 @ 3.99" — this means quantity 3 at unit price 3.99, and the item's own line shows the extended price (3.99 * 3 = 11.97). When you see this, set quantity and unitPrice from the "@" line, and lineTotal from the item's own printed price. Otherwise assume quantity 1 and unitPrice equal to lineTotal.
- A discount/instant-savings line is a separate negative-amount line referencing an item code — attribute it to that item's "discountAmount" (as a positive number) rather than as its own line item.
- The footer has SUBTOTAL, TAX, and TOTAL lines — extract these as "subtotal", "tax", and "total".
- Below TOTAL, the receipt lists how the purchase was paid — one line per tender used, e.g. a masked card number followed by CHIP/SWIPE/TAP, "CASH TEND", "COSTCO CASH REWARD", "DEBIT", "EBT", or "CHECK". Extract every such line into "tenders": "kind" is "CARD" for any credit/debit/chip/swipe/tap line, "CASH" for cash, "COSTCO_CASH_REWARD" for a Costco Cash Reward, and "OTHER" for anything else (EBT, check, gift card). "label" is the printed method name only — never include the card number or any of its digits, even masked; use a plain description like "Card" instead. "amount" is the dollar amount tendered on that line. Most receipts have exactly one tender line equal to TOTAL; if the purchase was split across payment methods there will be more than one, and together they should sum to TOTAL.
- Extract the purchase date if visible; otherwise use your best guess and note it's uncertain by leaving other fields as accurate as possible.

Example: a line "E 1374492 WELCH SNACKS 13.89 Y" is one item: itemCode "1374492", rawName "WELCH SNACKS", lineTotal 13.89, taxable true, quantity 1, unitPrice 13.89.
Example: a "3 @ 3.99" annotation followed by "BLUEBERRIES 11.97" is one item: rawName "BLUEBERRIES", quantity 3, unitPrice 3.99, lineTotal 11.97.
Example: a tender section reading "XXXXXXXXXXXX1234 CHIP 32.15" then "CASH TEND 20.00" is two tenders: { kind: "CARD", label: "Card", amount: 32.15 } and { kind: "CASH", label: "Cash", amount: 20.00 }.

Respond with JSON only, matching the schema exactly.`;

const GENERIC_PROMPT = `You are reading a store receipt image. Extract every purchased line item, the receipt totals, and the tender (payment) breakdown as JSON matching the given schema. Extract the item code/SKU for each line whenever the receipt prints one. If a line shows a quantity and unit price (e.g. "3 @ 3.99"), use those for "quantity"/"unitPrice" and the line's own printed price for "lineTotal"; otherwise assume quantity 1. Attribute any discount shown for an item to that item's "discountAmount" rather than as a separate line. Extract "subtotal", "tax", and "total" from the receipt's footer. Below that, extract each payment/tender line into "tenders" as { kind, label, amount }: "kind" is "CARD" for any credit/debit line, "CASH" for cash, "COSTCO_CASH_REWARD" for a Costco Cash Reward, or "OTHER" for anything else; "label" is the method name only — never include a card number or any of its digits, even masked. Multiple tender lines mean the purchase was split across payment methods and together should sum to "total". Respond with JSON only, matching the schema exactly.`;

/** Selects the extraction prompt for a given store — Costco is tuned for v1; other stores fall back to a generic prompt. */
export function buildExtractionPrompt(store: string | undefined): string {
  return store?.toLowerCase() === 'costco' ? COSTCO_PROMPT : GENERIC_PROMPT;
}

export interface ExtractReceiptOptions {
  store?: string;
  model?: string;
}

/**
 * Renders a receipt PDF and asks the VLM to extract its line items and
 * totals as structured JSON, validated with zod (model output is always
 * treated as untrusted — malformed or missing fields throw a clear error
 * rather than propagating silently).
 */
export async function extractReceipt(
  pdfPath: string,
  client: VisionChatClient,
  options: ExtractReceiptOptions = {},
): Promise<ExtractedReceipt> {
  const pages = await renderPdfPages(pdfPath);
  const images = pages.map((page) => page.toString('base64'));

  const response = await client.chat({
    model: options.model ?? defaultOllamaModel(),
    messages: [{ role: 'user', content: buildExtractionPrompt(options.store), images }],
    format: RECEIPT_JSON_SCHEMA,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(response.message.content);
  } catch (cause) {
    throw new Error(`Model did not return valid JSON: ${response.message.content}`, { cause });
  }

  const result = receiptSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(`Model's extracted receipt failed validation: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
