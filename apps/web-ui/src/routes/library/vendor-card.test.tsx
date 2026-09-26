/**
 * The marks on a vendor's card: the wires it speaks, then whether it needs the internet.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Marks } from '@/routes/library/vendor-card';

describe('Marks', () => {
  it('draws the platform wires by what they are', () => {
    render(<Marks vendor={{ transports: ['http', 'mqtt'], internetRequired: false }} />);

    expect(screen.getByRole('img', { name: 'Speaks HTTP to each device' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Listens on the MQTT broker' })).toBeTruthy();
  });

  it('draws Bluetooth LE and Zigbee too, when a vendor goes over them', () => {
    render(<Marks vendor={{ transports: ['ble', 'zigbee'], internetRequired: false }} />);

    expect(screen.getByRole('img', { name: 'Reaches its devices over Bluetooth LE' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Reaches its devices over Zigbee' })).toBeTruthy();
  });

  it("gives a vendor's own protocol no mark: it is not a wire anybody shops by", () => {
    render(<Marks vendor={{ transports: ['shelly/rpc', 'govee/lan'], internetRequired: false }} />);

    expect(screen.queryAllByRole('img')).toEqual([]);
  });

  it('says so when the internet is needed', () => {
    render(<Marks vendor={{ transports: ['http'], internetRequired: true }} />);

    expect(screen.getByRole('img', { name: 'Needs the internet' })).toBeTruthy();
  });
});
