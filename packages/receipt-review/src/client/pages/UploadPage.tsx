import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../lib/api.js';

interface FileProgress {
  file: File;
  jobId?: string;
  status: 'uploading' | 'pending' | 'done' | 'error';
  message?: string;
}

interface UploadPageProps {
  onDone: () => void;
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
  return <Chip icon={<CircularProgress size={14} />} label={status === 'uploading' ? 'Uploading' : 'Extracting'} size="small" />;
}

export function UploadPage({ onDone }: UploadPageProps) {
  const [store, setStore] = useState('Costco');
  const [payer, setPayer] = useState('Brian');
  const [files, setFiles] = useState<FileProgress[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function pollJob(jobId: string, index: number): Promise<void> {
    for (;;) {
      const res = await api.uploads[':jobId'].$get({ param: { jobId } });
      const job = await res.json();
      if (job.status === 'done') {
        setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: 'done' } : f)));
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
    formData.append('store', store);
    formData.append('payer', payer);

    const res = await fetch('/api/uploads', { method: 'POST', body: formData });
    const { jobIds } = (await res.json()) as { jobIds: string[] };

    setFiles((prev) => prev.map((f, i) => ({ ...f, jobId: jobIds[i], status: 'pending' })));
    await Promise.all(jobIds.map((jobId, index) => pollJob(jobId, index)));
    setSubmitting(false);
  }

  const allDone = files.length > 0 && files.every((f) => f.status === 'done' || f.status === 'error');

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Paper sx={{ p: 4 }}>
        <Stack spacing={3}>
          <Typography variant="h4">Upload receipts</Typography>
          <Stack direction="row" spacing={2}>
            <TextField label="Store" value={store} onChange={(e) => setStore(e.target.value)} disabled={submitting} fullWidth />
            <TextField label="Payer" value={payer} onChange={(e) => setPayer(e.target.value)} disabled={submitting} fullWidth />
          </Stack>
          <Button component="label" variant="contained" disabled={submitting}>
            Choose PDFs
            <input
              type="file"
              accept="application/pdf"
              multiple
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
                  sx={{ bgcolor: 'background.default', borderRadius: 1, mb: 1 }}
                >
                  <ListItemText primary={f.file.name} secondary={f.message} />
                </ListItem>
              ))}
            </List>
          ) : null}
          {allDone ? (
            <Box>
              <Button variant="outlined" onClick={onDone}>
                Go to review queue
              </Button>
            </Box>
          ) : null}
        </Stack>
      </Paper>
    </Container>
  );
}
