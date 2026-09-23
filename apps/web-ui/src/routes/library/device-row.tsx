/**
 * One device in the registry, and - opened - the entities it exposes, each with what it reads.
 *
 * The row is a button: the whole width toggles, because the chevron alone is a small target for
 * a row whose only action is opening. Inside, every entity is one line - its icon, its name, the
 * tags on it, what it can do, what it reads, and a spanner to change the first three - and the
 * reading is the live one whenever the channel has spoken, so a printer warming up is a number
 * climbing on this page rather than a number frozen at whatever it was when the page loaded.
 *
 * The address - `sensor.shelly_bench_relay_current` - is not printed. It is what automations and
 * history name an entity by, not what a person recognises it by; it is still what the search
 * finds, it sits on the name as a tooltip, and the dialog shows it as a fact.
 */
import type { DeviceView, EntityView, IconView, TagView } from '@nebula-home/contracts';
import { isNumericSensorClass, sensorClassLabel } from '@nebula-home/contracts';
import { Badge, cn, IconButton, TagChip } from '@nebula-home/ui';

import { ChevronIcon, WrenchIcon } from '@/components/icons';
import { relativeTime } from '@/lib/format-time';
import { type DeviceStanding, type Reading } from '@/library/entity-reading';
import { DeviceIcon } from '@/routes/library/device-icon';

/**
 * The column widths, shared by the header and every row so they line up.
 *
 * The name, the vendor and the area share the room that is left after the fixed columns, the
 * name taking the most: a fixed width for the two would leave the name a few letters on a
 * narrow window, and the name is what a row is recognised by.
 */
export const DEVICE_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 ' +
  'md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_64px_104px_88px_30px] ' +
  'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_64px_104px_88px_30px]';

/** One tag on an entity, with the icon it is drawn by resolved. */
export type TagLine = {
  readonly tag: TagView;

  /** The catalogue's icon for the tag, once read; undefined for none, and while reading. */
  readonly icon: IconView | undefined;
};

/** One entity of the device, with its reading, its icon and its tags resolved. */
export type EntityLine = {
  readonly entity: EntityView;
  readonly reading: Reading;

  /** The catalogue's icon for it, once read; undefined for none, and while reading. */
  readonly icon: IconView | undefined;

  /** The tags on it, in the order the field lists them. */
  readonly tags: readonly TagLine[];
};

/** What one row needs. */
export type DeviceRowProps = {
  readonly device: DeviceView;

  /** The vendor's name as the catalogue has it, or its id while the catalogue is away. */
  readonly vendorName: string;

  /** The device's icon, once the catalogue has answered. */
  readonly icon: IconView | undefined;

  /** Its entities, with what each reads right now. */
  readonly lines: readonly EntityLine[];

  /** Whether it is reporting, and when it was last heard from. */
  readonly standing: DeviceStanding;

  /** Whether the entities are shown. */
  readonly isOpen: boolean;

  /** Called to open or shut it. */
  readonly onToggle: () => void;

  /** The moment "last seen" is measured against. */
  readonly now: Date;

  /** Whether the entities may be configured; false hides the spanner on each. */
  readonly canEditEntities: boolean;

  /** Called with the entity whose spanner was pressed. */
  readonly onEditEntity: (entity: EntityView) => void;
};

/** What one entity line needs. */
type EntityRowProps = {
  readonly line: EntityLine;

  /** Whether the spanner is drawn. */
  readonly canEdit: boolean;

  /** Called when the spanner is pressed. */
  readonly onEdit: () => void;
};

/**
 * Renders one entity line.
 *
 * On a wide window: icon, name with its tags, capabilities, reading, spanner, on one line. On
 * a phone the name and the reading share the first line and the capabilities wrap under them,
 * so the two things read first stay first.
 *
 * @param props - See {@link EntityRowProps}.
 * @returns The line.
 */
