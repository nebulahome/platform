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
  device('inverter', 'Inverter garage', {
    childIds: ['eps', 'dry'],
    transportConfig: { host: '192.168.1.50' },
  }),
  device('eps', 'X1-Hybrid G4 EPS', { parentId: 'inverter' }),
  device('dry', 'X1-Hybrid G4 Dry contact', { parentId: 'inverter', state: 'failed' }),
  device('wallbox', 'Wallbox'),
];

/**
 * Draws the tab over the four devices.
 *
 * @param search - What the address's query asks for, when anything.
 * @param onShowFound - Opens the Found tab, when the vendor has one.
 */
function renderTab(search = '', onShowFound?: () => void): void {
  render(
    <MemoryRouter initialEntries={[`/integrations/solax${search}`]}>
      <QueryClientProvider client={new QueryClient()}>
        {VENDOR === undefined ? null : (
          <VendorDevicesTab
            vendor={VENDOR}
            devices={DEVICES}
            {...(onShowFound === undefined ? {} : { foundCount: 2, onShowFound })}
          />
        )}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('VendorDevicesTab', () => {
  it('lists the parts under their parent, closed at first, and counts every device', () => {
    renderTab();

    const toggle = screen.getByRole('button', { name: 'Show the devices of Inverter garage' });

    expect(screen.getByRole('heading', { name: 'Devices' })).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('192.168.1.50')).toBeTruthy();
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

    expect(screen.getByText('1 of 4')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Inverter garage' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'X1-Hybrid G4 EPS' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'X1-Hybrid G4 Dry contact' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Wallbox' })).toBeNull();
  });

  it('opens a closed parent for a failing part the Status filter finds', () => {
    renderTab('?status=failed');

    expect(screen.getByText('1 of 4')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Hide the devices of Inverter garage' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'X1-Hybrid G4 Dry contact' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'X1-Hybrid G4 EPS' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/u })).toBeNull();
  });

  it('sorts by a heading, the other way on a second press, the parts staying under their parent', () => {
    renderTab();

    /**
     * The main rows' device names, top to bottom.
     *
     * @returns The names.
     */
    const order = (): (string | null)[] =>
      screen.getAllByRole('link').map((link) => link.textContent);
    const heading = (name: string): HTMLElement =>
      screen.getByRole('columnheader', { name: new RegExp(name, 'iu') });

    expect(order()).toEqual(['Inverter garage', 'Wallbox']);
    expect(heading('Device').getAttribute('aria-sort')).toBe('ascending');
    expect(heading('Model').getAttribute('aria-sort')).toBe('none');
    expect(heading('Status').getAttribute('aria-sort')).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by device' }));

    expect(order()).toEqual(['Wallbox', 'Inverter garage']);
    expect(heading('Device').getAttribute('aria-sort')).toBe('descending');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by area' }));

    expect(heading('Device').getAttribute('aria-sort')).toBe('none');
    expect(heading('Area').getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'Show the devices of Inverter garage' }));

    expect(order()).toEqual([
      'Inverter garage',
      'X1-Hybrid G4 EPS',
      'X1-Hybrid G4 Dry contact',
      'Wallbox',
    ]);
  });

  it('says nothing matches, and points to the devices waiting in Found', () => {
    const onShowFound = vi.fn();

    renderTab('?q=kitchn', onShowFound);

    expect(screen.getByText('Nothing matches “kitchn”.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Found' }));
    expect(onShowFound).toHaveBeenCalled();
  });
});
