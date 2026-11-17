/**
 * What removing devices does, said before it is done: the parts that go with their parent, what
 * stops working until pointed elsewhere, and the aliases that read one of the entities, which
 * block the removal. One reading for every place a device is removed from - its settings, a
 * broker's list, an account signed out of, a vendor uninstalled - so the owner hears it the same
 * way everywhere.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { DeviceRemoval } from '@nebulahome/contracts';
import { AppIcon, Button, Modal } from '@nebulahome/ui';

import { listFormat } from '@/i18n/formatters';
import { signalled } from '@/lib/signalled';
import { fetchDevices, LIBRARY_QUERY_KEYS, previewDeviceRemoval } from '@/library/api';
import { UseRows, usedByCount } from '@/routes/library/aliases/use-rows';
import { DeviceIcon, useDeviceIcons } from '@/routes/library/device-icon';

/**
 * Reads what removing some devices would do.
 *
 * @param deviceIds - The devices; null while nothing is being removed.
 * @returns The query.
 */
export function useRemovalPreview(deviceIds: readonly string[] | null) {
  return useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.devices, 'removal', ...(deviceIds ?? [])],

    /**
     * Asks the API.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns What the removal would do.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      previewDeviceRemoval(deviceIds ?? [], signal),
    enabled: deviceIds !== null && deviceIds.length > 0,
    staleTime: 0,
  });
}

/**
 * The devices a removal takes besides those asked for: the parts that go with their parent.
 *
 * @param removal - What the removal would do.
 * @param asked - The devices the owner asked to remove.
 * @returns The parts, in the order the API lists them.
 */
export function partsOf(
  removal: DeviceRemoval,
  asked: readonly string[],
): DeviceRemoval['devices'] {
  return removal.devices.filter((device) => device.parentId !== null && !asked.includes(device.id));
}

/**
 * The parts that go with their parent, and what stops working: the body of every removal's
 * confirmation that is not blocked.
 *
 * @param props - What the removal would do, and what was asked.
 * @param props.removal - What the removal would do.
 * @param props.asked - The devices the owner asked to remove.
 * @returns The sections; nothing when it takes nothing else and stops nothing.
 */
