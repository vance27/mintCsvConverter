import { useEffect, useRef, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import ErrorIcon from '@mui/icons-material/Error';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Button,
  Chip,
  CircularProgress,
  Container,
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
  if (status === 'QUEUED' || status === 'EXTRACTING') {
    return <CircularProgress size={16} />;
  }
  return (
    <Tooltip title="Needs review">
      <PriorityHighIcon color="warning" fontSize="small" />
    </Tooltip>
  );
}

export function ReviewQueuePage({ onUpload, onSelect }: ReviewQueuePageProps) {
  const [receipts, setReceipts] = useState<ReceiptSummary[] | null>(null);
  const [retrying, setRetrying] = useState<Set<number>>(new Set());
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
    if (next.some((r) => r.status === 'QUEUED' || r.status === 'EXTRACTING')) {
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
                </TableRow>
              </TableHead>
              <TableBody>
                {receipts.map((receipt) => {
                  const pending = receipt.status === 'QUEUED' || receipt.status === 'EXTRACTING';
                  const clickable = receipt.status !== 'QUEUED' && receipt.status !== 'EXTRACTING' && receipt.status !== 'FAILED';
                  return (
                    <TableRow
                      key={receipt.id}
                      hover={clickable}
                      onClick={clickable ? () => onSelect(receipt.id) : undefined}
                      sx={{ cursor: clickable ? 'pointer' : 'default', opacity: pending ? 0.6 : 1 }}
                    >
                      <TableCell>
                        <ReviewIndicator status={receipt.status} />
                      </TableCell>
                      {receipt.status === 'QUEUED' ? (
                        <TableCell colSpan={7}>
                          {receipt.originalFilename ?? 'Receipt'} — queued
                          {receipt.queuePosition ? ` (#${receipt.queuePosition} in line)` : ''}
                        </TableCell>
                      ) : receipt.status === 'EXTRACTING' ? (
                        <TableCell colSpan={7}>{receipt.originalFilename ?? 'Receipt'} — extracting…</TableCell>
                      ) : receipt.status === 'FAILED' ? (
                        <TableCell colSpan={7}>
                          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                            <Typography color="error" variant="body2">
                              {receipt.originalFilename ?? 'Receipt'} failed: {receipt.extractionError ?? 'unknown error'}
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
                          </Stack>
                        </TableCell>
                      ) : (
                        <>
                          <TableCell>{receipt.store}</TableCell>
                          <TableCell>{receipt.payer}</TableCell>
                          <TableCell>{receipt.purchaseDate?.slice(0, 10) ?? ''}</TableCell>
                          <TableCell align="right">${(receipt.total ?? 0).toFixed(2)}</TableCell>
                          <TableCell align="right">{receipt.lineItemCount}</TableCell>
                          <TableCell>
                            {Object.entries(receipt.aggregate)
                              .map(([name, pct]) => `${name} ${pct}%`)
                              .join(' / ')}
                          </TableCell>
                          <TableCell>
                            {receipt.reconciled ? (
                              <Chip label="ok" color="success" size="small" variant="outlined" />
                            ) : (
                              <Chip label="check" color="warning" size="small" variant="outlined" />
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
    </Container>
  );
}
