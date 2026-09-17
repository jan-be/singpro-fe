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

export default defineConfig(({ isSsrBuild }) => ({
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
    // TV browsers run years-old WebViews (a Fire OS 7 stick is the case that
    // found this), and Vite's default target assumes far more. Lowering it
    // makes the build lower the syntax they cannot handle, for ~2.5 kB gzip:
    //   - CSS `inset: 0` (Chrome 87) -> top/right/bottom/left. Unsupported, it
    //     is simply dropped, and the video stage collapsed to 0x0: YouTube
    //     played the audio into an invisible iframe.
    //   - oklch() (Chrome 111) -> rgb. color-mix() Tailwind already guards
    //     behind @supports, which is why the colours survived and the video
    //     did not.
    //   - `||=` and `??` (Chrome 85), which older engines cannot even parse.
    target: ['chrome79', 'safari13'],
    outDir: 'build',
    // The prerenderer is a Node script that reads nothing out of public/, but
    // an SSR build copies the whole directory next to it — 810 kB, most of it
    // the two ONNX models — on every build, for nothing.
    copyPublicDir: !isSsrBuild,
  },
  optimizeDeps: {
    // Only the pitch worker imports the ONNX runtime, so the dev server would
    // discover it on the first "join singing", re-optimise, and reload the page
    // mid-permission-prompt. Pre-bundle it with everything else instead.
    include: ['onnxruntime-web/wasm', 'onnxruntime-web/webgpu'],
  },
  test: {
    testTimeout: 30000, // ONNX model loading can be slow
    exclude: ['**/e2e/**', '**/node_modules/**', '**/dist/**', '**/build/**'],
  },
}));
