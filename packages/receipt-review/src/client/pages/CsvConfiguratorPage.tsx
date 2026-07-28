import { useState } from 'react';
import type { InferResponseType } from 'hono/client';
import {
    Alert,
    Button,
    Checkbox,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Paper,
    Radio,
    RadioGroup,
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

type CsvPreview = InferResponseType<(typeof api)['csv-import-preview']['$post']>;
type CreatedProfile = InferResponseType<(typeof api)['csv-import-profiles']['$post'], 200>;

interface CsvConfiguratorPageProps {
    fileName: string;
    preview: CsvPreview;
    onCancel: () => void;
    onSaved: (profile: CreatedProfile) => void;
}

function columnLabel(preview: CsvPreview, hasHeader: boolean, index: number): string {
    const headerText = hasHeader ? preview.rows[0]?.[index] : undefined;
    return headerText && headerText.trim() !== '' ? headerText : `Column ${index + 1}`;
}

/**
 * Shown when /api/csv-import-preview finds no matching saved
 * CsvImportProfile for a just-uploaded CSV — lets the user map this
 * never-before-seen shape's columns to the roles core's CsvColumnMapping
 * needs, then saves it as a named profile so future imports of the same
 * shape (matched via headerSignature/columnCount) skip this step entirely.
 */
export function CsvConfiguratorPage({ fileName, preview, onCancel, onSaved }: CsvConfiguratorPageProps) {
    const [name, setName] = useState(fileName.replace(/\.csv$/i, ''));
    const [hasHeader, setHasHeader] = useState(preview.headerSignature !== null);
    const [dateColumn, setDateColumn] = useState(0);
    const [descriptionColumn, setDescriptionColumn] = useState(Math.min(1, preview.columnCount - 1));
    const [amountMode, setAmountMode] = useState<'DEBIT_CREDIT' | 'SIGNED_AMOUNT'>('SIGNED_AMOUNT');
    const [debitColumn, setDebitColumn] = useState(Math.min(2, preview.columnCount - 1));
    const [creditColumn, setCreditColumn] = useState(Math.min(3, preview.columnCount - 1));
    const [amountColumn, setAmountColumn] = useState(Math.min(2, preview.columnCount - 1));
    const [flipSign, setFlipSign] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const columnIndexes = Array.from({ length: preview.columnCount }, (_, i) => i);

    async function handleSave(): Promise<void> {
        if (name.trim() === '') {
            setError('Give this profile a name');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const res = await api['csv-import-profiles'].$post({
                json: {
                    name: name.trim(),
                    hasHeader,
                    columnCount: preview.columnCount,
                    headerSignature: hasHeader ? preview.headerSignature : null,
                    columnMapping: {
                        hasHeader,
                        dateColumn: { byIndex: dateColumn },
                        descriptionColumn: { byIndex: descriptionColumn },
                        amount:
                            amountMode === 'DEBIT_CREDIT'
                                ? {
                                      mode: 'DEBIT_CREDIT',
                                      debitColumn: { byIndex: debitColumn },
                                      creditColumn: { byIndex: creditColumn },
                                  }
                                : { mode: 'SIGNED_AMOUNT', amountColumn: { byIndex: amountColumn }, flipSign },
                    },
                },
            });
            if (!res.ok) {
                setError('Failed to save this profile — check the name is unique');
                return;
            }
            onSaved(await res.json());
        } finally {
            setSaving(false);
        }
    }

    return (
        <Paper sx={{ p: 4 }}>
            <Stack spacing={3}>
                <Typography variant="h5">Configure a new CSV format</Typography>
                <Typography color="text.secondary">
                    "{fileName}" doesn't match any saved import profile. Map its columns below — this only needs to
                    happen once per CSV shape.
                </Typography>
                {error ? <Alert severity="error">{error}</Alert> : null}

                <TableContainer sx={{ maxHeight: 300 }}>
                    <Table size="small" stickyHeader>
                        <TableHead>
                            <TableRow>
                                {columnIndexes.map((i) => (
                                    <TableCell key={i}>{columnLabel(preview, hasHeader, i)}</TableCell>
                                ))}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {preview.rows.slice(hasHeader ? 1 : 0).map((row, rowIndex) => (
                                <TableRow key={rowIndex}>
                                    {columnIndexes.map((i) => (
                                        <TableCell key={i}>{row[i]}</TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>

                <FormControlLabel
                    control={<Checkbox checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />}
                    label="First row is a header"
                />

                <TextField label="Profile name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />

                <Stack direction="row" spacing={2}>
                    <FormControl fullWidth>
                        <InputLabel id="date-column-label">Date column</InputLabel>
                        <Select
                            labelId="date-column-label"
                            label="Date column"
                            value={dateColumn}
                            onChange={(e) => setDateColumn(Number(e.target.value))}
                        >
                            {columnIndexes.map((i) => (
                                <MenuItem key={i} value={i}>
                                    {columnLabel(preview, hasHeader, i)}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl fullWidth>
                        <InputLabel id="description-column-label">Description column</InputLabel>
                        <Select
                            labelId="description-column-label"
                            label="Description column"
                            value={descriptionColumn}
                            onChange={(e) => setDescriptionColumn(Number(e.target.value))}
                        >
                            {columnIndexes.map((i) => (
                                <MenuItem key={i} value={i}>
                                    {columnLabel(preview, hasHeader, i)}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Stack>

                <RadioGroup
                    row
                    value={amountMode}
                    onChange={(e) => setAmountMode(e.target.value as 'DEBIT_CREDIT' | 'SIGNED_AMOUNT')}
                >
                    <FormControlLabel value="SIGNED_AMOUNT" control={<Radio />} label="Single signed Amount column" />
                    <FormControlLabel value="DEBIT_CREDIT" control={<Radio />} label="Separate Debit/Credit columns" />
                </RadioGroup>

                {amountMode === 'SIGNED_AMOUNT' ? (
                    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                        <FormControl fullWidth>
                            <InputLabel id="amount-column-label">Amount column</InputLabel>
                            <Select
                                labelId="amount-column-label"
                                label="Amount column"
                                value={amountColumn}
                                onChange={(e) => setAmountColumn(Number(e.target.value))}
                            >
                                {columnIndexes.map((i) => (
                                    <MenuItem key={i} value={i}>
                                        {columnLabel(preview, hasHeader, i)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControlLabel
                            control={<Checkbox checked={flipSign} onChange={(e) => setFlipSign(e.target.checked)} />}
                            label="Flip sign"
                        />
                    </Stack>
                ) : (
                    <Stack direction="row" spacing={2}>
                        <FormControl fullWidth>
                            <InputLabel id="debit-column-label">Debit column</InputLabel>
                            <Select
                                labelId="debit-column-label"
                                label="Debit column"
                                value={debitColumn}
                                onChange={(e) => setDebitColumn(Number(e.target.value))}
                            >
                                {columnIndexes.map((i) => (
                                    <MenuItem key={i} value={i}>
                                        {columnLabel(preview, hasHeader, i)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth>
                            <InputLabel id="credit-column-label">Credit column</InputLabel>
                            <Select
                                labelId="credit-column-label"
                                label="Credit column"
                                value={creditColumn}
                                onChange={(e) => setCreditColumn(Number(e.target.value))}
                            >
                                {columnIndexes.map((i) => (
                                    <MenuItem key={i} value={i}>
                                        {columnLabel(preview, hasHeader, i)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Stack>
                )}

                <Stack direction="row" spacing={2}>
                    <Button variant="outlined" onClick={onCancel} disabled={saving}>
                        Cancel
                    </Button>
                    <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
                        Save & Import
                    </Button>
                </Stack>
            </Stack>
        </Paper>
    );
}
