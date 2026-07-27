import { useRef, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { api } from '../lib/api.js';
import { CsvConfiguratorPage } from './CsvConfiguratorPage.js';

type CsvPreview = InferResponseType<(typeof api)['csv-import-preview']['$post']>;

interface ImportResult {
  importedCount: number;
  skippedDuplicateCount: number;
  excludedCount: number;
}

interface FileProgress {
  file: File;
  jobId?: string;
  status: 'previewing' | 'configuring' | 'uploading' | 'pending' | 'done' | 'error';
  message?: string;
  result?: ImportResult;
}

const POLL_INTERVAL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function StatusChip({ status }: { status: FileProgress['status'] }) {
  if (status === 'done') {
    return <Chip label="Done" color="success" size="small" />;
  }
  if (status === 'error') {
    return <Chip label="Error" color="error" size="small" />;
  }
  const label = { previewing: 'Checking format', configuring: 'Needs configuration', uploading: 'Uploading', pending: 'Importing' }[status];
  return <Chip icon={<CircularProgress size={14} />} label={label} size="small" />;
}

/**
 * Uploads a Citi (or other, once configured) CSV export and stages it as
 * ImportedTransaction rows — never touches Google Sheets. See
 * SyncOverviewPage for the separate, explicit sync step, and
 * TransactionReviewPage for reviewing what got staged against receipts.
 *
 * Every file is previewed first (/api/csv-import-preview) to auto-detect
 * a saved CsvImportProfile (the seeded "Citi (default)" one covers the
 * common case with zero user interaction). A genuinely new CSV shape
 * shows CsvConfiguratorPage instead — files are processed one at a time
 * so at most one configurator prompt is ever on screen.
 */
export function ImportPage() {
  const [payer, setPayer] = useState('Brian');
  const [files, setFiles] = useState<FileProgress[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [configuring, setConfiguring] = useState<{ index: number; file: File; preview: CsvPreview } | null>(null);
  const configuratorResolveRef = useRef<((profileId: number | null) => void) | null>(null);

  async function pollJob(jobId: string, index: number): Promise<void> {
    for (;;) {
      const res = await api.imports[':jobId'].$get({ param: { jobId } });
      const job = await res.json();
      if (job.status === 'done') {
        setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'done', result: job.result } : f)));
        return;
      }
      if (job.status === 'error') {
        setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'error', message: job.message } : f)));
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  async function resolveProfileId(file: File, index: number): Promise<number | null> {
    const previewFormData = new FormData();
    previewFormData.append('file', file);
    const res = await fetch('/api/csv-import-preview', { method: 'POST', body: previewFormData });
    const preview = (await res.json()) as CsvPreview;

    if (preview.detectedProfile) {
      return preview.detectedProfile.id;
    }

    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'configuring' } : f)));
    const profileId = await new Promise<number | null>((resolve) => {
      configuratorResolveRef.current = resolve;
      setConfiguring({ index, file, preview });
    });
    setConfiguring(null);
    return profileId;
  }

  async function handleSubmit(selected: File[]): Promise<void> {
    setSubmitting(true);
    setFiles(selected.map((file) => ({ file, status: 'previewing' })));

    for (let index = 0; index < selected.length; index++) {
      const file = selected[index];
      const profileId = await resolveProfileId(file, index);
      if (profileId === null) {
        setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'error', message: 'Skipped — not configured' } : f)));
        continue;
      }

      setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'uploading' } : f)));
      const formData = new FormData();
      formData.append('files', file);
      formData.append('payer', payer);
      formData.append('profileId', String(profileId));
      const res = await fetch('/api/imports', { method: 'POST', body: formData });
      const { jobIds } = (await res.json()) as { jobIds: string[] };

      setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, jobId: jobIds[0], status: 'pending' } : f)));
      await pollJob(jobIds[0], index);
    }

    setSubmitting(false);
  }

  if (configuring) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <CsvConfiguratorPage
          fileName={configuring.file.name}
          preview={configuring.preview}
          onCancel={() => configuratorResolveRef.current?.(null)}
          onSaved={(profile) => configuratorResolveRef.current?.(profile.id)}
        />
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Paper sx={{ p: 4 }}>
        <Stack spacing={3}>
          <Typography variant="h4">Import transactions</Typography>
          <Typography color="text.secondary">
            Uploading a CSV export only stages transactions for review — it never syncs to Google Sheets by itself.
          </Typography>
          <FormControl disabled={submitting} fullWidth>
            <InputLabel id="import-payer-label">Payer</InputLabel>
            <Select labelId="import-payer-label" label="Payer" value={payer} onChange={(e) => setPayer(e.target.value)}>
              <MenuItem value="Brian">Brian</MenuItem>
              <MenuItem value="Patrice">Patrice</MenuItem>
            </Select>
          </FormControl>
          <Button component="label" variant="contained" disabled={submitting}>
            Choose CSV
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const selected = Array.from(e.target.files ?? []);
                if (selected.length > 0) {
                  void handleSubmit(selected);
                }
              }}
            />
          </Button>
          {files.length > 0 ? (
            <List>
              {files.map((f, i) => (
                <ListItem
                  key={i}
                  secondaryAction={<StatusChip status={f.status} />}
                  sx={{ bgcolor: 'background.default', borderRadius: 1, mb: 1, alignItems: 'flex-start' }}
                >
                  <ListItemText
                    primary={f.file.name}
                    secondary={
                      f.result
                        ? `${f.result.importedCount} staged, ${f.result.skippedDuplicateCount} already staged, ${f.result.excludedCount} excluded`
                        : f.message
                    }
                  />
                </ListItem>
              ))}
            </List>
          ) : null}
          {files.some((f) => f.status === 'done') ? (
            <Box>
              <Typography color="text.secondary">
                Use "Review transactions" or "Sync overview" in the nav above to continue.
              </Typography>
            </Box>
          ) : null}
        </Stack>
      </Paper>
    </Container>
  );
}
