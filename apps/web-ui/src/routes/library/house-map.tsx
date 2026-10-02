/**
 * The map the house is placed on.
 *
 * Leaflet, driven by hand inside one effect: the map is an imperative thing with its own DOM,
 * and an effect that creates it on mount and removes it on unmount is the honest way to hold
 * one (RULES.md 15.2). Nothing else about it is React's business - the tiles it asks for, the
 * click it turns into a position, the mark it draws - so nothing else is state here.
 *
 * The tiles come from the API, not from a tile server. A plain `<img>` cannot carry the
 * session's credential, so the layer below fetches each tile through the client and hands the
 * picture to the image as a blob. That is also what makes the map work with the internet away:
 * the API serves the buffer it keeps on disk around the house.
 *
 * The house is a circle rather than a pin. Leaflet's pin is a picture the bundler has to be told
 * about, and a picture is not an icon from the catalogue either; a circle in the theme's colour
 * is drawn by the map itself and answers to the theme.
 */
import L from 'leaflet';
import { useEffect, useRef } from 'react';

import { cn } from '@nebulahome/ui';

import { apiBlob } from '@/lib/api-client';

import 'leaflet/dist/leaflet.css';
import './house-map.css';

/** Where the house stands. */
export type HousePosition = {
  readonly latitude: number;
  readonly longitude: number;
};

/** What the map needs. */
export type HouseMapProps = {
  /** Where the house stands, or null while it has not been placed. */
  readonly value: HousePosition | null;

  /** Called with where the map was clicked. */
  readonly onChange: (position: HousePosition) => void;

  /** Anything extra for the map's box. */
  readonly className?: string;
};

/** How close the map looks at a placed house. */
const PLACED_ZOOM = 16;

/** The whole world, for a house not yet placed. */
const WORLD_ZOOM = 2;

/** Where the world view is centred: mid-latitudes, where most houses are. */
const WORLD_CENTRE: [number, number] = [30, 10];

/** How many decimals a position keeps: six is a tenth of a metre. */
const POSITION_DECIMALS = 6;

/** How wide the mark on the house is. */
const MARK_RADIUS = 9;

/**
 * A tile layer whose tiles come through the API client, credential and all.
 */
class ApiTileLayer extends L.TileLayer {
  /**
   * Makes one tile: an image filled in once the picture has arrived.
   *
   * @param coords - Which tile.
   * @param done - Told when the picture is there, or why it is not.
   * @returns The image.
   */
  public override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('img');

    tile.alt = '';

    apiBlob(`/map/tiles/${String(coords.z)}/${String(coords.x)}/${String(coords.y)}`)
      .then((blob) => {
        const url = URL.createObjectURL(blob);

        tile.addEventListener('load', () => {
          URL.revokeObjectURL(url);
          done(undefined, tile);
        });
        tile.src = url;
      })
      .catch((error: unknown) => {
        done(error instanceof Error ? error : new Error(String(error)), tile);
      });

    return tile;
  }
}

/**
 * Rounds a coordinate to what is worth keeping.
 *
 * @param degrees - The coordinate.
 * @returns The coordinate, to a tenth of a metre.
 */
function round(degrees: number): number {
  return Number(degrees.toFixed(POSITION_DECIMALS));
}

/**
 * Reads the theme's primary colour, for the mark on the house.
 *
 * @returns The colour, as CSS has it.
 */
function primaryColour(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
}

/**
 * Renders the map.
 *
 * @param props - See {@link HouseMapProps}.
 * @returns The map's box.
 */
export function HouseMap(props: HouseMapProps) {
  const { value, onChange, className } = props;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const mark = useRef<L.CircleMarker | null>(null);

  // The latest handler, so the click listener registered once on mount always calls the
  // current one rather than the one from the first render.
  const latestOnChange = useRef(onChange);

  useEffect(() => {
    latestOnChange.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const element = container.current;

    if (element === null) {
      return undefined;
    }

    const created = L.map(element, { attributionControl: true });

    new ApiTileLayer('', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(created);
    created.on('click', (event: L.LeafletMouseEvent) => {
      latestOnChange.current({
        latitude: round(event.latlng.lat),
        longitude: round(event.latlng.lng),
      });
    });
    map.current = created;

    return () => {
      created.remove();
      map.current = null;
      mark.current = null;
    };
  }, []);

  useEffect(() => {
    const current = map.current;

    if (current === null) {
      return;
    }

    if (value === null) {
      mark.current?.remove();
      mark.current = null;
      current.setView(WORLD_CENTRE, WORLD_ZOOM);

      return;
    }

    const at: [number, number] = [value.latitude, value.longitude];

    if (mark.current === null) {
      mark.current = L.circleMarker(at, {
        radius: MARK_RADIUS,
        color: primaryColour(),
        weight: 3,
        fillOpacity: 0.35,
      });
      mark.current.addTo(current);
      current.setView(at, PLACED_ZOOM);
    } else {
      mark.current.setLatLng(at);
      current.panTo(at);
    }
  }, [value]);

  return (
    <div
      ref={container}
      role="application"
      aria-label="Map"
      className={cn(
        'h-72 w-full overflow-hidden rounded-field border border-border face-sunk',
        className,
      )}
    />
  );
}
