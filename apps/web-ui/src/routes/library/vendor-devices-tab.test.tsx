/**
 * The Devices tab of an integration's page: a device others are part of is one row with a
 * chevron, closed at first, its parts under it once opened; a search that finds a part brings its
 * parent along, opened, with only the parts it found.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { DeviceView } from '@nebulahome/contracts';

import { PRINTER, VENDORS } from '@/testing/printer-fixtures';

import { VendorDevicesTab } from './vendor-devices-tab';

vi.mock('@/library/api', () => ({
  fetchIcons: vi.fn(() => Promise.resolve([])),
  fetchVendors: vi.fn(() => Promise.resolve([])),
  LIBRARY_QUERY_KEYS: { icons: ['library', 'icons'], vendors: ['library', 'vendors'] },
}));

const [VENDOR] = VENDORS;

/**
 * A device of the vendor.
 *
 * @param id - Its id.
 * @param name - Its name.
 * @param fields - What else to set.
 * @returns The device.
 */
function device(id: string, name: string, fields: Partial<DeviceView> = {}): DeviceView {
  return { ...PRINTER, id, name, model: name, areaName: null, ...fields };
}

const DEVICES = [
  device('inverter', 'Inverter garage', { childIds: ['eps', 'dry'] }),
  device('eps', 'X1-Hybrid G4 EPS', { parentId: 'inverter' }),
  device('dry', 'X1-Hybrid G4 Dry contact', { parentId: 'inverter' }),
  device('wallbox', 'Wallbox'),
];

/**
 * Draws the tab over the four devices.
 *
 * @param search - What the address's query asks for, when anything.
 */
function renderTab(search = ''): void {
  render(
    <MemoryRouter initialEntries={[`/integrations/solax${search}`]}>
      <QueryClientProvider client={new QueryClient()}>
        {VENDOR === undefined ? null : <VendorDevicesTab vendor={VENDOR} devices={DEVICES} />}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('VendorDevicesTab', () => {
  it('lists the parts under their parent, closed at first, and counts every device', () => {
    renderTab();

    const toggle = screen.getByRole('button', { name: 'Show the devices of Inverter garage' });

    expect(screen.getByText('Devices · 4')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'X1-Hybrid G4 EPS' })).toBeNull();
    expect(screen.queryByRole('button', { name: /devices of Wallbox/u })).toBeNull();

    fireEvent.click(toggle);

    const opened = screen.getByRole('button', { name: 'Hide the devices of Inverter garage' });
    const parts = document.getElementById(opened.getAttribute('aria-controls') ?? '');

    expect(opened.getAttribute('aria-expanded')).toBe('true');
    expect(
      within(parts ?? document.body)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['X1-Hybrid G4 EPS', 'X1-Hybrid G4 Dry contact']);
  });

  it('brings the parent along, opened, with only the part a search finds', () => {
    renderTab('?q=eps');

    expect(screen.getByText('Devices · 1 of 4')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Inverter garage' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'X1-Hybrid G4 EPS' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'X1-Hybrid G4 Dry contact' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Wallbox' })).toBeNull();
  });
});
