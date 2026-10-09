/**
 * The block picker: a search narrows it, the arrows move through what can be taken, Enter takes
 * the lit one, and a block that cannot run yet is shown but cannot be picked.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BlockPickerModal } from './block-picker-modal';
import { ACTION_CHOICE_GROUPS } from './editor-choices';

/**
 * Renders the Then picker, open.
 *
 * @returns What it picked.
 */
function renderPicker(): ReturnType<typeof vi.fn> {
  const onPick = vi.fn();

  render(
    <BlockPickerModal
      isOpen
      title="Add an action"
      groups={ACTION_CHOICE_GROUPS}
      onClose={vi.fn()}
      onPick={onPick}
    />,
  );

  return onPick;
}

describe('BlockPickerModal', () => {
  it('offers actions and control blocks in two groups', () => {
    renderPicker();

    expect(screen.getByText('Actions')).toBeTruthy();
    expect(screen.getByText('Control')).toBeTruthy();
    expect(screen.getByRole('option', { name: /Set entity/u })).toBeTruthy();
  });

  it('narrows to what is searched for', () => {
    renderPicker();

    fireEvent.change(screen.getByPlaceholderText('Search blocks…'), { target: { value: 'wait' } });

    expect(screen.queryByRole('option', { name: /Set entity/u })).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('moves with the arrows and takes the lit one on Enter', () => {
    const onPick = renderPicker();
    const search = screen.getByPlaceholderText('Search blocks…');

    // Set entity is lit first; one to the right is Apply a scene.
    fireEvent.keyDown(search, { key: 'ArrowRight' });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledWith('scene');
  });

  it('shows a block that cannot run yet, and does not let it be picked', () => {
    const onPick = renderPicker();
    const notify = screen.getByRole('option', { name: /Notify/u });

    expect(notify.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(notify);
    expect(onPick).not.toHaveBeenCalled();
  });
});
