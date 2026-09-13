// Static server for the ONNX Runtime benchmark page: the page itself, the
// onnxruntime-web dist under /ort/, and the swift-f0 model at /model.onnx.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FE = process.env.FE || path.resolve(here, '..', '..'); // singpro-fe
const ORT = path.join(FE, 'node_modules/onnxruntime-web/dist');
const MODEL = path.join(FE, 'public/model.onnx');
const PORT = Number(process.env.PORT || 3005);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.map': 'application/json',
};

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  let file;
  if (pathname === '/') file = path.join(here, 'index.html');
  else if (pathname.startsWith('/ort/')) file = path.join(ORT, pathname.slice(5));
  else if (pathname === '/model.onnx') file = MODEL;
  else file = path.join(here, pathname.slice(1));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + pathname); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log('bench server on ' + PORT));
