import { describe, expect, it } from 'vitest';

import { SERIAL_SAMPLE_PORTS } from '@/testing/serial-samples';

import { freePortsFor } from './serial-port-fields';

describe('freePortsFor', () => {
  it('offers free plugged-in ports, recognised first, and the one the device holds', () => {
    expect(freePortsFor(SERIAL_SAMPLE_PORTS, 'victron').map((port) => port.name)).toEqual([
      'FTDI FT232R USB UART',
    ]);
    expect(
      freePortsFor(SERIAL_SAMPLE_PORTS, 'dsmr', 'dsmr-meter').map((port) => port.name),
    ).toEqual(['Meter cabinet ser2net', 'FTDI FT232R USB UART']);
  });
});
