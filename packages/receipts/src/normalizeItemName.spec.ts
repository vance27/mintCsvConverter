import { describe, it, expect } from 'vitest';
import { normalizeItemName } from './normalizeItemName.js';

describe('normalizeItemName', () => {
  it('uppercases and collapses whitespace', () => {
    expect(normalizeItemName('Org  Bananas')).toBe('ORG BANANAS');
  });

  it('strips punctuation/noise', () => {
    expect(normalizeItemName('ORG BANANAS.')).toBe('ORG BANANAS');
    expect(normalizeItemName('SILK ORG.ALM')).toBe('SILK ORG ALM');
  });

  it('trims leading/trailing space', () => {
    expect(normalizeItemName('  KS BEEF STKS  ')).toBe('KS BEEF STKS');
  });

  it('maps trivially-different printings of the same item together', () => {
    expect(normalizeItemName('Org Bananas')).toBe(normalizeItemName('ORG  BANANAS.'));
  });
});
