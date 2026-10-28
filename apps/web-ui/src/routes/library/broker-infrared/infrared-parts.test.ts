import { describe, expect, it } from 'vitest';

import { rssiBars } from '@/routes/library/broker-parts';
import { necSample } from '@/testing/infrared-samples';

import { protocolLine, protocolName, pulsesLine } from './infrared-parts';

describe('a code in words', () => {
  it('names the protocol, its address and command, and its pulses', () => {
    const code = necSample(0x04, 0x02);

    expect(protocolName(code.protocol)).toBe('NEC');
    expect(protocolName(undefined)).toBe('Raw');
    expect(protocolLine(code.protocol)).toBe('address 0x04 · command 0x02');
    expect(pulsesLine(code)).toBe('67 pulses · 38 kHz · 68 ms');
  });
});

describe('rssiBars', () => {
  it('fills four bars for a strong signal and none for one not heard', () => {
    expect([-55, -65, -75, -85, -95, null].map(rssiBars)).toEqual([4, 3, 2, 1, 0, 0]);
  });
});
