import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    svgr(),
    tailwindcss(),
  ],
  server: {
    port: 3001,
  },
  build: {
    outDir: 'build',
  },
});
