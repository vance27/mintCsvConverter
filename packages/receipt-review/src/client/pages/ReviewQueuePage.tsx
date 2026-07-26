import { useEffect, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import {
  Button,
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

type ReceiptSummary = InferResponseType<typeof api.receipts.$get>[number];

interface ReviewQueuePageProps {
  onUpload: () => void;
  onSelect: (receiptId: number) => void;
}

function ReviewIndicator({ status }: { status: ReceiptSummary['status'] }) {
  return status === 'SUBMITTED' ? (
    <Tooltip title="Submitted">
      <CheckCircleIcon color="success" fontSize="small" />
    </Tooltip>
  ) : (
    <Tooltip title="Needs review">
      <PriorityHighIcon color="warning" fontSize="small" />
    </Tooltip>
  );
}

export function ReviewQueuePage({ onUpload, onSelect }: ReviewQueuePageProps) {
  const [receipts, setReceipts] = useState<ReceiptSummary[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await api.receipts.$get();
      setReceipts(await res.json());
    })();
  }, []);

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
                {receipts.map((receipt) => (
                  <TableRow key={receipt.id} hover onClick={() => onSelect(receipt.id)} sx={{ cursor: 'pointer' }}>
                    <TableCell>
                      <ReviewIndicator status={receipt.status} />
                    </TableCell>
                    <TableCell>{receipt.store}</TableCell>
                    <TableCell>{receipt.payer}</TableCell>
                    <TableCell>{receipt.purchaseDate.slice(0, 10)}</TableCell>
                    <TableCell align="right">${receipt.total.toFixed(2)}</TableCell>
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
