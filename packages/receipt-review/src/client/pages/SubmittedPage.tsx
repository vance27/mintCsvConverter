import { Box, Button, Container, Paper, Stack, Typography } from '@mui/material';

interface SubmittedPageProps {
  aggregate: Record<string, number>;
  auditPath: string;
  manifestPath: string;
  wasUpdate: boolean;
  onBackToQueue: () => void;
}

export function SubmittedPage({ aggregate, auditPath, manifestPath, wasUpdate, onBackToQueue }: SubmittedPageProps) {
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Paper sx={{ p: 4 }}>
        <Stack spacing={2}>
          <Typography variant="h4">{wasUpdate ? 'Splits updated' : 'Receipt submitted'}</Typography>
          <Typography>
            Aggregate split: {Object.entries(aggregate).map(([name, pct]) => `${name} ${pct}%`).join(', ')}
          </Typography>
          {wasUpdate ? (
            <Typography color="text.secondary">
              The existing manifest entry for this receipt was updated in place, not duplicated.
            </Typography>
          ) : null}
          <Typography color="text.secondary">
            Manifest entry at{' '}
            <Box component="code" sx={{ bgcolor: 'background.default', px: 0.5, borderRadius: 0.5 }}>
              {manifestPath}
            </Box>
            , audit copy at{' '}
            <Box component="code" sx={{ bgcolor: 'background.default', px: 0.5, borderRadius: 0.5 }}>
              {auditPath}
            </Box>
            .
          </Typography>
          <Box>
            <Button variant="contained" onClick={onBackToQueue}>
              Back to queue
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Container>
  );
}
