import { useEffect, useMemo, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import { Alert, Box, Chip, Container, Divider, Grid, Paper, Slider, Stack, TextField, Typography, Button } from '@mui/material';
import { api } from '../lib/api.js';

type ReceiptDetail = InferResponseType<(typeof api.receipts)[':id']['$get']>;
type LineItemDetail = ReceiptDetail['lineItems'][number];
type SubmitResult = InferResponseType<(typeof api.receipts)[':id']['submit']['$post']>;

interface ReceiptReviewPageProps {
  receiptId: number;
  onBack: () => void;
  onSubmitted: (result: SubmitResult) => void;
}

interface Draft {
  displayName: string;
  /** Slider value: 0 = 100% left participant, 100 = 100% right participant. */
  rightPercent: number;
}

/**
 * "All the way left is 100% Brian, all the way right is 100% Patrice" — look
 * those names up specifically rather than relying on array order, falling
 * back to whatever two participants exist so this doesn't break if the
 * seeded names ever differ.
 */
function resolveNames(lineItems: LineItemDetail[]): [left: string, right: string] {
  const participants = [...new Set(lineItems.flatMap((li) => Object.keys(li.splits)))];
  const left = participants.includes('Brian') ? 'Brian' : (participants[0] ?? 'Brian');
  const right = participants.includes('Patrice') ? 'Patrice' : (participants.find((p) => p !== left) ?? 'Patrice');
  return [left, right];
}

function draftFromLineItem(line: LineItemDetail, leftName: string, rightName: string): Draft {
  return {
    displayName: line.displayName ?? '',
    rightPercent: line.splits[rightName] ?? 100 - (line.splits[leftName] ?? 50),
  };
}

export function ReceiptReviewPage({ receiptId, onBack, onSubmitted }: ReceiptReviewPageProps) {
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [leftName, rightName] = useMemo(() => (detail ? resolveNames(detail.lineItems) : ['Brian', 'Patrice']), [detail]);

  useEffect(() => {
    void load();
  }, [receiptId]);

  async function load(): Promise<void> {
    const res = await api.receipts[':id'].$get({ param: { id: String(receiptId) } });
    const data = await res.json();
    const [left, right] = resolveNames(data.lineItems);
    setDetail(data);
    setDrafts(Object.fromEntries(data.lineItems.map((li) => [li.id, draftFromLineItem(li, left, right)])));
  }

  const liveAggregate = useMemo(() => {
    if (!detail) {
      return { [leftName]: 0, [rightName]: 0 };
    }
    let leftTotal = 0;
    let rightTotal = 0;
    let netTotal = 0;
    for (const line of detail.lineItems) {
      const draft = drafts[line.id];
      const net = line.lineTotal - line.discountAmount;
      const rightPercent = draft?.rightPercent ?? 50;
      netTotal += net;
      rightTotal += net * (rightPercent / 100);
      leftTotal += net * ((100 - rightPercent) / 100);
    }
    if (netTotal <= 0) {
      return { [leftName]: 0, [rightName]: 0 };
    }
    return {
      [leftName]: Math.round((leftTotal / netTotal) * 100),
      [rightName]: Math.round((rightTotal / netTotal) * 100),
    };
  }, [detail, drafts, leftName, rightName]);

  async function submit(): Promise<void> {
    if (!detail) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // No per-line "Save" step — every line's current slider/name value is
      // saved as part of one Submit action, so an untouched (default) slider
      // is an implicit "the default is fine," not something you have to
      // separately confirm.
      const patchResults = await Promise.all(
        detail.lineItems.map((line) => {
          const draft = drafts[line.id];
          const splits = { [leftName]: 100 - (draft?.rightPercent ?? 50), [rightName]: draft?.rightPercent ?? 50 };
          return api.receipts[':id']['line-items'][':lineItemId'].$patch({
            param: { id: String(receiptId), lineItemId: String(line.id) },
            json: { splits, displayName: draft?.displayName || undefined },
          });
        }),
      );
      if (patchResults.some((res) => res.status !== 200)) {
        setError('Failed to save one or more line items.');
        return;
      }

      const res = await api.receipts[':id'].submit.$post({ param: { id: String(receiptId) } });
      if (res.status !== 200) {
        setError('Could not submit this receipt.');
        return;
      }
      const data = await res.json();
      onSubmitted(data);
    } finally {
      setSubmitting(false);
    }
  }

  if (!detail) {
    return (
      <Container sx={{ py: 6 }}>
        <Typography color="text.secondary">Loading…</Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={2} sx={{ position: 'sticky', top: 16 }}>
            <Button variant="outlined" onClick={onBack} sx={{ alignSelf: 'flex-start' }}>
              Back to queue
            </Button>
            <Paper sx={{ p: 1, height: '85vh' }}>
              <Box
                component="iframe"
                title="Receipt PDF"
                src={`/api/receipts/${receiptId}/source.pdf`}
                sx={{ width: '100%', height: '100%', border: 0 }}
              />
            </Paper>
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={2}>
            <Typography variant="h4">
              {detail.store} — {detail.purchaseDate.slice(0, 10)}
            </Typography>
            <Typography color="text.secondary">
              Paid by {detail.payer}. Total: ${detail.total.toFixed(2)}.
              {detail.reconciled ? '' : ' ⚠ low confidence — check carefully against the PDF.'}
            </Typography>
            {error ? <Alert severity="error">{error}</Alert> : null}

            {detail.lineItems.map((line) => {
              const draft = drafts[line.id] ?? { displayName: line.displayName ?? '', rightPercent: 50 };
              const changePercent = line.priceHistory.changePercent;
              return (
                <Paper key={line.id} sx={{ p: 2 }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <TextField
                        variant="standard"
                        value={draft.displayName}
                        placeholder={line.rawName}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [line.id]: { ...draft, displayName: e.target.value } }))
                        }
                        sx={{ flex: 1 }}
                      />
                      <Chip
                        size="small"
                        label={line.provenance === 'new' ? 'new — please set' : 'learned'}
                        color={line.provenance === 'new' ? 'secondary' : 'default'}
                        variant="outlined"
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      ${line.unitPrice.toFixed(2)} × {line.quantity} = ${line.lineTotal.toFixed(2)}
                      {line.priceHistory.previousUnitPrice === null
                        ? ''
                        : changePercent !== null && Math.abs(changePercent) > 1
                          ? ` · was $${line.priceHistory.previousUnitPrice.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(0)}%)`
                          : ' · no price change'}
                    </Typography>
                    <Box sx={{ px: 1 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                        <Typography variant="caption">{leftName}</Typography>
                        <Typography variant="caption">{rightName}</Typography>
                      </Stack>
                      <Slider
                        value={draft.rightPercent}
                        onChange={(_e, value) => setDrafts((prev) => ({ ...prev, [line.id]: { ...draft, rightPercent: value } }))}
                        valueLabelDisplay="auto"
                        valueLabelFormat={(v) => `${leftName} ${100 - v}% · ${rightName} ${v}%`}
                        min={0}
                        max={100}
                      />
                    </Box>
                  </Stack>
                </Paper>
              );
            })}

            <Divider />
            <Typography>
              Live aggregate: {leftName} {liveAggregate[leftName]}%, {rightName} {liveAggregate[rightName]}%
            </Typography>
            <Button variant="contained" size="large" disabled={submitting} onClick={() => void submit()}>
              {submitting ? 'Submitting…' : 'Submit receipt'}
            </Button>
          </Stack>
        </Grid>
      </Grid>
    </Container>
  );
}
