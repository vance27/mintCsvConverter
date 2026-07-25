import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { renderPdfPages } from './renderPdf.js';

const FIXTURE = fileURLToPath(new URL('./testing/fixtures/blank-page.pdf', import.meta.url));
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('renderPdfPages', () => {
  it('renders each page of a PDF to a PNG buffer', async () => {
    const pages = await renderPdfPages(FIXTURE);
    expect(pages).toHaveLength(1);
    expect(pages[0].subarray(0, 8)).toEqual(PNG_MAGIC);
  });

  it('renders larger images at a higher scale', async () => {
    const small = await renderPdfPages(FIXTURE, 1);
    const large = await renderPdfPages(FIXTURE, 3);
    expect(large[0].length).toBeGreaterThan(small[0].length);
  });
});
