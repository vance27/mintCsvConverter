import { useEffect, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import {
  Alert,
  Button,
  Container,
  FormControl,
  IconButton,
  InputLabel,
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
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../lib/api.js';

type ExclusionRule = InferResponseType<(typeof api)['exclusion-rules']['$get']>[number];
type VariableSplitRule = InferResponseType<(typeof api)['variable-split-rules']['$get']>[number];

/**
 * Manages the two DB-backed rule tables that drive CsvConverterFactory's
 * classification during import — personal-exclusion substrings (per payer)
 * and the variable-split vendor list — both read by automation's CLI sync
 * and this app's import flow alike (see automation's loadDbBackedFactory).
 */
export function RulesSettingsPage() {
  const [exclusionRules, setExclusionRules] = useState<ExclusionRule[] | null>(null);
  const [variableRules, setVariableRules] = useState<VariableSplitRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newPayer, setNewPayer] = useState('Brian');
  const [newPattern, setNewPattern] = useState('');
  const [newVariablePattern, setNewVariablePattern] = useState('');

  async function loadExclusionRules(): Promise<void> {
    const res = await api['exclusion-rules'].$get();
    setExclusionRules(await res.json());
  }

  async function loadVariableRules(): Promise<void> {
    const res = await api['variable-split-rules'].$get();
    setVariableRules(await res.json());
  }

  useEffect(() => {
    void loadExclusionRules();
    void loadVariableRules();
  }, []);

  async function handleAddExclusionRule(): Promise<void> {
    if (newPattern.trim() === '') return;
    setError(null);
    const res = await api['exclusion-rules'].$post({ json: { payer: newPayer, pattern: newPattern.trim() } });
    if (!res.ok) {
      setError((await res.json() as { message?: string }).message ?? 'Failed to add rule');
      return;
    }
    setNewPattern('');
    await loadExclusionRules();
  }

  async function handleDeleteExclusionRule(id: number): Promise<void> {
    await api['exclusion-rules'][':id'].$delete({ param: { id: String(id) } });
    await loadExclusionRules();
  }

  async function handleAddVariableRule(): Promise<void> {
    if (newVariablePattern.trim() === '') return;
    setError(null);
    const res = await api['variable-split-rules'].$post({ json: { pattern: newVariablePattern.trim() } });
    if (!res.ok) {
      setError((await res.json() as { message?: string }).message ?? 'Failed to add rule');
      return;
    }
    setNewVariablePattern('');
    await loadVariableRules();
  }

  async function handleDeleteVariableRule(id: number): Promise<void> {
    await api['variable-split-rules'][':id'].$delete({ param: { id: String(id) } });
    await loadVariableRules();
  }

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Typography variant="h4">Settings</Typography>
        {error ? <Alert severity="error">{error}</Alert> : null}

        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Personal exclusion rules</Typography>
            <Typography color="text.secondary">
              Transactions whose description contains one of these substrings (case-insensitive) are excluded entirely for that payer —
              personal spending, not split with anyone.
            </Typography>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <FormControl sx={{ minWidth: 140 }}>
                <InputLabel id="new-exclusion-payer-label">Payer</InputLabel>
                <Select
                  labelId="new-exclusion-payer-label"
                  label="Payer"
                  value={newPayer}
                  onChange={(e) => setNewPayer(e.target.value)}
                >
                  <MenuItem value="Brian">Brian</MenuItem>
                  <MenuItem value="Patrice">Patrice</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label="Pattern"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                fullWidth
              />
              <Button variant="contained" onClick={() => void handleAddExclusionRule()}>
                Add
              </Button>
            </Stack>
            {exclusionRules === null ? (
              <Typography color="text.secondary">Loading…</Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Payer</TableCell>
                      <TableCell>Pattern</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {exclusionRules.map((rule) => (
                      <TableRow key={rule.id} hover>
                        <TableCell>{rule.payer}</TableCell>
                        <TableCell>{rule.pattern}</TableCell>
                        <TableCell align="right">
                          <IconButton size="small" onClick={() => void handleDeleteExclusionRule(rule.id)} aria-label="Delete rule">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Stack>
        </Paper>

        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Variable-split vendors</Typography>
            <Typography color="text.secondary">
              Transactions whose description contains one of these substrings (case-insensitive) are tagged "Variably" instead of the
              default "Equally" split.
            </Typography>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <TextField
                label="Pattern"
                value={newVariablePattern}
                onChange={(e) => setNewVariablePattern(e.target.value)}
                fullWidth
              />
              <Button variant="contained" onClick={() => void handleAddVariableRule()}>
                Add
              </Button>
            </Stack>
            {variableRules === null ? (
              <Typography color="text.secondary">Loading…</Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Pattern</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {variableRules.map((rule) => (
                      <TableRow key={rule.id} hover>
                        <TableCell>{rule.pattern}</TableCell>
                        <TableCell align="right">
                          <IconButton size="small" onClick={() => void handleDeleteVariableRule(rule.id)} aria-label="Delete rule">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
