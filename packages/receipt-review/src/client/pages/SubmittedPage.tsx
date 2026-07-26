import { Box, Button, Container, Paper, Stack, Typography } from '@mui/material';

interface SubmittedPageProps {
  aggregate: Record<string, number>;
  auditPath: string;
  onBackToQueue: () => void;
}

export function SubmittedPage({ aggregate, auditPath, onBackToQueue }: SubmittedPageProps) {
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Paper sx={{ p: 4 }}>
        <Stack spacing={2}>
          <Typography variant="h4">Receipt submitted</Typography>
          <Typography>
            Aggregate split: {Object.entries(aggregate).map(([name, pct]) => `${name} ${pct}%`).join(', ')}
          </Typography>
          <Typography color="text.secondary">
            Audit copy written to{' '}
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
