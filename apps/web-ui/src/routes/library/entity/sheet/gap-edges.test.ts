import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchTelemetry } from '@/library/api';
import { exactGap } from '@/routes/library/entity/sheet/gap-edges';

vi.mock('@/library/api', () => ({ fetchTelemetry: vi.fn() }));

const HOUR = 3_600_000;
const MINUTE = 60_000;
const at = (ms: number) => ({ time: new Date(ms), value: 1 });

describe('exactGap', () => {
  beforeEach(() => {
    vi.mocked(fetchTelemetry).mockReset();
  });

  it('narrows hour buckets to the last and first readings around the gap', async () => {
    // The last reading came at 03:47:20, the first after at 12:05:10.
    vi.mocked(fetchTelemetry).mockImplementation((window, resolution) => {
      const from = window.from.getTime();

      if (resolution === '1m') {
        return Promise.resolve(
          from === 3 * HOUR
            ? [at(3 * HOUR + 10 * MINUTE), at(3 * HOUR + 47 * MINUTE)]
            : [at(12 * HOUR + 5 * MINUTE), at(12 * HOUR + 30 * MINUTE)],
        );
      }

      return Promise.resolve(
        from === 3 * HOUR + 47 * MINUTE
          ? [at(from + 5_000), at(from + 20_000)]
          : [at(from + 10_000), at(from + 40_000)],
      );
    });

    await expect(
      exactGap('sensor.t', { from: 3 * HOUR, to: 12 * HOUR }, '1h', new AbortController().signal),
    ).resolves.toEqual({
      from: 3 * HOUR + 47 * MINUTE + 20_000,
      to: 12 * HOUR + 5 * MINUTE + 10_000,
    });
  });

  it('keeps the minute when its readings are no longer kept', async () => {
    vi.mocked(fetchTelemetry).mockResolvedValue([]);

    await expect(
      exactGap(
        'sensor.t',
        { from: 5 * MINUTE, to: 50 * MINUTE },
        '1m',
        new AbortController().signal,
      ),
    ).resolves.toEqual({ from: 5 * MINUTE, to: 50 * MINUTE });
  });

  it('leaves raw readings as they are', async () => {
    const gap = { from: 1, to: 2 };

    await expect(exactGap('sensor.t', gap, 'raw', new AbortController().signal)).resolves.toBe(gap);
    expect(fetchTelemetry).not.toHaveBeenCalled();
  });
});
