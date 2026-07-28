import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import type { ImportBatchSummary } from './types.js';

/** Import-batch selection, editing, and deletion — including the derived "how many of this batch's transactions are already synced" count used to gate deletion. */
export function useImportBatches() {
    const [batches, setBatches] = useState<ImportBatchSummary[] | null>(null);
    const [selectedBatchId, setSelectedBatchId] = useState<number | 'ALL' | undefined>(undefined);
    const [editingBatch, setEditingBatch] = useState<{ title: string; description: string } | null>(null);
    const [savingBatch, setSavingBatch] = useState(false);
    const [batchSyncedCount, setBatchSyncedCount] = useState<{ synced: number; total: number } | null>(null);
    const [deletingBatch, setDeletingBatch] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    async function loadBatches(): Promise<ImportBatchSummary[]> {
        const res = await api['import-batches'].$get();
        const loaded = await res.json();
        setBatches(loaded);
        return loaded;
    }

    useEffect(() => {
        void (async () => {
            const loaded = await loadBatches();
            setSelectedBatchId(loaded.length > 0 ? loaded[0].id : 'ALL');
        })();
    }, []);

    const selectedBatch = selectedBatchId !== 'ALL' ? (batches ?? []).find((b) => b.id === selectedBatchId) : undefined;

    useEffect(() => {
        if (typeof selectedBatchId !== 'number') {
            setBatchSyncedCount(null);
            return;
        }
        void (async () => {
            const [totalRes, syncedRes] = await Promise.all([
                api.transactions.$get({
                    query: { importBatchId: String(selectedBatchId), syncedStatus: 'ALL', pageSize: '10' },
                }),
                api.transactions.$get({
                    query: { importBatchId: String(selectedBatchId), syncedStatus: 'SYNCED', pageSize: '10' },
                }),
            ]);
            if (!totalRes.ok || !syncedRes.ok) {
                return;
            }
            const [totalBody, syncedBody] = await Promise.all([totalRes.json(), syncedRes.json()]);
            setBatchSyncedCount({ synced: syncedBody.totalCount, total: totalBody.totalCount });
        })();
    }, [selectedBatchId]);

    async function deleteBatch(): Promise<void> {
        if (typeof selectedBatchId !== 'number') {
            return;
        }
        setDeletingBatch(true);
        try {
            const res = await api['import-batches'][':id'].$delete({ param: { id: String(selectedBatchId) } });
            if (res.ok) {
                const loaded = await loadBatches();
                setSelectedBatchId(loaded.length > 0 ? loaded[0].id : 'ALL');
                setConfirmingDelete(false);
            }
        } finally {
            setDeletingBatch(false);
        }
    }

    async function saveBatchEdit(): Promise<void> {
        if (!editingBatch || typeof selectedBatchId !== 'number') {
            return;
        }
        setSavingBatch(true);
        try {
            await api['import-batches'][':id'].$patch({
                param: { id: String(selectedBatchId) },
                json: { title: editingBatch.title, description: editingBatch.description || null },
            });
            await loadBatches();
            setEditingBatch(null);
        } finally {
            setSavingBatch(false);
        }
    }

    return {
        batches,
        selectedBatchId,
        setSelectedBatchId,
        selectedBatch,
        editingBatch,
        setEditingBatch,
        savingBatch,
        batchSyncedCount,
        deletingBatch,
        confirmingDelete,
        setConfirmingDelete,
        saveBatchEdit,
        deleteBatch,
    };
}