export function RemovalSummary(props: {
  readonly removal: DeviceRemoval;
  readonly asked: readonly string[];
}) {
  const { t } = useTranslation();
  const { removal, asked } = props;
  const parts = partsOf(removal, asked);
  const stopped = usedByCount(removal.usedBy);
  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    queryFn: signalled(fetchDevices),
  });
  const known = new Map((devices.data ?? []).map((device) => [device.id, device]));
  const icons = useDeviceIcons(parts.flatMap((part) => known.get(part.id) ?? []));

  if (parts.length === 0 && stopped === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {parts.length === 0 ? null : (
        <section className="flex flex-col gap-2">
          <h3 className="text-ui-sm font-normal text-foreground-muted">
            {t('library.deviceRemoval.removedWithIt', 'Removed with it · {{count}}', {
              count: parts.length,
            })}
          </h3>
          <ul className="flex flex-col rounded-card border border-border">
            {parts.map((part) => {
              const device = known.get(part.id);

              return (
                <li
                  key={part.id}
                  className="flex items-center gap-3 border-t border-border px-3.5 py-2.5 first:border-t-0"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-raised text-foreground-muted">
                    <DeviceIcon
                      icon={icons.get(device?.icon ?? '')}
                      {...(device === undefined ? {} : { device })}
                      size={14}
                    />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-ui-sm">{part.name}</span>
                    <span className="truncate text-caption text-foreground-subtle">
                      {[
                        part.model,
                        t('library.deviceRemoval.entities', {
                          count: part.entities,
                          defaultValue_one: '{{count}} entity',
                          defaultValue_other: '{{count}} entities',
                        }),
                      ]
                        .filter((each) => each !== null)
                        .join(' · ')}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {stopped === 0 ? null : (
        <section className="flex flex-col gap-2">
          <h3 className="text-ui-sm font-normal text-foreground-muted">
            {t(
              'library.deviceRemoval.stopsWorking',
              'Stops working until pointed elsewhere · {{count}}',
              { count: stopped },
            )}
          </h3>
          <ul className="flex flex-col rounded-card border border-border">
            <UseRows usedBy={removal.usedBy} />
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * The aliases that block a removal, each with what it reads: the body of a blocked removal.
 *
 * @param props - What the removal would do, and what was asked.
 * @param props.removal - What the removal would do.
 * @param props.asked - The devices the owner asked to remove.
 * @returns The section, and a word on the parts when they count too.
 */
export function RemovalBlockers(props: {
  readonly removal: DeviceRemoval;
  readonly asked: readonly string[];
}) {
  const { t } = useTranslation();
  const { removal, asked } = props;
  const blockers = removal.blockedBy.aliases;
  const parts = partsOf(removal, asked);
  const askedNames = new Set(
    removal.devices.filter((device) => asked.includes(device.id)).map((device) => device.name),
  );

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-2">
        <h3 className="text-ui-sm font-normal text-foreground-muted">
          {t('library.deviceRemoval.readByAliases', 'Read by aliases · {{count}}', {
            count: blockers.length,
          })}
        </h3>
        <ul className="flex flex-col rounded-card border border-border">
          {blockers.map((blocker) => (
            <li
              key={blocker.id}
              className="flex items-center gap-3 border-t border-border px-3.5 py-2.5 first:border-t-0"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-raised text-foreground-muted">
                <AppIcon id="sigma" size={13} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-ui-sm">{blocker.name}</span>
                <span className="text-caption text-foreground-subtle">
                  {t('library.deviceRemoval.reads', 'Reads {{entities}}', {
                    entities: listFormat({ type: 'conjunction' }).format(
                      blocker.reads.map((read) =>
                        askedNames.has(read.deviceName)
                          ? read.name
                          : t('library.deviceRemoval.readOf', '{{entity}} of {{device}}', {
                              entity: read.name,
                              device: read.deviceName,
                            }),
                      ),
                    ),
                  })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      {parts.length === 0 ? null : (
        <p className="text-ui-sm text-foreground-muted">
          {t('library.deviceRemoval.childrenCountToo', {
            count: parts.length,
            defaultValue_one: 'Its child goes with it, so its entities count too.',
            defaultValue_other: 'Its {{count}} children go with it, so their entities count too.',
          })}
        </p>
      )}
    </div>
  );
}

/**
 * A bin on red: a removal.
 *
 * @returns The mark.
 */
function RemovalMark() {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-tile border border-danger/40 bg-danger/12 text-danger">
      <AppIcon id="trash-2" size={20} />
    </span>
  );
}

/**
 * A lock on amber: a removal that cannot happen yet.
 *
 * @returns The mark.
 */
function BlockedMark() {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-tile border border-warning/40 bg-warning/12 text-warning">
      <AppIcon id="lock" size={20} />
    </span>
  );
}

/** What the removal dialog needs. */
export type DeviceRemovalDialogProps = {
  /** The device to remove; null while the dialog is shut. */
  readonly device: { readonly id: string; readonly name: string } | null;

  /** Whether the removal is under way. */
  readonly isBusy: boolean;

  /** Puts the dialog away without removing anything. */
  readonly onCancel: () => void;

  /** Removes it. */
  readonly onConfirm: () => void;
};

/**
 * Removes a device, saying first what goes with it and what stops working - or, when an alias
 * reads one of its entities or one of its parts', that it cannot go yet and which alias to open.
 *
 * @param props - See {@link DeviceRemovalDialogProps}.
 * @returns The dialog.
 */
export function DeviceRemovalDialog(props: DeviceRemovalDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { device, isBusy, onCancel, onConfirm } = props;
  const asked = device === null ? null : [device.id];
  const preview = useRemovalPreview(asked);
  const removal = preview.data;
  const parts = removal === undefined || asked === null ? [] : partsOf(removal, asked);
  const [blocker] = removal?.blockedBy.aliases ?? [];
  const entities = removal?.devices.find((each) => each.id === device?.id)?.entities ?? 0;

  if (blocker !== undefined && removal !== undefined && asked !== null) {
    return (
      <Modal
        isOpen={device !== null}
        size="medium"
        layout="card"
        lead={<BlockedMark />}
        title={t('library.deviceRemoval.cannotYet', "{{name}} can't be removed yet", {
          name: device?.name,
        })}
        description={t('library.deviceRemoval.aliasesRead', {
          count: removal.blockedBy.aliases.length,
          defaultValue_one: 'An alias reads its entities: point it elsewhere first',
          defaultValue_other: 'Aliases read its entities: point them elsewhere first',
        })}
        onClose={onCancel}
        footer={
          <>
            <span />
            <span className="flex items-center gap-2">
              <Button variant="bare" onClick={onCancel}>
                {t('common.close', 'Close')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  onCancel();
                  void navigate(`/aliases/${blocker.id}`);
                }}
              >
                <AppIcon id="sigma" size={15} />
                {t('library.deviceRemoval.openAlias', 'Open {{name}}', { name: blocker.name })}
              </Button>
            </span>
          </>
        }
      >
        <RemovalBlockers removal={removal} asked={asked} />
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={device !== null}
      size="medium"
      layout="card"
      lead={<RemovalMark />}
      title={t('library.deviceRemoval.removeName', 'Remove {{name}}?', { name: device?.name })}
      description={
        parts.length > 0
          ? t('library.deviceRemoval.childrenGo', {
              count: parts.length,
              defaultValue_one: 'Its child goes with it · history included · no undo',
              defaultValue_other: 'Its {{count}} children go with it · history included · no undo',
            })
          : entities === 0
            ? t('library.deviceRemoval.noEntities', 'It has no entities yet · no undo')
            : t('library.deviceRemoval.entitiesGo', {
                count: entities,
                defaultValue_one: 'Its entity goes with it · history included · no undo',
                defaultValue_other:
                  'Its {{count}} entities go with it · history included · no undo',
              })
      }
      onClose={onCancel}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onCancel}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="danger"
              isBusy={isBusy}
              disabled={preview.isPending}
              onClick={onConfirm}
            >
              <AppIcon id="trash-2" size={15} />
              {parts.length > 0
                ? t('library.deviceRemoval.removeDevices', 'Remove {{count}} devices', {
                    count: parts.length + 1,
                  })
                : t('common.remove', 'Remove')}
            </Button>
          </span>
        </>
      }
    >
      {removal === undefined ? (
        <p className="text-ui-sm text-foreground-muted">
          {preview.isError
            ? t('library.deviceRemoval.notRead', 'What it takes with it could not be read.')
            : t('library.detail.reading', 'Reading…')}
        </p>
      ) : asked === null ? null : (
        <RemovalSummary removal={removal} asked={asked} />
      )}
    </Modal>
  );
}
