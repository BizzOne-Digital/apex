import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 120000,
    // In-memory Mongo can be slow on a busy machine; the default 5s caused random timeouts.
    testTimeout: 30000,
  },
});
