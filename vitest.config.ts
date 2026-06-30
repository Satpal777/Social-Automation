import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    env: {
      NODE_ENV: 'development',
      APP_BASE_URL: 'https://localhost-test.com',
      SECRET_KEY: 'test-secret-key-32-bytes-long-minimum-length-for-aes',
      DATABASE_URL: 'postgresql://linkedin:linkedin@localhost:5432/linkedin?schema=public',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
