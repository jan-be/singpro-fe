import { describe, it, expect } from 'vitest';
import { GLScene, curvePoints, BOX_FLOATS, STROKE_FLOATS, BACKDROP, BOXES, STROKES, SPRITES, FADE } from './glScene';

const scene = () => new GLScene().begin(200, 100, 2);

describe('GLScene', () => {
  it('draws in call order, one batch per run of a kind', () => {
    const s = scene();
    s.backdrop();
    s.line(0, 10, 100, 1, 'rgba(255,255,255,0.12)');
    s.line(0, 20, 100, 1, 'rgba(255,255,255,0.12)');
    s.dot(5, 5, 4, 'rgba(255,0,0,0.3)', 2, '#f00');
    s.fillRect(1, 0, 3, 100, '#fff');
    s.fade(100);
    s.text('GREAT!', 50, 50, { font: 'bold 13px sans-serif', align: 'center', baseline: 'middle', fill: '#fff' });
    expect(s.take().scene.batches).toEqual([[BACKDROP, 0, 1], [BOXES, 0, 2], [STROKES, 0, 1], [BOXES, 2, 1], [FADE, 0, 1], [SPRITES, 0, 1]]);
  });

  it('draws a group as all its boxes, then all its pictures', () => {
    const s = scene();
    s.group(() => {
      s.noteRect(0, 0, 20, 8, 4, '#b8860b', 'rgba(255,215,0,0.2)', 0.3, false);
      s.star(10, 4, 'rgba(255,255,255,0.4)');
      s.noteRect(30, 0, 20, 8, 4, '#b8860b', 'rgba(255,215,0,0.2)', 0.3, false);
      s.star(40, 4, 'rgba(255,255,255,0.4)');
    });
    s.fillRect(0, 0, 1, 1, '#fff');
    // what comes after the group is drawn after its pictures
    expect(s.take().scene.batches).toEqual([[BOXES, 0, 2], [SPRITES, 0, 2], [BOXES, 2, 1]]);
  });

  it('folds the alpha into premultiplied colours, and hollows rap notes', () => {
    const s = scene();
    s.noteRect(0, 0, 20, 8, 10, '#ffffff', 'rgba(0,0,0,1)', 0.5, false);
    s.noteRect(0, 0, 20, 8, 4, '#ffffff', 'rgba(0,0,0,1)', 0.5, true);
    const { boxes } = s.take().scene;
    expect(Array.from(boxes.subarray(4, 8))).toEqual([4, 1, 0, 0]); // radius capped at h / 2
    expect(Array.from(boxes.subarray(8, 12))).toEqual([0.5, 0.5, 0.5, 0.5]);
    const rap = boxes.subarray(BOX_FLOATS, 2 * BOX_FLOATS);
    expect(rap[6]).toBe(1); // dashed
    expect(Array.from(rap.subarray(8, 12))).toEqual([0, 0, 0, 0]); // no fill
    expect(rap[15]).toBeCloseTo(0.35, 5); // the fill colour as the edge, at 0.7 of the alpha
  });

  it('gives a line one segment per pair of points along its curve, sharing the points', () => {
    const s = scene();
    s.pitchLine([{ x: 0, y: 10 }, { x: 2, y: 10 }, { x: 4, y: 30 }], 1, [10, 5, 2], ['rgba(0,0,0,0.3)', '#f00', '#fff']);
    const { strokes, nStrokes, verts, nVerts } = s.take().scene;
    const points = nVerts / 2;
    expect(nStrokes / STROKE_FLOATS).toBe(points - 1);
    expect(verts[0]).toBe(1); // shifted by dx
    for (let k = 0; k < points - 1; k++) {
      const o = k * STROKE_FLOATS;
      expect([strokes[o], strokes[o + 1], strokes[o + 2]]).toEqual([k, 0, points - 1]);
      expect([strokes[o + 4], strokes[o + 5], strokes[o + 6]]).toEqual([5, 2.5, 1]); // radii
    }
    expect([verts[nVerts - 2], verts[nVerts - 1]]).toEqual([5, 30]);
  });

  it('marks what is drawn between beginClip and endClip', () => {
    const s = scene();
    s.beginClip(50, 49);
    s.fillRect(0, 0, 1, 1, '#fff');
    s.endClip();
    s.fillRect(0, 0, 1, 1, '#fff');
    const { boxes, clipX } = s.take().scene;
    expect(clipX).toBe(50);
    expect([boxes[7], boxes[BOX_FLOATS + 7]]).toEqual([1, 0]);
  });

  it('sends a text style once per frame however often it is drawn', () => {
    const s = scene();
    const style = { font: '6px sans-serif', align: 'center', baseline: 'middle', fill: '#fff' };
    s.text('★', 1, 1, style);
    s.text('★', 2, 2, style);
    s.text('★', 3, 3, { ...style, fill: '#000' });
    expect(s.take().scene.defs.length).toBe(2);
  });
});

describe('curvePoints', () => {
  it('ends on the end point, with more points for a bigger step', () => {
    const flat = [];
    curvePoints(0, 0, 2, 0, flat);
    expect(flat).toEqual([2, 0]);
    const step = [];
    curvePoints(0, 0, 4, 24, step);
    expect(step.length / 2).toBe(8);
    expect(step.slice(-2)).toEqual([4, 24]);
    // the cubic's tangents are flat at both ends: the first point barely rises
    expect(step[1]).toBeLessThan(2);
  });
});
