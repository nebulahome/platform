/**
 * The filter sheet on the devices page: the standings as boxes with their counts, the dropdowns
 * two to a line, and the facets the devices give no choice in left out.
 *
 * A dropdown's list is portalled out of the sheet, so a click on one of its options lands outside
 * the sheet as far as the document is concerned - exactly what shuts the sheet. That the sheet
 * stays open through a choice is the behaviour worth pinning.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OPEN_FILTER, type DeviceFilter } from '@/library/device-filters';

import { DeviceFilterButton, type DeviceChoices } from './device-filter';

/** What two devices of two vendors in two rooms give. */
const CHOICES: DeviceChoices = {
  vendors: [
    { value: 'bambu-lab', label: 'Bambu Lab' },
    { value: 'shelly', label: 'Shelly' },
  ],
  areas: [
    { value: 'kitchen', label: 'Kitchen' },
    { value: 'study', label: 'Study' },
  ],
  models: ['P1S'],
  transports: ['mqtt'],
  tags: [],
  hasParts: false,
};

/** How many stand each way. */
const COUNTS = { unreachable: 0, silent: 1, update: 0, reporting: 3, disabled: 1 };

/**
 * Renders the button with its sheet open.
 *
 * @param choices - What the devices give.
 * @param filter - What is set.
 * @returns The change spy.
 */
function renderOpen(choices: DeviceChoices = CHOICES, filter: DeviceFilter = OPEN_FILTER) {
  const onChange = vi.fn();

  render(
    <DeviceFilterButton filter={filter} choices={choices} counts={COUNTS} onChange={onChange} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /filter/iu }));

  return { onChange };
}

describe('DeviceFilterButton', () => {
  it('offers every standing as a box with its count, and ticks one more', () => {
    const { onChange } = renderOpen(CHOICES, { ...OPEN_FILTER, statuses: ['silent'] });

    for (const label of ['Unreachable', 'Silent', 'Update ready', 'Reporting', 'Disabled']) {
      expect(screen.getByRole('checkbox', { name: new RegExp(label, 'u') })).toBeTruthy();
    }

    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /Unreachable/u }));

    // In the Status column's order, whatever order they were ticked in.
    expect(onChange).toHaveBeenCalledWith({ ...OPEN_FILTER, statuses: ['unreachable', 'silent'] });
  });

  it('offers the integrations and the rooms as dropdowns, any first', () => {
    renderOpen();

    fireEvent.click(screen.getByRole('combobox', { name: /integration/iu }));

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Any integration',
      'Bambu Lab',
      'Shelly',
    ]);
    expect(screen.getByRole('combobox', { name: /^Area/u }).textContent).toContain('Any area');
  });

  it('leaves out what the devices give no choice in, and offers what they do', () => {
    renderOpen();

    expect(screen.queryByRole('combobox', { name: /^Model/u })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /^Connection/u })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /^Tag/u })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Show' })).toBeNull();
    expect(screen.queryByText(/Sort by/u)).toBeNull();
  });

  it('offers models, connections, a tag in use and the parts when there are', () => {
    const { onChange } = renderOpen({
      ...CHOICES,
      models: ['P1S', 'X1C'],
      transports: ['mqtt', 'shelly/rpc'],
      tags: [{ value: 'tag-1', label: 'Exterior' }],
      hasParts: true,
    });

    fireEvent.click(screen.getByRole('combobox', { name: /^Connection/u }));

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Any connection',
      'MQTT',
      'RPC',
    ]);
    expect(screen.getByRole('combobox', { name: /^Model/u })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /^Tag/u })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Parts' }));

    expect(onChange).toHaveBeenCalledWith({ ...OPEN_FILTER, show: 'parts' });
  });

  it('keeps the sheet open through a choice made in the dropdown, and reports it', () => {
    const { onChange } = renderOpen();

    fireEvent.click(screen.getByRole('combobox', { name: /integration/iu }));

    const option = screen.getByRole('option', { name: 'Shelly' });

    // The document sees the press before the click: what the sheet's own listener sees.
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith({ ...OPEN_FILTER, vendorId: 'shelly' });
    expect(screen.getByRole('group', { name: /narrow/iu })).toBeTruthy();
  });

  it('turns the linked ones on, and resets every facet but the search', () => {
    const { onChange } = renderOpen(CHOICES, { ...OPEN_FILTER, search: 'lamp', areaKey: 'study' });

    fireEvent.click(screen.getByRole('switch', { name: 'Reached two ways' }));

    expect(onChange).toHaveBeenCalledWith({
      ...OPEN_FILTER,
      search: 'lamp',
      areaKey: 'study',
      isLinked: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(onChange).toHaveBeenLastCalledWith({ ...OPEN_FILTER, search: 'lamp' });
  });

  it('shuts on a press anywhere else', () => {
    renderOpen();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('group', { name: /narrow/iu })).toBeNull();
  });
});
