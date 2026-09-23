/**
 * The filter sheet on the devices page, with the integration facet a dropdown.
 *
 * The dropdown's list is portalled out of the sheet, so a click on one of its options lands
 * outside the sheet as far as the document is concerned - exactly what shuts the sheet. That the
 * sheet stays open through a choice is the behaviour worth pinning; the rest is a radio group.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OPEN_FILTER } from '@/library/device-filters';

import { DeviceFilterButton } from './device-filter';

const VENDORS = [
  { value: 'bambu-lab', label: 'Bambu Lab' },
  { value: 'shelly', label: 'Shelly' },
];

/**
 * Renders the button with its sheet open.
 *
 * @returns The change spy.
 */
const AREAS = [
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'study', label: 'Study' },
];

function renderOpen(areas: readonly { value: string; label: string }[] = []) {
  const onChange = vi.fn();

  render(
    <DeviceFilterButton filter={OPEN_FILTER} vendors={VENDORS} areas={areas} onChange={onChange} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /filter/iu }));

  return { onChange };
}

describe('DeviceFilterButton', () => {
  it('offers the integrations as a dropdown, any integration first', () => {
    renderOpen();

    const select = screen.getByRole('combobox', { name: /integration/iu });

    expect(select.textContent).toContain('Any integration');

    fireEvent.click(select);

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Any integration',
      'Bambu Lab',
      'Shelly',
    ]);
  });

  it('offers the rooms as a dropdown too, any room first, and reports the one picked', () => {
    const { onChange } = renderOpen(AREAS);

    const select = screen.getByRole('combobox', { name: /^Area/u });

    expect(select.textContent).toContain('Any area');
    expect(screen.queryByRole('radiogroup', { name: 'Area' })).toBeNull();

    fireEvent.click(select);

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Any area',
      'Kitchen',
      'Study',
    ]);

    const option = screen.getByRole('option', { name: 'Study' });

    fireEvent.pointerDown(option);
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith({ ...OPEN_FILTER, areaKey: 'study' });
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

  it('shuts on a press anywhere else', () => {
    renderOpen();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('group', { name: /narrow/iu })).toBeNull();
  });
});
