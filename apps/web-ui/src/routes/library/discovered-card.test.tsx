/**
 * One device found on the network: enough to recognise it, and the button to adopt it.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DiscoveredDevice, IntegrationVendorView } from '@nebulahome/contracts';

import { DiscoveredCard } from './discovered-card';

/**
 * A Shelly found over mDNS.
 *
 * @param overrides - What differs.
 * @returns The device, as the list serves it.
 */
function found(overrides: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return {
    id: '0123456789abcdef',
    vendorId: 'shelly',
    driverId: 'switch-pm',
    kind: 'shelly/switch-pm',
    source: 'mdns',
    address: '192.168.1.40',
    externalId: 'shelly1pmg3-a8032ab12345',
    name: 'Kitchen',
    model: '1PM Gen3',
    modelChoices: ['1PM Gen3'],
    modelCode: 'S3SW-001P16EU',
    swVersion: '1.4.2',
    transportConfig: { host: '192.168.1.40' },
    movedFrom: null,
    adoption: 'owner',
    firstSeenAt: new Date('2026-09-23T10:00:00.000Z'),
    lastSeenAt: new Date('2026-09-23T10:05:00.000Z'),
    ...overrides,
  };
}

/** Shelly, as the vendors list serves it, as far as the card reads it. */
const SHELLY: Pick<IntegrationVendorView, 'id' | 'name' | 'color' | 'logoPadding'> = {
  id: 'shelly',
  name: 'Shelly',
  color: '#3B9DFF',
  logoPadding: 0,
};

describe('DiscoveredCard', () => {
  it('shows what the device calls itself, its vendor, its model and where it is', () => {
    render(<DiscoveredCard device={found()} vendor={SHELLY} canAdopt onAdopt={vi.fn()} />);

    const card = screen.getByRole('article', { name: 'Kitchen' });

    expect(card.textContent).toContain('Shelly');
    expect(card.textContent).toContain('1PM Gen3');
    expect(card.textContent).toContain('192.168.1.40');
    expect(card.textContent).toContain('mDNS');
  });

  it('goes by its model when the device gave no name', () => {
    render(
      <DiscoveredCard device={found({ name: null })} vendor={SHELLY} canAdopt onAdopt={vi.fn()} />,
    );

    expect(screen.getByRole('article', { name: '1PM Gen3' })).toBeTruthy();
  });

  it('names the family when the device did not say which model of it it is', () => {
    render(
      <DiscoveredCard
        device={found({ name: null, model: null, modelChoices: ['BASICR3', 'MINI'] })}
        vendor={SHELLY}
        canAdopt
        onAdopt={vi.fn()}
      />,
    );

    const card = screen.getByRole('article', { name: 'Shelly device' });

    expect(card.textContent).toContain('BASICR3');
    expect(card.textContent).toContain('MINI');
  });

  it('hands the device to whoever adopts it', () => {
    const onAdopt = vi.fn();
    const device = found();

    render(<DiscoveredCard device={device} vendor={SHELLY} canAdopt onAdopt={onAdopt} />);
    fireEvent.click(screen.getByRole('button', { name: 'Adopt Kitchen' }));

    expect(onAdopt).toHaveBeenCalledWith(device);
  });

  it('offers no adoption to somebody who may not add devices', () => {
    render(<DiscoveredCard device={found()} vendor={SHELLY} canAdopt={false} onAdopt={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /Adopt/u })).toBeNull();
  });

  it('offers to move a device already added that answers at a new address, not to adopt it', () => {
    const onAdopt = vi.fn();
    const onMove = vi.fn();
    const device = found({
      address: '192.168.4.37',
      transportConfig: { host: '192.168.4.37' },
      movedFrom: { deviceId: 'kitchen-relay', address: '192.168.1.40' },
    });

    render(
      <DiscoveredCard device={device} vendor={SHELLY} canAdopt onAdopt={onAdopt} onMove={onMove} />,
    );

    expect(screen.getByRole('article', { name: 'Kitchen' }).textContent).toContain('192.168.1.40');
    expect(screen.queryByRole('button', { name: /Adopt/u })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Move Kitchen to 192.168.4.37' }));

    expect(onMove).toHaveBeenCalledWith(device);
    expect(onAdopt).not.toHaveBeenCalled();
  });

  it('still shows a device whose vendor the page has not loaded', () => {
    render(<DiscoveredCard device={found()} vendor={undefined} canAdopt onAdopt={vi.fn()} />);

    expect(screen.getByRole('article', { name: 'Kitchen' }).textContent).toContain('shelly');
  });
});
