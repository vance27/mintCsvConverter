import type { InferResponseType } from 'hono/client';
import { api } from '../lib/api.js';

export type TransactionsResponse = InferResponseType<typeof api.transactions.$get, 200>;
export type TransactionSummary = TransactionsResponse['transactions'][number];
export type ImportBatchSummary = InferResponseType<(typeof api)['import-batches']['$get']>[number];

export type Status = 'ACTIVE' | 'EXCLUDED_REMOVED';
export type SyncedStatus = 'UNSYNCED' | 'SYNCED' | 'ALL';
export type SortKey = 'date' | 'payer' | 'description' | 'amount' | 'splitType' | 'syncedAt';
export type SortDir = 'asc' | 'desc';
