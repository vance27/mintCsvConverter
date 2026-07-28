import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';

/** Where scraped item-photo thumbnails live — same "retained locally, not just a URL" convention as receiptStorage.ts. */
export function defaultItemImagesBaseDir(): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
    return `${home}/.config/mint-csv-converter/item-images`;
}

/**
 * Builds the Google Images query for one item — itemCode is the more
 * specific, less ambiguous signal when present (see the "costco <itemCode>"
 * pattern that motivated this whole approach); lastSeenName is the fallback
 * for items the VLM never read a code for.
 */
export function buildImageSearchQuery(storeName: string, item: { itemCode: string | null; lastSeenName: string }): string {
    return `${storeName} ${item.itemCode ?? item.lastSeenName}`;
}

/**
 * True when Google served its "unusual traffic" reCAPTCHA interstitial
 * instead of real results — a real, observed failure mode (not just
 * hypothetical) for automated requests to Google Images, even from a
 * headless browser. Checked against the rendered page's own text, not
 * status code, since Google returns 200 for this page too.
 */
export function isBlockedPage(pageText: string): boolean {
    return /unusual traffic|i'm not a robot/i.test(pageText);
}

export interface CandidateImage {
    src: string;
    width: number;
    height: number;
}

/**
 * Picks the first plausible content-result thumbnail out of every <img> on
 * a rendered Google Images results page — skips non-http(s) sources (inline
 * data: URI placeholders) and anything small enough to be UI chrome (nav
 * icons, the Google logo) rather than an actual result.
 */
export function pickFirstResultImage(images: CandidateImage[], minDimension = 50): string | null {
    const candidate = images.find(
        (img) => img.src.startsWith('https://') && img.width >= minDimension && img.height >= minDimension,
    );
    return candidate?.src ?? null;
}

/** Maps a downloaded image's content-type to a file extension — defaults to jpg, the overwhelmingly common case. */
export function extensionForContentType(contentType: string): string {
    if (contentType.includes('png')) {
        return 'png';
    }
    if (contentType.includes('webp')) {
        return 'webp';
    }
    if (contentType.includes('gif')) {
        return 'gif';
    }
    return 'jpg';
}

export interface ScrapedImage {
    buffer: Buffer;
    contentType: string;
}

/** Persists a scraped image to local storage, keyed by Item id (overwrites on re-scrape). */
export function saveItemImage(itemId: number, image: ScrapedImage, baseDir: string = defaultItemImagesBaseDir()): string {
    mkdirSync(baseDir, { recursive: true });
    const path = join(baseDir, `${itemId}.${extensionForContentType(image.contentType)}`);
    writeFileSync(path, image.buffer);
    return path;
}

export type ScrapeItemImageResult = { blocked: true } | { blocked: false; image: ScrapedImage | null };

/**
 * Runs one item's search against Google Images in an already-open Playwright
 * page, returning the first plausible result thumbnail, or `{ blocked: true
 * }` if Google served its CAPTCHA wall instead (see isBlockedPage). Reuses
 * the caller's page/browser across items rather than launching fresh per
 * item — cheaper, and looks less like a scripted burst of new sessions.
 *
 * Deliberately grabs the results-grid thumbnail rather than clicking through
 * to each result's "original size" image: one page load per item instead of
 * two, half the CAPTCHA exposure, and a moderate-resolution thumbnail is
 * plenty for a receipt-review recognition aid.
 */
export async function scrapeItemImage(page: Page, query: string): Promise<ScrapeItemImageResult> {
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&udm=2`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    // Thumbnails lazy-load in after the initial DOM is ready.
    await page.waitForTimeout(1500);

    const bodyText = await page.locator('body').innerText();
    if (isBlockedPage(bodyText)) {
        return { blocked: true };
    }

    const images = await page.$$eval('img', (imgs) =>
        imgs.map((img) => ({ src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight })),
    );
    const url = pickFirstResultImage(images);
    if (!url) {
        return { blocked: false, image: null };
    }

    // Fetched through the page's own request context (not a bare top-level
    // fetch) so it carries whatever cookies/session this navigation picked
    // up — some result thumbnails are proxied through a URL that expects them.
    const response = await page.request.get(url);
    return {
        blocked: false,
        image: { buffer: await response.body(), contentType: response.headers()['content-type'] ?? 'image/jpeg' },
    };
}
