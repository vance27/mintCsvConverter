import { useState } from 'react';
import { api } from '../lib/api.js';

/** Optimistic-patch bookkeeping for editing a transaction's splitType/removed flag — calls `reload` on success so the caller's list reflects the change. */
export function useTransactionPatch(reload: () => Promise<void>) {
    const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());

    async function patchTransaction(
        id: number,
        body: { splitType?: 'Equally' | 'Variably'; removed?: boolean },
    ): Promise<void> {
        setPendingIds((prev) => new Set(prev).add(id));
        try {
            const res = await api.transactions[':id'].$patch({ param: { id: String(id) }, json: body });
            if (res.ok) {
                await reload();
            }
        } finally {
            setPendingIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }

    return { pendingIds, patchTransaction };
}
