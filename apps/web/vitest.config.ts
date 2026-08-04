import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@fairsplit/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@fairsplit/logging': path.resolve(__dirname, '../../packages/logging/src'),
    },
  },
  test: {
    environment: 'node',
  },
});
