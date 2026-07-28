import { useEffect, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import DeleteIcon from '@mui/icons-material/Delete';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import UndoIcon from '@mui/icons-material/Undo';
import EditIcon from '@mui/icons-material/Edit';
import {
    Button,
    Chip,
    CircularProgress,
    Container,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TablePagination,
    TableRow,
    TableSortLabel,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from '@mui/material';
import { api } from '../lib/api.js';

type TransactionsResponse = InferResponseType<typeof api.transactions.$get, 200>;
type TransactionSummary = TransactionsResponse['transactions'][number];
type ImportBatchSummary = InferResponseType<(typeof api)['import-batches']['$get']>[number];

type Status = 'ACTIVE' | 'EXCLUDED_REMOVED';
type SyncedStatus = 'UNSYNCED' | 'SYNCED' | 'ALL';
type SortKey = 'date' | 'payer' | 'description' | 'amount' | 'splitType' | 'syncedAt';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

interface TransactionReviewPageProps {
    onSelectReceipt: (receiptId: number) => void;
}

function ReceiptStatusCell({
    transaction,
    onSelectReceipt,
}: {
    transaction: TransactionSummary;
    onSelectReceipt: (receiptId: number) => void;
}) {
    if (transaction.splitType !== 'Variably') {
        return <Typography color="text.secondary">—</Typography>;
    }
    if (!transaction.receiptMatch) {
        return <Typography color="text.secondary">No receipt yet</Typography>;
    }
    if (transaction.receiptMatch.status === 'SUBMITTED') {
        return (
            <Chip
                icon={<CheckCircleIcon />}
                label={`Submitted — ${Object.entries(transaction.receiptMatch.aggregate)
                    .map(([name, pct]) => `${name} ${pct}%`)
                    .join(' / ')}`}
                color="success"
                size="small"
                variant="outlined"
            />
        );
    }
    return (
        <Chip
            icon={<PriorityHighIcon />}
            label="Needs review"
            color="warning"
            size="small"
            onClick={() => onSelectReceipt(transaction.receiptMatch!.receiptId)}
            clickable
        />
    );
}

const SORTABLE_COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
    { key: 'date', label: 'Date' },
    { key: 'payer', label: 'Payer' },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount', align: 'right' },
    { key: 'splitType', label: 'Split' },
    { key: 'syncedAt', label: 'Synced' },
];

/** Lists staged transactions and, for Variably-split ones, whether a matching receipt exists and has been reviewed/submitted. */
export function TransactionReviewPage({ onSelectReceipt }: TransactionReviewPageProps) {
    const [batches, setBatches] = useState<ImportBatchSummary[] | null>(null);
    const [selectedBatchId, setSelectedBatchId] = useState<number | 'ALL' | undefined>(undefined);
    const [status, setStatus] = useState<Status>('ACTIVE');
    const [syncedStatus, setSyncedStatus] = useState<SyncedStatus>('UNSYNCED');
    const [sortBy, setSortBy] = useState<SortKey>('date');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);
    const [result, setResult] = useState<TransactionsResponse | null>(null);
    const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
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

    async function load(): Promise<void> {
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
        void load();
    }, [selectedBatchId, status, syncedStatus, sortBy, sortDir, page, pageSize]);

    function handleSort(key: SortKey): void {
        if (sortBy === key) {
            setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortBy(key);
            setSortDir('asc');
        }
        setPage(0);
    }

    async function patchTransaction(
        id: number,
        body: { splitType?: 'Equally' | 'Variably'; removed?: boolean },
    ): Promise<void> {
        setPendingIds((prev) => new Set(prev).add(id));
        try {
            const res = await api.transactions[':id'].$patch({ param: { id: String(id) }, json: body });
            if (res.ok) {
                await load();
            }
        } finally {
            setPendingIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }

    const transactions = result?.transactions ?? [];
    const hasAnyBatches = (batches?.length ?? 0) > 0;

    return (
        <Container maxWidth="lg" sx={{ py: 6 }}>
            <Stack spacing={3}>
                <Stack
                    direction="row"
                    sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}
                >
                    <Typography variant="h4">Review transactions</Typography>
                    <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
                        <FormControl size="small" sx={{ minWidth: 220 }}>
                            <InputLabel id="import-batch-label">Import</InputLabel>
                            <Select
                                labelId="import-batch-label"
                                label="Import"
                                value={selectedBatchId ?? ''}
                                onChange={(e) => {
                                    setSelectedBatchId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value));
                                    setPage(0);
                                }}
                            >
                                <MenuItem value="ALL">All imports</MenuItem>
                                {(batches ?? []).map((b) => (
                                    <MenuItem key={b.id} value={b.id}>
                                        {b.title}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {selectedBatch ? (
                            <Tooltip title="Edit import title/notes">
                                <IconButton
                                    size="small"
                                    aria-label="Edit import"
                                    onClick={() =>
                                        setEditingBatch({
                                            title: selectedBatch.title,
                                            description: selectedBatch.description ?? '',
                                        })
                                    }
                                >
                                    <EditIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        ) : null}
                        {selectedBatch ? (
                            <Tooltip
                                title={
                                    batchSyncedCount && batchSyncedCount.synced > 0
                                        ? `Can't delete — ${batchSyncedCount.synced} of ${batchSyncedCount.total} transactions already synced`
                                        : 'Delete this import'
                                }
                            >
                                <span>
                                    <IconButton
                                        size="small"
                                        aria-label="Delete import"
                                        disabled={!batchSyncedCount || batchSyncedCount.synced > 0}
                                        onClick={() => setConfirmingDelete(true)}
                                    >
                                        <DeleteForeverIcon fontSize="small" />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        ) : null}
                        <ToggleButtonGroup
                            size="small"
                            exclusive
                            value={status}
                            onChange={(_, next: Status | null) => {
                                if (next) {
                                    setStatus(next);
                                    setPage(0);
                                }
                            }}
                        >
                            <ToggleButton value="ACTIVE">Active</ToggleButton>
                            <ToggleButton value="EXCLUDED_REMOVED">Excluded &amp; Removed</ToggleButton>
                        </ToggleButtonGroup>
                        <ToggleButtonGroup
                            size="small"
                            exclusive
                            value={syncedStatus}
                            onChange={(_, next: SyncedStatus | null) => {
                                if (next) {
                                    setSyncedStatus(next);
                                    setPage(0);
                                }
                            }}
                        >
                            <ToggleButton value="UNSYNCED">Unsynced</ToggleButton>
                            <ToggleButton value="SYNCED">Synced</ToggleButton>
                            <ToggleButton value="ALL">All</ToggleButton>
                        </ToggleButtonGroup>
                    </Stack>
                </Stack>
                {result === null ? (
                    <Typography color="text.secondary">Loading…</Typography>
                ) : !hasAnyBatches ? (
                    <Paper sx={{ p: 4 }}>
                        <Typography color="text.secondary">
                            No transactions staged yet — import a CSV export to get started.
                        </Typography>
                    </Paper>
                ) : transactions.length === 0 ? (
                    <Paper sx={{ p: 4 }}>
                        <Typography color="text.secondary">No transactions match the current filters.</Typography>
                    </Paper>
                ) : (
                    <TableContainer component={Paper}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    {SORTABLE_COLUMNS.map((col) => (
                                        <TableCell key={col.key} align={col.align}>
                                            <TableSortLabel
                                                active={sortBy === col.key}
                                                direction={sortBy === col.key ? sortDir : 'asc'}
                                                onClick={() => handleSort(col.key)}
                                            >
                                                {col.label}
                                            </TableSortLabel>
                                        </TableCell>
                                    ))}
                                    <TableCell>Receipt</TableCell>
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {transactions.map((t) => {
                                    const locked = t.syncedAt !== null;
                                    const pending = pendingIds.has(t.id);
                                    return (
                                        <TableRow key={t.id} hover>
                                            <TableCell>{t.date}</TableCell>
                                            <TableCell>{t.payer}</TableCell>
                                            <TableCell>{t.description}</TableCell>
                                            <TableCell align="right">${t.amount.toFixed(2)}</TableCell>
                                            <TableCell>
                                                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                                    {status === 'EXCLUDED_REMOVED' && t.excluded ? (
                                                        <Chip label="Excluded" color="default" size="small" />
                                                    ) : null}
                                                    {status === 'EXCLUDED_REMOVED' && t.removed ? (
                                                        <Chip label="Removed" color="default" size="small" />
                                                    ) : null}
                                                    {locked ? (
                                                        t.splitType
                                                    ) : (
                                                        <Select
                                                            size="small"
                                                            value={t.splitType}
                                                            disabled={pending}
                                                            onChange={(e) =>
                                                                void patchTransaction(t.id, {
                                                                    splitType: e.target.value as 'Equally' | 'Variably',
                                                                })
                                                            }
                                                        >
                                                            <MenuItem value="Equally">Equally</MenuItem>
                                                            <MenuItem value="Variably">Variably</MenuItem>
                                                        </Select>
                                                    )}
                                                </Stack>
                                            </TableCell>
                                            <TableCell>
                                                <ReceiptStatusCell transaction={t} onSelectReceipt={onSelectReceipt} />
                                            </TableCell>
                                            <TableCell align="right">
                                                {pending ? (
                                                    <CircularProgress size={20} />
                                                ) : (
                                                    <Tooltip
                                                        title={
                                                            locked
                                                                ? 'Already synced — no longer editable'
                                                                : t.removed
                                                                  ? 'Undo removal'
                                                                  : 'Remove'
                                                        }
                                                    >
                                                        <span>
                                                            <IconButton
                                                                size="small"
                                                                disabled={locked}
                                                                onClick={() =>
                                                                    void patchTransaction(t.id, { removed: !t.removed })
                                                                }
                                                                aria-label={
                                                                    t.removed ? 'Undo removal' : 'Remove transaction'
                                                                }
                                                            >
                                                                {t.removed ? (
                                                                    <UndoIcon fontSize="small" />
                                                                ) : (
                                                                    <DeleteIcon fontSize="small" />
                                                                )}
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                        <TablePagination
                            component="div"
                            count={result.totalCount}
                            page={page}
                            onPageChange={(_, next) => setPage(next)}
                            rowsPerPage={pageSize}
                            rowsPerPageOptions={[...PAGE_SIZE_OPTIONS]}
                            onRowsPerPageChange={(e) => {
                                setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
                                setPage(0);
                            }}
                        />
                    </TableContainer>
                )}
            </Stack>
            <Dialog open={editingBatch !== null} onClose={() => setEditingBatch(null)} maxWidth="sm" fullWidth>
                <DialogTitle>Edit import</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <TextField
                            label="Title"
                            value={editingBatch?.title ?? ''}
                            onChange={(e) =>
                                setEditingBatch((prev) => (prev ? { ...prev, title: e.target.value } : prev))
                            }
                            fullWidth
                        />
                        <TextField
                            label="Notes"
                            value={editingBatch?.description ?? ''}
                            onChange={(e) =>
                                setEditingBatch((prev) => (prev ? { ...prev, description: e.target.value } : prev))
                            }
                            placeholder="e.g. remember to also pull the July return credit next time"
                            multiline
                            minRows={3}
                            fullWidth
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setEditingBatch(null)} disabled={savingBatch}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void saveBatchEdit()}
                        variant="contained"
                        disabled={savingBatch || !editingBatch?.title.trim()}
                    >
                        Save
                    </Button>
                </DialogActions>
            </Dialog>
            <Dialog open={confirmingDelete} onClose={() => setConfirmingDelete(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Delete import?</DialogTitle>
                <DialogContent>
                    <Typography>
                        This will permanently delete "{selectedBatch?.title}" and its {batchSyncedCount?.total ?? 0}{' '}
                        staged transaction
                        {batchSyncedCount?.total === 1 ? '' : 's'}. This can't be undone.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmingDelete(false)} disabled={deletingBatch}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void deleteBatch()}
                        variant="contained"
                        color="error"
                        disabled={deletingBatch}
                    >
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}
