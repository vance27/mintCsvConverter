import { useEffect, useState } from 'react';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Box, Button, Container, Paper, Stack, Typography } from '@mui/material';
import { api } from '../lib/api.js';

/**
 * Embeds the shared Google Sheet directly in the app. Uses the sheet's
 * normal, authenticated share URL (never a "Publish to the web" link,
 * which would make it visible to anyone with the link regardless of
 * sharing permissions) — access control is entirely Google's own: a
 * viewer without sharing access sees Google's sign-in/request-access
 * screen inside the iframe, the app never bypasses or replicates that
 * check itself.
 */
export function SheetEmbedPage() {
  const [spreadsheetId, setSpreadsheetId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const res = await api.config.$get();
      const config = await res.json();
      setSpreadsheetId(config.spreadsheetId);
    })();
  }, []);

  if (spreadsheetId === undefined) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Typography color="text.secondary">Loading…</Typography>
      </Container>
    );
  }

  if (spreadsheetId === null) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Paper sx={{ p: 4 }}>
          <Stack spacing={2}>
            <Typography variant="h5">Sheet</Typography>
            <Typography color="text.secondary">
              SPREADSHEET_ID isn't configured on the server — set it in .env (see packages/automation/README.md) to enable the embed.
            </Typography>
          </Stack>
        </Paper>
      </Container>
    );
  }

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  return (
    <Box sx={{ height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" sx={{ justifyContent: 'flex-end', p: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Button size="small" endIcon={<OpenInNewIcon />} href={sheetUrl} target="_blank" rel="noopener noreferrer">
          Open in Google Sheets
        </Button>
      </Stack>
      <Box
        component="iframe"
        title="Google Sheet"
        src={`${sheetUrl}?rm=minimal`}
        sx={{ flex: 1, border: 'none' }}
      />
    </Box>
  );
}
