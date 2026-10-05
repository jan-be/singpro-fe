import { describe, it, expect } from 'vitest';
import { CanvasRecorder, replayCanvas, PICTURE_FRAMES } from './canvasRecorder';

// A context that logs every call and property write
const loggingContext = () => {
  const log = [];
  const ctx = new Proxy({ canvas: { width: 0, height: 0 } }, {
    get: (t, k) => (k in t ? t[k] : (...args) => log.push([k, ...args])),
    set: (t, k, v) => { log.push([`=${String(k)}`, v]); return true; },
  });
  return { ctx, log };
};

// What MusicBars does with a context, more or less
const paint = (ctx) => {
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 100.25, 200);
  ctx.clip();
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(1.5, 2.25);
  ctx.arcTo(10, 2.25, 10, 10, 4.1666666666666667);
  ctx.bezierCurveTo(1, 2, 3, 4, 5, 6);
  ctx.lineTo(0.1 + 0.2, 7);
  ctx.closePath();
  ctx.fillStyle = 'hsl(140, 100%, 55%)';
  ctx.fill();
  ctx.setLineDash([3, 2]);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'hsla(140, 100%, 50%, 0.3)';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.arc(5, 5, 3.3333333333333335, 0, Math.PI * 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.restore();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(0, 0, 46.8, 200);
  ctx.clearRect(1, 2, 3, 4);
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Singer1  1,240', 100.5, 50.5);
  ctx.strokeText('AWESOME!', 3, 4);
  ctx.fillStyle = 'hsl(140, 100%, 55%)'; // a string already in the table
};

describe('CanvasRecorder', () => {
  it('replays exactly the calls it recorded, numbers unrounded', () => {
    const direct = loggingContext();
    paint(direct.ctx);
    const rec = new CanvasRecorder(16).begin(200, 400); // small: it has to grow
    paint(rec);
    const replayed = loggingContext();
    replayCanvas(replayed.ctx, rec.take().frame, {}, new Map());
    expect(replayed.log).toEqual(direct.log);
  });

  it('carries special ops out on the replaying side', () => {
    const rec = new CanvasRecorder().begin(10, 10);
    rec.special('fade', 936);
    rec.special('drawLayer');
    const seen = [];
    const { ctx } = loggingContext();
    replayCanvas(ctx, rec.take().frame, {
      fade: (c, width) => seen.push(['fade', c === ctx, width]),
      drawLayer: (c) => seen.push(['drawLayer', c === ctx]),
    }, new Map());
    expect(seen).toEqual([['fade', true, 936], ['drawLayer', true]]);
  });

  it('sends each picture once, then draws it by id', () => {
    const rec = new CanvasRecorder();
    const avatar = { name: 'bitmap' };
    rec.begin(10, 10, new Float64Array(64));
    rec.drawImage(avatar, 1, 2);
    rec.drawImage(avatar, 3, 4, 16, 16);
    const first = rec.take().frame;
    expect(first.images).toEqual([{ id: 1, image: avatar }]);
    rec.begin(10, 10, new Float64Array(64));
    rec.drawImage(avatar, 5, 6);
    const second = rec.take().frame;
    expect(second.images).toEqual([]);
    const images = new Map([[1, avatar]]);
    const { ctx, log } = loggingContext();
    replayCanvas(ctx, first, {}, images);
    replayCanvas(ctx, second, {}, images);
    expect(log).toEqual([['drawImage', avatar, 1, 2], ['drawImage', avatar, 3, 4, 16, 16], ['drawImage', avatar, 5, 6]]);
    rec.begin(10, 10, new Float64Array(64));
    rec.forgetImage(avatar);
    expect(rec.take().frame.forget).toEqual([1]);
  });

  it('lets go of pictures not drawn for a while, and sends them again if they come back', () => {
    const rec = new CanvasRecorder();
    const kept = { name: 'kept' }, gone = { name: 'gone' };
    rec.begin(10, 10, new Float64Array(64));
    rec.drawImage(kept, 0, 0);
    rec.drawImage(gone, 0, 0);
    const forgotten = [];
    for (let i = 0; i < PICTURE_FRAMES + 120; i++) {
      rec.begin(10, 10, new Float64Array(64));
      rec.drawImage(kept, 0, 0);
      forgotten.push(...rec.take().frame.forget);
    }
    expect(forgotten).toEqual([2]);
    rec.begin(10, 10, new Float64Array(64));
    rec.drawImage(gone, 0, 0);
    expect(rec.take().frame.images).toEqual([{ id: 3, image: gone }]);
  });

  it('starts every frame empty and hands over its buffer for transfer', () => {
    const rec = new CanvasRecorder();
    rec.begin(10, 10, new Float64Array(64));
    rec.fillText('a', 1, 2);
    rec.attach('layer', { n: 1 });
    rec.begin(20, 10, new Float64Array(64));
    rec.fillRect(0, 0, 1, 1);
    const { frame, transfer } = rec.take();
    expect(frame.n).toBe(5);
    expect(frame.strings).toEqual([]);
    expect(frame.attached).toEqual({});
    expect(transfer).toEqual([frame.ops.buffer]);
    expect(rec.canvas).toEqual({ width: 20, height: 10 });
  });
});
