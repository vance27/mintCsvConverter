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

const receiptSchema = z.object({
  store: z.string().nullable().default(null),
  purchaseDate: z.string(),
  subtotal: z.coerce.number(),
  tax: z.coerce.number(),
  total: z.coerce.number(),
  items: z.array(lineItemSchema),
});

const RECEIPT_JSON_SCHEMA = z.toJSONSchema(receiptSchema);

// Grounded in a real Costco warehouse receipt (CHASKA #1646 sample, see
// costco-receipt-importer.md): each line is
// `<taxflag> <itemCode> <abbrevName> <extendedPrice> <Y/N taxable>`.
// Multi-quantity items add a separate `N @ unitPrice` annotation on the line
// above, whose product equals the extended price. Instant-savings discounts
// print as separate negative lines referencing an item code. The footer
// gives SUBTOTAL/TAX/TOTAL — TOTAL is the amount that matches the card
// transaction.
const COSTCO_PROMPT = `You are reading a Costco warehouse receipt image. Extract every purchased line item and the receipt totals as JSON matching the given schema.

Layout notes for Costco receipts:
- Each item line looks like: <tax-flag letter> <item code number> <abbreviated item name> <extended price> <Y or N>. The "Y"/"N" indicates whether the item was taxed — map it to the "taxable" field (Y -> true, N -> false).
- The item code is the numeric SKU (e.g. 1374492, or a short code like 6659) — always extract it as "itemCode", never omit it if present.
- Some items have a separate line above them like "3 @ 3.99" — this means quantity 3 at unit price 3.99, and the item's own line shows the extended price (3.99 * 3 = 11.97). When you see this, set quantity and unitPrice from the "@" line, and lineTotal from the item's own printed price. Otherwise assume quantity 1 and unitPrice equal to lineTotal.
- A discount/instant-savings line is a separate negative-amount line referencing an item code — attribute it to that item's "discountAmount" (as a positive number) rather than as its own line item.
- The footer has SUBTOTAL, TAX, and TOTAL lines — extract these as "subtotal", "tax", and "total". TOTAL is the amount that would match a card transaction.
- Extract the purchase date if visible; otherwise use your best guess and note it's uncertain by leaving other fields as accurate as possible.

Example: a line "E 1374492 WELCH SNACKS 13.89 Y" is one item: itemCode "1374492", rawName "WELCH SNACKS", lineTotal 13.89, taxable true, quantity 1, unitPrice 13.89.
Example: a "3 @ 3.99" annotation followed by "BLUEBERRIES 11.97" is one item: rawName "BLUEBERRIES", quantity 3, unitPrice 3.99, lineTotal 11.97.

Respond with JSON only, matching the schema exactly.`;

const GENERIC_PROMPT = `You are reading a store receipt image. Extract every purchased line item and the receipt totals as JSON matching the given schema. Extract the item code/SKU for each line whenever the receipt prints one. If a line shows a quantity and unit price (e.g. "3 @ 3.99"), use those for "quantity"/"unitPrice" and the line's own printed price for "lineTotal"; otherwise assume quantity 1. Attribute any discount shown for an item to that item's "discountAmount" rather than as a separate line. Extract "subtotal", "tax", and "total" from the receipt's footer. Respond with JSON only, matching the schema exactly.`;

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
