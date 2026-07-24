import type { Sheet } from './types.js';
import {
  CHECKBOX_VALIDATION,
  PARTICIPANT_COLUMN_OFFSET,
  PERCENT_VALIDATION,
  SPLIT_TYPE_COLUMN,
  getParticipantCount,
  isEquallySplitRow,
  isVariablySplitRow,
} from './sheetLayout.js';
import { recalculateSettleUp } from './settleUp.js';

/*
 * Hello there, inquisitive  friend.
 *
 * Hacked by Sam Killin, August 2018.
 * www.homies.rent
 * help@homies.rent
 */

/**
 * Simple trigger Apps Script calls on every edit made directly in the
 * sheet's UI (does not fire for edits made via the Sheets API or another
 * script — see addTransactionsForPeriod in syncApi.ts for that path).
 *
 * @param e - The edit event Apps Script provides to onEdit simple triggers.
 */
export function onEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  Logger.log('Starting Edit');
  const row = e.range.getRow();
  const sheet = e.source.getActiveSheet();
  const val = e.value;
  const col = e.range.getColumn();

  if (row == 1) {
    onHeaderChange(sheet, row, col, val);
  } else {
    onDataChange(sheet, row, col, val);
  }
  recalculateSettleUp(sheet);
}

/**
 * Placeholder for header-row edit handling — currently a no-op.
 *
 * @param _sheet - The sheet the edit occurred on.
 * @param _row - The edited row number (always 1 for a header edit).
 * @param _col - The edited column number.
 * @param _val - The cell's new value.
 */
export function onHeaderChange(_sheet: Sheet, _row: number, _col: number, _val: string | undefined): void {
  //TODO(SK) something, probably.
  return;
}

/**
 * Routes a data-row edit to the split-type handler when column D changed.
 *
 * @param sheet - The sheet the edit occurred on.
 * @param row - The edited row number.
 * @param col - The edited column number.
 * @param _val - The cell's new value.
 */
export function onDataChange(sheet: Sheet, row: number, col: number, _val: string | undefined): void {
  Logger.log('onDataChange');

  if (col == SPLIT_TYPE_COLUMN) {
    onSplitTypeChanged(sheet, row);
  }
}

/**
 * Applies the default value + data validation for every participant column
 * on `row`, based on that row's "How to split" value: a checkbox defaulted
 * to checked for "Equally", or an even percentage share for "Variably".
 * Called both from onEdit (a human picking a dropdown value) and from
 * addTransactionsForPeriod in syncApi.ts (a row inserted via the sync API).
 *
 * @param sheet - The sheet containing the row.
 * @param row - The row whose "How to split" value changed.
 */
export function onSplitTypeChanged(sheet: Sheet, row: number): void {
  Logger.log('onSplitTypeChanged');

  const participantCount = getParticipantCount(sheet);

  const isEquallySplit = isEquallySplitRow(sheet, row);
  const isVariablySplit = isVariablySplitRow(sheet, row);

  for (let i = 0; i < participantCount; i++) {
    const col = PARTICIPANT_COLUMN_OFFSET + i + 1;
    const range = sheet.getRange(row, col);

    // Update this row col to be a variable percentage split
    if (isVariablySplit) {
      range.setValue(100 / participantCount + '%');
      range.setDataValidation(PERCENT_VALIDATION);
      // Update this row col to be an equal, checkbox togglerable split
    } else if (isEquallySplit) {
      range.setValue(true);
      range.setDataValidation(CHECKBOX_VALIDATION);
    }
  }
}
