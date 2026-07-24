import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/coverage/**', '.nx/**', '.github/**', '**/*.tsbuildinfo'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Config files (rollup.config.mjs etc.) run under plain Node, outside
    // the TypeScript-aware blocks below that get Node globals for free via
    // @types/node.
    files: ['**/*.{mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Matches the codebase's existing convention (e.g. fakeGasGlobals.ts's
    // `_args`) for parameters/vars kept only for signature shape.
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['packages/core/tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/automation/src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['packages/automation/tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/apps-script/src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['packages/apps-script/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Test doubles frequently satisfy an async interface (e.g. `fetch`,
    // `SheetsClient.addTransactionsForPeriod`) without needing to await
    // anything themselves — that's not a real missing-await bug. Placed
    // after the per-package type-checked blocks above so it wins for spec
    // files, which those blocks also match.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
);
