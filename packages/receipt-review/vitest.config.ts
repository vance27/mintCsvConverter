import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // e2e/ holds Playwright specs (their own `test`/`expect`, run via
        // `nx run @mint-csv-converter/receipt-review:e2e`), not vitest ones.
        exclude: [...configDefaults.exclude, 'e2e/**'],
    },
});
