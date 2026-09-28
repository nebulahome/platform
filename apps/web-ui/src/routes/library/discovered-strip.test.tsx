/**
 * The row of devices found on the network, and the arrows that page through it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as renderAlone, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DiscoveredDevice } from '@nebula-home/contracts';

import { DiscoveredStrip } from './discovered-strip';

/**
 * Renders inside a query client, which moving a device found at a new address uses.
 *
 * @param ui - What to render.
 * @returns What testing-library returns.
 */
function render(ui: ReactElement): ReturnType<typeof renderAlone> {
  const client = new QueryClient();

  return renderAlone(ui, {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

/**
 * A device found over mDNS.
 *
 * @param n - Which one, for its id, name and address.
 * @returns The device, as the list serves it.
 */
function found(n: number): DiscoveredDevice {
  return {
    id: `${String(n).padStart(2, '0')}23456789abcdef`,
    vendorId: 'shelly',
    driverId: 'plug',
    kind: 'shelly/plug',
    source: 'mdns',
    address: `192.168.1.${String(40 + n)}`,
    externalId: `plug-${String(n)}`,
    name: `Plug ${String(n)}`,
    model: 'Plug S Gen3',
    modelChoices: ['Plug S Gen3'],
    modelCode: 'S3PL-00112EU',
    swVersion: null,
    transportConfig: { host: `192.168.1.${String(40 + n)}` },
    movedFrom: null,
    adoption: 'owner',
    firstSeenAt: new Date('2026-09-23T10:00:00.000Z'),
    lastSeenAt: new Date('2026-09-23T10:00:00.000Z'),
  };
}

/**
 * Makes every element report a row wider than its box, as a row of many cards is.
 *
 * @param scrollLeft - Where the row is scrolled to.
 */
function overflowing(scrollLeft: number): void {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'get').mockReturnValue(scrollLeft);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DiscoveredStrip', () => {
  it('shows one card per device found, and says how many there are', () => {
    render(
      <DiscoveredStrip devices={[found(1), found(2)]} vendors={[]} canAdopt onAdopt={vi.fn()} />,
    );

    const strip = screen.getByRole('region', { name: /Found on your network/u });

    expect(strip.textContent).toContain('2');
    expect(screen.getByRole('article', { name: 'Plug 1' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Plug 2' })).toBeTruthy();
  });

  it('shows nothing at all when nothing was found', () => {
    const { container } = render(
      <DiscoveredStrip devices={[]} vendors={[]} canAdopt onAdopt={vi.fn()} />,
    );

    expect(container.textContent).toBe('');
  });

  it('offers no arrows when every card fits', () => {
    render(<DiscoveredStrip devices={[found(1)]} vendors={[]} canAdopt onAdopt={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Show the next devices' })).toBeNull();
  });

  it('pages on with the arrow, and cannot page back from the start', () => {
    overflowing(0);
    const scrollBy = vi.fn();

    HTMLElement.prototype.scrollBy = scrollBy;
    render(
      <DiscoveredStrip
        devices={[found(1), found(2), found(3), found(4)]}
        vendors={[]}
        canAdopt
        onAdopt={vi.fn()}
      />,
    );

    const next = screen.getByRole('button', { name: 'Show the next devices' });
    const previous = screen.getByRole('button', { name: 'Show the previous devices' });

    expect(previous.hasAttribute('disabled')).toBe(true);
    fireEvent.click(next);

    expect(scrollBy).toHaveBeenCalledWith({ left: 400, behavior: 'smooth' });
  });

  it('cannot page on from the end', () => {
    overflowing(700);
    HTMLElement.prototype.scrollBy = vi.fn();
    render(
      <DiscoveredStrip
        devices={[found(1), found(2), found(3), found(4)]}
        vendors={[]}
        canAdopt
        onAdopt={vi.fn()}
      />,
    );

    fireEvent.scroll(screen.getByRole('list'));

    expect(
      screen.getByRole('button', { name: 'Show the next devices' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Show the previous devices' }).hasAttribute('disabled'),
    ).toBe(false);
  });
});
