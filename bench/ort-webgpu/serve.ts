// Static server for the ONNX Runtime benchmark page: the page itself, the
// onnxruntime-web dist under /ort/, and the models: /model.onnx and
// /model-gpu.onnx from public/, any other *.onnx from this directory
// (make_gpu_model.py writes its variants here).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FE = process.env.FE || path.resolve(here, '..', '..'); // singspree-fe
const ORT = path.join(FE, 'node_modules/onnxruntime-web/dist');
const PUBLIC = path.join(FE, 'public');
const PORT = Number(process.env.PORT || 3005);
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.map': 'application/json',
};
const transpiler = new Bun.Transpiler({ loader: 'ts' });

http.createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost'); // (a server's requests always have one)
  let file: string;
  if (pathname === '/') file = path.join(here, 'index.html');
  else if (pathname.startsWith('/ort/')) file = path.join(ORT, pathname.slice(5));
  else if (pathname.endsWith('.onnx') && fs.existsSync(path.join(PUBLIC, pathname.slice(1)))) file = path.join(PUBLIC, pathname.slice(1));
  else file = path.join(here, pathname.slice(1));
  // The pages' own scripts are TypeScript, asked for by their .js names: served as JavaScript
  const ts = file.replace(/\.js$/, '.ts');
  if (file.endsWith('.js') && !fs.existsSync(file) && fs.existsSync(ts)) {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    res.end(transpiler.transformSync(fs.readFileSync(ts, 'utf8')));
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + pathname); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log('bench server on ' + PORT));
