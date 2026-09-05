import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Port et proxy fixes (CLAUDE.md §2) : en dev, l'API tourne toujours en local
// sur le port 3001. Le proxy evite tout souci de CORS pendant le developpement.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
