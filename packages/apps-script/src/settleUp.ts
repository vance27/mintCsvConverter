import type { Sheet } from './types.js';
import {
    AMOUNT_COLUMN,
    PARTICIPANT_COLUMN_OFFSET,
    SPLIT_TYPE_COLUMN,
    countEquallySplitParticipants,
    getParticipantCount,
    getParticipantIndexByName,
    getParticipantNames,
    getPayeeNamesForRows,
    getTotalRowAnchor,
    isEquallySplitRow,
    isVariablySplitRow,
    sumVariableSplitShares,
} from './sheetLayout.js';

/**
 * Returns a square matrix filled with zeros.
 *
 * @param size - Width and height of the matrix.
 * @returns A `size` x `size` matrix, every cell 0.
 */
export function createZeroMatrix(size: number): number[][] {
    const matrix: number[][] = [];
    for (let i = 0; i < size; i++) {
        matrix.push([]);
        for (let j = 0; j < size; j++) {
            matrix[i].push(0);
        }
    }
    return matrix;
}

/**
 * Builds a participantCount x participantCount debt matrix from every
 * transaction row, where debtMatrix[payerIndex][payeeIndex] is the total
 * amount payerIndex owes payeeIndex across all transactions. For each row:
 * an equally-split amount is divided evenly among the checked participants;
 * a variably-split amount is divided proportionally to each participant's
 * share value.
 *
 * @param sheet - The sheet to read transaction rows from.
 * @param participantNames - Participant names in column order.
 * @param participantIndexByName - Lookup from participant name to index.
 * @param participantCount - Number of participants.
 * @param totalRowAnchor - The off-by-one anchor from getTotalRowAnchor.
 * @returns The debt matrix; `debtMatrix[payerIndex][payeeIndex]` is what
 *   `payerIndex` owes `payeeIndex`.
 */
export function buildDebtMatrix(
    sheet: Sheet,
    participantNames: string[],
    participantIndexByName: Record<string, number>,
    participantCount: number,
    totalRowAnchor: number,
): number[][] {
    Logger.log('Build Graph');

    const debtMatrix = createZeroMatrix(participantCount);
    const payeeNames = getPayeeNamesForRows(sheet, totalRowAnchor);
    for (let payeeNameIndex = 0; payeeNameIndex < payeeNames.length; payeeNameIndex++) {
        const payeeName = payeeNames[payeeNameIndex];
        const transactionRow = payeeNameIndex + 2;

        const payeeIndex = participantIndexByName[payeeName];
        const amountRange = sheet.getRange(transactionRow, AMOUNT_COLUMN, 1, 1);
        const amount = amountRange.getValue() as number;

        const isEquallySplit = isEquallySplitRow(sheet, transactionRow);
        let equallySplitParticipantCount = 0;
        if (isEquallySplit) {
            equallySplitParticipantCount = countEquallySplitParticipants(sheet, transactionRow, participantCount);
        }

        const isVariablySplit = isVariablySplitRow(sheet, transactionRow);
        let totalVariableShares = 0;
        if (isVariablySplit) {
            totalVariableShares = sumVariableSplitShares(sheet, transactionRow, participantCount);
        }

        for (let payerIndex = 0; payerIndex < participantCount; payerIndex++) {
            if (payerIndex == payeeIndex) {
                continue;
            }
            const payerColumn = PARTICIPANT_COLUMN_OFFSET + payerIndex + 1;
            const participantSplitRange = sheet.getRange(transactionRow, payerColumn);
            // The cell holds a checkbox (boolean) for an equally-split row or a
            // percentage share for a variably-split row — a string like "50%"
            // (onSplitTypeChanged's default, and what PERCENT_VALIDATION requires
            // a human to type), not a bare number.
            const participantSplitValue = participantSplitRange.getValue() as boolean | string;
            if (isEquallySplit && participantSplitValue == true) {
                const owedAmount = amount / equallySplitParticipantCount;
                debtMatrix[payerIndex][payeeIndex] += owedAmount;
            } else if (isVariablySplit) {
                const share = parseFloat(String(participantSplitValue));
                // Guard against NaN (e.g. a stray/blank cell): letting it into the
                // matrix would poison every downstream sum, and simplifyDebts'
                // convergence check (Math.abs(x) < 0.005) never terminates for NaN.
                if (!Number.isNaN(share) && share !== 0) {
                    const owedAmount = (share / totalVariableShares) * amount;
                    debtMatrix[payerIndex][payeeIndex] += owedAmount;
                }
            }
        }
    }

    return debtMatrix;
}

