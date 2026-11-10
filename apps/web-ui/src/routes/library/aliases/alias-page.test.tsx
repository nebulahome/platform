/**
 * An alias's page: its parts, Required and Optional; a part opened and moved to another source;
 * Save sending only what changed; the Code tab only when a part comes from code.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateAlias } from '@/library/api';
import { useLive } from '@/live/live-store';
import { HOUSE_TEMPERATURE, sampleAliasCache, signIn, THERMOSTAT } from '@/testing/alias-samples';

import { AliasPage, changesOf, draftOf } from './alias-page';

vi.mock('@/library/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  updateAlias: vi.fn(),
}));

/**
 * Renders an alias's page.
 *
 * @param aliasId - The alias.
 */
function renderPage(aliasId: string): void {
  render(
    <QueryClientProvider client={sampleAliasCache(false)}>
      <MemoryRouter initialEntries={[`/aliases/${aliasId}`]}>
        <Routes>
          <Route path="/aliases/:aliasId" element={<AliasPage />} />
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

describe('changesOf', () => {
  it('sends only the fields that differ', () => {
    const before = draftOf(THERMOSTAT);

    expect(changesOf(before, { ...before, debounceMs: 500 })).toEqual({ debounceMs: 500 });
    expect(changesOf(before, before)).toEqual({});
  });
});

describe('AliasPage', () => {
  it('lists the parts, required and optional, with their source', async () => {
    renderPage(THERMOSTAT.id);

    expect(await screen.findByText('Target temperature')).toBeTruthy();
    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.getByText('Optional')).toBeTruthy();
    expect(screen.getAllByText('Stored').length).toBeGreaterThan(0);
    expect(screen.getByText('action()')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Code/u })).toBeTruthy();
  });

  it('moves a part to Stored and saves only the parts', async () => {
    vi.mocked(updateAlias).mockResolvedValue(THERMOSTAT);
    renderPage(THERMOSTAT.id);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Current temperature' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Stored' }));
    fireEvent.click(screen.getByRole('button', { name: /Save/u }));

    await waitFor(() => {
      expect(updateAlias).toHaveBeenCalledTimes(1);
    });

    const [, body] = vi.mocked(updateAlias).mock.calls[0] ?? [];

    expect(Object.keys(body ?? {})).toEqual(['parts']);
    expect(body?.parts?.['current_temperature']).toMatchObject({ from: 'stored' });
  });

  it('has no Code tab when no part comes from code, and a Display section for a reading', async () => {
    renderPage(HOUSE_TEMPERATURE.id);

    expect(await screen.findByText('Display')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Code/u })).toBeNull();
  });
});
