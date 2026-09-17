/**
 * One device in the registry, and - opened - the entities it exposes, each with what it reads.
 *
 * The row is a button: the whole width toggles, because the chevron alone is a small target for
 * a row whose only action is opening. Inside, every entity is one line - the address in the mono
 * face, the name, what it can do, what it reads - and the reading is the live one whenever the
 * channel has spoken, so a printer warming up is a number climbing on this page rather than a
 * number frozen at whatever it was when the page loaded.
 */
import type { DeviceView, EntityView, IconView } from '@nebula-home/contracts';
import { Badge, cn } from '@nebula-home/ui';

import { ChevronIcon } from '@/components/icons';
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

/** One entity of the device, with its reading resolved. */
export type EntityLine = {
  readonly entity: EntityView;
  readonly reading: Reading;
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
};

/**
 * Renders one entity line.
 *
 * @param props - The entity and its reading.
 * @param props.line - The entity and its reading.
 * @returns The line.
 */
function EntityRow(props: { readonly line: EntityLine }) {
  const { entity, reading } = props.line;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-field border border-border face-sunk px-3 py-2 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto_auto]">
      {/* Never truncated: the address is what this page exists to show. It wraps instead. */}
      <span className="font-mono text-ui break-all text-foreground">{entity.entityId}</span>
      <span className="text-ui text-foreground-muted max-md:order-3 max-md:col-span-2">
        {entity.name}
      </span>
      <span className="flex flex-wrap justify-end gap-1.5 max-md:order-4 max-md:col-span-2 max-md:justify-start">
        {entity.capabilities.map((capability) => (
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
          'font-mono text-ui whitespace-nowrap tabular',
          reading.isAvailable ? 'text-foreground' : 'text-foreground-subtle line-through',
        )}
        title={reading.at === null ? 'Never reported' : `Reported ${reading.at.toLocaleString()}`}
        data-live={reading.isLive ? 'true' : undefined}
      >
        {reading.text}
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
  const { device, vendorName, icon, lines, standing, isOpen, onToggle, now } = props;
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
            lines.map((line) => <EntityRow key={line.entity.entityId} line={line} />)
          )}
        </ul>
      ) : null}
    </li>
  );
}
