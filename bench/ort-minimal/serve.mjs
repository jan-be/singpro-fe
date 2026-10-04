// Static server for the minimal-runtime comparison page: the page and its
// worker, the stock onnxruntime-web dist under /ort/, every runtime variant
// under /v/<name>/, the models from public/, and the test audio (iris.mp3
// next to the checkout, decoded once to 16 kHz float32 with ffmpeg).
//   VARIANTS="min=src/vendor/ort-minimal,release=D:/ort-build/out/release" bun bench/ort-minimal/serve.mjs
// Everything is served no-store, so each worker downloads and compiles its
// runtime from scratch, like a first visit.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FE = process.env.FE || path.resolve(here, '..', '..'); // singpro-fe
const ORT = path.join(FE, 'node_modules/onnxruntime-web/dist');
const PUBLIC = path.join(FE, 'public');
const PORT = Number(process.env.PORT || 3006);
const AUDIO_SRC = process.env.AUDIO || path.resolve(FE, '..', 'iris.mp3');
const AUDIO = path.join(here, 'audio.f32');
const variants = Object.fromEntries((process.env.VARIANTS || 'min=src/vendor/ort-minimal').split(',').map(v => {
  const [name, dir] = v.split('=');
  return [name, path.resolve(FE, dir)];
}));

if (!fs.existsSync(AUDIO)) {
  execSync(`ffmpeg -v error -i "${AUDIO_SRC}" -f f32le -ac 1 -ar 16000 "${AUDIO}"`);
}

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json',
};

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  let file;
  const v = pathname.match(/^\/v\/([^/]+)\/(.+)$/);
  if (pathname === '/') file = path.join(here, 'index.html');
  else if (pathname === '/variants.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(Object.keys(variants)));
    return;
  } else if (pathname === '/audio.f32') file = AUDIO;
  else if (pathname.startsWith('/ort/')) file = path.join(ORT, pathname.slice(5));
  else if (v && variants[v[1]] && v[2] === 'ortMinimal.js') {
    // the app's wrapper, with its two Vite imports pointed at this variant's files
    const src = fs.readFileSync(path.join(FE, 'src/logic/ortMinimal.js'), 'utf8')
      .replace("'../vendor/ort-minimal/ort-wasm-simd.mjs'", "'./ort-wasm-simd.mjs'")
      .replace(/import wasmUrl from '[^']+';/, "const wasmUrl = new URL('./ort-wasm-simd.wasm', import.meta.url).href;");
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    res.end(src);
    return;
  } else if (v && variants[v[1]]) file = path.join(variants[v[1]], v[2]);
  else if (/^\/model[\w-]*\.(onnx|ort)$/.test(pathname)) file = path.join(PUBLIC, pathname.slice(1));
  else file = path.join(here, pathname.slice(1));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + pathname); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`minimal-runtime bench on ${PORT}: ${JSON.stringify(variants)}`));
