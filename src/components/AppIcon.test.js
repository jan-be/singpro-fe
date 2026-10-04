import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AppIcon, { withIdSuffix } from './AppIcon.jsx';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r/g, '');
const ids = (markup) => [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const refs = (markup) => [...markup.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map(m => m[1] ?? m[2]);

describe('AppIcon', () => {
  it('is the same drawing as the favicon', () => {
    expect(read('../icon.svg')).toBe(read('../../public/icon.svg'));
  });

  it('suffixes every id and every reference, so each reference still finds its definition', () => {
    const markup = withIdSuffix(read('../icon.svg'), 'x1');
    expect(ids(markup).length).toBeGreaterThan(0);
    expect(ids(markup).every(id => id.endsWith('-x1'))).toBe(true);
    expect(refs(markup).length).toBeGreaterThan(0);
    for (const ref of refs(markup)) expect(ids(markup)).toContain(ref);
  });

  it('gives two copies on one page no id in common', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null,
      createElement(AppIcon, { width: 16, height: 16 }),
      createElement(AppIcon, { width: 55, height: 55 })));
    const [first, second] = html.split('</svg>').slice(0, 2).map(ids);
    expect(first.length).toBeGreaterThan(0);
    expect(first.filter(id => second.includes(id))).toEqual([]);
    expect(html).toContain('width="16"');
    expect(html).toContain('viewBox="0 0 512 512"');
  });
});
