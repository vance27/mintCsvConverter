import { useEffect, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import {
  Alert,
  Button,
  Checkbox,
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
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
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

  const [selectedExclusionIds, setSelectedExclusionIds] = useState<Set<number>>(new Set());
  const [selectedVariableIds, setSelectedVariableIds] = useState<Set<number>>(new Set());

  const [editingExclusionId, setEditingExclusionId] = useState<number | null>(null);
  const [editExclusionPayer, setEditExclusionPayer] = useState('');
  const [editExclusionPattern, setEditExclusionPattern] = useState('');

  const [editingVariableId, setEditingVariableId] = useState<number | null>(null);
  const [editVariablePattern, setEditVariablePattern] = useState('');

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
      setError(((await res.json()) as { message?: string }).message ?? 'Failed to add rule');
      return;
    }
    setNewPattern('');
    await loadExclusionRules();
  }

  function startEditExclusionRule(rule: ExclusionRule): void {
    setEditingExclusionId(rule.id);
    setEditExclusionPayer(rule.payer);
    setEditExclusionPattern(rule.pattern);
  }

  function cancelEditExclusionRule(): void {
    setEditingExclusionId(null);
  }

  async function saveEditExclusionRule(id: number): Promise<void> {
    if (editExclusionPattern.trim() === '') return;
    setError(null);
    const res = await api['exclusion-rules'][':id'].$patch({
      param: { id: String(id) },
      json: { payer: editExclusionPayer, pattern: editExclusionPattern.trim() },
    });
    if (!res.ok) {
      setError(((await res.json()) as { message?: string }).message ?? 'Failed to update rule');
      return;
    }
    setEditingExclusionId(null);
    await loadExclusionRules();
  }

  async function handleDeleteExclusionRule(id: number): Promise<void> {
    await api['exclusion-rules'][':id'].$delete({ param: { id: String(id) } });
    setSelectedExclusionIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await loadExclusionRules();
  }

  async function handleDeleteSelectedExclusionRules(): Promise<void> {
    setError(null);
    await Promise.all(
      [...selectedExclusionIds].map((id) => api['exclusion-rules'][':id'].$delete({ param: { id: String(id) } })),
    );
    setSelectedExclusionIds(new Set());
    await loadExclusionRules();
  }

  function toggleExclusionSelected(id: number): void {
    setSelectedExclusionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllExclusionSelected(): void {
    if (!exclusionRules) return;
    setSelectedExclusionIds((prev) => (prev.size === exclusionRules.length ? new Set() : new Set(exclusionRules.map((r) => r.id))));
  }

  async function handleAddVariableRule(): Promise<void> {
    if (newVariablePattern.trim() === '') return;
    setError(null);
    const res = await api['variable-split-rules'].$post({ json: { pattern: newVariablePattern.trim() } });
    if (!res.ok) {
      setError(((await res.json()) as { message?: string }).message ?? 'Failed to add rule');
      return;
    }
    setNewVariablePattern('');
    await loadVariableRules();
  }

  function startEditVariableRule(rule: VariableSplitRule): void {
    setEditingVariableId(rule.id);
    setEditVariablePattern(rule.pattern);
  }

  function cancelEditVariableRule(): void {
    setEditingVariableId(null);
  }

  async function saveEditVariableRule(id: number): Promise<void> {
    if (editVariablePattern.trim() === '') return;
    setError(null);
    const res = await api['variable-split-rules'][':id'].$patch({
      param: { id: String(id) },
      json: { pattern: editVariablePattern.trim() },
    });
    if (!res.ok) {
      setError(((await res.json()) as { message?: string }).message ?? 'Failed to update rule');
      return;
    }
    setEditingVariableId(null);
    await loadVariableRules();
  }

  async function handleDeleteVariableRule(id: number): Promise<void> {
    await api['variable-split-rules'][':id'].$delete({ param: { id: String(id) } });
    setSelectedVariableIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await loadVariableRules();
  }

  async function handleDeleteSelectedVariableRules(): Promise<void> {
    setError(null);
    await Promise.all(
      [...selectedVariableIds].map((id) => api['variable-split-rules'][':id'].$delete({ param: { id: String(id) } })),
    );
    setSelectedVariableIds(new Set());
    await loadVariableRules();
  }

  function toggleVariableSelected(id: number): void {
    setSelectedVariableIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVariableSelected(): void {
    if (!variableRules) return;
    setSelectedVariableIds((prev) => (prev.size === variableRules.length ? new Set() : new Set(variableRules.map((r) => r.id))));
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
              <>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <Button
                    size="small"
                    color="error"
                    startIcon={<DeleteIcon fontSize="small" />}
                    disabled={selectedExclusionIds.size === 0}
                    onClick={() => void handleDeleteSelectedExclusionRules()}
                  >
                    Delete selected ({selectedExclusionIds.size})
                  </Button>
                </Stack>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={exclusionRules.length > 0 && selectedExclusionIds.size === exclusionRules.length}
                            indeterminate={selectedExclusionIds.size > 0 && selectedExclusionIds.size < exclusionRules.length}
                            onChange={toggleAllExclusionSelected}
                            slotProps={{ input: { 'aria-label': 'Select all exclusion rules' } }}
                          />
                        </TableCell>
                        <TableCell>Payer</TableCell>
                        <TableCell>Pattern</TableCell>
                        <TableCell align="right" />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {exclusionRules.map((rule) => {
                        const isEditing = editingExclusionId === rule.id;
                        return (
                          <TableRow key={rule.id} hover selected={selectedExclusionIds.has(rule.id)}>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={selectedExclusionIds.has(rule.id)}
                                onChange={() => toggleExclusionSelected(rule.id)}
                                slotProps={{ input: { 'aria-label': `Select rule ${rule.pattern}` } }}
                              />
                            </TableCell>
                            {isEditing ? (
                              <>
                                <TableCell>
                                  <FormControl size="small" sx={{ minWidth: 120 }}>
                                    <Select value={editExclusionPayer} onChange={(e) => setEditExclusionPayer(e.target.value)}>
                                      <MenuItem value="Brian">Brian</MenuItem>
                                      <MenuItem value="Patrice">Patrice</MenuItem>
                                      {editExclusionPayer !== 'Brian' && editExclusionPayer !== 'Patrice' ? (
                                        <MenuItem value={editExclusionPayer}>{editExclusionPayer}</MenuItem>
                                      ) : null}
                                    </Select>
                                  </FormControl>
                                </TableCell>
                                <TableCell>
                                  <TextField
                                    size="small"
                                    fullWidth
                                    value={editExclusionPattern}
                                    onChange={(e) => setEditExclusionPattern(e.target.value)}
                                  />
                                </TableCell>
                                <TableCell align="right">
                                  <Tooltip title="Save">
                                    <IconButton size="small" onClick={() => void saveEditExclusionRule(rule.id)} aria-label="Save rule">
                                      <CheckIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title="Cancel">
                                    <IconButton size="small" onClick={cancelEditExclusionRule} aria-label="Cancel edit">
                                      <CloseIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell>{rule.payer}</TableCell>
                                <TableCell>{rule.pattern}</TableCell>
                                <TableCell align="right">
                                  <IconButton size="small" onClick={() => startEditExclusionRule(rule)} aria-label="Edit rule">
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                  <IconButton size="small" onClick={() => void handleDeleteExclusionRule(rule.id)} aria-label="Delete rule">
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
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
              <>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <Button
                    size="small"
                    color="error"
                    startIcon={<DeleteIcon fontSize="small" />}
                    disabled={selectedVariableIds.size === 0}
                    onClick={() => void handleDeleteSelectedVariableRules()}
                  >
                    Delete selected ({selectedVariableIds.size})
                  </Button>
                </Stack>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={variableRules.length > 0 && selectedVariableIds.size === variableRules.length}
                            indeterminate={selectedVariableIds.size > 0 && selectedVariableIds.size < variableRules.length}
                            onChange={toggleAllVariableSelected}
                            slotProps={{ input: { 'aria-label': 'Select all variable-split rules' } }}
                          />
                        </TableCell>
                        <TableCell>Pattern</TableCell>
                        <TableCell align="right" />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {variableRules.map((rule) => {
                        const isEditing = editingVariableId === rule.id;
                        return (
                          <TableRow key={rule.id} hover selected={selectedVariableIds.has(rule.id)}>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={selectedVariableIds.has(rule.id)}
                                onChange={() => toggleVariableSelected(rule.id)}
                                slotProps={{ input: { 'aria-label': `Select rule ${rule.pattern}` } }}
                              />
                            </TableCell>
                            {isEditing ? (
                              <>
                                <TableCell>
                                  <TextField
                                    size="small"
                                    fullWidth
                                    value={editVariablePattern}
                                    onChange={(e) => setEditVariablePattern(e.target.value)}
                                  />
                                </TableCell>
                                <TableCell align="right">
                                  <Tooltip title="Save">
                                    <IconButton size="small" onClick={() => void saveEditVariableRule(rule.id)} aria-label="Save rule">
                                      <CheckIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title="Cancel">
                                    <IconButton size="small" onClick={cancelEditVariableRule} aria-label="Cancel edit">
                                      <CloseIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell>{rule.pattern}</TableCell>
                                <TableCell align="right">
                                  <IconButton size="small" onClick={() => startEditVariableRule(rule)} aria-label="Edit rule">
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                  <IconButton size="small" onClick={() => void handleDeleteVariableRule(rule.id)} aria-label="Delete rule">
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
