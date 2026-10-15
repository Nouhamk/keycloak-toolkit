import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30_000,
    // All files share one Keycloak and some tests change realm settings: run files one at a time.
    fileParallelism: false,
  },
});
