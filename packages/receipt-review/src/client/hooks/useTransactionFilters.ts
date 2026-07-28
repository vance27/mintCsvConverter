import { useState } from 'react';
import type { SortDir, SortKey, Status, SyncedStatus } from './types.js';

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

/** Pure filter/sort/pagination state for the transaction list — no fetching. */
export function useTransactionFilters() {
    const [status, setStatus] = useState<Status>('ACTIVE');
    const [syncedStatus, setSyncedStatus] = useState<SyncedStatus>('UNSYNCED');
    const [sortBy, setSortBy] = useState<SortKey>('date');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);

    function handleSort(key: SortKey): void {
        if (sortBy === key) {
            setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortBy(key);
            setSortDir('asc');
        }
        setPage(0);
    }

    return {
        status,
        setStatus,
        syncedStatus,
        setSyncedStatus,
        sortBy,
        sortDir,
        page,
        setPage,
        pageSize,
        setPageSize,
        handleSort,
    };
}

export { PAGE_SIZE_OPTIONS };
