import { afterEach, describe, expect, it, vi } from 'vitest';

import { UpdatingSources } from './updating-sources.js';

describe('UpdatingSources', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tells when a source starts and ends, and a wait resolves on the end', async () => {
    const changes: string[] = [];
    const sources = new UpdatingSources({
      onChange: (source, isUpdating) => changes.push(`${source}:${String(isUpdating)}`),
    });

    sources.start('mqtt');

    const waited = sources.wait('mqtt', 60_000);

    expect(sources.isUpdating('mqtt')).toBe(true);
    sources.end('mqtt');

    await expect(waited).resolves.toBe(true);
    expect(changes).toEqual(['mqtt:true', 'mqtt:false']);
    await expect(sources.wait('mqtt', 1)).resolves.toBe(true);
  });

  it('gives up waiting after its time, and when the run is cancelled', async () => {
    vi.useFakeTimers();

    const sources = new UpdatingSources({ onChange: () => undefined });
    const controller = new AbortController();

    sources.start('shelly-1');

    const timedOut = sources.wait('shelly-1', 1000);
    const cancelled = sources.wait('shelly-1', 60_000, controller.signal);

    vi.advanceTimersByTime(1000);
    controller.abort();

    await expect(timedOut).resolves.toBe(false);
    await expect(cancelled).resolves.toBe(false);
  });

  it('lets a source go when its end never comes', () => {
    vi.useFakeTimers();

    const sources = new UpdatingSources({ onChange: () => undefined, capMs: 5000 });

    sources.start('nvr');
    vi.advanceTimersByTime(5000);

    expect(sources.isUpdating('nvr')).toBe(false);
  });
});
