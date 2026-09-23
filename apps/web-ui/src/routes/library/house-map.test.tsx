/**
 * The map the house is placed on.
 *
 * Leaflet is stood in for - it draws on a canvas jsdom does not have - and what is checked is
 * the glue: a click on the map becomes a position, a position becomes a mark, and the map is
 * taken down with the component.
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HouseMap } from './house-map';

/** The handlers the fake map was given, by event. */
const handlers = new Map<string, (event: { latlng: { lat: number; lng: number } }) => void>();

const fakeMap = {
  setView: vi.fn(),
  on: vi.fn((event: string, handler: (event: { latlng: { lat: number; lng: number } }) => void) => {
    handlers.set(event, handler);
  }),
  remove: vi.fn(),
  addLayer: vi.fn(),
  getZoom: vi.fn(() => 2),
  panTo: vi.fn(),
};

const fakeMarker = {
  addTo: vi.fn(),
  setLatLng: vi.fn(),
  remove: vi.fn(),
};

vi.mock('leaflet', () => {
  /** Stands in for Leaflet's tile layer class, which the map subclasses. */
  class TileLayer {
    /**
     * Adds the layer to a map.
     *
     * @returns The layer.
     */
    public addTo(): this {
      return this;
    }
  }

  return {
    default: {
      map: vi.fn(() => fakeMap),
      circleMarker: vi.fn(() => fakeMarker),
      TileLayer,
    },
  };
});

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
});

describe('HouseMap', () => {
  it('turns a click on the map into a position, rounded to a metre or so', () => {
    const onChange = vi.fn();

    render(<HouseMap value={null} onChange={onChange} />);

    handlers.get('click')?.({ latlng: { lat: 45.46421234567, lng: 9.19000987654 } });

    expect(onChange).toHaveBeenCalledWith({ latitude: 45.464212, longitude: 9.19001 });
  });

  it('marks the house where it stands, and looks at it', () => {
    render(<HouseMap value={{ latitude: 45.4642, longitude: 9.19 }} onChange={vi.fn()} />);

    expect(fakeMarker.addTo).toHaveBeenCalledWith(fakeMap);
    expect(fakeMap.setView).toHaveBeenCalledWith([45.4642, 9.19], expect.any(Number));
  });

  it('shows the whole world while the house is not placed', () => {
    render(<HouseMap value={null} onChange={vi.fn()} />);

    expect(fakeMarker.addTo).not.toHaveBeenCalled();
    expect(fakeMap.setView).toHaveBeenCalledWith(expect.anything(), 2);
  });

  it('takes the map down with the component', () => {
    const { unmount } = render(<HouseMap value={null} onChange={vi.fn()} />);

    unmount();

    expect(fakeMap.remove).toHaveBeenCalledOnce();
  });
});
