import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // Next's 'server-only' poison-pill import is meaningless under vitest.
      'server-only': path.resolve(__dirname, 'src/__tests__/stubs/server-only.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
