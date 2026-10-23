/**
 * The Matter broker's page, drawn from the board's fabric: the strip, Recently added and About on
 * Overview; the Devices tab's filters, search and bridge; and the Add device dialog's code field
 * and the question a test certificate asks.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import type { MatterCommissioning } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { SAMPLE_OWNER } from '@/testing/backup-samples';
import { matterSampleCache, MATTER_SAMPLE_TEST } from '@/testing/matter-samples';

import { cleanCode, isWholeCode } from './broker-matter/code-field';
import { MatterBrokerPage } from './broker-matter-page';

/**
 * Draws the page over a cache already holding the fabric.
 *
 * @param job - The last commissioning.
 */
function renderPage(job: MatterCommissioning | null = null): void {
  render(
    <QueryClientProvider client={matterSampleCache(job)}>
      <MemoryRouter initialEntries={['/brokers/matter']}>
        <MatterBrokerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSession.setState({ status: 'signed-in', user: SAMPLE_OWNER });
});

describe('MatterBrokerPage', () => {
  it('says how the fabric stands, what came in last and what the broker is', () => {
    renderPage();

    expect(screen.getByText('5 of 6 online')).toBeTruthy();
    expect(screen.getByText('Hallway plug silent for 3 h')).toBeTruthy();
    expect(screen.getByText(/^Made (?:12 September|September 12,) 2026$/u)).toBeTruthy();
    expect(screen.getByText('Also reached through Shelly')).toBeTruthy();
    expect(screen.getByText(/Shelly Plug S Gen3 · Utility · added 2 hours ago/u)).toBeTruthy();
    expect(screen.getByText('All 6 devices')).toBeTruthy();
    expect(screen.getByText('UDP 5540')).toBeTruthy();
    expect(screen.getByText('matter.js 0.17')).toBeTruthy();
  });

  it('lists every device, a bridge with those behind it, and filters them', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'See it: devices, 5 of 6 online' }));

    const bridge = screen.getByRole('button', { name: /DIRIGERA hub/u });

    expect(bridge.getAttribute('aria-expanded')).toBe('true');
    expect(within(bridge).getByText('2 devices')).toBeTruthy();
    expect(screen.getByText('Sofa lamp')).toBeTruthy();

    fireEvent.click(bridge);
    expect(screen.queryByText('Sofa lamp')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Linked · 1' }));
    expect(screen.getByText('Dryer plug')).toBeTruthy();
    expect(screen.queryByText('Hallway plug')).toBeNull();
  });

  it('takes a whole code before it adds a device', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));

    const dialog = screen.getByRole('dialog', { name: 'Add a Matter device' });
    const add = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add device' });

    expect(add.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Setup code'), {
      target: { value: '3497-011-2332' },
    });
    expect(add.disabled).toBe(false);
  });

  it('asks before it adds a device with a test certificate', () => {
    renderPage(MATTER_SAMPLE_TEST);
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));

    const dialog = screen.getByRole('dialog', { name: 'This device has a test certificate' });

    expect(within(dialog).getByText('Not listed in the DCL as a certified product')).toBeTruthy();
    expect(within(dialog).queryByText('Reading what it can do')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Add it anyway' })).toBeTruthy();
  });
});

describe('cleanCode', () => {
  it('keeps the digits of a manual code and the text of a QR code', () => {
    expect(cleanCode(' 3497-011-2332 ')).toBe('34970112332');
    expect(cleanCode('mt:y.k90 sq')).toBe('MT:Y.K90SQ');
    expect(isWholeCode('34970112332')).toBe(true);
    expect(isWholeCode('3497011233')).toBe(false);
    expect(isWholeCode('MT:Y.K9042C00KA0648G00')).toBe(true);
  });
});
