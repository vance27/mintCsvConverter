import { useEffect, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import DeleteIcon from '@mui/icons-material/Delete';
import UndoIcon from '@mui/icons-material/Undo';
import {
  Chip,
  CircularProgress,
  Container,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
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

type TransactionSummary = InferResponseType<typeof api.transactions.$get>[number];

interface TransactionReviewPageProps {
  onSelectReceipt: (receiptId: number) => void;
}

function ReceiptStatusCell({ transaction, onSelectReceipt }: { transaction: TransactionSummary; onSelectReceipt: (receiptId: number) => void }) {
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

/** Lists staged transactions and, for Variably-split ones, whether a matching receipt exists and has been reviewed/submitted. */
export function TransactionReviewPage({ onSelectReceipt }: TransactionReviewPageProps) {
  const [transactions, setTransactions] = useState<TransactionSummary[] | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());

  async function load(): Promise<void> {
    const res = await api.transactions.$get();
    setTransactions(await res.json());
  }

  useEffect(() => {
    void load();
  }, []);

  async function patchTransaction(id: number, body: { splitType?: 'Equally' | 'Variably'; removed?: boolean }): Promise<void> {
    setPendingIds((prev) => new Set(prev).add(id));
    try {
      const res = await api.transactions[':id'].$patch({ param: { id: String(id) }, json: body });
      if (res.ok) {
        const updated = await res.json();
        setTransactions((prev) => prev?.map((t) => (t.id === id ? updated : t)) ?? null);
      }
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const visible = (transactions ?? []).filter((t) => showHidden || (!t.excluded && !t.removed));

  return (
    <Container maxWidth="lg" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h4">Review transactions</Typography>
          <FormControlLabel
            control={<Switch checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />}
            label="Show excluded/removed"
          />
        </Stack>
        {transactions === null ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : visible.length === 0 ? (
          <Paper sx={{ p: 4 }}>
            <Typography color="text.secondary">No transactions staged yet — import a CSV export to get started.</Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Payer</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Split</TableCell>
                  <TableCell>Receipt</TableCell>
                  <TableCell>Synced</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((t) => {
                  const hidden = t.excluded || t.removed;
                  const locked = t.syncedAt !== null;
                  const pending = pendingIds.has(t.id);
                  return (
                    <TableRow key={t.id} hover sx={hidden ? { opacity: 0.5 } : undefined}>
                      <TableCell>{t.date}</TableCell>
                      <TableCell>{t.payer}</TableCell>
                      <TableCell>{t.description}</TableCell>
                      <TableCell align="right">${t.amount.toFixed(2)}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          {t.excluded ? <Chip label="Excluded" color="default" size="small" /> : null}
                          {t.removed ? <Chip label="Removed" color="default" size="small" /> : null}
                          {locked ? (
                            t.splitType
                          ) : (
                            <Select
                              size="small"
                              value={t.splitType}
                              disabled={pending}
                              onChange={(e) => void patchTransaction(t.id, { splitType: e.target.value as 'Equally' | 'Variably' })}
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
                      <TableCell>
                        {t.syncedAt ? (
                          <Tooltip title={new Date(t.syncedAt).toLocaleString()}>
                            <CheckCircleIcon color="success" fontSize="small" />
                          </Tooltip>
                        ) : (
                          <Typography color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {pending ? (
                          <CircularProgress size={20} />
                        ) : (
                          <Tooltip title={locked ? 'Already synced — no longer editable' : t.removed ? 'Undo removal' : 'Remove'}>
                            <span>
                              <IconButton
                                size="small"
                                disabled={locked}
                                onClick={() => void patchTransaction(t.id, { removed: !t.removed })}
                                aria-label={t.removed ? 'Undo removal' : 'Remove transaction'}
                              >
                                {t.removed ? <UndoIcon fontSize="small" /> : <DeleteIcon fontSize="small" />}
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
          </TableContainer>
        )}
      </Stack>
    </Container>
  );
}
