/**
 * One floor of the house: its name and number, and the rooms on it with what is in each.
 *
 * A panel per floor rather than a tree with twisties: a house has a handful of floors, and
 * seeing every room of every floor at once is what the page is for. A room's row says how many
 * devices are in it, because that is what a room is for here - a device is put in a room, and
 * the row is where you see that it was.
 */
import type { AreaView } from '@nebulahome/contracts';
import { Badge, Button, IconButton, Panel } from '@nebulahome/ui';

import { WrenchIcon } from '@/components/icons';
import type { DeviceIcons } from '@/routes/library/device-icon';
import { DeviceIcon } from '@/routes/library/device-icon';

/** What the section needs. */
export type FloorSectionProps = {
  readonly floor: AreaView;

  /** The rooms on it, in the order they read. */
  readonly rooms: readonly AreaView[];

  /** The catalogue's icons, for the floor's and the rooms'. */
  readonly icons: DeviceIcons;

  /** Whether the controls that change things are drawn. */
  readonly canEdit: boolean;

  /** Called when the floor is to be configured. */
  readonly onEdit: () => void;

  /** Called when a room is to be added to it. */
  readonly onAddRoom: () => void;

  /** Called with the room to configure. */
  readonly onEditRoom: (room: AreaView) => void;
};

/**
 * Says what is in a room.
 *
 * @param room - The room.
 * @returns "2 devices", or "Nothing yet".
 */
function describeContents(room: AreaView): string {
  return room.deviceCount === 0
    ? 'Nothing yet'
    : `${String(room.deviceCount)} device${room.deviceCount === 1 ? '' : 's'}`;
}

/**
 * Renders the section.
 *
 * @param props - See {@link FloorSectionProps}.
 * @returns The section.
 */
export function FloorSection(props: FloorSectionProps) {
  const { floor, rooms, icons, canEdit, onEdit, onAddRoom, onEditRoom } = props;

  return (
    <Panel
      title={floor.name}
      action={
        <div className="flex items-center gap-2">
          {floor.level === null ? null : (
            <Badge tone="neutral" size="small">
              Floor {floor.level}
            </Badge>
          )}
          {canEdit ? (
            <>
              <IconButton
                variant="bare"
                size="medium"
                label={`Configure ${floor.name}`}
                onClick={onEdit}
              >
                <WrenchIcon width="15" height="15" />
              </IconButton>
              <Button size="compact" variant="ghost" onClick={onAddRoom}>
                Add room
              </Button>
            </>
          ) : null}
        </div>
      }
    >
      {rooms.length === 0 ? (
        <p className="px-4 py-3.5 text-ui text-foreground-muted">No rooms on this floor yet.</p>
      ) : (
        <ul>
          {rooms.map((room) => (
            <li
              key={room.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border-soft px-4 py-2.5 last:border-b-0"
            >
              <DeviceIcon
                icon={icons.get(room.icon ?? '')}
                size={20}
                className="text-foreground-muted"
              />
              <span className="truncate text-ui font-medium text-foreground">{room.name}</span>
              <span className="text-caption text-foreground-subtle tabular">
                {describeContents(room)}
              </span>
              <span className="flex size-7 items-center justify-center">
                {canEdit ? (
                  <IconButton
                    variant="bare"
                    size="small"
                    label={`Configure ${room.name}`}
                    onClick={() => {
                      onEditRoom(room);
                    }}
                  >
                    <WrenchIcon width="15" height="15" />
                  </IconButton>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
