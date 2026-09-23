/**
 * The entity dialog: what it shows of the entity, and what it sends when saved.
 *
 * The API is stood in for; the interest is in the diff the dialog sends - only what changed,
 * and nothing at all when nothing did - and in the address being shown but never edited.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { entityIdSchema, type EntityView, type TagView } from '@nebula-home/contracts';

import { fetchIcons, fetchTags, updateEntity } from '@/library/api';

import { EntityDialog } from './entity-dialog';

vi.mock('@/library/api', () => ({
  fetchIcons: vi.fn(),
  fetchTags: vi.fn(),
  createTag: vi.fn(),
  updateEntity: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    icons: ['library', 'icons'],
    tags: ['library', 'tags'],
    entities: ['library', 'entities'],
  },
}));

const EXTERIOR: TagView = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  key: 'exterior',
  name: 'Exterior',
  color: 'green',
  icon: null,
  deviceCount: 0,
  entityCount: 0,
};

/** The relay, as the devices page holds it. */
const RELAY: EntityView = {
  entityId: entityIdSchema.parse('switch.shelly_bench_switch'),
  domain: 'switch',
  name: 'Switch',
  icon: 'switch',
  areaKey: null,
  areaName: null,
  deviceId: '00000000-0000-4000-8000-000000000010',
  source: 'shelly-bench',
  unitOfMeasurement: null,
  deviceClass: null,
  isEnabled: true,
  isHidden: false,
  capabilities: [{ capability: 'on_off', params: {} }],
  searchAliases: [],
  state: null,
  attributes: {},
  isAvailable: true,
  lastChanged: null,
  lastUpdated: null,
  tagIds: [],
};

/**
 * Renders the dialog for the relay.
 *
 * @returns The callbacks it was given.
 */
function renderDialog() {
  const onSaved = vi.fn();
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <EntityDialog entity={RELAY} canCreateTags onClose={onClose} onSaved={onSaved} />
    </QueryClientProvider>,
  );

  return { onSaved, onClose };
}

beforeAll(() => {
  vi.mocked(fetchIcons).mockResolvedValue([]);
  vi.mocked(fetchTags).mockResolvedValue([EXTERIOR]);
});

beforeEach(() => {
  vi.mocked(updateEntity).mockClear();
});

describe('EntityDialog', () => {
  it('shows the address as a fact, and the name as the thing to change', () => {
    renderDialog();

    expect(screen.getByText('switch.shelly_bench_switch')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Switch');
    expect(screen.queryByLabelText('Id')).toBeNull();
    // The address on its own says what it is; a sentence explaining that it does not change
    // was read every time and needed once.
    expect(screen.queryByText(/The address never changes/u)).toBeNull();
  });

  it('closes without asking the server when nothing changed', () => {
    const { onClose, onSaved } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateEntity).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('sends only what changed, and hands back what came back', async () => {
    const saved = { ...RELAY, name: 'Bench relay', tagIds: [EXTERIOR.id] };

    vi.mocked(updateEntity).mockResolvedValue(saved);

    const { onSaved } = renderDialog();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bench relay' } });

    const tags = await screen.findByRole('combobox', { name: 'Tags' });

    fireEvent.focus(tags);
    fireEvent.click(await screen.findByRole('option', { name: 'Exterior' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateEntity).toHaveBeenCalledWith('switch.shelly_bench_switch', {
        name: 'Bench relay',
        tagIds: [EXTERIOR.id],
      });
      expect(onSaved).toHaveBeenCalledWith(saved);
    });
  });

  it('refuses to save a blank name', () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateEntity).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/name/iu);
  });
});
