import { useEffect, useRef, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import ErrorIcon from '@mui/icons-material/Error';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
    Button,
    Chip,
    CircularProgress,
    Container,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import {
    isPending,
    hasReliableExtraction,
    canRetry,
    isDeletable,
} from '@mint-csv-converter/receipts/receiptStateMachine';
import { api } from '../lib/api.js';

type ReceiptSummary = InferResponseType<typeof api.receipts.$get>[number];

interface ReviewQueuePageProps {
    onUpload: () => void;
    onSelect: (receiptId: number) => void;
}

const POLL_INTERVAL_MS = 2000;

function ReviewIndicator({ status }: { status: ReceiptSummary['status'] }) {
    if (status === 'SUBMITTED') {
        return (
            <Tooltip title="Submitted">
                <CheckCircleIcon color="success" fontSize="small" />
            </Tooltip>
        );
    }
    if (status === 'FAILED') {
        return (
            <Tooltip title="Extraction failed">
                <ErrorIcon color="error" fontSize="small" />
            </Tooltip>
        );
    }
    if (status === 'CANCELLED') {
        return (
            <Tooltip title="Cancelled">
                <CancelIcon color="disabled" fontSize="small" />
            </Tooltip>
        );
    }
    if (isPending(status)) {
        return <CircularProgress size={16} />;
    }
    return (
        <Tooltip title="Needs review">
            <PriorityHighIcon color="warning" fontSize="small" />
        </Tooltip>
    );
}

/** "Extracting… 47s elapsed" — ticks off the receipt's own createdAt, since there's no separate extraction-start timestamp (see Phase 1 notes in receipts-tab-improvements.md). */
function ElapsedTime({ since }: { since: string }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
    return <Typography variant="body2">{seconds}s elapsed</Typography>;
}

export function ReviewQueuePage({ onUpload, onSelect }: ReviewQueuePageProps) {
    const [receipts, setReceipts] = useState<ReceiptSummary[] | null>(null);
    const [retrying, setRetrying] = useState<Set<number>>(new Set());
    const [cancelling, setCancelling] = useState<Set<number>>(new Set());
    const [deleting, setDeleting] = useState<Set<number>>(new Set());
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
    const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mounted = useRef(true);

    /** Fetches the current receipts list and, if anything is still QUEUED/EXTRACTING, schedules another fetch. */
    async function refresh(): Promise<void> {
        const res = await api.receipts.$get();
        const next = await res.json();
        if (!mounted.current) {
            return;
        }
        setReceipts(next);
        if (pollTimer.current) {
            clearTimeout(pollTimer.current);
            pollTimer.current = null;
        }
        if (next.some((r) => isPending(r.status))) {
            pollTimer.current = setTimeout(() => void refresh(), POLL_INTERVAL_MS);
        }
    }

    useEffect(() => {
        mounted.current = true;
        void refresh();
        return () => {
            mounted.current = false;
            if (pollTimer.current) {
                clearTimeout(pollTimer.current);
            }
        };
    }, []);

    async function handleRetry(receiptId: number): Promise<void> {
        setRetrying((prev) => new Set(prev).add(receiptId));
        await api.receipts[':id'].retry.$post({ param: { id: String(receiptId) } });
        await refresh();
        setRetrying((prev) => {
            const next = new Set(prev);
            next.delete(receiptId);
            return next;
        });
    }

    /** Stops a QUEUED or EXTRACTING receipt — if it's the one actively extracting, this aborts the live request, not just relabels it. */
    async function handleCancel(receiptId: number): Promise<void> {
        setCancelling((prev) => new Set(prev).add(receiptId));
        await api.receipts[':id'].cancel.$post({ param: { id: String(receiptId) } });
        await refresh();
        setCancelling((prev) => {
            const next = new Set(prev);
            next.delete(receiptId);
            return next;
        });
    }

    /** Hard-deletes a FAILED/CANCELLED/EXTRACTED receipt (never SUBMITTED) — removes the DB row and its retained source PDF. */
    async function handleDelete(receiptId: number): Promise<void> {
        setDeleting((prev) => new Set(prev).add(receiptId));
        try {
            await api.receipts[':id'].$delete({ param: { id: String(receiptId) } });
            await refresh();
        } finally {
            setDeleting((prev) => {
                const next = new Set(prev);
                next.delete(receiptId);
                return next;
            });
            setConfirmingDeleteId(null);
        }
    }

    return (
        <Container maxWidth="lg" sx={{ py: 6 }}>
            <Stack spacing={3}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h4">Receipts</Typography>
                    <Button variant="contained" onClick={onUpload}>
                        Upload more
                    </Button>
                </Stack>
                {receipts === null ? (
                    <Typography color="text.secondary">Loading…</Typography>
                ) : receipts.length === 0 ? (
                    <Paper sx={{ p: 4 }}>
                        <Typography color="text.secondary">No receipts yet — upload one to get started.</Typography>
                    </Paper>
                ) : (
                    <TableContainer component={Paper}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Review</TableCell>
                                    <TableCell>Store</TableCell>
                                    <TableCell>Payer</TableCell>
                                    <TableCell>Date</TableCell>
                                    <TableCell align="right">Total</TableCell>
                                    <TableCell align="right">Items</TableCell>
                                    <TableCell>Split</TableCell>
                                    <TableCell>Confidence</TableCell>
                                    <TableCell>Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {receipts.map((receipt) => {
                                    const pending = isPending(receipt.status);
                                    const clickable = hasReliableExtraction(receipt.status);
                                    return (
                                        <TableRow
                                            key={receipt.id}
                                            hover={clickable}
                                            onClick={clickable ? () => onSelect(receipt.id) : undefined}
                                            sx={{
                                                cursor: clickable ? 'pointer' : 'default',
                                                opacity: pending ? 0.6 : 1,
                                            }}
                                        >
                                            <TableCell>
                                                <ReviewIndicator status={receipt.status} />
                                            </TableCell>
                                            {receipt.status === 'QUEUED' ? (
                                                <TableCell colSpan={8}>
                                                    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                                                        <Typography variant="body2">
                                                            {receipt.originalFilename ?? 'Receipt'} — queued
                                                            {receipt.queuePosition
                                                                ? ` (#${receipt.queuePosition} in line)`
                                                                : ''}
                                                        </Typography>
                                                        <Tooltip title="Cancel">
                                                            <span>
                                                                <IconButton
                                                                    size="small"
                                                                    disabled={cancelling.has(receipt.id)}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        void handleCancel(receipt.id);
                                                                    }}
                                                                >
                                                                    <CancelIcon fontSize="small" />
                                                                </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                    </Stack>
                                                </TableCell>
                                            ) : receipt.status === 'EXTRACTING' ? (
                                                <TableCell colSpan={8}>
                                                    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                                                        <Typography variant="body2">
                                                            {receipt.originalFilename ?? 'Receipt'} — extracting…
                                                        </Typography>
                                                        <ElapsedTime since={receipt.createdAt} />
                                                        <Tooltip title="Cancel">
                                                            <span>
                                                                <IconButton
                                                                    size="small"
                                                                    disabled={cancelling.has(receipt.id)}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        void handleCancel(receipt.id);
                                                                    }}
                                                                >
                                                                    <CancelIcon fontSize="small" />
                                                                </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                    </Stack>
                                                </TableCell>
                                            ) : canRetry(receipt.status) ? (
                                                <TableCell colSpan={8}>
                                                    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                                                        <Typography
                                                            color={receipt.status === 'FAILED' ? 'error' : 'text.secondary'}
                                                            variant="body2"
                                                        >
                                                            {receipt.status === 'FAILED'
                                                                ? `${receipt.originalFilename ?? 'Receipt'} failed: ${receipt.extractionError ?? 'unknown error'}`
                                                                : `${receipt.originalFilename ?? 'Receipt'} — cancelled`}
                                                        </Typography>
                                                        <Tooltip title="Retry">
                                                            <span>
                                                                <IconButton
                                                                    size="small"
                                                                    disabled={retrying.has(receipt.id)}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        void handleRetry(receipt.id);
                                                                    }}
                                                                >
                                                                    <RefreshIcon fontSize="small" />
                                                                </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                        <Tooltip title="Delete">
                                                            <span>
                                                                <IconButton
                                                                    size="small"
                                                                    disabled={deleting.has(receipt.id)}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setConfirmingDeleteId(receipt.id);
                                                                    }}
                                                                >
                                                                    <DeleteIcon fontSize="small" />
                                                                </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                    </Stack>
                                                </TableCell>
                                            ) : (
                                                <>
                                                    <TableCell>{receipt.store}</TableCell>
                                                    <TableCell>{receipt.payer}</TableCell>
                                                    <TableCell>{receipt.purchaseDate?.slice(0, 10) ?? ''}</TableCell>
                                                    <TableCell align="right">
                                                        ${(receipt.total ?? 0).toFixed(2)}
                                                    </TableCell>
                                                    <TableCell align="right">{receipt.lineItemCount}</TableCell>
                                                    <TableCell>
                                                        {Object.entries(receipt.aggregate)
                                                            .map(([name, pct]) => `${name} ${pct}%`)
                                                            .join(' / ')}
                                                    </TableCell>
                                                    <TableCell>
                                                        {receipt.reconciled ? (
                                                            <Chip
                                                                label="ok"
                                                                color="success"
                                                                size="small"
                                                                variant="outlined"
                                                            />
                                                        ) : (
                                                            <Chip
                                                                label="check"
                                                                color="warning"
                                                                size="small"
                                                                variant="outlined"
                                                            />
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        {isDeletable(receipt.status) && (
                                                            <Tooltip title="Delete">
                                                                <span>
                                                                    <IconButton
                                                                        size="small"
                                                                        disabled={deleting.has(receipt.id)}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setConfirmingDeleteId(receipt.id);
                                                                        }}
                                                                    >
                                                                        <DeleteIcon fontSize="small" />
                                                                    </IconButton>
                                                                </span>
                                                            </Tooltip>
                                                        )}
                                                    </TableCell>
                                                </>
                                            )}
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Stack>
            <Dialog open={confirmingDeleteId !== null} onClose={() => setConfirmingDeleteId(null)} maxWidth="sm" fullWidth>
                <DialogTitle>Delete this receipt?</DialogTitle>
                <DialogContent>
                    <Typography>This can't be undone.</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmingDeleteId(null)} disabled={confirmingDeleteId !== null && deleting.has(confirmingDeleteId)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => confirmingDeleteId !== null && void handleDelete(confirmingDeleteId)}
                        variant="contained"
                        color="error"
                        disabled={confirmingDeleteId !== null && deleting.has(confirmingDeleteId)}
                    >
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}
