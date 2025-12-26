import { config } from 'dotenv';
import { beforeAll, afterAll } from 'vitest';

// Load test environment variables
config({ path: '.env.test' });

// Global test utilities
declare global {
  var testStartTime: number;
}

beforeAll(() => {
  global.testStartTime = Date.now();
});

afterAll(async () => {
  const duration = Date.now() - global.testStartTime;
  console.log(`\nTests completed in ${duration}ms`);

  // Force cleanup of any remaining handles
  // This helps with vitest not hanging on HTTP connections
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
});
