import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
        'tests/**',
        'node_modules/**',
      ],
      reporter: ['text', 'json', 'html'],
      reportsDirectory: 'reports/coverage',
      all: true,
    },
  },
});