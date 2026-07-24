/*
 * Hello there, inquisitive  friend.
 *
 * Hacked by Sam Killin, August 2018.
 * www.homies.rent
 * help@homies.rent
 */

// Apps Script's runtime calls onEdit, doPost, etc. by name from the global
// scope — nothing in this bundle calls them directly, so from Rollup's
// perspective they'd normally look "unused" and get tree-shaken away. This
// entry point re-exports every domain module so they're all reachable from
// here; rollup.config.mjs also marks every local module as `no-treeshake`
// as a belt-and-suspenders safety net, and strips the resulting
// `export { ... }` statement from the final bundle since Apps Script can't
// parse ESM export syntax.
export * from './types.js';
export * from './sheetLayout.js';
export * from './settleUp.js';
export * from './triggers.js';
export * from './syncApi.js';
