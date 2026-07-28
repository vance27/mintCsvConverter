import { pdf } from 'pdf-to-img';

/**
 * Renders every page of a receipt PDF to a PNG buffer, at a high enough
 * scale for small receipt-print digits (item codes, prices) to stay legible
 * to the VLM. Receipts have no reliable text layer, so this render→vision
 * path is the baseline extraction strategy, not a fallback.
 */
export async function renderPdfPages(pdfPath: string, scale = 3): Promise<Buffer[]> {
    const document = await pdf(pdfPath, { scale });
    const pages: Buffer[] = [];
    for await (const page of document) {
        pages.push(page);
    }
    return pages;
}
