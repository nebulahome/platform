import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REDESCRIBE_AFTER_MS } from '@nebulahome/package-runtime';

import { SetUpWaits } from './set-up-waits.js';

const claimOf = (mode: string) => ({ deviceKey: 'bot', externalId: 'bot', descriptor: { mode } });

describe('SetUpWaits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('describes a device again once it still says the new setup after the wait', () => {
    const waits = new SetUpWaits();
    const due = vi.fn();

    waits.follow('bot', claimOf('switch'), true, due);
    vi.advanceTimersByTime(REDESCRIBE_AFTER_MS / 2);
    // Said again: the wait goes on, it does not start over.
    waits.follow('bot', claimOf('switch'), true, due);
    vi.advanceTimersByTime(REDESCRIBE_AFTER_MS / 2);

    expect(due).toHaveBeenCalledExactlyOnceWith(claimOf('switch'));
  });

  it('changes nothing when the device says its claim again, or its instance stops', () => {
    const waits = new SetUpWaits();
    const due = vi.fn();

    waits.follow('bot', claimOf('switch'), true, due);
    waits.follow('bot', claimOf('press'), false, due);
    waits.follow('plug', claimOf('switch'), true, due);
    waits.drop('plug');
    vi.advanceTimersByTime(REDESCRIBE_AFTER_MS * 2);

    expect(due).not.toHaveBeenCalled();
  });
});
