import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
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

interface SyncOverviewGroup {
  payer: string;
  periodLabel: string;
  rowCount: number;
}

interface SyncOverview {
  totalRows: number;
  groups: SyncOverviewGroup[];
}

interface PeriodResult {
  payerName: string;
  periodLabel: string;
  rowCount: number;
  status: 'SYNCED' | 'FAILED';
  errorMessage?: string;
}

interface SyncRunSummary {
  id: number;
  createdAt: string;
  status: 'DONE' | 'PARTIAL' | 'ERROR';
  periodResults: PeriodResult[];
  errorMessage: string | null;
}

interface GoogleAuthStatus {
  connected: boolean;
  job: { status: 'pending' } | { status: 'done' } | { status: 'error'; message: string } | null;
}

const POLL_INTERVAL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function StatusChip({ status }: { status: SyncRunSummary['status'] }) {
  if (status === 'DONE') {
    return <Chip label="Done" color="success" size="small" />;
  }
  if (status === 'PARTIAL') {
    return <Chip label="Partial" color="warning" size="small" />;
  }
  return <Chip label="Error" color="error" size="small" />;
}

/**
 * Previews what a sync would do (zero Sheets calls) and, on explicit
 * request, runs it — the overview itself is the confirmation step, so
 * there's no separate modal on top of it. History below shows every past
 * run, including partial failures, so nothing that went wrong is silent.
 */
export function SyncOverviewPage() {
  const [overview, setOverview] = useState<SyncOverview | null>(null);
  const [runs, setRuns] = useState<SyncRunSummary[] | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<GoogleAuthStatus | null>(null);
  const [reauthorizing, setReauthorizing] = useState(false);

  async function refresh(): Promise<void> {
    const [overviewRes, runsRes, authRes] = await Promise.all([api['sync-overview'].$get(), api['sync-runs'].$get(), api['google-auth'].status.$get()]);
    setOverview(await overviewRes.json());
    setRuns(await runsRes.json());
    setAuthStatus(await authRes.json());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleReauthorize(): Promise<void> {
    setReauthorizing(true);
    await api['google-auth'].reauthorize.$post();

    for (;;) {
      const res = await api['google-auth'].status.$get();
      const status = await res.json();
      setAuthStatus(status);
      if (status.job?.status !== 'pending') {
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    setReauthorizing(false);
  }

  async function handleRunSync(): Promise<void> {
    setRunning(true);
    setRunError(null);
    await api['sync-runs'].$post();

    for (;;) {
      const res = await api['sync-runs'].current.$get();
      const job = await res.json();
      if (job?.status === 'done') {
        break;
      }
      if (job?.status === 'error') {
        setRunError(job.message);
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    setRunning(false);
    await refresh();
  }

  return (
    <Container maxWidth="lg" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Typography variant="h4">Sync overview</Typography>

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {authStatus?.connected ? (
            <Chip label="Google Sheets: connected" color="success" size="small" variant="outlined" />
          ) : (
            <Chip label="Google Sheets: not connected" color="warning" size="small" variant="outlined" />
          )}
          <Button size="small" onClick={() => void handleReauthorize()} disabled={reauthorizing}>
            {reauthorizing ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
            Reauthorize
          </Button>
          {authStatus?.job?.status === 'error' ? <Alert severity="error">{authStatus.job.message}</Alert> : null}
        </Stack>

        <Paper sx={{ p: 3 }}>
          {overview === null ? (
            <Typography color="text.secondary">Loading…</Typography>
          ) : overview.totalRows === 0 ? (
            <Typography color="text.secondary">Nothing to sync — every staged transaction is already synced.</Typography>
          ) : (
            <Stack spacing={2}>
              <Typography>
                <strong>{overview.totalRows}</strong> row(s) across <strong>{overview.groups.length}</strong> tab(s) will sync:
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Payer</TableCell>
                      <TableCell>Tab</TableCell>
                      <TableCell align="right">Rows</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {overview.groups.map((g) => (
                      <TableRow key={`${g.payer}-${g.periodLabel}`}>
                        <TableCell>{g.payer}</TableCell>
                        <TableCell>{g.periodLabel}</TableCell>
                        <TableCell align="right">{g.rowCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {runError ? <Alert severity="error">{runError}</Alert> : null}
              <Button variant="contained" onClick={() => void handleRunSync()} disabled={running} sx={{ alignSelf: 'flex-start' }}>
                {running ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
                Run sync
              </Button>
            </Stack>
          )}
        </Paper>

        <Typography variant="h5">History</Typography>
        {runs === null ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : runs.length === 0 ? (
          <Typography color="text.secondary">No syncs run yet.</Typography>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{new Date(run.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <StatusChip status={run.status} />
                    </TableCell>
                    <TableCell>
                      {run.errorMessage ? (
                        <Typography color="error.main">{run.errorMessage}</Typography>
                      ) : (
                        <Stack spacing={0.5}>
                          {run.periodResults.map((p, i) => (
                            <Typography key={i} color={p.status === 'FAILED' ? 'error.main' : 'text.primary'}>
                              {p.payerName} {p.periodLabel}: {p.rowCount} row(s) —{' '}
                              {p.status === 'SYNCED' ? 'synced' : `failed (${p.errorMessage})`}
                            </Typography>
                          ))}
                        </Stack>
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
