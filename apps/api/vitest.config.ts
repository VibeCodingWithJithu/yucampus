import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Password checks are slow on purpose (scrypt), and several run in one test.
    testTimeout: 30_000,
    exclude: ['src/generated/**', 'node_modules/**', 'dist/**'],
  },
});
