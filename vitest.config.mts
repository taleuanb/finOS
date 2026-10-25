import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    projects: [
      // Tests de domaine / serveur : environnement node.
      { extends: true, test: { name: 'node', environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] } },
      // Tests de composants : jsdom.
      { extends: true, test: { name: 'jsdom', environment: 'jsdom', include: ['src/**/*.test.tsx'] } },
    ],
  },
});
