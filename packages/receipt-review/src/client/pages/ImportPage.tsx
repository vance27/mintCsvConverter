import { useState } from 'react';
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

interface ImportResult {
  importedCount: number;
  skippedDuplicateCount: number;
  excludedCount: number;
}

interface FileProgress {
  file: File;
  jobId?: string;
  status: 'uploading' | 'pending' | 'done' | 'error';
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
  return <Chip icon={<CircularProgress size={14} />} label={status === 'uploading' ? 'Uploading' : 'Importing'} size="small" />;
}

/**
 * Uploads a Citi CSV export and stages it as ImportedTransaction rows —
 * never touches Google Sheets. See SyncOverviewPage for the separate,
 * explicit sync step, and TransactionReviewPage for reviewing what got
 * staged against receipts.
 */
export function ImportPage() {
  const [payer, setPayer] = useState('Brian');
  const [files, setFiles] = useState<FileProgress[]>([]);
  const [submitting, setSubmitting] = useState(false);

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

  async function handleSubmit(selected: File[]): Promise<void> {
    setSubmitting(true);
    setFiles(selected.map((file) => ({ file, status: 'uploading' })));

    const formData = new FormData();
    for (const file of selected) {
      formData.append('files', file);
    }
    formData.append('payer', payer);

    const res = await fetch('/api/imports', { method: 'POST', body: formData });
    const { jobIds } = (await res.json()) as { jobIds: string[] };

    setFiles((prev) => prev.map((f, i) => ({ ...f, jobId: jobIds[i], status: 'pending' })));
    await Promise.all(jobIds.map((jobId, index) => pollJob(jobId, index)));
    setSubmitting(false);
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
