import { useEffect, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import {
    Autocomplete,
    Box,
    Button,
    Container,
    List,
    ListItem,
    ListItemText,
    MenuItem,
    Paper,
    Select,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from '@mui/material';
import { api } from '../lib/api.js';

interface UploadPageProps {
    onDone: () => void;
}

interface UploadRow {
    file: File;
    store: string;
    payer: string;
    model: string;
}

interface UploadDefaults {
    store: string;
    payer: string;
    model: string;
}

// No stores/participants/models are known yet on a totally fresh install (no
// prior localStorage, e.g. first run) — these bootstrap a usable row rather
// than forcing a blank choice before the option lists below have loaded.
// Matches this app's long-standing Costco/Brian assumption and
// ollamaClient.ts's own defaultOllamaModel() fallback.
const BOOTSTRAP_DEFAULTS: UploadDefaults = { store: 'Costco', payer: 'Brian', model: 'qwen2.5vl:32b' };

const STICKY_DEFAULTS_KEY = 'receipt-review:upload-defaults';

/** The last store/payer/model used, sticky across sessions (ADR-0005) — not a hardcoded default. */
function loadStickyDefaults(): UploadDefaults {
    try {
        const raw = localStorage.getItem(STICKY_DEFAULTS_KEY);
        if (raw) {
            return { ...BOOTSTRAP_DEFAULTS, ...(JSON.parse(raw) as Partial<UploadDefaults>) };
        }
    } catch {
        // Corrupt or inaccessible localStorage — fall through to the bootstrap default.
    }
    return BOOTSTRAP_DEFAULTS;
}

function saveStickyDefaults(defaults: UploadDefaults): void {
    try {
        localStorage.setItem(STICKY_DEFAULTS_KEY, JSON.stringify(defaults));
    } catch {
        // Not worth surfacing to the user — sticky defaults are a convenience, not a requirement.
    }
}

type Participant = InferResponseType<typeof api.participants.$get>[number];
type VariableSplitRule = InferResponseType<(typeof api)['variable-split-rules']['$get']>[number];

/**
 * Upload page (ADR-0003, ADR-0005, and the UI half of ADR-0007): files are
 * picked first, then shown in an editable table with per-row Store/Payer/
 * Model — a batch is never forced to share one value across genuinely
 * distinct receipts. Nothing is queued for extraction until the explicit
 * "Queue for extraction" submit.
 */
export function UploadPage({ onDone }: UploadPageProps) {
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [storeOptions, setStoreOptions] = useState<string[]>([]);
    const [modelOptions, setModelOptions] = useState<string[]>([]);
    const [rows, setRows] = useState<UploadRow[] | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [queuedFilenames, setQueuedFilenames] = useState<string[] | null>(null);

    useEffect(() => {
        void (async () => {
            const [participantsRes, rulesRes] = await Promise.all([
                api.participants.$get(),
                api['variable-split-rules'].$get(),
            ]);
            setParticipants(await participantsRes.json());
            setStoreOptions((await rulesRes.json()).map((r: VariableSplitRule) => r.pattern));
        })();
        // Fetched separately: a local Ollama server being unreachable (a real,
        // documented failure mode — see CLAUDE.md's reauthorize/--watch note
        // on this same local-tooling flakiness class) shouldn't also break
        // Store/Payer, which don't depend on it.
        void (async () => {
            try {
                setModelOptions(await (await api['ollama-models'].$get()).json());
            } catch {
                // modelOptions stays empty — each row's Model Select still shows its own
                // current (sticky/bootstrap) value, just with no other choices offered.
            }
        })();
    }, []);

    function chooseFiles(selected: File[]): void {
        const defaults = loadStickyDefaults();
        setQueuedFilenames(null);
        setRows(selected.map((file) => ({ file, ...defaults })));
    }

    function updateRow(index: number, patch: Partial<Omit<UploadRow, 'file'>>): void {
        setRows((prev) => {
            if (!prev) {
                return prev;
            }
            const next = prev.map((row, i) => (i === index ? { ...row, ...patch } : row));
            saveStickyDefaults({ store: next[index].store, payer: next[index].payer, model: next[index].model });
            return next;
        });
    }

    async function handleSubmit(): Promise<void> {
        if (!rows || rows.length === 0) {
            return;
        }
        setSubmitting(true);

        const formData = new FormData();
        for (const row of rows) {
            formData.append('files', row.file);
        }
        formData.append('meta', JSON.stringify(rows.map(({ store, payer, model }) => ({ store, payer, model }))));

        // enqueue() already awaits the placeholder Receipt row's DB write
        // before this responds, so there's no "hasn't shown up yet" gap to
        // bridge — the Receipts table (now durable and polling on its own) is
        // the single place to watch extraction progress from here on.
        await fetch('/api/uploads', { method: 'POST', body: formData });
        setQueuedFilenames(rows.map((row) => row.file.name));
        setRows(null);
        setSubmitting(false);
    }

    return (
        <Container maxWidth="md" sx={{ py: 6 }}>
            <Paper sx={{ p: 4 }}>
                <Stack spacing={3}>
                    <Typography variant="h4">Upload receipts</Typography>
                    <Button component="label" variant="contained" disabled={submitting} sx={{ alignSelf: 'flex-start' }}>
                        Choose PDFs
                        <input
                            type="file"
                            accept="application/pdf"
                            multiple
                            hidden
                            onChange={(e) => {
                                const selected = Array.from(e.target.files ?? []);
                                if (selected.length > 0) {
                                    chooseFiles(selected);
                                }
                                e.target.value = '';
                            }}
                        />
                    </Button>

                    {rows ? (
                        <>
                            <TableContainer>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>File</TableCell>
                                            <TableCell>Store</TableCell>
                                            <TableCell>Payer</TableCell>
                                            <TableCell>Model</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {rows.map((row, i) => (
                                            <TableRow key={i}>
                                                <TableCell>{row.file.name}</TableCell>
                                                <TableCell sx={{ minWidth: 180 }}>
                                                    <Autocomplete
                                                        freeSolo
                                                        disableClearable
                                                        size="small"
                                                        options={storeOptions}
                                                        value={row.store}
                                                        disabled={submitting}
                                                        onInputChange={(_e, value) => updateRow(i, { store: value })}
                                                        renderInput={(params) => <TextField {...params} />}
                                                    />
                                                </TableCell>
                                                <TableCell sx={{ minWidth: 140 }}>
                                                    <Select
                                                        size="small"
                                                        fullWidth
                                                        value={row.payer}
                                                        disabled={submitting}
                                                        onChange={(e) => updateRow(i, { payer: e.target.value })}
                                                    >
                                                        {/* The row's current value is included even if participants
                                                            hasn't loaded yet, or no longer names an active
                                                            participant, so the Select never renders with an empty
                                                            selection the user didn't choose. */}
                                                        {(participants.some((p) => p.name === row.payer)
                                                            ? participants
                                                            : [{ id: -1, name: row.payer }, ...participants]
                                                        ).map((p) => (
                                                            <MenuItem key={p.id} value={p.name}>
                                                                {p.name}
                                                            </MenuItem>
                                                        ))}
                                                    </Select>
                                                </TableCell>
                                                <TableCell sx={{ minWidth: 160 }}>
                                                    <Select
                                                        size="small"
                                                        fullWidth
                                                        value={row.model}
                                                        disabled={submitting}
                                                        onChange={(e) => updateRow(i, { model: e.target.value })}
                                                    >
                                                        {(modelOptions.includes(row.model)
                                                            ? modelOptions
                                                            : [row.model, ...modelOptions]
                                                        ).map((model) => (
                                                            <MenuItem key={model} value={model}>
                                                                {model}
                                                            </MenuItem>
                                                        ))}
                                                    </Select>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                            <Button
                                variant="contained"
                                size="large"
                                disabled={submitting}
                                onClick={() => void handleSubmit()}
                                sx={{ alignSelf: 'flex-start' }}
                            >
                                {submitting ? 'Queuing…' : `Queue ${rows.length} receipt${rows.length === 1 ? '' : 's'} for extraction`}
                            </Button>
                        </>
                    ) : null}

                    {queuedFilenames ? (
                        <>
                            <Typography color="text.secondary">
                                {queuedFilenames.length} file{queuedFilenames.length === 1 ? '' : 's'} queued for
                                extraction:
                            </Typography>
                            <List>
                                {queuedFilenames.map((name, i) => (
                                    <ListItem key={i} sx={{ bgcolor: 'background.default', borderRadius: 1, mb: 1 }}>
                                        <ListItemText primary={name} />
                                    </ListItem>
                                ))}
                            </List>
                            <Box>
                                <Button variant="outlined" onClick={onDone}>
                                    Go to review queue
                                </Button>
                            </Box>
                        </>
                    ) : null}
                </Stack>
            </Paper>
        </Container>
    );
}
