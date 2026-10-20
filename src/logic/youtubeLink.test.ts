import { describe, expect, it } from 'vitest';
import { extractYouTubeVideoId } from './youtubeLink';

describe('extractYouTubeVideoId', () => {
  it('reads the usual link shapes', () => {
    for (const link of [
      'https://www.youtube.com/watch?v=y1cBhJLNNXU',
      '  https://youtube.com/watch?v=y1cBhJLNNXU&t=42s ',
      'https://m.youtube.com/watch?v=y1cBhJLNNXU',
      'https://music.youtube.com/watch?v=y1cBhJLNNXU&list=RD',
      'https://youtu.be/y1cBhJLNNXU?si=abc',
      'https://www.youtube.com/shorts/y1cBhJLNNXU',
      'https://www.youtube.com/live/y1cBhJLNNXU',
    ]) expect(extractYouTubeVideoId(link)).toBe('y1cBhJLNNXU');
  });

  it('ignores text, other sites and broken ids', () => {
    for (const text of ['glue song', 'https://example.com/watch?v=y1cBhJLNNXU', 'https://youtu.be/short', 'https://www.youtube.com/watch?v=bad', '', null]) {
      expect(extractYouTubeVideoId(text)).toBe(null);
    }
  });
});
