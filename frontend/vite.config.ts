import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Puerto de desarrollo documentado: 5173. Debe coincidir con CORS_ORIGIN de la API (por defecto
// http://localhost:5173). `strictPort` hace que falle en voz alta si está ocupado, en lugar de moverse
// a otro puerto que la API rechazaría por CORS.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
