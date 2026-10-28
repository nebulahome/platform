import { describe, expect, it } from 'vitest';

import { THREAD_SAMPLE_BORDER_ROUTERS, THREAD_SAMPLE_DEVICES } from '@/testing/thread-samples';

import { threadMapOf } from './thread-map';

describe('threadMapOf', () => {
  it('rings routers and same-network border routers round this one, end devices off their parent', () => {
    const { points, links } = threadMapOf(THREAD_SAMPLE_DEVICES, THREAD_SAMPLE_BORDER_ROUTERS);

    expect(points[0]).toMatchObject({ id: 'border-router', kind: 'self', x: 0, y: 0 });
    expect(links.map((link) => `${link.source} > ${link.target} (${link.look})`).sort()).toEqual([
      '1a2b3c4d5e6f7081 > 4d5e6f708192a3b4 (strong)',
      '2b3c4d5e6f708192 > 5e6f708192a3b4c5 (fair)',
      '3c4d5e6f708192a3 > 6a3f9c210b4e7d10 (fair)',
      '3c4d5e6f708192a3 > 6f708192a3b4c5d6 (weak)',
      'border-router > 1a2b3c4d5e6f7081 (strong)',
      'border-router > 2b3c4d5e6f708192 (strong)',
      'border-router > 3c4d5e6f708192a3 (fair)',
      'border-router > br:homepod (border)',
    ]);
  });
});
