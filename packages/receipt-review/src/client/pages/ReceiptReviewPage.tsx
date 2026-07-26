import { useEffect, useMemo, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import { api } from '../lib/api.js';

type ReceiptDetail = InferResponseType<(typeof api.receipts)[':id']['$get']>;
type LineItemDetail = ReceiptDetail['lineItems'][number];
type SubmitResult = InferResponseType<(typeof api.receipts)[':id']['submit']['$post']>;

interface ReceiptReviewPageProps {
  receiptId: number;
  onBack: () => void;
  onSubmitted: (result: SubmitResult) => void;
}

interface Draft {
  splits: Record<string, string>;
  displayName: string;
}

function draftFromLineItem(line: LineItemDetail): Draft {
  return {
    splits: Object.fromEntries(Object.entries(line.splits).map(([name, pct]) => [name, String(pct)])),
    displayName: line.displayName ?? '',
  };
}

export function ReceiptReviewPage({ receiptId, onBack, onSubmitted }: ReceiptReviewPageProps) {
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void load();
  }, [receiptId]);

  async function load(): Promise<void> {
    const res = await api.receipts[':id'].$get({ param: { id: String(receiptId) } });
    const data = await res.json();
    setDetail(data);
    setDrafts(Object.fromEntries(data.lineItems.map((li) => [li.id, draftFromLineItem(li)])));
  }

  const participants = useMemo(
    () => (detail ? [...new Set(detail.lineItems.flatMap((li) => Object.keys(li.splits)))] : []),
    [detail],
  );

  const liveAggregate = useMemo(() => {
    if (!detail) {
      return {};
    }
    const totals: Record<string, number> = Object.fromEntries(participants.map((p) => [p, 0]));
    let netTotal = 0;
    for (const line of detail.lineItems) {
      const draft = drafts[line.id];
      const net = line.lineTotal - line.discountAmount;
      netTotal += net;
      for (const participant of participants) {
        const percent = Number(draft?.splits[participant] ?? line.splits[participant] ?? 0);
        totals[participant] += net * (percent / 100);
      }
    }
    if (netTotal <= 0) {
      return totals;
    }
    return Object.fromEntries(participants.map((p) => [p, Math.round((totals[p] / netTotal) * 100)]));
  }, [detail, drafts, participants]);

  async function saveLine(lineItemId: number): Promise<void> {
    const draft = drafts[lineItemId];
    if (!draft) {
      return;
    }
    const splits = Object.fromEntries(participants.map((p) => [p, Number(draft.splits[p] ?? 0)]));
    const total = Object.values(splits).reduce((sum, n) => sum + n, 0);
    if (Math.round(total) !== 100) {
      setError(`Splits for this line must sum to 100 (got ${total}).`);
      return;
    }

    setError(null);
    setSavingId(lineItemId);
    try {
      const res = await api.receipts[':id']['line-items'][':lineItemId'].$patch({
        param: { id: String(receiptId), lineItemId: String(lineItemId) },
        json: { splits, displayName: draft.displayName || undefined },
      });
      if (res.status !== 200) {
        setError('Failed to save — check that the splits sum to 100.');
        return;
      }
      const data = await res.json();
      setDetail(data);
      const updatedLine = data.lineItems.find((li: LineItemDetail) => li.id === lineItemId);
      if (updatedLine) {
        setDrafts((prev) => ({ ...prev, [lineItemId]: draftFromLineItem(updatedLine) }));
      }
    } finally {
      setSavingId(null);
    }
  }

  async function submit(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.receipts[':id'].submit.$post({ param: { id: String(receiptId) } });
      if (res.status !== 200) {
        setError('Could not submit — make sure every line is reviewed.');
        return;
      }
      const data = await res.json();
      onSubmitted(data);
    } finally {
      setSubmitting(false);
    }
  }

  if (!detail) {
    return <p>Loading…</p>;
  }

  const allReviewed = detail.lineItems.every((li) => li.reviewed);

  return (
    <main style={{ display: 'flex', gap: '1rem' }}>
      <section style={{ flex: 1 }}>
        <button onClick={onBack}>Back to queue</button>
        <iframe title="Receipt PDF" src={`/api/receipts/${receiptId}/source.pdf`} style={{ width: '100%', height: '80vh', border: 0 }} />
      </section>
      <section style={{ flex: 1 }}>
        <h1>
          {detail.store} — {detail.purchaseDate.slice(0, 10)}
        </h1>
        <p>
          Paid by {detail.payer}. Total: ${detail.total.toFixed(2)}.{' '}
          {detail.reconciled ? '' : '⚠ low confidence — check carefully against the PDF.'}
        </p>
        {error ? <p style={{ color: 'red' }}>{error}</p> : null}
        {detail.lineItems.map((line) => {
          const draft = drafts[line.id] ?? draftFromLineItem(line);
          const changePercent = line.priceHistory.changePercent;
          return (
            <div key={line.id} style={{ borderBottom: '1px solid #ccc', padding: '0.5rem 0' }}>
              <input
                value={draft.displayName}
                placeholder={line.rawName}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [line.id]: { ...draft, displayName: e.target.value } }))}
              />
              <span>
                {' '}
                ${line.unitPrice.toFixed(2)} × {line.quantity} = ${line.lineTotal.toFixed(2)}
              </span>
              <span>
                {line.priceHistory.previousUnitPrice === null
                  ? ''
                  : changePercent !== null && Math.abs(changePercent) > 1
                    ? ` (was $${line.priceHistory.previousUnitPrice.toFixed(2)}, ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(0)}%)`
                    : ' (no change)'}
              </span>
              <span>{line.provenance === 'new' ? ' new — please set' : ' learned'}</span>
              {participants.map((participant) => (
                <label key={participant}>
                  {' '}
                  {participant}
                  <input
                    type="number"
                    value={draft.splits[participant] ?? ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [line.id]: { ...draft, splits: { ...draft.splits, [participant]: e.target.value } },
                      }))
                    }
                  />
                  %
                </label>
              ))}
              <button disabled={savingId === line.id} onClick={() => void saveLine(line.id)}>
                {line.reviewed ? 'Update' : 'Save'}
              </button>
            </div>
          );
        })}
        <p>Live aggregate: {participants.map((p) => `${p} ${liveAggregate[p] ?? 0}%`).join(', ')}</p>
        <button disabled={!allReviewed || submitting} onClick={() => void submit()}>
          Submit receipt
        </button>
      </section>
    </main>
  );
}
