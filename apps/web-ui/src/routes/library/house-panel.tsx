/**
 * The house at the top of the areas page: its name and icon, where it stands, and whether the
 * map around it is on disk.
 *
 * Fetching the map is the server's own business - it starts the moment the house is placed or
 * moved - so there is nothing here to press. What is shown is a tag: "Map cached" once every
 * tile is on disk, the count while some are missing, and "Caching map" while a fetch runs.
 */
import type { AreaView, TileCacheStatus } from '@nebulahome/contracts';
import { Badge, Button } from '@nebulahome/ui';

import type { DeviceIcons } from '@/routes/library/device-icon';
import { DeviceIcon } from '@/routes/library/device-icon';

/** The catalogue icon every house is drawn with. */
export const HOUSE_ICON = 'house';

/** What the panel needs. */
export type HousePanelProps = {
  readonly house: AreaView;

  /** The catalogue's icons, for the house glyph. */
  readonly icons: DeviceIcons;

  /** How much of the map around the house is on disk; undefined while unread or unplaced. */
  readonly tiles: TileCacheStatus | undefined;

  /** Whether the map around the house is being fetched right now. */
  readonly isCaching: boolean;

  /** Whether the controls that change things are drawn. */
  readonly canEdit: boolean;

  /** Called when the house is to be configured. */
  readonly onEdit: () => void;

  /** Called when a floor is to be added. */
  readonly onAddFloor: () => void;
};

/** What the map tag says, and in which tone. */
type MapTag = {
  readonly label: string;
  readonly tone: 'success' | 'neutral';
};

/**
 * Says how much of the map around the house is on disk.
 *
 * @param tiles - What the server reports, or undefined while it has not.
 * @param isCaching - Whether a fetch is running.
 * @returns The tag, or null when there is nothing to say yet.
 */
function mapTagOf(tiles: TileCacheStatus | undefined, isCaching: boolean): MapTag | null {
  if (isCaching) {
    return { label: 'Caching map…', tone: 'neutral' };
  }

  if (tiles === undefined) {
    return null;
  }

  return tiles.cached >= tiles.total
    ? { label: 'Map cached', tone: 'success' }
    : { label: `Map ${String(tiles.cached)}/${String(tiles.total)}`, tone: 'neutral' };
}

/**
 * Says where the house stands.
 *
 * @param house - The house.
 * @returns The coordinates, or that it is not placed.
 */
function describePosition(house: AreaView): string {
  return house.latitude === null || house.longitude === null
    ? 'Not placed on the map yet.'
    : `${house.latitude.toFixed(4)}, ${house.longitude.toFixed(4)}`;
}

/**
 * Renders the panel.
 *
 * @param props - See {@link HousePanelProps}.
 * @returns The panel.
 */
export function HousePanel(props: HousePanelProps) {
  const { house, icons, tiles, isCaching, canEdit, onEdit, onAddFloor } = props;
  const isPlaced = house.latitude !== null && house.longitude !== null;
  const mapTag = isPlaced ? mapTagOf(tiles, isCaching) : null;

  return (
    <section
      aria-labelledby="house-name"
      className="flex flex-col gap-4 rounded-panel border border-border face-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <DeviceIcon icon={icons.get(HOUSE_ICON)} size={28} className="text-foreground" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="house-name" className="truncate text-subhead font-semibold text-foreground">
              {house.name}
            </h2>
            <p className="text-caption text-foreground-subtle">{describePosition(house)}</p>
          </div>
          <Badge tone={isPlaced ? 'success' : 'neutral'} size="small">
            {isPlaced ? 'Placed' : 'Not placed'}
          </Badge>
          {mapTag === null ? null : (
            <span title="The map around the house, kept on the server for the days the internet is away">
              <Badge tone={mapTag.tone} size="small">
                {mapTag.label}
              </Badge>
            </span>
          )}
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button size="compact" variant="ghost" onClick={onEdit}>
              Configure
            </Button>
            <Button size="compact" onClick={onAddFloor}>
              Add floor
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