/**
 * @param values - Values to search.
 * @returns The index of the smallest value in `values`.
 */
export function indexOfMin(values: number[]): number {
    let min = values[0];
    let minIndex = 0;

    for (let i = 1; i < values.length; i++) {
        if (values[i] < min) {
            minIndex = i;
            min = values[i];
        }
    }
    return minIndex;
}

/**
 * @param values - Values to search.
 * @returns The index of the largest value in `values`.
 */
export function indexOfMax(values: number[]): number {
    let max = values[0];
    let maxIndex = 0;

    for (let i = 1; i < values.length; i++) {
        if (values[i] > max) {
            maxIndex = i;
            max = values[i];
        }
    }
    return maxIndex;
}

/**
 * Reduces the debt matrix to the minimal set of payments that settles
 * every balance, via a greedy algorithm: repeatedly match whoever is owed
 * the most against whoever owes the most, record a payment between them
 * for the smaller of the two amounts, and repeat until every net balance
 * is (within floating-point tolerance) zero.
 *
 * @param sheet - Unused directly, but kept for signature parity with computeSettlementPayments.
 * @param debtMatrix - Pairwise debts, as built by buildDebtMatrix.
 * @param participantNames - Participant names in column order.
 * @param participantIndexByName - Lookup from participant name to index.
 * @param participantCount - Number of participants.
 * @param _totalRowAnchor - Unused directly, but kept for signature parity with computeSettlementPayments.
 * @returns Payments as `[payerIndex, payeeIndex, paymentAmount]` tuples.
 */
export function simplifyDebts(
    sheet: Sheet,
    debtMatrix: number[][],
    participantNames: string[],
    participantIndexByName: Record<string, number>,
    participantCount: number,
    _totalRowAnchor: number,
): number[][] {
    const netBalances: number[] = [];

    for (let participantIndex = 0; participantIndex < participantCount; participantIndex++) {
        let netBalance = 0;
        for (let otherParticipantIndex = 0; otherParticipantIndex < participantCount; otherParticipantIndex++) {
            netBalance +=
                debtMatrix[otherParticipantIndex][participantIndex] -
                debtMatrix[participantIndex][otherParticipantIndex];
        }
        netBalances.push(netBalance);
    }

    const settlementPayments: number[][] = [];
    while (true) {
        const payeeIndex = indexOfMax(netBalances);
        const payerIndex = indexOfMin(netBalances);
        // fml floating point math
        if (Math.abs(netBalances[payeeIndex]) < 0.005 && Math.abs(netBalances[payerIndex]) < 0.005) {
            return settlementPayments;
        }
        const paymentAmount = Math.min(-netBalances[payerIndex], netBalances[payeeIndex]);
        netBalances[payeeIndex] -= paymentAmount;
        netBalances[payerIndex] += paymentAmount;
        settlementPayments.push([payerIndex, payeeIndex, paymentAmount]);
    }
}

/**
 * Decides how to present the debt matrix as a list of payments: if the
 * "simplify" checkbox (one row below the header, in the split-type column)
 * is checked, reduces it to a minimal set via simplifyDebts; otherwise
 * returns every non-zero pairwise debt verbatim.
 *
 * @param sheet - The sheet to read the "simplify" toggle from.
 * @param debtMatrix - Pairwise debts, as built by buildDebtMatrix.
 * @param participantNames - Participant names in column order.
 * @param participantIndexByName - Lookup from participant name to index.
 * @param participantCount - Number of participants.
 * @param totalRowAnchor - The off-by-one anchor from getTotalRowAnchor.
 * @returns Payments as `[payerIndex, payeeIndex, paymentAmount]` tuples.
 */
