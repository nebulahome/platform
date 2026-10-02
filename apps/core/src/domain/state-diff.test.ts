import { describe, expect, it } from 'vitest';

import type { CapabilityState } from '@nebulahome/contracts';

import { hasStateChanged, mergeCapabilityState } from './state-diff.js';

describe('mergeCapabilityState', () => {
  it('keeps the capabilities a report did not mention', () => {
    // A colour bulb whose brightness changed. Taking the report as the whole truth would leave
    // the interface showing a lamp with no colour every time somebody dimmed it.
    const previous: CapabilityState = {
      on_off: { isOn: true },
      level: { level: 80 },
      color_hs: { hue: 30, saturation: 60 },
    };

    const merged = mergeCapabilityState(previous, { level: { level: 40 } });

    expect(merged).toStrictEqual({
      on_off: { isOn: true },
      level: { level: 40 },
      color_hs: { hue: 30, saturation: 60 },
    });
  });

  it('replaces a mentioned capability wholesale', () => {
    // Hue and saturation are one observation. Mixing a new hue with an old saturation would
    // produce a colour the device never reported.
    const merged = mergeCapabilityState(
      { color_hs: { hue: 30, saturation: 60 } },
      { color_hs: { hue: 200, saturation: 10 } },
    );

    expect(merged.color_hs).toStrictEqual({ hue: 200, saturation: 10 });
  });

  it('accepts the first report for an entity', () => {
    expect(mergeCapabilityState({}, { on_off: { isOn: false } })).toStrictEqual({
      on_off: { isOn: false },
    });
  });
});

describe('hasStateChanged', () => {
  it('is false for a sensor repeating itself', () => {
    // The property every automation triggering on change depends on.
    expect(
      hasStateChanged({ sensor_numeric: { value: 21.5 } }, { sensor_numeric: { value: 21.5 } }),
    ).toBe(false);
  });

  it('is true for a different value', () => {
    expect(
      hasStateChanged({ sensor_numeric: { value: 21.5 } }, { sensor_numeric: { value: 21.6 } }),
    ).toBe(true);
  });

  it('does not care what order the keys were built in', () => {
    // One state came from a merge and the other from a database row. Comparing their JSON would
    // report them as different and fire every automation in the house.
    const left: CapabilityState = { on_off: { isOn: true }, level: { level: 50 } };
    const right: CapabilityState = { level: { level: 50 }, on_off: { isOn: true } };

    expect(hasStateChanged(left, right)).toBe(false);
  });

  it('notices a capability appearing', () => {
    expect(
      hasStateChanged(
        { on_off: { isOn: true } },
        {
          on_off: { isOn: true },
          level: { level: 10 },
        },
      ),
    ).toBe(true);
  });

  it('notices a capability disappearing', () => {
    expect(
      hasStateChanged({ on_off: { isOn: true }, level: { level: 10 } }, { on_off: { isOn: true } }),
    ).toBe(true);
  });

  it('distinguishes zero, false and absent', () => {
    // Three values JavaScript is happy to conflate, and three genuinely different facts about a
    // dimmer: off, at zero, and never reported.
    expect(hasStateChanged({ level: { level: 0 } }, {})).toBe(true);
    expect(hasStateChanged({ on_off: { isOn: false } }, {})).toBe(true);
    expect(hasStateChanged({ level: { level: 0 } }, { level: { level: 0 } })).toBe(false);
  });
});
