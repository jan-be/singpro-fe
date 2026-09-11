import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import tailwindcss from '@tailwindcss/vite';

// Same API proxy for the dev server and `vite preview` (production build on
// :3001), so profiling and e2e runs can target either.
const apiProxy = {
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
    ws: true,
  },
};

export default defineConfig({
  plugins: [
    react(),
    svgr(),
    tailwindcss(),
  ],
  server: {
    port: 3001,
    host: true,
    proxy: apiProxy,
  },
  preview: {
    port: 3001,
    host: true,
    proxy: apiProxy,
  },
  build: {
    outDir: 'build',
  },
  test: {
    testTimeout: 30000, // ONNX model loading can be slow
    exclude: ['**/e2e/**', '**/node_modules/**', '**/dist/**', '**/build/**'],
  },
});