export function computeSettlementPayments(
    sheet: Sheet,
    debtMatrix: number[][],
    participantNames: string[],
    participantIndexByName: Record<string, number>,
    participantCount: number,
    totalRowAnchor: number,
): number[][] {
    const simplifyToggleRow = totalRowAnchor + 1 + 1; // header + 1
    const simplifyToggleColumn = SPLIT_TYPE_COLUMN;
    const simplifyToggleRange = sheet.getRange(simplifyToggleRow, simplifyToggleColumn);
    const shouldSimplifyDebts = simplifyToggleRange.getValue() as boolean;

    Logger.log(shouldSimplifyDebts);
    if (shouldSimplifyDebts == true) {
        return simplifyDebts(
            sheet,
            debtMatrix,
            participantNames,
            participantIndexByName,
            participantCount,
            totalRowAnchor,
        );
    }

    const payments: number[][] = [];
    // Spit out the payments verbatim
    for (let payerIndex = 0; payerIndex < debtMatrix.length; payerIndex++) {
        const owedToOthers = debtMatrix[payerIndex];
        for (let payeeIndex = 0; payeeIndex < owedToOthers.length; payeeIndex++) {
            const amount = owedToOthers[payeeIndex];
            if (amount > 0.005) {
                payments.push([payerIndex, payeeIndex, amount]);
            }
        }
    }
    return payments;
}

/**
 * Clears the settle-up summary area and writes each computed payment as
 * "<payee name> $<amount>" beneath the "TOTAL OWING" marker, one column
 * per payer, stacking multiple payments from the same payer downward.
 *
 * @param sheet - The sheet to write into.
 * @param payments - Payments as `[payerIndex, payeeIndex, paymentAmount]` tuples.
 * @param participantNames - Participant names in column order.
 * @param participantIndexByName - Lookup from participant name to index.
 * @param participantCount - Number of participants.
 * @param totalRowAnchor - The off-by-one anchor from getTotalRowAnchor.
 */
export function writeSettlementPayments(
    sheet: Sheet,
    payments: number[][],
    participantNames: string[],
    participantIndexByName: Record<string, number>,
    participantCount: number,
    totalRowAnchor: number,
): void {
    const nextRowOffsetByPayerIndex: number[] = [];
    for (let i = 0; i < participantCount; i++) {
        nextRowOffsetByPayerIndex.push(0);
    }

    const settlementAreaRange = sheet.getRange(
        totalRowAnchor + 1,
        PARTICIPANT_COLUMN_OFFSET + 1,
        participantCount,
        participantCount,
    );
    settlementAreaRange.clear({
        contentsOnly: true,
    });

    for (let i = 0; i < payments.length; i++) {
        const payment = payments[i];
        const payerIndex = payment[0];
        const payeeIndex = payment[1];
        const payeeName = participantNames[payeeIndex];
        const amount = payment[2];
        const outputCell = sheet.getRange(
            totalRowAnchor + nextRowOffsetByPayerIndex[payerIndex] + 1,
            PARTICIPANT_COLUMN_OFFSET + payerIndex + 1,
        );
        const formattedAmount = '$' + amount.toFixed(2);
        outputCell.setValue(payeeName + ' ' + formattedAmount);
        nextRowOffsetByPayerIndex[payerIndex] = nextRowOffsetByPayerIndex[payerIndex] + 1;
    }
}

/**
 * Recomputes the "who owes whom" settle-up summary: builds the debt matrix
 * from every transaction row, reduces it to a payment list (simplified or
 * verbatim per the sheet's toggle), and writes that list below the
 * "TOTAL OWING" marker. Called after every edit (via onEdit) and after
 * every batch of rows added via the sync API (via addTransactionsForPeriod).
 *
 * @param sheet - The sheet to recalculate.
 */
export function recalculateSettleUp(sheet: Sheet): void {
    Logger.log('Calculate');

    const participantNames = getParticipantNames(sheet);
    const participantIndexByName = getParticipantIndexByName(participantNames);
    const participantCount = getParticipantCount(sheet);
    // getTotalRowAnchor's `undefined` path is unreachable in normal use (a
    // real "TOTAL OWING" row always exists) — asserted here rather than
    // guarded with an early return, to keep this exactly as behaviorally
    // faithful to the original untyped version as possible. See the note on
    // getTotalRowAnchor.
    const totalRowAnchor = getTotalRowAnchor(sheet) as number;
    Logger.log('variables Set in Calculate');

    const debtMatrix = buildDebtMatrix(
        sheet,
        participantNames,
        participantIndexByName,
        participantCount,
        totalRowAnchor,
    );
    Logger.log('calculate payments in Calculate');

    const payments = computeSettlementPayments(
        sheet,
        debtMatrix,
        participantNames,
        participantIndexByName,
        participantCount,
        totalRowAnchor,
    );
    Logger.log('RenderPayments');

    writeSettlementPayments(
        sheet,
        payments,
        participantNames,
        participantIndexByName,
        participantCount,
        totalRowAnchor,
    );
    Logger.log('renderPayments and calculate completed');
}
