import { describe, expect, it } from 'vitest';

import { ENTITY_ID_PATTERN } from '@nebula-home/contracts';

import { composeEntityId } from './entity-ids.js';

describe('composeEntityId', () => {
  it('produces the same identifier for the same device every time', () => {
    // The property everything else rests on. If a rescan produced a different identifier, every
    // re-adoption would create a second copy of the device and every automation naming the old
    // one would quietly stop working.
    const once = composeEntityId('switch', 'shellyplus1-aabbcc');
    const again = composeEntityId('switch', 'shellyplus1-aabbcc');

    expect(once).toBe(again);
  });

  it('reduces an address to the alphabet an identifier allows', () => {
    expect(composeEntityId('switch', '192.168.1.40')).toBe('switch.d_192_168_1_40');
  });

  it('reduces a hex device address', () => {
    expect(composeEntityId('sensor', '0x00124b0022a1b2')).toBe('sensor.d_0x00124b0022a1b2');
  });

  it('keeps a name that is already usable', () => {
    expect(composeEntityId('light', 'kitchen_ceiling')).toBe('light.kitchen_ceiling');
  });

  it('tells two entities of one device apart', () => {
    const first = composeEntityId('switch', 'pro4pm-aabbcc', 'ch0');
    const second = composeEntityId('switch', 'pro4pm-aabbcc', 'ch1');

    expect([first, second]).toEqual(['switch.pro4pm_aabbcc_ch0', 'switch.pro4pm_aabbcc_ch1']);
  });

  it('keeps what tells entities apart when the device identifier is long', () => {
    // Truncating the whole thing from the end would cut off exactly the part that distinguishes
    // channel 0 from channel 1, and the second registration would collide with the first.
    const long = 'a'.repeat(120);
    const first = composeEntityId('switch', long, 'ch0');
    const second = composeEntityId('switch', long, 'ch1');

    expect(first).not.toBe(second);
    expect(ENTITY_ID_PATTERN.test(first)).toBe(true);
  });

  it('produces a valid identifier from anything a device might call itself', () => {
    for (const external of [
      '192.168.1.40',
      '0x00124b0022a1b2',
      'Shelly Plus 1PM (Kitchen)',
      '---',
      '9',
      'ü-mlaut',
      'a'.repeat(200),
    ]) {
      expect(ENTITY_ID_PATTERN.test(composeEntityId('switch', external))).toBe(true);
    }
  });
});
