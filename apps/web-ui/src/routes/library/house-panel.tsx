/**
 * The house at the top of the areas page: its name and icon, where it stands, and how much of
 * the map around it is on disk.
 *
 * The map's state is a sentence with a number in it - "12 of 180 tiles on disk" - rather than a
 * bar, because what the person wants to know is whether the map will be there when the
 * internet is not, and a number answers that where a bar only suggests it. The button to fetch
 * the rest is there for the day a fetch failed halfway, or the buffer was cleared by hand.
 */
import type { AreaView, TileCacheStatus } from '@nebula-home/contracts';
import { Badge, Button } from '@nebula-home/ui';

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
  readonly isPreparing: boolean;

  /** Whether the controls that change things are drawn. */
  readonly canEdit: boolean;

  /** Called when the house is to be configured. */
  readonly onEdit: () => void;

  /** Called when a floor is to be added. */
  readonly onAddFloor: () => void;

  /** Called when the map around the house is to be fetched. */
  readonly onPrepareMap: () => void;
};

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
  const { house, icons, tiles, isPreparing, canEdit, onEdit, onAddFloor, onPrepareMap } = props;
  const isPlaced = house.latitude !== null && house.longitude !== null;

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

      {isPlaced ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-border-soft bg-surface px-4 py-3">
          <p className="text-ui text-foreground-muted">
            {isPreparing
              ? 'Preparing the offline map…'
              : tiles === undefined
                ? 'Reading the offline map…'
                : tiles.cached >= tiles.total
                  ? `Offline map ready: ${String(tiles.total)} tiles on disk.`
                  : `Offline map: ${String(tiles.cached)} of ${String(tiles.total)} tiles on disk.`}
          </p>
          {canEdit ? (
            <Button size="compact" variant="ghost" isBusy={isPreparing} onClick={onPrepareMap}>
              Prepare offline map
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
