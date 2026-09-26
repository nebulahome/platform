/**
 * The energy card: the parts it draws for the meters it has, and the day under a large one.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HOUSE_STYLES, type HouseStyle } from '@nebula-home/contracts';

import { geometryFor } from '@/routes/dashboard/cards/energy/geometry';
import { energySample, energySampleCache, type SampleMeters } from '@/testing/energy-samples';

import { EnergyCard } from './energy-card';

/**
 * Renders a card for some meters.
 *
 * @param meters - What its meters read.
 * @param size - Its size.
 * @param houseStyle - Which house it draws.
 * @returns The rendered container.
 */
function renderCard(
  meters: SampleMeters,
  size: 'tall' | 'large' | 'square' = 'tall',
  houseStyle: HouseStyle = 'european',
): HTMLElement {
  const cache = energySampleCache();
  const { card, data } = energySample('test', meters, cache, size, houseStyle);

  return render(
    <QueryClientProvider client={cache}>
      <EnergyCard card={card} data={data} />
    </QueryClientProvider>,
  ).container;
}

describe('EnergyCard', () => {
  it('leads with what the house is doing, and reads every meter it has', () => {
    renderCard({ solar: 11_100, battery: -8300, level: 85, grid: 0 });

    expect(screen.getByText('Charging')).toBeTruthy();
    expect(screen.getByText('11.1 kW')).toBeTruthy();
    expect(screen.getByText('BATTERY · 85%')).toBeTruthy();
    expect(screen.getByText('2.8 kW')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /^Charging: panels making 11\.1 kilowatts/u }),
    ).toBeTruthy();
  });

  it('draws no panels and no battery for a house that has neither, and no impact', () => {
    renderCard({ solar: null, battery: null, level: null, grid: 750 });

    expect(screen.queryByText('SOLAR')).toBeNull();
    expect(screen.queryByText(/^BATTERY/u)).toBeNull();
    expect(screen.getByText('GRID')).toBeTruthy();
    expect(screen.getByText('Energy', { selector: 'span.text-title' })).toBeTruthy();
    // Wh early in the day, kWh later: the sample day runs up to now.
    expect(screen.getByText(/\d Wh used today|kWh used today/u)).toBeTruthy();
    expect(screen.queryByText('Impact')).toBeNull();
  });

  it('shows the day with panels as what they made and how much the house ran on itself', () => {
    renderCard({ solar: 5200, battery: null, level: null, grid: -3100 });

    expect(screen.getByText(/\d Wh generated today|kWh generated today/u)).toBeTruthy();
    expect(screen.getByText(/% self-powered today/u)).toBeTruthy();
  });

  it('draws every style of house with its panels and every figure', () => {
    for (const style of HOUSE_STYLES) {
      const container = renderCard(
        { solar: 5200, battery: -800, level: 60, grid: -3100 },
        'tall',
        style,
      );

      // One sheet of glass on a pitched roof - and one more on the American house proper,
      // behind its garage - and one per row on a flat roof.
      expect(container.querySelectorAll('polygon.fill-house-panel').length, style).toBe(
        { european: 1, american: 2, arabic: 3 }[style],
      );
      expect(screen.getAllByText('SOLAR').length, style).toBeGreaterThan(0);
      cleanup();
    }
  });

  it('gives the American house its open garage, and only that house', () => {
    const american = renderCard(
      { solar: 5200, battery: null, level: null, grid: 0 },
      'tall',
      'american',
    );

    expect(american.querySelectorAll('polygon.fill-house-interior')).toHaveLength(1);
    cleanup();

    const european = renderCard(
      { solar: 5200, battery: null, level: null, grid: 0 },
      'tall',
      'european',
    );

    expect(european.querySelectorAll('polygon.fill-house-interior')).toHaveLength(0);
  });

  it('draws the American house proper behind its garage wing, and nothing behind the others', () => {
    expect(geometryFor('american').annex).not.toBeNull();
    expect(geometryFor('european').annex).toBeNull();
    expect(geometryFor('arabic').annex).toBeNull();
  });

  it('draws every style in the same colours: shape and detail differ, the palette does not', () => {
    // The house's palette, shared by every style: nothing here is one style's own colour.
    const palette = new Set(
      [
        'wall',
        'wall-shade',
        'roof',
        'roof-edge',
        'plinth',
        'trim',
        'window',
        'window-frame',
        'ground',
        'interior',
        'panel',
        'panel-cell',
        'panel-frame',
        'device',
        'wire',
      ].flatMap((token) => [`fill-house-${token}`, `stroke-house-${token}`]),
    );

    for (const style of HOUSE_STYLES) {
      const container = renderCard(
        { solar: 5200, battery: -800, level: 60, grid: -3100 },
        'tall',
        style,
      );
      const used = [...container.querySelectorAll('svg [class]')]
        .flatMap((element) => (element.getAttribute('class') ?? '').split(' '))
        .filter((name) => /^(?:fill|stroke)-house-/u.test(name));

      expect(used.length, style).toBeGreaterThan(0);
      expect(
        used.filter((name) => !palette.has(name)),
        style,
      ).toEqual([]);
      cleanup();
    }
  });

  it('puts the panels in the middle of a pitched roof, with the same margin at both ends', () => {
    for (const style of ['european', 'american'] as const) {
      const { panels } = geometryFor(style);

      expect(panels.along[0], style).toBeCloseTo(1 - panels.along[1]);
    }
  });

  it('leaves the day off a square card', () => {
    renderCard({ solar: 5200, battery: null, level: null, grid: -3100 }, 'square');

    expect(screen.queryByText('Energy', { selector: 'span.text-title' })).toBeNull();
    expect(screen.queryByText('Impact')).toBeNull();
  });
});
