import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ShareCardImage from './ShareCardImage.jsx';
import { COUNT_FRAMES, countValue } from '../logic/shareImage.js';

// The share video draws the card in two layers (useShareCardDrawer.drawVideo): before its result, and the result alone
const me = { username: 'Ana', score: 6840, rank: 1, newBest: true };
const card = (layer) => renderToStaticMarkup(createElement(ShareCardImage, {
  names: { title: 'Song', artist: 'Artist' }, me, ranked: [me], rows: [me], more: 0, hueOf: () => 300,
  melody: null, songUrl: 'https://singpro.app/sing/x', art: null, t: (k) => k, layer,
}));
const count = (markup, re) => (markup.match(re) ?? []).length;
const scoreSpan = (markup) => markup.match(/<span[^>]*data-anim="score"[^>]*>/)[0];

describe('ShareCardImage layers', () => {
  it('the whole card: four gold stars and the score line, no boxes for the video', () => {
    const m = card(undefined);
    expect(count(m, /data-anim="(wave|marker|star)"/g)).toBe(0);
    expect(count(m, /stroke="#fff3b0"/g)).toBe(4); // earned stars
    expect(count(m, /stroke-dasharray/g)).toBe(5); // the thresholds
  });

  it('the card before its result: every star an outline, no score, no badges, the bars all dim', () => {
    const m = card('base');
    expect(count(m, /stroke="#fff3b0"/g)).toBe(0);
    expect(count(m, /stroke="rgba\(255,255,255,0.4\)"/g)).toBe(5);
    expect(scoreSpan(m)).toMatch(/visibility:hidden/);
    expect(m).toMatch(/data-anim="badges"[^>]*visibility:hidden/);
    expect(count(m, /data-anim="marker"/g)).toBe(0);
    expect(count(m, /data-anim="wave"/g)).toBe(1);
  });

  it('the result: only what the score adds, everything else hidden', () => {
    const m = card('result');
    expect(m).toMatch(/^<div[^>]*visibility:hidden/);
    expect(count(m, /data-anim="star"/g)).toBe(4);
    expect(count(m, /stroke="rgba\(255,255,255,0.4\)"/g)).toBe(0); // no outlines
    expect(count(m, /stroke-dasharray/g)).toBe(0);
    expect(count(m, /data-anim="marker"/g)).toBe(1);
    expect(scoreSpan(m)).toMatch(/visibility:visible/);
    expect(scoreSpan(m)).toMatch(/data-score="6840"/);
    expect(m).toMatch(/data-anim="wave" data-fill="[\d.]+"/);
  });
});

describe('countValue', () => {
  it('counts from 0 to the score, quickly at first and slowing down', () => {
    const values = Array.from({ length: COUNT_FRAMES }, (_, k) => countValue(6840, k));
    expect(values[0]).toBe(0);
    expect(values[COUNT_FRAMES - 1]).toBe(6840);
    for (let k = 1; k < COUNT_FRAMES; k++) expect(values[k]).toBeGreaterThanOrEqual(values[k - 1]);
    expect(values[1] - values[0]).toBeGreaterThan(values[COUNT_FRAMES - 1] - values[COUNT_FRAMES - 2]);
  });
});
