import { installFakeGasGlobals } from './fakeGasGlobals.js';

// Runs once per test file, before that file's own imports are evaluated
// (see vitest.config.ts's setupFiles) — this is what lets test files use
// plain top-level `import` for modules that touch SpreadsheetApp/etc. at
// module load time, instead of a dynamic `await import(...)`.
installFakeGasGlobals();
