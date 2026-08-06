import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the API runs separately on 3200; proxying /api keeps the browser on one
// origin so session cookies work exactly as they will in production behind nginx.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true, // listen on the LAN so the phone can reach the dev server
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3200',
        changeOrigin: false,
      },
    },
  },
});
