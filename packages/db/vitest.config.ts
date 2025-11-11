import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    threads: false,
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 120000,
    hookTimeout: 120000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '*.config.ts',
        'prisma/migrations/',
      ],
    },
  },
});
