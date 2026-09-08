import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    // Contract ABIs live outside the web root, in fairate/contracts/abi.
    fs: { allow: ['..', '../..'] },
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
