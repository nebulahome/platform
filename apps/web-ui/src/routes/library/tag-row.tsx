/**
 * One tag on the tags page, and - opened - the devices and the entities that carry it.
 *
 * The row is a button that opens, like a device's: the chip in the tag's colour, its name, and
 * how many things carry it. Opened, two short lists: the devices, each a link to its place on
 * the devices page, and the entities, each with its address in the mono face beside its name,
 * because here - where an automation will one day be written - the address is what the tag
 * is for. The spanner opens the tag's own dialog, to rename, recolour or delete it.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { DeviceView, EntityView, TagView } from '@nebulahome/contracts';
import { cn, IconButton, TagChip } from '@nebulahome/ui';

import { ChevronIcon, WrenchIcon } from '@/components/icons';
import { translate } from '@/i18n/messages';
import { devicePath } from '@/routes/library/device/device-path';
import { DeviceIcon, type DeviceIcons } from '@/routes/library/device-icon';

/** The column widths, shared by the header and every row so they line up. */
export const TAG_COLUMNS = 'grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2';

/** What one row needs. */
export type TagRowProps = {
  readonly tag: TagView;

  /** The devices carrying it, by name. */
  readonly devices: readonly DeviceView[];

  /** The entities carrying it, by name. */
  readonly entities: readonly EntityView[];

  /** The catalogue's icons, for the tag itself and for the devices and the entities. */
  readonly icons: DeviceIcons;

  /** Whether the lists are shown. */
  readonly isOpen: boolean;

  /** Called to open or shut it. */
  readonly onToggle: () => void;

  /** Whether the spanner is drawn. */
  readonly canEdit: boolean;

  /** Called when the spanner is pressed. */
  readonly onEdit: () => void;
};

/**
 * Says what carries a tag, in a few words.
 *
 * @param tag - The tag.
 * @returns "1 device · 3 entities", or "On nothing yet".
 */
export function describeCarriers(tag: TagView): string {
  const parts = [
    tag.deviceCount === 0
      ? null
      : `${String(tag.deviceCount)} device${tag.deviceCount === 1 ? '' : 's'}`,
    tag.entityCount === 0
      ? null
      : `${String(tag.entityCount)} entit${tag.entityCount === 1 ? 'y' : 'ies'}`,
  ].filter((part) => part !== null);

  return parts.length === 0
    ? translate('library.tagRow.onNothingYet', 'On nothing yet')
    : parts.join(' · ');
}

/**
 * Renders one tag.
 *
 * The row is a button that opens, like a device's, with the spanner beside it rather than
 * inside it: a button in a button is not a thing, and the spanner is the one action here that
 * is not opening.
 *
 * @param props - See {@link TagRowProps}.
 * @returns The row, and what carries the tag when open.
 */
export function TagRow(props: TagRowProps) {
  const { t } = useTranslation();

  const { tag, devices, entities, icons, isOpen, onToggle, canEdit, onEdit } = props;

  return (
    <li className="border-b border-border last:border-b-0">
      <div className={cn(TAG_COLUMNS, 'pr-3 pl-4', isOpen ? 'bg-surface-raised' : undefined)}>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={onToggle}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-left transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <span className="flex min-w-0 items-center">
            <TagChip color={tag.color} icon={icons.get(tag.icon ?? '')}>
              {tag.name}
            </TagChip>
          </span>
          <span className="truncate text-ui text-foreground-muted tabular max-md:order-3 max-md:col-span-2 max-md:text-caption">
            {describeCarriers(tag)}
          </span>
          <span className="flex items-center justify-end text-foreground-subtle">
            <ChevronIcon isOpen={isOpen} />
          </span>
        </button>

        <span className="flex size-7 items-center justify-center">
          {canEdit ? (
            <IconButton
              variant="bare"
              size="small"
              label={t('library.tagRow.configureName', 'Configure {{name}}', { name: tag.name })}
              className="text-foreground-subtle hover:text-foreground"
              onClick={onEdit}
            >
              <WrenchIcon width="15" height="15" />
            </IconButton>
          ) : null}
        </span>
      </div>

      {isOpen ? (
        <div className="grid gap-4 bg-surface-raised px-4 pt-1 pb-4 md:grid-cols-2">
          <Carried title={t('library.tagRow.devices', 'Devices')} isEmpty={devices.length === 0}>
            {devices.map((device) => (
              <li key={device.id}>
                <Link
                  to={devicePath(device.id)}
                  className="flex items-center gap-2.5 rounded-field border border-border bg-surface-raised px-3 py-2 text-ui font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <DeviceIcon
                    icon={device.icon === null ? undefined : icons.get(device.icon)}
                    device={device}
                    size={18}
                    className="text-foreground-muted"
                  />
                  <span className="truncate">{device.name}</span>
                </Link>
              </li>
            ))}
          </Carried>
          <Carried title={t('library.tagRow.entities', 'Entities')} isEmpty={entities.length === 0}>
            {entities.map((entity) => (
              <li
                key={entity.entityId}
                className="flex items-center gap-2.5 rounded-field border border-border bg-surface-raised px-3 py-2"
              >
                <DeviceIcon
                  icon={entity.icon === null ? undefined : icons.get(entity.icon)}
                  size={18}
                  className="text-foreground-muted"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-ui font-medium text-foreground">
                    {entity.name}
                  </span>
                  <span className="truncate font-mono text-caption text-foreground-subtle">
                    {entity.entityId}
                  </span>
                </span>
              </li>
            ))}
          </Carried>
        </div>
      ) : null}
    </li>
  );
}

/** What one list of carriers needs. */
type CarriedProps = {
  readonly title: string;
  readonly isEmpty: boolean;
  readonly children: ReactNode;
};

/**
 * Renders one of the two lists under an open tag.
 *
 * @param props - See {@link CarriedProps}.
 * @returns The list, or a line saying it is empty.
 */
function Carried(props: CarriedProps) {
  const { t } = useTranslation();

  const { title, isEmpty, children } = props;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-label text-foreground-subtle uppercase">{title}</span>
      {isEmpty ? (
        <span className="text-caption text-foreground-subtle">
          {t('library.tagRow.noneCarryIt', 'None carry it.')}
        </span>
      ) : (
        <ul className="flex flex-col gap-1.5">{children}</ul>
      )}
    </div>
  );
}
