/**
 * The energy card: the parts it draws for the meters it has, and the day under a large one.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { energySample, energySampleCache, type SampleMeters } from '@/testing/energy-samples';

import { EnergyCard } from './energy-card';

/**
 * Renders a card for some meters.
 *
 * @param meters - What its meters read.
 * @param size - Its size.
 */
function renderCard(meters: SampleMeters, size: 'tall' | 'large' | 'square' = 'tall'): void {
  const cache = energySampleCache();
  const { card, data } = energySample('test', meters, cache, size);

  render(
    <QueryClientProvider client={cache}>
      <EnergyCard card={card} data={data} />
    </QueryClientProvider>,
  );
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

  it('leaves the day off a square card', () => {
    renderCard({ solar: 5200, battery: null, level: null, grid: -3100 }, 'square');

    expect(screen.queryByText('Energy', { selector: 'span.text-title' })).toBeNull();
    expect(screen.queryByText('Impact')).toBeNull();
  });
});
