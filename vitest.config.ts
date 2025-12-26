import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: [],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 120000,
    // Ensure proper cleanup after tests
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Teardown timeout to ensure cleanup completes
    teardownTimeout: 5000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'tests', '.next', 'src/app', '*.config.*'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
