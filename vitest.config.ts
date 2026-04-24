import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
    reporters: [
      'verbose',
      ['json', { outputFile: 'reports/test-results.json' }],
      ['allure-vitest/reporter', { resultsDir: 'allure-results' }],
    ],
    setupFiles: ['allure-vitest/setup'],

    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],

      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        '**/*.spec.ts',
        'tests/**',
        'node_modules/**',
      ],

      reporter: ['text', 'json', 'html', 'text-summary'],

      reportsDirectory: 'reports/coverage',

      all: true,

      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});