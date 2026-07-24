import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toIsoDate, getPeriodLabel } from './dateUtils.js';

describe('toIsoDate', () => {
  it('converts MM/DD/YYYY to YYYY-MM-DD', () => {
    assert.equal(toIsoDate('06/29/2026'), '2026-06-29');
  });

  it('throws on an unrecognized format', () => {
    assert.throws(() => toIsoDate('2026-06-29'), /Unrecognized date format/);
  });
});

describe('getPeriodLabel', () => {
  it('converts MM/DD/YYYY to MM/YY', () => {
    assert.equal(getPeriodLabel('06/29/2026'), '06/26');
  });

  it('throws on an unrecognized format', () => {
    assert.throws(() => getPeriodLabel('not-a-date'), /Unrecognized date format/);
  });
});
