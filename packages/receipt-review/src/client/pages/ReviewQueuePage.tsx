import { useEffect, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import { api } from '../lib/api.js';

type ReceiptSummary = InferResponseType<typeof api.receipts.$get>[number];

interface ReviewQueuePageProps {
  onUpload: () => void;
  onSelect: (receiptId: number) => void;
}

export function ReviewQueuePage({ onUpload, onSelect }: ReviewQueuePageProps) {
  const [receipts, setReceipts] = useState<ReceiptSummary[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await api.receipts.$get();
      setReceipts(await res.json());
    })();
  }, []);

  return (
    <main>
      <h1>Receipts needing review</h1>
      <button onClick={onUpload}>Upload more</button>
      {receipts === null ? (
        <p>Loading…</p>
      ) : receipts.length === 0 ? (
        <p>Nothing to review — upload a receipt to get started.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Store</th>
              <th>Payer</th>
              <th>Date</th>
              <th>Total</th>
              <th>Items</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.id} onClick={() => onSelect(receipt.id)} style={{ cursor: 'pointer' }}>
                <td>{receipt.store}</td>
                <td>{receipt.payer}</td>
                <td>{receipt.purchaseDate.slice(0, 10)}</td>
                <td>${receipt.total.toFixed(2)}</td>
                <td>{receipt.lineItemCount}</td>
                <td>{receipt.reconciled ? 'ok' : 'needs a closer look'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
