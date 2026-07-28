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
import { useImportBatches } from '../hooks/useImportBatches.js';
import { PAGE_SIZE_OPTIONS, useTransactionFilters } from '../hooks/useTransactionFilters.js';
import { useTransactionsQuery } from '../hooks/useTransactionsQuery.js';
import { useTransactionPatch } from '../hooks/useTransactionPatch.js';
import type { SortKey, Status, SyncedStatus, TransactionSummary } from '../hooks/types.js';

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
    const importBatches = useImportBatches();
    const filters = useTransactionFilters();
    const query = useTransactionsQuery(importBatches.selectedBatchId, filters);
    const patch = useTransactionPatch(query.reload);

    const hasAnyBatches = (importBatches.batches?.length ?? 0) > 0;

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
                                value={importBatches.selectedBatchId ?? ''}
                                onChange={(e) => {
                                    importBatches.setSelectedBatchId(
                                        e.target.value === 'ALL' ? 'ALL' : Number(e.target.value),
                                    );
                                    filters.setPage(0);
                                }}
                            >
                                <MenuItem value="ALL">All imports</MenuItem>
                                {(importBatches.batches ?? []).map((b) => (
                                    <MenuItem key={b.id} value={b.id}>
                                        {b.title}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {importBatches.selectedBatch ? (
                            <Tooltip title="Edit import title/notes">
                                <IconButton
                                    size="small"
                                    aria-label="Edit import"
                                    onClick={() =>
                                        importBatches.setEditingBatch({
                                            title: importBatches.selectedBatch!.title,
                                            description: importBatches.selectedBatch!.description ?? '',
                                        })
                                    }
                                >
                                    <EditIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        ) : null}
                        {importBatches.selectedBatch ? (
                            <Tooltip
                                title={
                                    importBatches.batchSyncedCount && importBatches.batchSyncedCount.synced > 0
                                        ? `Can't delete — ${importBatches.batchSyncedCount.synced} of ${importBatches.batchSyncedCount.total} transactions already synced`
                                        : 'Delete this import'
                                }
                            >
                                <span>
                                    <IconButton
                                        size="small"
                                        aria-label="Delete import"
                                        disabled={
                                            !importBatches.batchSyncedCount || importBatches.batchSyncedCount.synced > 0
                                        }
                                        onClick={() => importBatches.setConfirmingDelete(true)}
                                    >
                                        <DeleteForeverIcon fontSize="small" />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        ) : null}
                        <ToggleButtonGroup
                            size="small"
                            exclusive
                            value={filters.status}
                            onChange={(_, next: Status | null) => {
                                if (next) {
                                    filters.setStatus(next);
                                    filters.setPage(0);
                                }
                            }}
                        >
                            <ToggleButton value="ACTIVE">Active</ToggleButton>
                            <ToggleButton value="EXCLUDED_REMOVED">Excluded &amp; Removed</ToggleButton>
                        </ToggleButtonGroup>
                        <ToggleButtonGroup
                            size="small"
                            exclusive
                            value={filters.syncedStatus}
                            onChange={(_, next: SyncedStatus | null) => {
                                if (next) {
                                    filters.setSyncedStatus(next);
                                    filters.setPage(0);
                                }
                            }}
                        >
                            <ToggleButton value="UNSYNCED">Unsynced</ToggleButton>
                            <ToggleButton value="SYNCED">Synced</ToggleButton>
                            <ToggleButton value="ALL">All</ToggleButton>
                        </ToggleButtonGroup>
                    </Stack>
                </Stack>
                {query.result === null ? (
                    <Typography color="text.secondary">Loading…</Typography>
                ) : !hasAnyBatches ? (
                    <Paper sx={{ p: 4 }}>
                        <Typography color="text.secondary">
                            No transactions staged yet — import a CSV export to get started.
                        </Typography>
                    </Paper>
                ) : query.transactions.length === 0 ? (
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
                                                active={filters.sortBy === col.key}
                                                direction={filters.sortBy === col.key ? filters.sortDir : 'asc'}
                                                onClick={() => filters.handleSort(col.key)}
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
                                {query.transactions.map((t) => {
                                    const locked = t.syncedAt !== null;
                                    const pending = patch.pendingIds.has(t.id);
                                    return (
                                        <TableRow key={t.id} hover>
                                            <TableCell>{t.date}</TableCell>
                                            <TableCell>{t.payer}</TableCell>
                                            <TableCell>{t.description}</TableCell>
                                            <TableCell align="right">${t.amount.toFixed(2)}</TableCell>
                                            <TableCell>
                                                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                                    {filters.status === 'EXCLUDED_REMOVED' && t.excluded ? (
                                                        <Chip label="Excluded" color="default" size="small" />
                                                    ) : null}
                                                    {filters.status === 'EXCLUDED_REMOVED' && t.removed ? (
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
                                                                void patch.patchTransaction(t.id, {
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
                                                                    void patch.patchTransaction(t.id, {
                                                                        removed: !t.removed,
                                                                    })
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
                            count={query.totalCount}
                            page={filters.page}
                            onPageChange={(_, next) => filters.setPage(next)}
                            rowsPerPage={filters.pageSize}
                            rowsPerPageOptions={[...PAGE_SIZE_OPTIONS]}
                            onRowsPerPageChange={(e) => {
                                filters.setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
                                filters.setPage(0);
                            }}
                        />
                    </TableContainer>
                )}
            </Stack>
            <Dialog
                open={importBatches.editingBatch !== null}
                onClose={() => importBatches.setEditingBatch(null)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Edit import</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <TextField
                            label="Title"
                            value={importBatches.editingBatch?.title ?? ''}
                            onChange={(e) =>
                                importBatches.setEditingBatch((prev) =>
                                    prev ? { ...prev, title: e.target.value } : prev,
                                )
                            }
                            fullWidth
                        />
                        <TextField
                            label="Notes"
                            value={importBatches.editingBatch?.description ?? ''}
                            onChange={(e) =>
                                importBatches.setEditingBatch((prev) =>
                                    prev ? { ...prev, description: e.target.value } : prev,
                                )
                            }
                            placeholder="e.g. remember to also pull the July return credit next time"
                            multiline
                            minRows={3}
                            fullWidth
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => importBatches.setEditingBatch(null)} disabled={importBatches.savingBatch}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void importBatches.saveBatchEdit()}
                        variant="contained"
                        disabled={importBatches.savingBatch || !importBatches.editingBatch?.title.trim()}
                    >
                        Save
                    </Button>
                </DialogActions>
            </Dialog>
            <Dialog
                open={importBatches.confirmingDelete}
                onClose={() => importBatches.setConfirmingDelete(false)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Delete import?</DialogTitle>
                <DialogContent>
                    <Typography>
                        This will permanently delete "{importBatches.selectedBatch?.title}" and its{' '}
                        {importBatches.batchSyncedCount?.total ?? 0} staged transaction
                        {importBatches.batchSyncedCount?.total === 1 ? '' : 's'}. This can't be undone.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => importBatches.setConfirmingDelete(false)}
                        disabled={importBatches.deletingBatch}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void importBatches.deleteBatch()}
                        variant="contained"
                        color="error"
                        disabled={importBatches.deletingBatch}
                    >
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}
