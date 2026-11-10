/**
 * The actions of a part: listed under its source with how they last ran, added from a menu of the
 * commands and changes it takes, kept when the source changes, saved with the parts.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aliasType, aliasTypeParts } from '@nebulahome/contracts';

import { updateAlias } from '@/library/api';
import type { AutomationDraft } from '@/library/automation-draft';
import { dropSlots } from '@/library/block-path';
import { useLive } from '@/live/live-store';
import { LIGHTS, sampleAliasCache, signIn } from '@/testing/alias-samples';

import { AliasPage } from './alias-page';
import { switchSource } from './alias-parts';

vi.mock('@/library/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  updateAlias: vi.fn(),
}));

/**
 * Renders the lights' page and opens their brightness.
 *
 * @returns The opened part's region.
 */
async function openBrightness(): Promise<void> {
  render(
    <QueryClientProvider client={sampleAliasCache(false)}>
      <MemoryRouter initialEntries={[`/aliases/${LIGHTS.id}`]}>
        <Routes>
          <Route path="/aliases/:aliasId" element={<AliasPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Brightness' }));
}

beforeEach(() => {
  useLive.getState().reset();
  signIn(['alias:read', 'alias:write', 'history:read', 'automation:read']);
  vi.mocked(updateAlias).mockReset();
});

describe('the actions of a part', () => {
  it('lists them under the source, with how each last ran', async () => {
    await openBrightness();

    expect(screen.getByText('Actions')).toBeTruthy();
    expect(screen.getByText('Set level')).toBeTruthy();
    expect(screen.getByText(/^Failed · /u)).toBeTruthy();
    expect(screen.getByText(/^Ran /u)).toBeTruthy();
  });

  it('offers the commands it takes, the one answered already greyed, and saves a new one', async () => {
    vi.mocked(updateAlias).mockResolvedValue(LIGHTS);
    await openBrightness();

    fireEvent.click(screen.getByRole('button', { name: /Add an action/u }));

    const menu = await screen.findByRole('menu');
    const setLevel = within(menu).getByRole('menuitem', { name: /Set level/u });

    expect((setLevel as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Falls below/u }));
    fireEvent.click(screen.getByRole('button', { name: /Save/u }));

    await waitFor(() => {
      expect(updateAlias).toHaveBeenCalledTimes(1);
    });

    const [, body] = vi.mocked(updateAlias).mock.calls[0] ?? [];

    expect(body?.parts?.['brightness']?.actions?.map((action) => action.when.kind)).toEqual([
      'command',
      'change',
      'change',
    ]);
  });
});

describe('keeping and moving actions', () => {
  it('keeps a part’s actions when its source changes', () => {
    const def = aliasTypeParts(aliasType('light')).find((each) => each.key === 'brightness');
    const config = LIGHTS.parts['brightness'];

    expect(def).toBeDefined();
    expect(config).toBeDefined();

    if (def !== undefined && config !== undefined) {
      expect(switchSource(def, config, 'stored', 50).actions).toEqual(config.actions);
    }
  });

  it('places a dragged block in the lists of the actions, never in the list of actions', () => {
    const root = {
      actions: LIGHTS.parts['brightness']?.actions ?? [],
    } as unknown as AutomationDraft;

    expect(dropSlots(root, 'action').map((slot) => slot.list)).toEqual([
      'actions.0.then',
      'actions.0.then',
      'actions.0.then',
      'actions.1.then',
      'actions.1.then',
    ]);
  });
});
