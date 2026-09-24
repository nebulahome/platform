/**
 * An entity's settings dialog: what it shows of the entity, and what it sends when saved.
 *
 * The API is stood in for; the interest is in the diff the form sends - only what changed, and
 * nothing at all when nothing did - and in the address never being offered for editing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { entityIdSchema, type EntityView, type TagView } from '@nebula-home/contracts';

import { fetchIcons, fetchTags, updateEntity } from '@/library/api';

import { EntitySettingsDialog } from './entity-settings-dialog';

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
 * Renders the settings of the relay, open.
 *
 * @param canEdit - Whether the person may change them.
 * @returns What the dialog calls to shut itself.
 */
function renderForm(canEdit = true): ReturnType<typeof vi.fn> {
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <EntitySettingsDialog
        entity={RELAY}
        isOpen
        onClose={onClose}
        canCreateTags
        canEdit={canEdit}
      />
    </QueryClientProvider>,
  );

  return onClose;
}

beforeAll(() => {
  vi.mocked(fetchIcons).mockResolvedValue([]);
  vi.mocked(fetchTags).mockResolvedValue([EXTERIOR]);
});

beforeEach(() => {
  vi.mocked(updateEntity).mockClear();
});

describe('EntitySettingsDialog', () => {
  it('offers the name to change, and never the address', () => {
    renderForm();

    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Switch');
    expect(screen.queryByLabelText('Id')).toBeNull();
    expect(screen.queryByDisplayValue('switch.shelly_bench_switch')).toBeNull();
  });

  it('asks the server for nothing while nothing has changed', () => {
    renderForm();

    const save = screen.getByRole('button', { name: 'Save' });

    expect(save).toHaveProperty('disabled', true);
    fireEvent.click(save);
    expect(updateEntity).not.toHaveBeenCalled();
  });

  it('sends only what changed, and shuts once it is saved', async () => {
    vi.mocked(updateEntity).mockResolvedValue({
      ...RELAY,
      name: 'Bench relay',
      tagIds: [EXTERIOR.id],
    });

    const onClose = renderForm();

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
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('refuses to save a blank name', () => {
    renderForm();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateEntity).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/name/iu);
  });

  it('shows the settings without a way to save them to someone who may not change them', () => {
    renderForm(false);

    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByLabelText('Name').matches(':disabled')).toBe(true);
  });
});
