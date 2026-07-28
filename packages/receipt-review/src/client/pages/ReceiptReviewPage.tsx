import { useEffect, useMemo, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import { aggregateSplits, type AggregateLine } from '@mint-csv-converter/receipts/aggregate';
import { describeReconcileMismatch } from '@mint-csv-converter/receipts/reconcile';
import { storeNamesDisagree } from '@mint-csv-converter/receipts/storeNameMatch';
import DeleteIcon from '@mui/icons-material/Delete';
import RestoreIcon from '@mui/icons-material/RestoreFromTrash';
import {
    Alert,
    Box,
    Chip,
    Container,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    Grid,
    IconButton,
    Paper,
    Slider,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
    Button,
} from '@mui/material';
import { api } from '../lib/api.js';

type ReceiptDetail = InferResponseType<(typeof api.receipts)[':id']['$get']>;
type LineItemDetail = ReceiptDetail['lineItems'][number];
type SubmitResult = InferResponseType<(typeof api.receipts)[':id']['submit']['$post']>;

interface ReceiptReviewPageProps {
    receiptId: number;
    onBack: () => void;
    onSubmitted: (result: SubmitResult, wasUpdate: boolean) => void;
}

interface Draft {
    displayName: string;
    /** Slider value: 0 = 100% left participant, 100 = 100% right participant. */
    rightPercent: number;
    /** Reviewer-editable "what was actually paid" for this line — defaults to lineTotal - discountAmount. */
    netPrice: number;
    unitPrice: number;
    quantity: number;
    taxable: boolean | null;
}

interface AddItemForm {
    itemCode: string;
    rawName: string;
    unitPrice: string;
    quantity: string;
    taxable: boolean | null;
}

const emptyAddForm: AddItemForm = { itemCode: '', rawName: '', unitPrice: '', quantity: '1', taxable: null };

function round2(n: number): number {
    return Math.round(n * 100) / 100;
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
        netPrice: round2(line.lineTotal - line.discountAmount),
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        taxable: line.taxable,
    };
}

/** Adds a fresh draft for any line item not already tracked (e.g. one just added), without disturbing in-progress edits to existing lines. */
function mergeNewDrafts(
    prev: Record<number, Draft>,
    lineItems: LineItemDetail[],
    leftName: string,
    rightName: string,
): Record<number, Draft> {
    const next = { ...prev };
    for (const line of lineItems) {
        if (!(line.id in next)) {
            next[line.id] = draftFromLineItem(line, leftName, rightName);
        }
    }
    return next;
}

/**
 * unitPrice/quantity are the "printed" values; shifting either preserves the
 * dollar discount already dialed into netPrice, matching how the server
 * leaves discountAmount alone when netPrice isn't also submitted. `value` is
 * rounded on the way in — a native number input's step buttons (or a
 * scroll-wheel nudge while focused) increment/decrement in raw binary
 * floating point (e.g. 61 - 0.01 → 60.98999999999999), and without rounding
 * that drift would both display as garbage and compound further on every
 * subsequent edit.
 */
function applyPriceFieldChange(draft: Draft, field: 'unitPrice' | 'quantity', rawValue: number): Draft {
    const value = round2(rawValue);
    const oldLineTotal = draft.unitPrice * draft.quantity;
    const updated = { ...draft, [field]: value };
    const newLineTotal = updated.unitPrice * updated.quantity;
    return { ...updated, netPrice: round2(draft.netPrice + (newLineTotal - oldLineTotal)) };
}

function taxableToggleValue(taxable: boolean | null): 'yes' | 'no' | 'unknown' {
    return taxable === null ? 'unknown' : taxable ? 'yes' : 'no';
}

