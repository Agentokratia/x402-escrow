import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/server-integration/**/*.test.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@x402/core/server': path.resolve(
        __dirname,
        './node_modules/@x402/core/dist/esm/server/index.mjs'
      ),
    },
  },
});
