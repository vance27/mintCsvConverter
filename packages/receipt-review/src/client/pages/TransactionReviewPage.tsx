import { useEffect, useState } from 'react';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import {
  Chip,
  Container,
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

type ReceiptMatch = { receiptId: number; status: 'EXTRACTED' | 'SUBMITTED'; aggregate: Record<string, number> } | null;

interface TransactionSummary {
  id: number;
  payer: string;
  date: string;
  description: string;
  amount: number;
  splitType: string;
  syncedAt: string | null;
  receiptMatch: ReceiptMatch;
}

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

  useEffect(() => {
    void (async () => {
      const res = await api.transactions.$get();
      setTransactions(await res.json());
    })();
  }, []);

  return (
    <Container maxWidth="lg" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Typography variant="h4">Review transactions</Typography>
        {transactions === null ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : transactions.length === 0 ? (
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
                </TableRow>
              </TableHead>
              <TableBody>
                {transactions.map((t) => (
                  <TableRow key={t.id} hover>
                    <TableCell>{t.date}</TableCell>
                    <TableCell>{t.payer}</TableCell>
                    <TableCell>{t.description}</TableCell>
                    <TableCell align="right">${t.amount.toFixed(2)}</TableCell>
                    <TableCell>{t.splitType}</TableCell>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>
    </Container>
  );
}
