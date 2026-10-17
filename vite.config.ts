/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// base: './' so the build works both locally and under GitHub Pages (/RANVORA/).
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
