/**
 * The aliases list: grouped by type, the Problems switch, the Enabled switch, the empty house,
 * and New alias opened from its address.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateAlias } from '@/library/api';
import { useLive } from '@/live/live-store';
import { GUEST_MODE, sampleAliasCache, signIn } from '@/testing/alias-samples';

import { AliasesPage } from './aliases-page';

vi.mock('@/library/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  updateAlias: vi.fn(),
}));

/**
 * Renders the list.
 *
 * @param cache - What it reads.
 * @param at - Where it opens.
 */
function renderList(cache: QueryClient, at = '/aliases'): void {
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/aliases" element={<AliasesPage />} />
          <Route path="/aliases/new" element={<AliasesPage isCreating />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useLive.getState().reset();
  signIn(['alias:read', 'alias:write', 'history:read']);
  vi.mocked(updateAlias).mockReset();
});

describe('AliasesPage', () => {
  it('groups the aliases by type, with their device and their problem', () => {
    renderList(sampleAliasCache(false));

    const table = screen.getAllByRole('list')[0];

    if (table === undefined) {
      throw new Error('No table');
    }

    expect(within(table).getByText('Thermostats')).toBeTruthy();
    expect(within(table).getByText('Living room thermostat')).toBeTruthy();
    expect(within(table).getByText('Living room heater')).toBeTruthy();
    expect(within(table).getByText('Line 8 · avg() got None')).toBeTruthy();
  });

  it('keeps only the problems when asked', () => {
    renderList(sampleAliasCache(false), '/aliases?show=problems');

    expect(screen.getAllByText('Washing done').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Guest mode')).toEqual([]);
  });

  it('turns an alias on from its row', async () => {
    vi.mocked(updateAlias).mockResolvedValue({ ...GUEST_MODE, isEnabled: true });
    renderList(sampleAliasCache(false));

    fireEvent.click(screen.getByRole('switch', { name: 'Guest mode enabled' }));

    await waitFor(() => {
      expect(updateAlias).toHaveBeenCalledWith(GUEST_MODE.id, { isEnabled: true });
    });
  });

  it('says there are none, offering New alias and Import', () => {
    renderList(sampleAliasCache(true));

    expect(screen.getByText('No aliases')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /New alias/u }).length).toBeGreaterThan(0);
  });

  it('opens New alias at its address, with the types to pick from', () => {
    renderList(sampleAliasCache(false), '/aliases/new');

    expect(screen.getByRole('radiogroup', { name: 'Type' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Sensor/u }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});
