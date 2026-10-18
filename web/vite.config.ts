/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API is served by ../server (node server/index.js). During `npm run dev` it is proxied.
export default defineConfig({
  plugins: [react()],
  base: './', // relative URLs: works behind a reverse proxy sub-path
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ["src/lib/**"],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 75 }
    }
  }
});