export function ReceiptReviewPage({ receiptId, onBack, onSubmitted }: ReceiptReviewPageProps) {
    const [detail, setDetail] = useState<ReceiptDetail | null>(null);
    const [drafts, setDrafts] = useState<Record<number, Draft>>({});
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [deletingLineId, setDeletingLineId] = useState<number | null>(null);
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
    const [restoringLineId, setRestoringLineId] = useState<number | null>(null);
    const [savingCodeId, setSavingCodeId] = useState<number | null>(null);
    const [addForm, setAddForm] = useState<AddItemForm>(emptyAddForm);
    const [addingItem, setAddingItem] = useState(false);

    const [leftName, rightName] = useMemo(
        () => (detail ? resolveNames(detail.lineItems) : ['Brian', 'Patrice']),
        [detail],
    );

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

    const activeLineItems = useMemo(() => detail?.lineItems.filter((li) => li.removedAt === null) ?? [], [detail]);

    const liveAggregate = useMemo(() => {
        if (!detail) {
            return { [leftName]: 0, [rightName]: 0 };
        }
        const lines: AggregateLine[] = activeLineItems.map((line) => {
            const draft = drafts[line.id];
            const netPrice = draft?.netPrice ?? line.lineTotal - line.discountAmount;
            const rightPercent = draft?.rightPercent ?? 50;
            return {
                lineTotal: netPrice,
                discountAmount: 0,
                splits: { [leftName]: 100 - rightPercent, [rightName]: rightPercent },
            };
        });
        return aggregateSplits(lines, [leftName, rightName]);
    }, [detail, activeLineItems, drafts, leftName, rightName]);

    const liveTotal = useMemo(() => {
        return activeLineItems.reduce(
            (sum, line) => sum + (drafts[line.id]?.netPrice ?? line.lineTotal - line.discountAmount),
            0,
        );
    }, [activeLineItems, drafts]);

    async function deleteLine(lineItemId: number): Promise<void> {
        setDeletingLineId(lineItemId);
        try {
            const res = await api.receipts[':id']['line-items'][':lineItemId'].$delete({
                param: { id: String(receiptId), lineItemId: String(lineItemId) },
            });
            if (res.ok) {
                setDetail(await res.json());
            }
        } finally {
            setDeletingLineId(null);
            setConfirmingDeleteId(null);
        }
    }

    async function restoreLine(lineItemId: number): Promise<void> {
        setRestoringLineId(lineItemId);
        try {
            const res = await api.receipts[':id']['line-items'][':lineItemId'].restore.$post({
                param: { id: String(receiptId), lineItemId: String(lineItemId) },
            });
            if (res.ok) {
                setDetail(await res.json());
            }
        } finally {
            setRestoringLineId(null);
        }
    }

    async function saveItemCode(lineItemId: number, itemCode: string, currentCode: string | null): Promise<void> {
        const trimmed = itemCode.trim();
        if (!trimmed || trimmed === (currentCode ?? '')) {
            return;
        }
        setSavingCodeId(lineItemId);
        try {
            const res = await api.receipts[':id']['line-items'][':lineItemId']['item-code'].$patch({
                param: { id: String(receiptId), lineItemId: String(lineItemId) },
                json: { itemCode: trimmed },
            });
            if (res.ok) {
                setDetail(await res.json());
            }
        } finally {
            setSavingCodeId(null);
        }
    }

    async function addItem(): Promise<void> {
        const unitPrice = Number(addForm.unitPrice);
        const quantity = Number(addForm.quantity);
        if (!addForm.rawName.trim() || !Number.isFinite(unitPrice) || !Number.isFinite(quantity) || quantity <= 0) {
            setError('Enter a name, unit price, and a positive quantity to add a line item.');
            return;
        }
        setAddingItem(true);
        setError(null);
        try {
            const res = await api.receipts[':id']['line-items'].$post({
                param: { id: String(receiptId) },
                json: {
                    itemCode: addForm.itemCode.trim() || null,
                    rawName: addForm.rawName.trim(),
                    unitPrice,
                    quantity,
                    taxable: addForm.taxable,
                },
            });
            if (res.ok) {
                const data = await res.json();
                const [left, right] = resolveNames(data.lineItems);
                setDetail(data);
                setDrafts((prev) => mergeNewDrafts(prev, data.lineItems, left, right));
                setAddForm(emptyAddForm);
            } else {
                setError('Could not add this line item.');
            }
        } finally {
            setAddingItem(false);
        }
    }

    async function submit(): Promise<void> {
        if (!detail) {
            return;
        }
        const wasAlreadySubmitted = detail.status === 'SUBMITTED';
        setError(null);
        setSubmitting(true);
        try {
            // No per-line "Save" step — every active line's current slider/name
            // value is saved as part of one Submit action, so an untouched
            // (default) slider is an implicit "the default is fine," not
            // something you have to separately confirm. Removed lines are never
            // reviewed and are skipped here — the server-side submit gate
            // excludes them from the "every line reviewed" requirement too.
            const patchResults = await Promise.all(
                activeLineItems.map((line) => {
                    const draft = drafts[line.id];
                    const splits = {
                        [leftName]: 100 - (draft?.rightPercent ?? 50),
                        [rightName]: draft?.rightPercent ?? 50,
                    };
                    return api.receipts[':id']['line-items'][':lineItemId'].$patch({
                        param: { id: String(receiptId), lineItemId: String(line.id) },
                        json: {
                            splits,
                            displayName: draft?.displayName || undefined,
                            netPrice: draft?.netPrice,
                            unitPrice: draft?.unitPrice,
                            quantity: draft?.quantity,
                            taxable: draft?.taxable,
                        },
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
            onSubmitted(data, wasAlreadySubmitted);
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

    if (detail.purchaseDate === null || detail.total === null) {
        return (
            <Container sx={{ py: 6 }}>
                <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
                    <Button variant="outlined" onClick={onBack}>
                        Back to queue
                    </Button>
                    <Typography color="text.secondary">
                        {detail.status === 'FAILED'
                            ? `Extraction failed: ${detail.extractionError ?? 'unknown error'}. Retry from the queue.`
                            : `${detail.originalFilename ?? 'This receipt'} is still being extracted — check back in a moment.`}
                    </Typography>
                </Stack>
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
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                            <Typography variant="h4">
                                {detail.store} — {detail.purchaseDate.slice(0, 10)}
                            </Typography>
                            {detail.status === 'SUBMITTED' ? (
                                <Chip
                                    size="small"
                                    color="primary"
                                    label={`Submitted ${detail.submittedAt ? detail.submittedAt.slice(0, 10) : ''}`}
                                />
                            ) : null}
                        </Stack>
                        <Typography color="text.secondary">
                            Paid by {detail.payer}. Total: ${detail.total.toFixed(2)} · Live total: $
                            {liveTotal.toFixed(2)}.
                            {detail.reconciled
                                ? ''
                                : ` ⚠ ${detail.reconcile ? describeReconcileMismatch(detail.reconcile) : 'low confidence'} — check carefully against the PDF.`}
                        </Typography>
                        {storeNamesDisagree(detail.store, detail.extractedStoreName) ? (
                            <Alert severity="warning">
                                Declared store is "{detail.store}", but the receipt itself reads "
                                {detail.extractedStoreName}" — check this is the right receipt before submitting.
                            </Alert>
                        ) : null}
                        {error ? <Alert severity="error">{error}</Alert> : null}

                        {detail.lineItems.map((line) => {
                            if (line.removedAt !== null) {
                                return (
                                    <Paper key={line.id} sx={{ p: 2, opacity: 0.6 }}>
                                        <Stack
                                            direction="row"
                                            sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                                        >
                                            <Typography sx={{ textDecoration: 'line-through' }}>
                                                {line.displayName ?? line.rawName} — ${line.lineTotal.toFixed(2)}
                                            </Typography>
                                            <Tooltip title="Restore this line item">
                                                <span>
                                                    <IconButton
                                                        size="small"
                                                        disabled={restoringLineId === line.id}
                                                        onClick={() => void restoreLine(line.id)}
                                                    >
                                                        <RestoreIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        </Stack>
                                    </Paper>
                                );
                            }

                            const draft = drafts[line.id] ?? draftFromLineItem(line, leftName, rightName);
                            const changePercent = line.priceHistory.changePercent;
                            return (
                                <Paper key={line.id} sx={{ p: 2 }}>
                                    <Stack spacing={1.5}>
                                        <Stack
                                            direction="row"
                                            sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
                                        >
                                            <TextField
                                                variant="standard"
                                                value={draft.displayName}
                                                placeholder={line.rawName}
                                                onChange={(e) =>
                                                    setDrafts((prev) => ({
                                                        ...prev,
                                                        [line.id]: { ...draft, displayName: e.target.value },
                                                    }))
                                                }
                                                sx={{ flex: 1 }}
                                            />
                                            <Chip
                                                size="small"
                                                label={line.provenance === 'new' ? 'new — please set' : 'learned'}
                                                color={line.provenance === 'new' ? 'secondary' : 'default'}
                                                variant="outlined"
                                            />
                                            <Tooltip title="Remove this line item">
                                                <span>
                                                    <IconButton
                                                        size="small"
                                                        disabled={deletingLineId === line.id}
                                                        onClick={() => setConfirmingDeleteId(line.id)}
                                                    >
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        </Stack>
                                        <Typography variant="body2" color="text.secondary">
                                            Printed: ${line.unitPrice.toFixed(2)} × {line.quantity} = $
                                            {line.lineTotal.toFixed(2)}
                                            {line.discountAmount !== 0
                                                ? ` · discount $${line.discountAmount.toFixed(2)}`
                                                : ''}
                                            {line.priceHistory.previousUnitPrice === null
                                                ? ''
                                                : changePercent !== null && Math.abs(changePercent) > 1
                                                  ? ` · was $${line.priceHistory.previousUnitPrice.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(0)}%)`
                                                  : ' · no price change'}
                                        </Typography>
                                        <Stack direction="row" spacing={1}>
                                            <TextField
                                                label="Unit price"
                                                type="number"
                                                size="small"
                                                value={draft.unitPrice}
                                                onChange={(e) => {
                                                    const value = Number(e.target.value);
                                                    if (!Number.isNaN(value)) {
                                                        setDrafts((prev) => ({
                                                            ...prev,
                                                            [line.id]: applyPriceFieldChange(draft, 'unitPrice', value),
                                                        }));
                                                    }
                                                }}
                                                slotProps={{ htmlInput: { step: 0.01, min: 0 } }}
                                                sx={{ maxWidth: 130 }}
                                            />
                                            <TextField
                                                label="Quantity"
                                                type="number"
                                                size="small"
                                                value={draft.quantity}
                                                onChange={(e) => {
                                                    const value = Number(e.target.value);
                                                    if (!Number.isNaN(value) && value > 0) {
                                                        setDrafts((prev) => ({
                                                            ...prev,
                                                            [line.id]: applyPriceFieldChange(draft, 'quantity', value),
                                                        }));
                                                    }
                                                }}
                                                slotProps={{ htmlInput: { step: 1, min: 0 } }}
                                                sx={{ maxWidth: 110 }}
                                            />
                                            <TextField
                                                key={`code-${line.id}-${line.itemId}`}
                                                label="Item code"
                                                size="small"
                                                defaultValue={line.rawItemCode ?? ''}
                                                disabled={savingCodeId === line.id}
                                                onBlur={(e) => void saveItemCode(line.id, e.target.value, line.rawItemCode)}
                                                sx={{ maxWidth: 140 }}
                                            />
                                        </Stack>
                                        <ToggleButtonGroup
                                            size="small"
                                            exclusive
                                            value={taxableToggleValue(draft.taxable)}
                                            onChange={(_e, value: 'yes' | 'no' | 'unknown' | null) => {
                                                if (value === null) {
                                                    return;
                                                }
                                                setDrafts((prev) => ({
                                                    ...prev,
                                                    [line.id]: {
                                                        ...draft,
                                                        taxable: value === 'unknown' ? null : value === 'yes',
                                                    },
                                                }));
                                            }}
                                        >
                                            <ToggleButton value="yes">Taxable</ToggleButton>
                                            <ToggleButton value="no">Not taxable</ToggleButton>
                                            <ToggleButton value="unknown">Unknown</ToggleButton>
                                        </ToggleButtonGroup>
                                        <TextField
                                            label="Price paid"
                                            type="number"
                                            size="small"
                                            value={draft.netPrice}
                                            onChange={(e) => {
                                                const value = Number(e.target.value);
                                                if (!Number.isNaN(value)) {
                                                    setDrafts((prev) => ({
                                                        ...prev,
                                                        [line.id]: { ...draft, netPrice: round2(value) },
                                                    }));
                                                }
                                            }}
                                            slotProps={{ htmlInput: { step: 0.01, min: 0 } }}
                                            sx={{ maxWidth: 160 }}
                                        />
                                        <Box sx={{ px: 1 }}>
                                            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                                                <Typography variant="caption">{leftName}</Typography>
                                                <Typography variant="caption">{rightName}</Typography>
                                            </Stack>
                                            <Slider
                                                value={draft.rightPercent}
                                                onChange={(_e, value) =>
                                                    setDrafts((prev) => ({
                                                        ...prev,
                                                        [line.id]: { ...draft, rightPercent: value },
                                                    }))
                                                }
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

                        <Paper sx={{ p: 2 }} variant="outlined">
                            <Stack spacing={1.5}>
                                <Typography variant="subtitle2">Add a line item the receipt is missing</Typography>
                                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                                    <TextField
                                        label="Name"
                                        size="small"
                                        value={addForm.rawName}
                                        onChange={(e) => setAddForm((prev) => ({ ...prev, rawName: e.target.value }))}
                                        sx={{ flex: 1, minWidth: 160 }}
                                    />
                                    <TextField
                                        label="Item code"
                                        size="small"
                                        value={addForm.itemCode}
                                        onChange={(e) => setAddForm((prev) => ({ ...prev, itemCode: e.target.value }))}
                                        sx={{ maxWidth: 140 }}
                                    />
                                    <TextField
                                        label="Unit price"
                                        type="number"
                                        size="small"
                                        value={addForm.unitPrice}
                                        onChange={(e) => setAddForm((prev) => ({ ...prev, unitPrice: e.target.value }))}
                                        slotProps={{ htmlInput: { step: 0.01, min: 0 } }}
                                        sx={{ maxWidth: 130 }}
                                    />
                                    <TextField
                                        label="Quantity"
                                        type="number"
                                        size="small"
                                        value={addForm.quantity}
                                        onChange={(e) => setAddForm((prev) => ({ ...prev, quantity: e.target.value }))}
                                        slotProps={{ htmlInput: { step: 1, min: 0 } }}
                                        sx={{ maxWidth: 110 }}
                                    />
                                </Stack>
                                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                    <ToggleButtonGroup
                                        size="small"
                                        exclusive
                                        value={taxableToggleValue(addForm.taxable)}
                                        onChange={(_e, value: 'yes' | 'no' | 'unknown' | null) => {
                                            if (value === null) {
                                                return;
                                            }
                                            setAddForm((prev) => ({
                                                ...prev,
                                                taxable: value === 'unknown' ? null : value === 'yes',
                                            }));
                                        }}
                                    >
                                        <ToggleButton value="yes">Taxable</ToggleButton>
                                        <ToggleButton value="no">Not taxable</ToggleButton>
                                        <ToggleButton value="unknown">Unknown</ToggleButton>
                                    </ToggleButtonGroup>
                                    <Button variant="outlined" disabled={addingItem} onClick={() => void addItem()}>
                                        {addingItem ? 'Adding…' : 'Add item'}
                                    </Button>
                                </Stack>
                            </Stack>
                        </Paper>

                        <Divider />
                        <Typography>
                            Live aggregate: {leftName} {liveAggregate[leftName]}%, {rightName}{' '}
                            {liveAggregate[rightName]}%
                        </Typography>
                        <Button variant="contained" size="large" disabled={submitting} onClick={() => void submit()}>
                            {submitting
                                ? 'Saving…'
                                : detail.status === 'SUBMITTED'
                                  ? 'Update splits'
                                  : 'Submit receipt'}
                        </Button>
                    </Stack>
                </Grid>
            </Grid>
            <Dialog
                open={confirmingDeleteId !== null}
                onClose={() => setConfirmingDeleteId(null)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Remove this line item?</DialogTitle>
                <DialogContent>
                    <Typography>You can restore it afterward from this same page.</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmingDeleteId(null)} disabled={deletingLineId !== null}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => confirmingDeleteId !== null && void deleteLine(confirmingDeleteId)}
                        variant="contained"
                        color="error"
                        disabled={deletingLineId !== null}
                    >
                        Remove
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}
