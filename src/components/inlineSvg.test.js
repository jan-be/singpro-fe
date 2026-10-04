import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AppIcon from './AppIcon.jsx';
import Wordmark from './Wordmark.jsx';
import { withIdSuffix } from './inlineSvg.jsx';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r/g, '');
const ids = (markup) => [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const refs = (markup) => [...markup.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map(m => m[1] ?? m[2]);
const twice = (Component, props) => renderToStaticMarkup(createElement(Fragment, null,
  createElement(Component, props), createElement(Component, props)));

describe('AppIcon', () => {
  it('is the same drawing as the favicon', () => {
    expect(read('../icon.svg')).toBe(read('../../public/icon.svg'));
  });

  it('gives two copies on one page no id in common', () => {
    const [first, second] = twice(AppIcon, { width: 16, height: 16 }).split('</svg>').slice(0, 2).map(ids);
    expect(first.length).toBeGreaterThan(0);
    expect(first.filter(id => second.includes(id))).toEqual([]);
  });

  it('is decoration, sized as asked', () => {
    const html = renderToStaticMarkup(createElement(AppIcon, { width: 16, height: 16 }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="16"');
    expect(html).toContain('viewBox="0 0 512 512"');
  });
});

describe('Wordmark', () => {
  it('is an image named SingPro, as wide as its viewBox makes it for the height asked', () => {
    const html = renderToStaticMarkup(createElement(Wordmark, { height: 28 }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="SingPro"');
    const [, , w, h] = html.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
    expect(html).toContain(`width="${Math.round(28 * w / h)}"`);
  });

  it('gives two copies on one page no id in common', () => {
    const [first, second] = twice(Wordmark, { height: 28 }).split('</svg>').slice(0, 2).map(ids);
    expect(first.length).toBeGreaterThan(0);
    expect(first.filter(id => second.includes(id))).toEqual([]);
  });
});

describe('withIdSuffix', () => {
  for (const file of ['../icon.svg', '../wordmark.svg']) {
    it(`suffixes every id and reference in ${file.slice(3)}, so each reference still finds its definition`, () => {
      const markup = withIdSuffix(read(file), 'x1');
      expect(ids(markup).every(id => id.endsWith('-x1'))).toBe(true);
      expect(refs(markup).length).toBeGreaterThan(0);
      for (const ref of refs(markup)) expect(ids(markup)).toContain(ref);
    });
  }
});
