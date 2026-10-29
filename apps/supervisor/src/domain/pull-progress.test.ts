import { describe, expect, it } from 'vitest';

import { PullProgressTracker } from './pull-progress.js';

describe('PullProgressTracker', () => {
  it('adds up the bytes of every layer that says its size', () => {
    const tracker = new PullProgressTracker();

    expect(tracker.percent()).toBe(null);

    tracker.add({ id: 'a', status: 'Downloading', progressDetail: { current: 50, total: 100 } });
    tracker.add({ id: 'b', status: 'Downloading', progressDetail: { current: 0, total: 300 } });
    tracker.add({ id: 'c', status: 'Already exists' });

    expect(tracker.percent()).toBe(12);
    expect(tracker.bytes()).toBe(400);

    tracker.add({ id: 'a', status: 'Pull complete' });
    tracker.add({ id: 'b', status: 'Download complete' });

    expect(tracker.percent()).toBe(99);
  });

  it('ignores the lines about the pull as a whole', () => {
    const tracker = new PullProgressTracker();

    tracker.add({ status: 'Pulling from koenkk/zigbee2mqtt', id: 'latest' });
    tracker.add({ id: 'a', status: 'Downloading', progressDetail: { current: 50, total: 100 } });

    expect(tracker.percent()).toBe(50);
  });

  it('counts a waiting layer as an average one and never goes back', () => {
    const tracker = new PullProgressTracker();

    tracker.add({ id: 'a', status: 'Pulling fs layer' });
    tracker.add({ id: 'b', status: 'Waiting' });
    tracker.add({ id: 'a', status: 'Downloading', progressDetail: { current: 50, total: 100 } });

    expect(tracker.percent()).toBe(25);

    // b turns out much larger than a: the share falls, the figure does not.
    tracker.add({ id: 'b', status: 'Downloading', progressDetail: { current: 0, total: 900 } });

    expect(tracker.percent()).toBe(25);

    tracker.add({ id: 'b', status: 'Downloading', progressDetail: { current: 500, total: 900 } });

    expect(tracker.percent()).toBe(55);
  });
});
