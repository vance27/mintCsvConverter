import { useEffect, useState } from 'react';
import type { InferResponseType } from 'hono/client';
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
  Typography,
} from '@mui/material';
import { api } from '../lib/api.js';

type ReceiptSummary = InferResponseType<typeof api.receipts.$get>[number];

interface ReviewQueuePageProps {
  onUpload: () => void;
  onSelect: (receiptId: number) => void;
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
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h4">Receipts needing review</Typography>
          <Button variant="contained" onClick={onUpload}>
            Upload more
          </Button>
        </Stack>
        {receipts === null ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : receipts.length === 0 ? (
          <Paper sx={{ p: 4 }}>
            <Typography color="text.secondary">Nothing to review — upload a receipt to get started.</Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Store</TableCell>
                  <TableCell>Payer</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell align="right">Items</TableCell>
                  <TableCell>Confidence</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {receipts.map((receipt) => (
                  <TableRow key={receipt.id} hover onClick={() => onSelect(receipt.id)} sx={{ cursor: 'pointer' }}>
                    <TableCell>{receipt.store}</TableCell>
                    <TableCell>{receipt.payer}</TableCell>
                    <TableCell>{receipt.purchaseDate.slice(0, 10)}</TableCell>
                    <TableCell align="right">${receipt.total.toFixed(2)}</TableCell>
                    <TableCell align="right">{receipt.lineItemCount}</TableCell>
                    <TableCell>
                      {receipt.reconciled ? (
                        <Chip label="ok" color="success" size="small" variant="outlined" />
                      ) : (
                        <Chip label="needs a closer look" color="warning" size="small" variant="outlined" />
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
