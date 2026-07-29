import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.base.json, which points every workspace package at its
    // source. Resolving @fairsplit/logging through its package.json instead would
    // need packages/logging/dist built first, so tests would pass or fail
    // depending on whether a build had happened to run.
    alias: {
      '@fairsplit/db': path.resolve(__dirname, '../../packages/db/src'),
      '@fairsplit/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@fairsplit/logging': path.resolve(__dirname, '../../packages/logging/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
