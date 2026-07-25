/** One line's contribution to the aggregate: its net value and how it splits. */
export interface AggregateLine {
  lineTotal: number;
  discountAmount?: number;
  /** participant name → percent of this line (0–100); should sum to ~100. */
  splits: Record<string, number>;
}

/**
 * Rolls per-item splits up into a single set of whole-receipt percentages —
 * the aggregate pair that lands in the sheet's two "Variably" cells. Each
 * participant's dollar share is Σ(netLineTotal · itemSplit/100) over lines,
 * then converted to an integer percent of the net receipt total. Uses
 * largest-remainder rounding so the returned percentages always sum to 100.
 *
 * Net line value is `lineTotal − discountAmount`; tax is intentionally
 * excluded since it scales proportionally and doesn't change the ratio.
 */
export function aggregateSplits(lines: AggregateLine[], participants: string[]): Record<string, number> {
  const shares: Record<string, number> = Object.fromEntries(participants.map((p) => [p, 0]));
  let total = 0;

  for (const line of lines) {
    const net = line.lineTotal - (line.discountAmount ?? 0);
    total += net;
    for (const participant of participants) {
      const percent = line.splits[participant] ?? 0;
      shares[participant] += net * (percent / 100);
    }
  }

  if (total <= 0) {
    return shares;
  }

  const rawPercents = participants.map((p) => ({ participant: p, raw: (shares[p] / total) * 100 }));
  return largestRemainderRound(rawPercents);
}

function largestRemainderRound(rawPercents: { participant: string; raw: number }[]): Record<string, number> {
  const floored = rawPercents.map((entry) => ({
    participant: entry.participant,
    floor: Math.floor(entry.raw),
    remainder: entry.raw - Math.floor(entry.raw),
  }));

  const flooredSum = floored.reduce((sum, entry) => sum + entry.floor, 0);
  let remaining = Math.round(100 - flooredSum);

  const byRemainderDesc = [...floored].sort((a, b) => b.remainder - a.remainder);
  const result: Record<string, number> = {};
  for (const entry of floored) {
    result[entry.participant] = entry.floor;
  }
  for (let i = 0; i < byRemainderDesc.length && remaining > 0; i++) {
    result[byRemainderDesc[i].participant] += 1;
    remaining -= 1;
  }
  return result;
}
