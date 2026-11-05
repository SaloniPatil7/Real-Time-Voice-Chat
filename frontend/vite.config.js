import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: serverUrl, ws: true },
    },
  },
});
