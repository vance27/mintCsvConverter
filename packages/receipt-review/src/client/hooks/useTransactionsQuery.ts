import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import type { SortDir, SortKey, Status, SyncedStatus, TransactionsResponse } from './types.js';

export interface TransactionFiltersInput {
    status: Status;
    syncedStatus: SyncedStatus;
    sortBy: SortKey;
    sortDir: SortDir;
    page: number;
    pageSize: number;
}

/** Fetches the transaction list for the selected import batch + filters; `reload` re-runs the same fetch on demand (e.g. after a patch). */
export function useTransactionsQuery(selectedBatchId: number | 'ALL' | undefined, filters: TransactionFiltersInput) {
    const [result, setResult] = useState<TransactionsResponse | null>(null);
    const { status, syncedStatus, sortBy, sortDir, page, pageSize } = filters;

    async function reload(): Promise<void> {
        if (selectedBatchId === undefined) {
            return;
        }
        const res = await api.transactions.$get({
            query: {
                ...(selectedBatchId !== 'ALL' ? { importBatchId: String(selectedBatchId) } : {}),
                status,
                syncedStatus,
                sortBy,
                sortDir,
                page: String(page + 1),
                pageSize: String(pageSize),
            },
        });
        if (res.ok) {
            setResult(await res.json());
        }
    }

    useEffect(() => {
        void reload();
    }, [selectedBatchId, status, syncedStatus, sortBy, sortDir, page, pageSize]);

    return {
        result,
        transactions: result?.transactions ?? [],
        totalCount: result?.totalCount ?? 0,
        reload,
    };
}
