/**
 * The list and level rules every kind of thing shares (canvas `N-Entity-Index-Fields`): a short
 * list is a segmented row, a longer one chips, a long one five chips and "more" with the chosen
 * one always among the five; up to five levels are named, up to ten numbered, more a slider.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ListViewContext, OptionList } from '@/routes/library/entity/sheet/parts/option-list';
import { LevelSteps } from '@/routes/library/entity/sheet/parts/sheet-controls';

/**
 * Names for a list.
 *
 * @param count - How many.
 * @returns "Option 1", "Option 2"...
 */
function names(count: number): { value: string }[] {
  return [...Array.from({ length: count }).keys()].map((index) => ({
    value: `Option ${String(index + 1)}`,
  }));
}

describe('a list of names', () => {
  it('is one segmented row up to four, chips up to eight', () => {
    const { rerender } = render(
      <OptionList
        title="Preset"
        options={names(4)}
        value="Option 2"
        onPick={vi.fn()}
        tone="cyan"
      />,
    );

    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.queryByText(/more/u)).toBeNull();

    rerender(
      <OptionList title="Preset" options={names(8)} value={null} onPick={vi.fn()} tone="cyan" />,
    );

    expect(screen.getAllByRole('radio')).toHaveLength(8);
    expect(screen.queryByText(/more/u)).toBeNull();
  });

  it('shows five of nine or more, the chosen one among them, and opens the rest', () => {
    const open = vi.fn();

    render(
      <ListViewContext value={open}>
        <OptionList
          title="Preset"
          options={names(12)}
          value="Option 10"
          onPick={vi.fn()}
          tone="cyan"
        />
      </ListViewContext>,
    );

    const shown = screen.getAllByRole('radio');

    expect(shown).toHaveLength(5);
    expect(screen.getByRole('radio', { name: /Option 10/u }).getAttribute('aria-checked')).toBe(
      'true',
    );

    fireEvent.click(screen.getByText('+7 more'));

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Preset', value: 'Option 10' }),
    );
  });
});

describe('a pick', () => {
  it('shows at once, before the device says so', () => {
    const send = vi.fn();

    render(
      <OptionList title="Preset" options={names(6)} value="Option 1" onPick={send} tone="cyan" />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Option 3/u }));

    expect(send).toHaveBeenCalledWith('Option 3');
    expect(screen.getByRole('radio', { name: /Option 3/u }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});

describe('a bar of levels', () => {
  it('names up to five, numbers up to ten, and slides beyond', () => {
    const levels = (count: number) =>
      [...Array.from({ length: count }).keys()].map((index) => ({
        value: `l${String(index)}`,
        label: `Level ${String(index)}`,
      }));
    const { rerender } = render(
      <LevelSteps title="Suction" levels={levels(5)} value="l2" onPick={vi.fn()} tone="cyan" />,
    );

    expect(screen.getByText('Level 2')).toBeTruthy();

    rerender(
      <LevelSteps title="Suction" levels={levels(8)} value="l2" onPick={vi.fn()} tone="cyan" />,
    );

    expect(screen.queryByText('Level 2')).toBeNull();
    expect(screen.getByText('3')).toBeTruthy();

    rerender(
      <LevelSteps title="Suction" levels={levels(12)} value="l2" onPick={vi.fn()} tone="cyan" />,
    );

    expect(screen.getByRole('slider', { name: 'Suction' })).toBeTruthy();
  });
});
