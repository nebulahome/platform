/**
 * The parts a detail page and a long list are built from: tabs that move with the arrow keys, a
 * health card that says a problem in words as well as colour, a menu that gives the focus back, a
 * pager that keeps its shape, and a button that acts only once held.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Checkbox } from './checkbox.js';
import { FilterChips } from './filter-chips.js';
import { HealthCard, HealthStrip } from './health-strip.js';
import { HoldButton } from './hold-button.js';
import { OverflowMenu } from './overflow-menu.js';
import { pageSlots, TableFooter } from './pagination.js';
import { TabPanel, Tabs } from './tabs.js';

describe('Tabs', () => {
  it('chooses with the arrow keys and names each panel by its tab', () => {
    const onChange = vi.fn();

    render(
      <>
        <Tabs
          label="Integration"
          idPrefix="vendor"
          value="overview"
          onChange={onChange}
          items={[
            { id: 'overview', label: 'Overview' },
            { id: 'devices', label: 'Devices', count: 2 },
          ]}
        />
        <TabPanel idPrefix="vendor" id="overview">
          The overview
        </TabPanel>
      </>,
    );

    const overview = screen.getByRole('tab', { name: 'Overview' });
    expect(overview.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Overview' }).textContent).toBe('The overview');

    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('devices');

    fireEvent.keyDown(overview, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('devices');
  });
});

describe('HealthCard', () => {
  it('says a failure in its word, and offers the one action that fixes it', () => {
    render(
      <HealthStrip>
        <HealthCard
          label="Runtime"
          tone="danger"
          value="Failed"
          detail="Exited with code 1"
          action={<button type="button">Open the log</button>}
        />
      </HealthStrip>,
    );

    expect(screen.getByRole('region', { name: 'Health' })).toBeTruthy();
    expect(screen.getByText('Failed').className).toContain('text-danger');
    expect(screen.getByRole('button', { name: 'Open the log' })).toBeTruthy();
  });
});

describe('OverflowMenu', () => {
  it('opens on the first choice, closes on Escape and gives the focus back', () => {
    const onRemove = vi.fn();

    render(
      <OverflowMenu
        items={[
          { label: 'Restart', onSelect: vi.fn() },
          { label: 'Remove', tone: 'danger', onSelect: onRemove },
        ]}
      />,
    );

    const more = screen.getByRole('button', { name: 'More' });
    fireEvent.click(more);
    expect(document.activeElement?.textContent).toBe('Restart');

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Remove');

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);

    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('draws nothing when there is nothing in it', () => {
    const { container } = render(<OverflowMenu items={[]} />);

    expect(container.childElementCount).toBe(0);
  });
});

describe('the pager', () => {
  it('shows every page up to seven, then the ends and the pages around the current one', () => {
    expect(pageSlots(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageSlots(1, 8)).toEqual([1, 2, 'gap', 8]);
    expect(pageSlots(5, 12)).toEqual([1, 'gap', 4, 5, 6, 'gap', 12]);
    expect(pageSlots(3, 8)).toEqual([1, 2, 3, 4, 'gap', 8]);
    expect(pageSlots(8, 8)).toEqual([1, 'gap', 7, 8]);
  });

  it('says which rows these are and moves a page on', () => {
    const onPage = vi.fn();

    render(<TableFooter page={3} size={20} total={148} onPage={onPage} />);

    expect(screen.getByText('41–60')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenCalledWith(4);
    expect(screen.getByRole('button', { name: 'Page 3' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});

describe('HoldButton', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('acts only once it has been held long enough', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] });
    const onConfirm = vi.fn();

    render(<HoldButton onConfirm={onConfirm}>Hold to unlock</HoldButton>);
    const button = screen.getByRole('button', { name: 'Hold to unlock' });

    fireEvent.pointerDown(button);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.pointerUp(button);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.pointerDown(button);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('filters', () => {
  it('lists the filters on, takes one off, and clears them all', () => {
    const onRemove = vi.fn();
    const onClearAll = vi.fn();

    render(
      <FilterChips
        filters={[{ id: 'status', key: 'Status', value: 'Running', onRemove }]}
        summary="4 of 9 shown"
        onClearAll={onClearAll}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove Status Running' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('reads a partly ticked group as mixed', () => {
    render(<Checkbox label="Status" isChecked={false} isMixed count={6} onChange={vi.fn()} />);

    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: /Status/u });
    expect(box.indeterminate).toBe(true);
  });
});
