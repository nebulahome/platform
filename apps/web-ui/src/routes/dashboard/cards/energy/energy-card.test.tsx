/**
 * The energy card: the parts it draws for the meters it has, and the day under a large one or
 * beside a square one.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HOUSE_STYLES, type HouseStyle } from '@nebulahome/contracts';

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
    expect(screen.getByText('Energy', { selector: 'span.text-ui' })).toBeTruthy();
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

      // One sheet of glass on a pitched roof - on the American house, the garage's only - and one
      // per row on a flat roof.
      expect(container.querySelectorAll('polygon.fill-house-panel').length, style).toBe(
        { european: 1, american: 1, arabic: 3 }[style],
      );
      expect(screen.getAllByText('SOLAR').length, style).toBeGreaterThan(0);
      cleanup();
    }
  });

  it('gives the American house its open garage, empty, and only that house', () => {
    const american = renderCard(
      { solar: 5200, battery: null, level: null, grid: 0 },
      'tall',
      'american',
    );
    const inside = american.querySelector('polygon.fill-house-interior');

    expect(american.querySelectorAll('polygon.fill-house-interior')).toHaveLength(1);
    // The garage as the picture has it, with nothing on its walls: no charger, no cable.
    expect(inside?.parentElement?.querySelectorAll('.fill-house-device, path')).toHaveLength(0);
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

  it('makes the American house proper larger than its garage, with its front door in view', () => {
    const { annex, wallHeight, ridgeHeight, shortSide, focus } = geometryFor('american');

    if (annex === null) {
      throw new Error('The American house has no house proper');
    }

    // Two storeys to the garage's one, and deeper.
    expect(annex.wallHeight).toBeGreaterThan(wallHeight * 1.5);
    expect(annex.ridgeHeight).toBeGreaterThan(ridgeHeight);
    expect(annex.shortSide).toBeGreaterThan(shortSide);

    // The door is on the stretch of its wall that reaches past the garage, and the card keeps it.
    const door = annex.onWall(0.14, 0);

    expect(door.x).toBeGreaterThanOrEqual(focus.x);
    expect(door.x).toBeLessThan(geometryFor('american').corners.left.x);
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

  it('writes every figure inside the drawing, and none over another', () => {
    for (const style of HOUSE_STYLES) {
      const container = renderCard(
        { solar: 11_100, battery: -8300, level: 85, grid: -3100 },
        'tall',
        style,
      );
      const svg = container.querySelector('svg[role="img"]');
      const [, , width = 0] = (svg?.getAttribute('viewBox') ?? '').split(' ').map(Number);
      const figures = [...container.querySelectorAll('svg text.font-semibold')].map((text) => ({
        x: Number(text.getAttribute('x')),
        y: Number(text.getAttribute('y')),
        isEnd: text.getAttribute('text-anchor') === 'end',
      }));

      expect(figures, style).toHaveLength(4);

      for (const figure of figures) {
        expect(figure.x, style).toBeGreaterThanOrEqual(0);
        expect(figure.x, style).toBeLessThanOrEqual(width);
      }

      // Two figures on one line are apart: starts, or an end and a start, never together.
      for (const [index, figure] of figures.entries()) {
        for (const other of figures.slice(index + 1)) {
          if (figure.y === other.y) {
            expect(Math.abs(figure.x - other.x), style).toBeGreaterThan(40);
          }
        }
      }

      cleanup();
    }
  });

  it('sets the day beside the house on a square card', () => {
    const container = renderCard(
      { solar: 5200, battery: null, level: null, grid: -3100 },
      'square',
    );

    expect(screen.getByText('Energy', { selector: 'span.text-ui' })).toBeTruthy();
    expect(screen.getByText('Impact')).toBeTruthy();
    // In a column: the lines stacked, not a row under the house.
    expect(container.querySelector('.grid-cols-2')).toBeNull();
  });
});
