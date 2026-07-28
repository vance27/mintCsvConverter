import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { getPrisma } from '../db.js';
import { buildImageSearchQuery, scrapeItemImage, saveItemImage } from '../itemImages.js';

// One-off, manually-run bulk backfill — not part of ingest, since Google
// Images scraping is inherently fragile (Google can CAPTCHA-wall automated
// requests, even from a real headless browser) and is meant to be run every
// once in a while, not on every receipt:
//
//   nx run @mint-csv-converter/receipts:scrape-item-images -- [--limit N] [--headed]
//
// Only ever attempts Items where imagePath is still null, so a run is safe
// to stop and resume at any time — a CAPTCHA block just ends the run early,
// leaving the rest for next time.

const USAGE = `Usage: scrapeItemImages.ts [--limit N] [--headed]

  --limit    Only attempt this many items this run (default: every item still missing an image)
  --headed   Show the browser window — lets you solve a CAPTCHA by hand if Google shows one`;

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A few seconds of jitter between items — looks less like a scripted burst than a fixed interval. */
function delayBetweenItems(): Promise<void> {
    return sleep(3000 + Math.random() * 3000);
}

function waitForEnter(promptText: string): Promise<void> {
    process.stdout.write(promptText);
    return new Promise((resolve) => {
        process.stdin.once('data', () => resolve());
    });
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            limit: { type: 'string' },
            headed: { type: 'boolean', default: false },
            help: { type: 'boolean', default: false },
        },
    });

    if (values.help) {
        console.log(USAGE);
        return;
    }

    const prisma = getPrisma();
    const items = await prisma.item.findMany({
        where: { imagePath: null },
        include: { store: true },
        orderBy: { id: 'asc' },
        ...(values.limit ? { take: Number(values.limit) } : {}),
    });

    if (items.length === 0) {
        console.log('Every item already has an image.');
        await prisma.$disconnect();
        return;
    }

    console.log(`Scraping images for ${items.length} item(s)${values.headed ? ' (headed)' : ''}...`);
    const browser = await chromium.launch({ headless: !values.headed });
    const page = await browser.newPage({ userAgent: USER_AGENT, viewport: { width: 1280, height: 900 } });

    let saved = 0;
    let skipped = 0;

    for (const item of items) {
        const query = buildImageSearchQuery(item.store.name, item);
        process.stdout.write(`  ${item.lastSeenName} (${query})... `);

        let result = await scrapeItemImage(page, query);
        if (result.blocked && values.headed) {
            await waitForEnter(
                '\n  Google is showing a CAPTCHA — solve it in the browser window, then press Enter to retry this item... ',
            );
            result = await scrapeItemImage(page, query);
        }

        if (result.blocked) {
            console.log('blocked by Google — stopping here for this run.');
            break;
        }

        if (!result.image) {
            console.log('no image found — skipped.');
            skipped++;
        } else {
            const path = saveItemImage(item.id, result.image);
            await prisma.item.update({ where: { id: item.id }, data: { imagePath: path } });
            console.log(`saved ${path}`);
            saved++;
        }

        await delayBetweenItems();
    }

    console.log(`\nDone: ${saved} saved, ${skipped} skipped, ${items.length - saved - skipped} left for next run.`);
    await browser.close();
    await prisma.$disconnect();
    // waitForEnter leaves stdin in resumed/flowing mode when --headed hit a
    // CAPTCHA — without this the process hangs open after main() resolves.
    process.stdin.pause();
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
