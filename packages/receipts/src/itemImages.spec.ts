import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildImageSearchQuery,
    isBlockedPage,
    pickFirstResultImage,
    extensionForContentType,
    saveItemImage,
} from './itemImages.js';

describe('buildImageSearchQuery', () => {
    it('prefers itemCode over the raw name when present', () => {
        expect(buildImageSearchQuery('Costco', { itemCode: '1374492', lastSeenName: 'FRUIT SNACK' })).toBe(
            'Costco 1374492',
        );
    });

    it('falls back to lastSeenName when there is no itemCode', () => {
        expect(buildImageSearchQuery('Costco', { itemCode: null, lastSeenName: 'TRUBAR VR TY' })).toBe(
            'Costco TRUBAR VR TY',
        );
    });
});

describe('isBlockedPage', () => {
    it('detects the "unusual traffic" reCAPTCHA interstitial', () => {
        expect(isBlockedPage('Our systems have detected unusual traffic from your computer network.')).toBe(true);
        expect(isBlockedPage("I'm not a robot")).toBe(true);
    });

    it('is false for ordinary results-page text', () => {
        expect(isBlockedPage('Welch’s Fruit Snacks, .8 oz, 90-count Costco')).toBe(false);
    });
});

describe('pickFirstResultImage', () => {
    it('picks the first https image at or above the minimum dimension', () => {
        const images = [
            { src: 'data:image/png;base64,abc', width: 200, height: 200 },
            { src: 'https://gstatic.com/nav-icon.png', width: 16, height: 16 },
            { src: 'https://encrypted-tbn0.gstatic.com/images?q=result1', width: 150, height: 150 },
            { src: 'https://encrypted-tbn0.gstatic.com/images?q=result2', width: 300, height: 300 },
        ];
        expect(pickFirstResultImage(images)).toBe('https://encrypted-tbn0.gstatic.com/images?q=result1');
    });

    it('returns null when nothing plausible is found', () => {
        const images = [
            { src: 'data:image/png;base64,abc', width: 500, height: 500 },
            { src: 'https://gstatic.com/nav-icon.png', width: 16, height: 16 },
        ];
        expect(pickFirstResultImage(images)).toBeNull();
    });
});

describe('extensionForContentType', () => {
    it.each([
        ['image/png', 'png'],
        ['image/webp', 'webp'],
        ['image/gif', 'gif'],
        ['image/jpeg', 'jpg'],
        ['application/octet-stream', 'jpg'],
    ])('%s -> %s', (contentType, expected) => {
        expect(extensionForContentType(contentType)).toBe(expected);
    });
});

describe('saveItemImage', () => {
    const dirs: string[] = [];

    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it('writes the image under the item id with an extension matching its content type', () => {
        const baseDir = mkdtempSync(join(tmpdir(), 'item-images-test-'));
        dirs.push(baseDir);
        const buffer = Buffer.from('fake-png-bytes');

        const path = saveItemImage(42, { buffer, contentType: 'image/png' }, baseDir);

        expect(path).toBe(join(baseDir, '42.png'));
        expect(readFileSync(path)).toEqual(buffer);
    });
});
