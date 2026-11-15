import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: process.env.RUN_EMULATOR_TESTS === 'true'
      ? ['src/**/__tests__/**/*.test.ts']
      : ['src/**/__tests__/**/!(*.emulator).test.ts'],
  },
});