function EntityRow(props: EntityRowProps) {
  const { line, canEdit, onEdit } = props;
  const { entity, reading, icon, tags } = line;
  const classLabel = sensorClassLabel(entity.deviceClass);
  const isCatalogSensor = isNumericSensorClass(entity.deviceClass);
  const sensorFigure = reading.sensorFigure;
  const shownCapabilities = isCatalogSensor
    ? entity.capabilities.filter((capability) => capability.capability !== 'sensor_numeric')
    : entity.capabilities;

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 rounded-field border border-border face-sunk py-2 pr-2 pl-3 md:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]">
      <DeviceIcon icon={icon} size={18} className="text-foreground-muted" />
      {/*
       * The tags sit with the name, on the left: they are part of what the entity is called,
       * where what it can do sits on the right. Glyph-only here - a row has room for several
       * glyphs beside a name where it has none for several words.
       */}
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className="truncate text-ui font-medium text-foreground"
          title={entity.entityId}
          data-entity-id={entity.entityId}
        >
          {entity.name}
        </span>
        {tags.map(({ tag, icon: tagIcon }) => (
          <TagChip key={tag.id} color={tag.color} icon={tagIcon} size="small" reveal="hover">
            {tag.name}
          </TagChip>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-1.5 max-md:order-4 max-md:col-span-3 max-md:col-start-2 md:justify-end">
        {isCatalogSensor && classLabel !== undefined ? (
          <Badge tone="neutral" size="small">
            {classLabel}
          </Badge>
        ) : null}
        {shownCapabilities.map((capability) => (
          <Badge key={capability.capability} tone="accent" size="small">
            {capability.capability}
          </Badge>
        ))}
        {entity.isHidden ? (
          <Badge tone="neutral" size="small">
            hidden
          </Badge>
        ) : null}
      </span>
      <span
        className={cn(
          'whitespace-nowrap',
          reading.isAvailable ? 'text-foreground' : 'text-foreground-subtle line-through',
        )}
        title={reading.at === null ? 'Never reported' : `Reported ${reading.at.toLocaleString()}`}
        data-live={reading.isLive ? 'true' : undefined}
      >
        {sensorFigure !== null ? (
          <span className="inline-flex items-baseline gap-1">
            <span className="font-mono text-ui tabular">{sensorFigure.figure}</span>
            {sensorFigure.unit !== null && sensorFigure.unit !== '' ? (
              <span className="text-caption text-foreground-subtle">{sensorFigure.unit}</span>
            ) : null}
          </span>
        ) : (
          <span className="font-mono text-ui tabular">{reading.text}</span>
        )}
      </span>
      <span className="flex size-7 items-center justify-center">
        {canEdit ? (
          <IconButton
            variant="bare"
            size="small"
            label={`Configure ${entity.name}`}
            className="text-foreground-subtle hover:text-foreground"
            onClick={onEdit}
          >
            <WrenchIcon width="15" height="15" />
          </IconButton>
        ) : null}
      </span>
    </li>
  );
}

/**
 * Renders one device.
 *
 * @param props - See {@link DeviceRowProps}.
 * @returns The row, and its entities when open.
 */
export function DeviceRow(props: DeviceRowProps) {
  const {
    device,
    vendorName,
    icon,
    lines,
    standing,
    isOpen,
    onToggle,
    now,
    canEditEntities,
    onEditEntity,
  } = props;
  const isDisabled = device.state === 'disabled';
  const make = [device.manufacturer, device.model].filter(Boolean).join(' ');
  const subtitle = make === '' ? (device.externalId ?? device.id) : make;

  return (
    <li className="border-b border-border-soft last:border-b-0">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className={cn(
          DEVICE_COLUMNS,
          'w-full px-4 py-3 text-left transition-colors hover:bg-surface-lit focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
          isOpen ? 'bg-sunk' : undefined,
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <DeviceIcon icon={icon} className="text-foreground-muted" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-title font-medium text-foreground">{device.name}</span>
            <span className="truncate text-caption text-foreground-subtle">{subtitle}</span>
          </span>
        </span>

        <span className="hidden truncate text-ui text-foreground-muted md:block">{vendorName}</span>

        <span className="hidden truncate text-ui text-foreground-muted lg:block">
          {device.areaName ?? '—'}
        </span>

        <span className="hidden font-mono text-ui text-foreground-muted tabular md:block">
          {lines.length}
        </span>

        <span className="hidden md:block">
          <Badge tone={isDisabled ? 'neutral' : standing.isReporting ? 'success' : 'warning'}>
            {isDisabled ? 'disabled' : standing.isReporting ? 'Reporting' : 'Silent'}
          </Badge>
        </span>

        <span className="hidden text-ui text-foreground-subtle tabular md:block">
          {standing.lastSeenAt === null ? 'never' : relativeTime(standing.lastSeenAt, now)}
        </span>

        <span className="flex items-center justify-end gap-2 text-foreground-subtle">
          <span className="md:hidden">
            <Badge
              tone={isDisabled ? 'neutral' : standing.isReporting ? 'success' : 'warning'}
              size="small"
            >
              {isDisabled ? 'disabled' : standing.isReporting ? 'Reporting' : 'Silent'}
            </Badge>
          </span>
          <ChevronIcon isOpen={isOpen} />
        </span>
      </button>

      {isOpen ? (
        <ul className="flex flex-col gap-1.5 bg-sunk px-4 pt-1 pb-3.5">
          {lines.length === 0 ? (
            <li className="text-caption text-foreground-subtle">No entities.</li>
          ) : (
            lines.map((line) => (
              <EntityRow
                key={line.entity.entityId}
                line={line}
                canEdit={canEditEntities}
                onEdit={() => {
                  onEditEntity(line.entity);
                }}
              />
            ))
          )}
        </ul>
      ) : null}
    </li>
  );
}
