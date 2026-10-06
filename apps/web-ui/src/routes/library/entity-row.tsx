/**
 * One entity under an opened device: what it is, what it reads, and the way into it.
 *
 * The row is a link to the entity's own page, where it is controlled, read back over time and
 * configured - the whole row, because a name alone is a small target for the one thing a row
 * leads to. The switch and the spanner beside it are the exceptions, and the reason the link is
 * stretched over the row rather than wrapped around it: on and off is done from the list without
 * opening anything, the spanner opens the entity's settings over the list rather than leaving it,
 * and a button inside a link is a control nobody can reach by keyboard reliably.
 *
 * What it is reads as words - "Dimmable light", "Power sensor" - not as the capabilities it
 * declares. The tags sit under the name at full width, with their names, capped at three and a
 * count: a row that grew a chip under the pointer moved the reading beside it every time a
 * person's hand crossed the list.
 *
 * The address - `sensor.shelly_bench_relay_current` - is not printed. It is what automations and
 * history name an entity by, not what a person recognises it by; it is still what the search
 * finds, it sits on the name as a tooltip, and the entity's page shows it as a fact.
 */
import { Link } from 'react-router';

import type { CapabilityState, EntityView, IconView, TagView } from '@nebulahome/contracts';
import { AppIcon, TagChip } from '@nebulahome/ui';

import { entityKindOf } from '@/library/entity-kind';
import { type Reading } from '@/library/entity-reading';
import { isActiveState } from '@/library/history-series';
import { entityPath } from '@/routes/library/entity/entity-path';
import { QuickPowerSwitch } from '@/routes/library/entity/quick-power-switch';
import { EntityStateSummary } from '@/routes/library/entity-state-summary';
import { EntityTile } from '@/routes/library/entity-tile';

/** How many tags a row names before it counts the rest. */
const TAGS_SHOWN = 3;

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

  /** The state the reading was made from, capability by capability. */
  readonly state: CapabilityState;

  /** When the state last arrived, in milliseconds since the epoch; null for never. */
  readonly reportedAt: number | null;

  /** The catalogue's icon for it, once read; undefined for none, and while reading. */
  readonly icon: IconView | undefined;

  /** The tags on it, in the order the field lists them. */
  readonly tags: readonly TagLine[];

  /** Whether this person may command it, and it can be commanded at all. */
  readonly canControl: boolean;
};

/** What one entity row needs. */
export type EntityRowProps = {
  readonly line: EntityLine;

  /** The room its device is in, so the row names a room only when the entity's differs. */
  readonly deviceAreaKey: string | null;

  /**
   * Opens the entity's settings where the row is; the spanner is drawn only when given. The page
   * the row sits on holds the dialog, so the settings open over the list the person is reading
   * instead of taking them to another page to open there.
   */
  readonly onConfigure?: ((entity: EntityView) => void) | undefined;
};

/**
 * Renders one entity row.
 *
 * On a wide window: tile, name over what it is, reading, switch, the way in. On a phone the
 * reading wraps under the name, so the name keeps the width it is recognised by.
 *
 * @param props - See {@link EntityRowProps}.
 * @returns The row.
 */
export function EntityRow(props: EntityRowProps) {
  const { line, deviceAreaKey, onConfigure } = props;
  const { entity, reading, state, reportedAt, icon, tags, canControl } = line;
  const kind = entityKindOf(entity);
  const hasPower = entity.capabilities.some((entry) => entry.capability === 'on_off');
  const isOn = state.on_off?.isOn ?? false;
  const room = entity.areaKey !== deviceAreaKey ? entity.areaName : null;
  const shownTags = tags.slice(0, TAGS_SHOWN);
  const hiddenTags = tags.length - shownTags.length;

  return (
    <li className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-field border border-border bg-surface-raised py-2 pr-2.5 pl-2.5 transition-colors hover:border-border-strong has-[[data-row-link]:focus-visible]:ring-3 has-[[data-row-link]:focus-visible]:ring-primary/25 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
      <EntityTile
        icon={icon}
        kind={kind}
        isActive={isActiveState(state)}
        isAvailable={reading.isAvailable}
      />

      <span className="flex min-w-0 flex-col gap-1">
        <Link
          to={entityPath(entity.entityId)}
          data-row-link
          title={entity.entityId}
          data-entity-id={entity.entityId}
          className="truncate text-ui font-medium text-foreground after:absolute after:inset-0 after:rounded-field focus-visible:outline-none"
        >
          {entity.name}
        </Link>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-foreground-subtle">
          <span className="truncate">
            {kind.label}
            {room === null ? null : ` · ${room}`}
          </span>
          {entity.isHidden ? (
            <span className="inline-flex items-center gap-1" title="Hidden from lists by default">
              <AppIcon id="eye-off" size={12} />
              <span>Hidden</span>
            </span>
          ) : null}
          {shownTags.map(({ tag, icon: tagIcon }) => (
            <TagChip key={tag.id} color={tag.color} icon={tagIcon} size="small">
              {tag.name}
            </TagChip>
          ))}
          {hiddenTags > 0 ? (
            <span
              title={tags
                .slice(TAGS_SHOWN)
                .map(({ tag }) => tag.name)
                .join(', ')}
            >
              +{hiddenTags}
            </span>
          ) : null}
        </span>
      </span>

      <EntityStateSummary
        reading={reading}
        state={state}
        className="max-sm:col-start-2 max-sm:row-start-2 sm:justify-self-end"
      />

      <span className="flex items-center justify-end gap-1.5 max-sm:col-start-3 max-sm:row-span-2 max-sm:row-start-1">
        {hasPower ? (
          <QuickPowerSwitch
            entityId={entity.entityId}
            name={entity.name}
            isOn={isOn}
            reportedAt={reportedAt}
            disabled={!canControl || !reading.isAvailable}
          />
        ) : null}
        {onConfigure === undefined ? null : (
          <button
            type="button"
            aria-label={`Configure ${entity.name}`}
            title={`Configure ${entity.name}`}
            onClick={() => {
              onConfigure(entity);
            }}
            className="relative z-10 flex size-7 items-center justify-center rounded-chip text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none"
          >
            <AppIcon id="wrench" size={15} />
          </button>
        )}
        <span aria-hidden="true" className="text-foreground-subtle">
          <AppIcon id="chevron-right" size={16} />
        </span>
      </span>
    </li>
  );
}
