import { useState } from 'react';
import {
    Box,
    Button,
    Container,
    List,
    ListItem,
    ListItemText,
    Paper,
    Stack,
    TextField,
    Typography,
} from '@mui/material';

interface UploadPageProps {
    onDone: () => void;
}

export function UploadPage({ onDone }: UploadPageProps) {
    const [store, setStore] = useState('Costco');
    const [payer, setPayer] = useState('Brian');
    const [submitting, setSubmitting] = useState(false);
    const [queuedFilenames, setQueuedFilenames] = useState<string[] | null>(null);

    async function handleSubmit(selected: File[]): Promise<void> {
        setSubmitting(true);
        setQueuedFilenames(null);

        const formData = new FormData();
        for (const file of selected) {
            formData.append('files', file);
        }
        formData.append('store', store);
        formData.append('payer', payer);

        // enqueue() already awaits the placeholder Receipt row's DB write
        // before this responds, so there's no "hasn't shown up yet" gap to
        // bridge — the Receipts table (now durable and polling on its own) is
        // the single place to watch extraction progress from here on.
        await fetch('/api/uploads', { method: 'POST', body: formData });
        setQueuedFilenames(selected.map((file) => file.name));
        setSubmitting(false);
    }

    return (
        <Container maxWidth="sm" sx={{ py: 6 }}>
            <Paper sx={{ p: 4 }}>
                <Stack spacing={3}>
                    <Typography variant="h4">Upload receipts</Typography>
                    <Stack direction="row" spacing={2}>
                        <TextField
                            label="Store"
                            value={store}
                            onChange={(e) => setStore(e.target.value)}
                            disabled={submitting}
                            fullWidth
                        />
                        <TextField
                            label="Payer"
                            value={payer}
                            onChange={(e) => setPayer(e.target.value)}
                            disabled={submitting}
                            fullWidth
                        />
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
