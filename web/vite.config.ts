import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the API runs separately on 4300; proxying /api keeps the browser on one
// origin so session cookies work exactly as they will in production behind nginx.
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:4300',
    changeOrigin: false,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true, // listen on the LAN so the phone can reach the dev server
    proxy: apiProxy,
  },
  // `vite preview` does not inherit server.proxy, and checking the production
  // build (service worker included) locally needs the same API route.
  preview: {
    port: 5175,
    host: true,
    proxy: apiProxy,
  },
});
