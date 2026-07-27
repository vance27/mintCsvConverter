import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '.nx/**',
      '.github/**',
      '**/*.tsbuildinfo',
      'packages/receipts/src/generated/**',
    ],
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
    files: ['packages/receipts/src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['packages/receipts/tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/receipt-review/src/server/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['packages/receipt-review/tsconfig.server.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/receipt-review/src/client/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['packages/receipt-review/tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // e2e/ has its own standalone tsconfig.json (no project references) so
    // Playwright's own tsconfig auto-discovery — which walks up from
    // playwright.config.ts and fully resolves whatever tsconfig.json it
    // finds nearest, including "references" — doesn't choke trying to
    // recursively follow the rest of this package's composite build graph.
    files: ['packages/receipt-review/e2e/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['packages/receipt-review/e2e/tsconfig.json'],
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
      // expect(mockFn).toHaveBeenCalledWith(...) extracts a method
      // reference without calling it — the rule can't tell that apart from
      // an unsafe extract-and-call-later pattern, but vitest's `expect`
      // only ever inspects the mock's recorded calls, never invokes it
      // with a different `this`.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
