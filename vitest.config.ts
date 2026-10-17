import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false, // run sequentially to prevent database lock in embedded mode
    include: ['tests/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'dashboard/**'],
  },
});
