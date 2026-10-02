/**
 * The models a device can be added as: grouped by series when the vendor sells its models so,
 * whichever driver runs each, and by driver otherwise.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { IntegrationVendorView, ModelChoice } from '@nebulahome/contracts';

import { ModelList } from '@/routes/library/model-list';

/**
 * The choices of one driver.
 *
 * @param driverId - The driver.
 * @param series - Each model, and the series the driver puts it in; null for none.
 * @returns The choices, in the bundle's order.
 */
function choicesOf(
  driverId: string,
  series: Readonly<Record<string, string | null>>,
): ModelChoice[] {
  return Object.entries(series).map(([model, each]) => ({
    kind: `bambu-lab/${driverId}`,
    driverId,
    model,
    series: each,
  }));
}

/** Bambu Lab's printers, as its four drivers list them. */
const PRINTERS: readonly ModelChoice[] = [
  ...choicesOf('printer', { X1: 'X series', X1C: 'X series', X1E: 'X series' }),
  ...choicesOf('printer-p2s-h2s', { P2S: 'P series', H2S: 'H series' }),
  ...choicesOf('printer-dual-nozzle', {
    H2D: 'H series',
    'H2D Pro': 'H series',
    H2C: 'H series',
    X2D: 'X series',
  }),
  ...choicesOf('printer-p1-a1', {
    P1P: 'P series',
    P1S: 'P series',
    A1: 'A series',
    'A1 mini': 'A series',
    A2L: 'A series',
  }),
];

/** The drivers' names, which a list by series does not show. */
const VENDOR: Pick<IntegrationVendorView, 'drivers'> = {
  drivers: [
    ['printer', 'X1 series printer'],
    ['printer-p2s-h2s', 'P2S and H2S printer'],
    ['printer-dual-nozzle', 'Dual-nozzle printer'],
    ['printer-p1-a1', 'P1, A1 and A2 series printer'],
  ].map(([driverId = '', name = '']) => ({
    id: `bambu-lab/${driverId}`,
    vendorId: 'bambu-lab',
    driverId,
    name,
    transport: 'mqtt',
    models: [],
    setup: {
      transport: { constants: {}, fields: [] },
      options: { constants: {}, fields: [] },
    },
  })),
};

/**
 * The headings of the list, and the models under each, in the order shown.
 *
 * @returns Each group's heading and its models.
 */
function shownGroups(): [string, string[]][] {
  return within(screen.getByRole('listbox'))
    .getAllByRole('group')
    .flatMap((group) => {
      const heading = group.getAttribute('aria-label');

      return heading === null
        ? []
        : [
            [
              heading,
              within(group)
                .getAllByRole('option')
                .map((option) => option.textContent),
            ],
          ];
    });
}

describe('ModelList', () => {
  it('groups the printers by series, whichever driver runs each, in counting order', () => {
    render(<ModelList choices={PRINTERS} value={undefined} vendor={VENDOR} onPick={vi.fn()} />);

    expect(shownGroups()).toEqual([
      ['A series', ['A1', 'A1 mini', 'A2L']],
      ['H series', ['H2C', 'H2D', 'H2D Pro', 'H2S']],
      ['P series', ['P1P', 'P1S', 'P2S']],
      ['X series', ['X1', 'X1C', 'X1E', 'X2D']],
    ]);
    expect(screen.queryByText('Dual-nozzle printer')).toBeNull();
  });

  it('moves down the list the way it is shown', () => {
    const onPick = vi.fn();
    const h2s = PRINTERS.find((choice) => choice.model === 'H2S');

    render(<ModelList choices={PRINTERS} value={h2s} vendor={VENDOR} onPick={onPick} />);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });

    // After the H2S, the next the eye reads: the P series' first, not the driver's next model.
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ model: 'P1P' }));
  });

  it('finds a printer by its series', () => {
    render(<ModelList choices={PRINTERS} value={undefined} vendor={VENDOR} onPick={vi.fn()} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), {
      target: { value: 'H series' },
    });

    // The dual-nozzle H2s are found by their series alone: neither their names nor their
    // driver's say it.
    expect(shownGroups()).toContainEqual(['H series', ['H2C', 'H2D', 'H2D Pro', 'H2S']]);
  });

  it('groups the models of a vendor without series by driver, in the bundle’s order', () => {
    const plain = PRINTERS.slice(0, 5).map((choice) => ({ ...choice, series: null }));

    render(<ModelList choices={plain} value={undefined} vendor={VENDOR} onPick={vi.fn()} />);

    expect(shownGroups()).toEqual([
      ['X1 series printer', ['X1', 'X1C', 'X1E']],
      ['P2S and H2S printer', ['P2S', 'H2S']],
    ]);
  });
});
