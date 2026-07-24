import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeGasGlobals } from './testing/fakeGasGlobals.js';
import { FakeSheet } from './testing/fakeSheet.js';

// Must run before dynamically importing sheetLayout.js, since its
// CHECKBOX_VALIDATION/PERCENT_VALIDATION constants call
// SpreadsheetApp.newDataValidation() at module load time.
installFakeGasGlobals();

const {
  getParticipantCount,
  getParticipantNames,
  getParticipantIndexByName,
  isEquallySplitRow,
  isVariablySplitRow,
  countEquallySplitParticipants,
  sumVariableSplitShares,
  getTotalRowAnchor,
  getPayeeNamesForRows,
} = await import('./sheetLayout.js');

describe('getParticipantCount', () => {
  it('derives the count from how far the header row extends past the fixed columns', () => {
    const sheet = new FakeSheet([['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice']]);
    assert.equal(getParticipantCount(sheet.asSheet()), 2);
  });
});

describe('getParticipantNames', () => {
  it('reads participant names from the header row', () => {
    const sheet = new FakeSheet([['Description', 'Who Paid', 'Amount', 'How to split', 'Brian', 'Patrice']]);
    assert.deepEqual(getParticipantNames(sheet.asSheet()), ['Brian', 'Patrice']);
  });
});

describe('getParticipantIndexByName', () => {
  it('maps each name to its column position', () => {
    assert.deepEqual(getParticipantIndexByName(['Brian', 'Patrice']), { Brian: 0, Patrice: 1 });
  });
});

describe('isEquallySplitRow / isVariablySplitRow', () => {
  it('reads the split type from column D', () => {
    const sheet = new FakeSheet([
      [], // row 1: header, unused here
      ['Chipotle', 'Brian', 25, 'Equally'],
      ['Costco', 'Brian', 150, 'Variably'],
    ]);
    assert.equal(isEquallySplitRow(sheet.asSheet(), 2), true);
    assert.equal(isVariablySplitRow(sheet.asSheet(), 2), false);
    assert.equal(isEquallySplitRow(sheet.asSheet(), 3), false);
    assert.equal(isVariablySplitRow(sheet.asSheet(), 3), true);
  });
});

describe('countEquallySplitParticipants', () => {
  it('counts how many participant checkboxes are checked', () => {
    const sheet = new FakeSheet([[], ['Chipotle', 'Brian', 25, 'Equally', true, false]]);
    assert.equal(countEquallySplitParticipants(sheet.asSheet(), 2, 2), 1);
  });
});

describe('sumVariableSplitShares', () => {
  it('sums the participant-column share values', () => {
    const sheet = new FakeSheet([[], ['Costco', 'Brian', 150, 'Variably', 60, 40]]);
    assert.equal(sumVariableSplitShares(sheet.asSheet(), 2, 2), 100);
  });
});

describe('getTotalRowAnchor', () => {
  it('returns the row before the literal "TOTAL OWING" marker', () => {
    const sheet = new FakeSheet([
      [], // row 1: header
      ['Chipotle', 'Brian', 25, 'Equally', true, true], // row 2
      ['', '', '', 'TOTAL OWING'], // row 3: marker
    ]);
    assert.equal(getTotalRowAnchor(sheet.asSheet()), 2);
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
    assert.deepEqual(getPayeeNamesForRows(sheet.asSheet(), 3), ['Brian', 'Patrice']);
  });
});
