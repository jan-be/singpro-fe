/**
 * Renders the frontend's static pages to HTML at build time.
 *
 * Run through Vite's SSR build (see the prerender script in package.json), so
 * the same JSX people see becomes the page a crawler gets. Output goes to
 * build/bot/<path>.html, which nginx serves for crawlers and 404s when a URL
 * has nothing generated for it — no list of routes anywhere.
 */
import fs from 'fs';
import path from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import { STATIC_PAGES } from './staticPages.jsx';

const SITE = 'https://singpro.app';
const OUT_DIR = path.resolve('build/bot');

// The app's own styles are Tailwind classes that mean nothing outside the
// bundle, so these pages carry a small sheet of their own — enough to be
// readable if a person ever lands on one.
const STYLE = `
:root{color-scheme:dark}
body{margin:0;padding:2rem 1rem;background:#0b0b13;color:#d1d5db;
  font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:46rem;margin:0 auto}
h1{font-size:1.9rem;line-height:1.2;color:#fff;margin:0 0 .3em}
h2{font-size:1.15rem;color:#fff;margin:1.8em 0 .4em}
a{color:#67e8f9}
header a{font-weight:800;text-decoration:none}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #1f2937;font-size:.9rem;color:#6b7280}
`.trim();

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function documentFor({ title, description, url, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${url}" />
  <link rel="icon" type="image/png" sizes="512x512" href="${SITE}/logo.png" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${SITE}/logo.png" />
  <style>${STYLE}</style>
</head>
<body>
<header><a href="${SITE}/">singpro.app</a></header>
<main>${body}</main>
<footer><a href="${SITE}/">Home</a> · <a href="${SITE}/privacy-policy">Privacy Policy</a> · <a href="${SITE}/tos">Terms of Service</a> · <a href="${SITE}/contact">Contact</a></footer>
</body>
</html>
`;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
for (const { path: route, title, description, Content } of STATIC_PAGES) {
  const body = renderToStaticMarkup(<Content />);
  const html = documentFor({ title, description, url: `${SITE}${route}`, body });

  // /contact becomes build/bot/contact.html, which nginx reaches by rewriting
  // the request path — so the file name is the route, and nothing maps them.
  const file = path.join(OUT_DIR, `${route.replace(/^\//, '')}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  written++;
  console.log(`[prerender] ${route} -> ${path.relative(process.cwd(), file)} (${Buffer.byteLength(html)} bytes)`);
}
console.log(`[prerender] ${written} static pages`);
