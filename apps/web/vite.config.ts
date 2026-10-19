import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Validações compartilhadas com a API (CPF, CNS, CNPJ, idade, senha).
      '@compartilhado': fileURLToPath(new URL('../api/src/compartilhado', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': 'http://localhost:3333' },
  },
  build: {
    chunkSizeWarningLimit: 2500,
    sourcemap: false,
  },
});
