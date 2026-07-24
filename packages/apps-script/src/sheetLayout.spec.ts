import { describe, it, expect } from 'vitest';
import { FakeSheet } from './testing/fakeSheet.js';
import {
  getParticipantCount,
  getParticipantNames,
  getParticipantIndexByName,
  isEquallySplitRow,
  isVariablySplitRow,
  countEquallySplitParticipants,
  sumVariableSplitShares,
  getTotalRowAnchor,
  getPayeeNamesForRows,
} from './sheetLayout.js';

describe('getParticipantCount', () => {
  it('derives the count from how far the header row extends past the fixed columns', () => {
    const sheet = new FakeSheet([['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice']]);
    expect(getParticipantCount(sheet.asSheet())).toBe(2);
  });
});

describe('getParticipantNames', () => {
  it('reads participant names from the header row', () => {
    const sheet = new FakeSheet([['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice']]);
    expect(getParticipantNames(sheet.asSheet())).toEqual(['Brian', 'Patrice']);
  });
});

describe('getParticipantIndexByName', () => {
  it('maps each name to its column position', () => {
    expect(getParticipantIndexByName(['Brian', 'Patrice'])).toEqual({ Brian: 0, Patrice: 1 });
  });
});

describe('isEquallySplitRow / isVariablySplitRow', () => {
  it('reads the split type from column D', () => {
    const sheet = new FakeSheet([
      [], // row 1: header, unused here
      ['Chipotle', 'Brian', 25, 'Equally'],
      ['Costco', 'Brian', 150, 'Variably'],
    ]);
    expect(isEquallySplitRow(sheet.asSheet(), 2)).toBe(true);
    expect(isVariablySplitRow(sheet.asSheet(), 2)).toBe(false);
    expect(isEquallySplitRow(sheet.asSheet(), 3)).toBe(false);
    expect(isVariablySplitRow(sheet.asSheet(), 3)).toBe(true);
  });
});

describe('countEquallySplitParticipants', () => {
  it('counts how many participant checkboxes are checked', () => {
    const sheet = new FakeSheet([[], ['Chipotle', 'Brian', 25, 'Equally', true, false]]);
    expect(countEquallySplitParticipants(sheet.asSheet(), 2, 2)).toBe(1);
  });
});

describe('sumVariableSplitShares', () => {
  it('sums the participant-column share values', () => {
    const sheet = new FakeSheet([[], ['Costco', 'Brian', 150, 'Variably', 60, 40]]);
    expect(sumVariableSplitShares(sheet.asSheet(), 2, 2)).toBe(100);
  });
});

describe('getTotalRowAnchor', () => {
  it('returns the row before the literal "TOTAL OWING" marker', () => {
    const sheet = new FakeSheet([
      [], // row 1: header
      ['Chipotle', 'Brian', 25, 'Equally', true, true], // row 2
      ['', '', '', 'TOTAL OWING'], // row 3: marker
    ]);
    expect(getTotalRowAnchor(sheet.asSheet())).toBe(2);
  });
});

describe('getPayeeNamesForRows', () => {
  it('reads the "Who Paid" column for every transaction row up to the anchor', () => {
    const sheet = new FakeSheet([
      [], // row 1: header
      ['Chipotle', 'Brian', 25, 'Equally'], // row 2
      ['Groceries', 'Patrice', 60, 'Equally'], // row 3
      ['', '', '', 'TOTAL OWING'], // row 4: marker, anchor = 3
    ]);
    expect(getPayeeNamesForRows(sheet.asSheet(), 3)).toEqual(['Brian', 'Patrice']);
  });
});
