import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/**/__tests__/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': '/src',
      '@config': '/src/config',
      '@parser': '/src/parser',
      '@db': '/src/db',
      '@matcher': '/src/matcher',
      '@migrators': '/src/migrators',
      '@report': '/src/report',
      '@orchestrator': '/src/orchestrator',
      '@utils': '/src/utils',
    },
  },
});
