/**
 * A device reached two ways, drawn from the board's Dryer plug: a health card per way, the
 * readings with their linked tag or their one way, the suggestion under Sensors, and linking two
 * readings from the keyboard, which asks first with what the server says it would do.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { useSession } from '@/auth/session-store';
import { SAMPLE_OWNER } from '@/testing/backup-samples';
import { linkedSampleCache } from '@/testing/linked-samples';

import { DevicePage } from './device-page';

/** Draws the Dryer plug's page over a cache already holding it. */
function renderPage(): void {
  render(
    <QueryClientProvider client={linkedSampleCache()}>
      <MemoryRouter initialEntries={['/devices/shelly-dryer']}>
        <Routes>
          <Route path="/devices/:deviceId" element={<DevicePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSession.setState({ status: 'signed-in', user: SAMPLE_OWNER });
});

describe('a linked device', () => {
  it('has a health card per way and says which is read first', () => {
    renderPage();

    expect(screen.getByText('RPC · preferred')).toBeTruthy();
    expect(screen.getByText('Node 0x1F · fallback')).toBeTruthy();
    expect(screen.getByLabelText('Linked: Shelly and Matter')).toBeTruthy();
    // Each linked reading's tag unlinks it: Plug, Voltage, Current and Energy.
    expect(screen.getAllByRole('button', { name: 'Unlink: Shelly and Matter' })).toHaveLength(4);
  });

  it('suggests the two readings that read the same thing', () => {
    renderPage();

    expect(
      screen.getByText(
        'Power and Active power read the same thing. Drag one onto the other to link them.',
      ),
    ).toBeTruthy();
  });

  it('links two readings from the keyboard, asking first', () => {
    renderPage();

    const power = screen.getByRole('link', { name: 'Power' });

    fireEvent.keyDown(power, { key: ' ' });
    expect(screen.getByText(/Took up Power\. Over Active power\./u)).toBeTruthy();

    fireEvent.keyDown(power, { key: 'Enter' });

    const dialog = screen.getByRole('dialog', { name: 'Link Power and Active power?' });

    expect(within(dialog).getByText('sensor.dryer_plug_power stays')).toBeTruthy();
    expect(within(dialog).getByText('Dryer finished')).toBeTruthy();
  });
});
