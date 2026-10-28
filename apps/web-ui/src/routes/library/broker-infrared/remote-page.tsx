/**
 * A remote's page (`/brokers/infrared/remotes/:remoteId`): where its buttons are learned and laid
 * out.
 *
 * The hero is the remote: its kind's square, its name (the pencil renames it, and changes its kind
 * and room), its room and kind, and its blaster - picking another moves the remote there without
 * learning again, since codes are kept as timings. Import codes, Learn a button and the overflow
 * menu (its device page, Remove) sit top right.
 *
 * The keypad is a grid laid out like the remote: a tile in a cell of its own, the dashed Learn
 * tile after the last. Clicking a tile sends it as a test and the tile flashes once. Holding one
 * and dragging it moves it onto any empty cell, which show only while dragging, like the icons
 * of a phone's home screen. A tile's menu - on hover or focus - renames it or changes its icon,
 * learns it again, shows its code, duplicates or removes it. A role that may not change the house
 * only presses. Beside the keypad, what the remote is and that its codes move with it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import {
  INFRARED_REMOTE_KINDS,
  type InfraredBlaster,
  type InfraredButton,
  type InfraredRemoteDetail,
  type InfraredRemoteKind,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  CatalogueIcon,
  cn,
  DetailHero,
  HeroFact,
  IconButton,
  Menu,
  Modal,
  Note,
  OverflowMenu,
  Popover,
  Section,
  SelectField,
  TextField,
  toast,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/format-time';
import { fetchAreas, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  fetchInfraredBlasters,
  fetchInfraredCodeFormats,
  fetchInfraredRemote,
  INFRARED_QUERY_KEYS,
  moveInfraredButton,
  pressInfraredButton,
  removeInfraredButton,
  removeInfraredRemote,
  saveInfraredButton,
  saveInfraredRemote,
} from '@/library/infrared-api';
import { CopyButton, DeviceTag, PulseStrip } from '@/routes/library/broker-parts';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { devicePath } from '@/routes/library/device/device-path';
import { useCatalogueIcons, type DeviceIcons } from '@/routes/library/device-icon';
import { NameIconField } from '@/routes/library/name-icon-field';

import { ImportDialog } from './import-dialog';
import {
  INFRARED_TEXT,
  KIND_ICONS,
  kindName,
  ProtocolPill,
  protocolLine,
  protocolName,
  pulsesLine,
} from './infrared-parts';
import { LearnDialog } from './learn-dialog';

/** How often the remote is read again. */
const REFRESH_MS = 5000;

/** How long a tile flashes once sent. */
const FLASH_MS = 600;

/**
 * Renders the page.
 *
 * @returns The page.
 */
export function InfraredRemotePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { remoteId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const can = useSession((state) => state.can);
  const canWrite = can('device:write');
  const canDelete = can('device:delete');
  const [learning, setLearning] = useState<{ readonly button?: InfraredButton } | null>(() =>
    params.get('open') === 'learn' ? {} : null,
  );
  const [isImporting, setImporting] = useState(params.get('open') === 'import');
  const [isEditing, setEditing] = useState(false);
  const [isRemoving, setRemoving] = useState(false);
  const [renaming, setRenaming] = useState<InfraredButton | null>(null);

  const remote = useQuery({
    queryKey: [...INFRARED_QUERY_KEYS.remote, remoteId],
    refetchInterval: REFRESH_MS,

    /**
     * Reads the remote and its buttons.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns It.
     */
    queryFn: async ({ signal }) => fetchInfraredRemote(remoteId, signal),
  });
  const blasters = useQuery({
    queryKey: INFRARED_QUERY_KEYS.blasters,

    /**
     * Reads the blasters, for the remote's to be picked from.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Them.
     */
    queryFn: async ({ signal }) => fetchInfraredBlasters(signal),
  });
  const areas = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.areas,

    /**
     * Reads the rooms.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The rooms.
     */
    queryFn: async ({ signal }) => fetchAreas(signal),
  });
  const current = remote.data;
  const icons = useCatalogueIcons((current?.buttons ?? []).map((button) => button.icon));
  const rooms = (areas.data ?? []).filter((area) => area.kind === 'room');
  const room =
    current?.areaId == null ? null : (rooms.find((area) => area.id === current.areaId) ?? null);

  /** Reads everything the remote touches again. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['brokers', 'infrared'] });
  };

  /**
   * Says why something did not happen.
   *
   * @param title - What did not.
   * @returns The handler.
   */
  const failed =
    (title: string) =>
    (error: Error): void => {
      toast.error({ title, message: toMessage(error) });
    };

  const move = useMutation({
    /**
     * Moves a button to an empty cell.
     *
     * @param request - Which, and where.
     * @param request.id - The button.
     * @param request.cell - The cell.
     * @returns It, moved.
     */
    mutationFn: async (request: { readonly id: string; readonly cell: number }) =>
      moveInfraredButton(request.id, request.cell),

    /**
     * Moves it on screen at once.
     *
     * @param request - Which, and where.
     */
    onMutate: (request) => {
      queryClient.setQueryData<InfraredRemoteDetail>(
        [...INFRARED_QUERY_KEYS.remote, remoteId],
        (was) =>
          was === undefined
            ? was
            : {
                ...was,
                buttons: was.buttons.map((button) =>
                  button.id === request.id ? { ...button, cell: request.cell } : button,
                ),
              },
      );
    },
    onSettled: refresh,
    onError: failed(t('brokers.infrared.remote.moveFailed', 'Couldn’t move the button')),
  });
  const press = useMutation({
    mutationFn: pressInfraredButton,
    onError: failed(t('brokers.infrared.remote.pressFailed', 'Couldn’t send it')),
  });
  const duplicate = useMutation({
    /**
     * Saves a copy of a button, in the next empty cell.
     *
     * @param button - The button.
     * @returns The copy.
     */
    mutationFn: async (button: InfraredButton) =>
      saveInfraredButton({
        remoteId,
        name: t('brokers.infrared.remote.copyName', '{{name}} copy', { name: button.name }).slice(
          0,
          64,
        ),
        icon: button.icon,
        code: button.code,
      }),
    onSettled: refresh,
    onError: failed(t('brokers.infrared.remote.duplicateFailed', 'Couldn’t duplicate it')),
  });
  const removeButton = useMutation({
    mutationFn: removeInfraredButton,
    onSettled: refresh,
    onError: failed(t('brokers.infrared.remote.removeButtonFailed', 'Couldn’t remove it')),
  });
  const moveTo = useMutation({
    /**
     * Moves the remote to another blaster.
     *
     * @param blasterId - The blaster.
     * @returns The remote.
     */
    mutationFn: async (blasterId: string) =>
      current === undefined
        ? null
        : saveInfraredRemote({
            id: current.id,
            name: current.name,
            kind: current.kind,
            blasterId,
            columns: current.columns,
          }),
    onSettled: refresh,
    onError: failed(t('brokers.infrared.remote.blasterFailed', 'Couldn’t change the blaster')),
  });
  const remove = useMutation({
    /**
     * Removes the remote.
     *
     * @returns Once removed.
     */
    mutationFn: async () => removeInfraredRemote(remoteId),

    /** Goes back to the broker. */
    onSuccess: () => {
      refresh();
      toast.success({ title: t('brokers.infrared.remote.removed', 'Remote removed') });
      void navigate('/brokers/infrared?tab=remotes');
    },
    onError: failed(t('brokers.infrared.remote.removeFailed', 'Couldn’t remove the remote')),
  });

  const protocols = new Map<string, number>();

  for (const button of current?.buttons ?? []) {
    const word = protocolName(button.code.protocol);

    protocols.set(word, (protocols.get(word) ?? 0) + 1);
  }

  const [first] = current?.buttons ?? [];
  const pressed = [...(current?.buttons ?? [])]
    .filter((button) => button.lastPressedAt !== null)
    .sort(
      (one, other) => (other.lastPressedAt?.getTime() ?? 0) - (one.lastPressedAt?.getTime() ?? 0),
    )[0];

  /** Forgets the dialog the page was opened for. */
  const clearOpen = (): void => {
    if (params.has('open')) {
      params.delete('open');
      setParams(params, { replace: true });
    }
  };

  return (
    <DetailFrame
      isPending={remote.isPending}
      error={remote.error}
      hero={
        <DetailHero
          back={
            <BackLink to="/brokers/infrared">{t('brokers.infrared.name', 'Infrared')}</BackLink>
          }
          mark={
            current === undefined ? undefined : (
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-14 shrink-0 items-center justify-center rounded-inner border border-border-strong bg-surface-raised infrared-glow',
                  INFRARED_TEXT,
                )}
              >
                <AppIcon id={KIND_ICONS[current.kind]} size={26} />
              </span>
            )
          }
          title={current?.name ?? ''}
          titleAside={
            current === undefined || !canWrite ? undefined : (
              <IconButton
                label={t('brokers.infrared.remote.edit', 'Rename {{name}}', { name: current.name })}
                onClick={() => {
                  setEditing(true);
                }}
              >
                <AppIcon id="pencil" size={16} />
              </IconButton>
            )
          }
          facts={
            current === undefined ? undefined : (
              <>
                <HeroFact icon="house">
                  {room?.name ?? t('brokers.infrared.noRoom', 'No room')}
                </HeroFact>
                <HeroFact icon={KIND_ICONS[current.kind]}>{kindName(current.kind)}</HeroFact>
                <BlasterPicker
                  remote={current}
                  blasters={blasters.data ?? []}
                  onPick={
                    canWrite
                      ? (blasterId) => {
                          moveTo.mutate(blasterId);
                        }
                      : undefined
                  }
                />
              </>
            )
          }
          actions={
            current === undefined ? undefined : (
              <>
                {canWrite ? (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setImporting(true);
                      }}
                    >
                      <AppIcon id="upload" size={15} />
                      {t('brokers.infrared.remote.import', 'Import codes')}
                    </Button>
                    <Button
                      disabled={current.blasterId === null}
                      onClick={() => {
                        setLearning({});
                      }}
                    >
                      <AppIcon id="plus" size={15} />
                      {t('brokers.infrared.remote.learn', 'Learn a button')}
                    </Button>
                  </>
                ) : null}
                <OverflowMenu
                  label={t('brokers.infrared.remote.more', 'More for {{name}}', {
                    name: current.name,
                  })}
                  items={[
                    ...(current.deviceId === null
                      ? []
                      : [
                          {
                            label: t('brokers.infrared.remote.openDevice', 'Open device page'),
                            icon: 'external-link' as const,
                            /** Opens the remote's device. */
                            onSelect: () => {
                              void navigate(devicePath(current.deviceId ?? ''));
                            },
                          },
                        ]),
                    ...(canDelete
                      ? [
                          {
                            label: t('brokers.infrared.remote.remove', 'Remove remote'),
                            icon: 'trash-2' as const,
                            tone: 'danger' as const,
                            /** Asks first. */
                            onSelect: () => {
                              setRemoving(true);
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              </>
            )
          }
        />
      }
    >
      {current === undefined ? null : (
        <>
          {current.blasterId === null ? (
            <Note tone="warning">
              {t(
                'brokers.infrared.remote.noBlaster',
                'No blaster: pick another one. Its buttons are unavailable until it has one.',
              )}
            </Note>
          ) : null}
          <Section
            title={t('brokers.infrared.remote.buttons', 'Buttons')}
            note={t(
              'brokers.infrared.remote.buttonsNote',
              '{{count}} buttons, each a button entity of {{name}}. Lay them out like the real remote.',
              { count: current.buttons.length, name: current.name },
            )}
          >
            <div className="flex flex-col items-start gap-4 lg:flex-row">
              <Keypad
                remote={current}
                icons={icons}
                canWrite={canWrite}
                canDelete={canDelete}
                onPress={(button) => {
                  press.mutate(button.id);
                }}
                onMove={(button, cell) => {
                  move.mutate({ id: button.id, cell });
                }}
                onLearn={(button) => {
                  setLearning(button === undefined ? {} : { button });
                }}
                onRename={setRenaming}
                onDuplicate={(button) => {
                  duplicate.mutate(button);
                }}
                onRemove={(button) => {
                  removeButton.mutate(button.id);
                }}
              />
              <div className="flex w-full min-w-0 grow flex-col gap-4">
                <div className="grid grid-cols-1 gap-x-6 gap-y-5 rounded-card border border-border bg-surface px-5 py-4.5 sm:grid-cols-3">
                  <Fact label={t('brokers.infrared.remote.device', 'Device')}>
                    {current.deviceId === null ? (
                      t('brokers.infrared.remote.notInHouse', 'Not in the house yet')
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-primary"
                        onClick={() => {
                          void navigate(devicePath(current.deviceId ?? ''));
                        }}
                      >
                        {current.name}
                        <AppIcon id="chevron-right" size={14} />
                      </button>
                    )}
                  </Fact>
                  <Fact label={t('brokers.infrared.remote.signal', 'Signal')}>
                    {first === undefined
                      ? '—'
                      : first.code.signal === 'rf'
                        ? t('brokers.infrared.remote.radio', 'Radio · 433 MHz')
                        : t('brokers.infrared.remote.infraredAt', 'Infrared · {{khz}} kHz', {
                            khz: Math.round(first.code.carrierHz / 1000),
                          })}
                  </Fact>
                  <Fact label={t('brokers.infrared.remote.codes', 'Codes')}>
                    {current.buttons.length === 0
                      ? '0'
                      : `${String(current.buttons.length)} · ${[...protocols]
                          .map(([word, count]) => `${word} ${String(count)}`)
                          .join(', ')}`}
                  </Fact>
                  <Fact label={t('brokers.infrared.remote.lastPressed', 'Last pressed')}>
                    {pressed?.lastPressedAt == null
                      ? t('brokers.infrared.neverPressed', 'Not pressed yet')
                      : `${pressed.name} · ${relativeTime(pressed.lastPressedAt)}`}
                  </Fact>
                </div>
                <p className="flex gap-3 rounded-card border border-border bg-surface px-5 py-4 text-ui-sm leading-normal text-foreground-muted">
                  <AppIcon id="info" size={16} className="mt-0.5 shrink-0 text-foreground-subtle" />
                  {t(
                    'brokers.infrared.remote.timings',
                    'Codes are kept as timings, not in a blaster’s format. Pick another blaster above and the buttons go with it, no learning again.',
                  )}
                </p>
              </div>
            </div>
          </Section>

          {learning === null ? null : (
            <LearnDialog
              isOpen
              remote={current}
              button={learning.button}
              onClose={() => {
                setLearning(null);
                clearOpen();
              }}
            />
          )}
          {isImporting ? (
            <ImportDialog
              isOpen
              remote={current}
              onClose={() => {
                setImporting(false);
                clearOpen();
              }}
            />
          ) : null}
          {isEditing ? (
            <EditRemoteDialog
              remote={current}
              rooms={rooms}
              onClose={() => {
                setEditing(false);
              }}
            />
          ) : null}
          {renaming === null ? null : (
            <RenameButtonDialog
              button={renaming}
              onClose={() => {
                setRenaming(null);
              }}
            />
          )}
          <Modal
            isOpen={isRemoving}
            onClose={() => {
              setRemoving(false);
            }}
            size="small"
            title={t('brokers.infrared.remote.removeTitle', 'Remove {{name}}?', {
              name: current.name,
            })}
            description={t(
              'brokers.infrared.remote.removeLine',
              'Its device and its buttons leave the house, and the automations that press them stop finding them.',
            )}
            footer={
              <>
                <Button
                  variant="bare"
                  onClick={() => {
                    setRemoving(false);
                  }}
                >
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button
                  variant="danger"
                  isBusy={remove.isPending}
                  onClick={() => {
                    remove.mutate();
                  }}
                >
                  {t('brokers.infrared.remote.removeConfirm', 'Remove')}
                </Button>
              </>
            }
          >
            {null}
          </Modal>
        </>
      )}
    </DetailFrame>
  );
}

/**
 * One fact beside the keypad.
 *
 * @param props - What it says.
 * @param props.label - The fact.
 * @param props.children - Its value.
 * @returns The fact.
 */
function Fact(props: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-caption text-foreground-muted">{props.label}</span>
      <span className="truncate text-ui font-medium text-foreground">{props.children}</span>
    </div>
  );
}

/**
 * The remote's blaster as a fact of the hero that opens the list of the others.
 *
 * @param props - The remote, the blasters, and how one is picked.
 * @param props.remote - The remote.
 * @param props.blasters - Every blaster.
 * @param props.onPick - Moves the remote to one; absent when the person may not.
 * @returns The picker.
 */
function BlasterPicker(props: {
  readonly remote: InfraredRemoteDetail;
  readonly blasters: readonly InfraredBlaster[];
  readonly onPick?: ((blasterId: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  const { remote, blasters, onPick } = props;
  const chip = (
    <>
      <span className="text-foreground-subtle">
        {t('brokers.infrared.remote.blaster', 'Blaster')}
      </span>
      {remote.blasterName === null ? (
        <span className="text-warning">{t('brokers.infrared.none', 'None yet')}</span>
      ) : (
        <DeviceTag
          name={remote.blasterName}
          vendorName={blasters.find((each) => each.deviceId === remote.blasterId)?.vendorName}
          className="h-auto border-0 bg-transparent px-0 font-medium"
        />
      )}
    </>
  );
  const chipClass =
    'inline-flex h-6 items-center gap-1.5 rounded-pill border border-border-strong bg-surface-raised pr-2 pl-2.5 text-caption text-foreground-muted';

  if (onPick === undefined) {
    return <span className={chipClass}>{chip}</span>;
  }

  return (
    <Menu
      align="start"
      items={blasters.map((blaster) => ({
        label: blaster.name,
        description: blaster.isOnline
          ? blaster.vendorName
          : t('brokers.infrared.remote.offlineVendor', '{{vendor}} · offline', {
              vendor: blaster.vendorName,
            }),
        ...(blaster.deviceId === remote.blasterId ? { icon: 'check' as const } : {}),
        disabled: blaster.deviceId === remote.blasterId,
        /** Moves the remote there. */
        onSelect: () => {
          onPick(blaster.deviceId);
        },
      }))}
      trigger={(state) => (
        <button
          ref={state.buttonRef}
          type="button"
          aria-expanded={state.isOpen}
          onClick={state.toggle}
          className={cn(chipClass, 'hover:border-foreground-subtle')}
        >
          {chip}
          <AppIcon id="chevron-down" size={13} />
        </button>
      )}
    />
  );
}

/** What the keypad needs. */
type KeypadProps = {
  readonly remote: InfraredRemoteDetail;
  readonly icons: DeviceIcons;
  readonly canWrite: boolean;
  readonly canDelete: boolean;
  readonly onPress: (button: InfraredButton) => void;
  readonly onMove: (button: InfraredButton, cell: number) => void;
  readonly onLearn: (button?: InfraredButton) => void;
  readonly onRename: (button: InfraredButton) => void;
  readonly onDuplicate: (button: InfraredButton) => void;
  readonly onRemove: (button: InfraredButton) => void;
};

/**
 * The keypad: the remote's buttons in their cells.
 *
 * @param props - See {@link KeypadProps}.
 * @returns The keypad's card.
 */
function Keypad(props: KeypadProps) {
  const { t } = useTranslation();
  const { remote, icons, canWrite } = props;
  const [dragging, setDragging] = useState<InfraredButton | null>(null);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [showing, setShowing] = useState<string | null>(null);
  const columns = remote.columns;
  const byCell = new Map(remote.buttons.map((button) => [button.cell, button]));
  const last = Math.max(-1, ...remote.buttons.map((button) => button.cell));
  const learnCell = canWrite ? last + 1 : -1;

  // Whole rows, the Learn tile's included, and one more row to drag into while dragging.
  const filled = Math.max(last, learnCell) + 1;
  const rows = Math.ceil(filled / columns) + (dragging === null ? 0 : 1);
  const cells = Array.from({ length: Math.max(rows, 1) * columns }, (unused, cell) => cell);

  /**
   * Drops the tile dragged on an empty cell.
   *
   * @param event - The drop.
   * @param cell - The cell.
   */
  const drop = (event: DragEvent<HTMLElement>, cell: number): void => {
    event.preventDefault();

    if (dragging !== null && !byCell.has(cell)) {
      props.onMove(dragging, cell);
    }

    setDragging(null);
  };

  return (
    <div className="flex w-full shrink-0 flex-col gap-3.5 rounded-panel border border-border bg-surface p-5 lg:w-105">
      <span className="flex items-center gap-2 text-caption text-foreground-muted">
        <AppIcon id="grip-vertical" size={13} className="text-foreground-subtle" />
        {dragging !== null
          ? t('brokers.infrared.remote.dropHint', 'Drop it on any empty cell')
          : canWrite
            ? t(
                'brokers.infrared.remote.hint',
                'Click to send · hold and drag to move a button anywhere',
              )
            : t('brokers.infrared.remote.pressHint', 'Click a button to send it')}
      </span>
      <div className="grid grid-cols-3 gap-2.5">
        {cells.map((cell) => {
          const button = byCell.get(cell);

          if (button === undefined) {
            if (cell === learnCell && dragging === null) {
              return (
                <button
                  key={cell}
                  type="button"
                  onClick={() => {
                    props.onLearn();
                  }}
                  className="flex aspect-[1.42] flex-col items-center justify-center gap-2 rounded-inner border border-dashed border-border-strong text-ui-sm text-foreground-muted hover:border-primary/60 hover:text-foreground"
                >
                  <AppIcon id="plus" size={18} />
                  {t('brokers.infrared.remote.learnTile', 'Learn')}
                </button>
              );
            }

            return (
              <span
                key={cell}
                aria-hidden={dragging === null}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  drop(event, cell);
                }}
                className={cn(
                  'aspect-[1.42] rounded-inner',
                  dragging !== null &&
                    'border border-dashed border-border-strong bg-[radial-gradient(var(--color-border-strong)_1px,transparent_1px)] bg-size-[10px_10px]',
                )}
              />
            );
          }

          return (
            <KeypadTile
              key={button.id}
              button={button}
              icons={icons}
              isFlashing={flashed === button.id}
              isDragged={dragging?.id === button.id}
              isShowing={showing === button.id}
              canWrite={canWrite}
              canDelete={props.canDelete}
              onPress={() => {
                props.onPress(button);
                setFlashed(button.id);
                setTimeout(() => {
                  setFlashed(null);
                }, FLASH_MS);
              }}
              onDragStart={() => {
                setDragging(button);
              }}
              onDragEnd={() => {
                setDragging(null);
              }}
              onShow={(isShown) => {
                setShowing(isShown ? button.id : null);
              }}
              onLearn={() => {
                props.onLearn(button);
              }}
              onRename={() => {
                props.onRename(button);
              }}
              onDuplicate={() => {
                props.onDuplicate(button);
              }}
              onRemove={() => {
                props.onRemove(button);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** What a tile needs. */
type KeypadTileProps = {
  readonly button: InfraredButton;
  readonly icons: DeviceIcons;
  readonly isFlashing: boolean;
  readonly isDragged: boolean;
  readonly isShowing: boolean;
  readonly canWrite: boolean;
  readonly canDelete: boolean;
  readonly onPress: () => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onShow: (isShown: boolean) => void;
  readonly onLearn: () => void;
  readonly onRename: () => void;
  readonly onDuplicate: () => void;
  readonly onRemove: () => void;
};

/**
 * One button of the keypad: its icon and name; its menu on hover.
 *
 * @param props - See {@link KeypadTileProps}.
 * @returns The tile.
 */
function KeypadTile(props: KeypadTileProps) {
  const { t } = useTranslation();
  const { button, icons, canWrite } = props;
  const anchor = useRef<HTMLDivElement>(null);
  const icon = button.icon === null ? undefined : icons.get(button.icon);

  return (
    <div ref={anchor} className={cn('group relative', props.isDragged && 'opacity-40')}>
      <button
        type="button"
        draggable={canWrite}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', button.id);
          props.onDragStart();
        }}
        onDragEnd={props.onDragEnd}
        onClick={props.onPress}
        className={cn(
          'flex aspect-[1.42] w-full flex-col items-center justify-center gap-2 rounded-inner border bg-surface-raised/40 px-2 text-ui-sm text-foreground transition-[border-color,box-shadow] focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
          props.isFlashing
            ? 'border-primary bg-primary/12 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-primary)_25%,transparent)]'
            : props.isShowing
              ? 'border-border-strong'
              : 'border-border hover:border-border-strong',
          canWrite && 'cursor-grab active:cursor-grabbing',
        )}
      >
        {icon === undefined ? (
          <AppIcon id="circle-dot" size={18} className="text-foreground-muted" />
        ) : (
          <CatalogueIcon node={icon.node} frame={icon.frame} size={18} />
        )}
        <span className="max-w-full truncate">{button.name}</span>
      </button>
      {canWrite ? (
        <Menu
          align="start"
          className="absolute top-1.5 right-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          items={[
            {
              label: t('brokers.infrared.remote.renameIcon', 'Rename / icon'),
              icon: 'pencil',
              onSelect: props.onRename,
            },
            {
              label: t('brokers.infrared.remote.learnAgain', 'Learn again'),
              icon: 'radio',
              onSelect: props.onLearn,
            },
            {
              label: t('brokers.infrared.remote.showCode', 'Show code'),
              icon: 'braces',
              /** Opens the code under the tile. */
              onSelect: () => {
                props.onShow(true);
              },
            },
            {
              label: t('brokers.infrared.remote.duplicate', 'Duplicate'),
              icon: 'copy',
              onSelect: props.onDuplicate,
            },
            ...(props.canDelete
              ? [
                  {
                    label: t('brokers.infrared.remote.removeButton', 'Remove'),
                    icon: 'trash-2' as const,
                    tone: 'danger' as const,
                    onSelect: props.onRemove,
                  },
                ]
              : []),
          ]}
          trigger={(state) => (
            <button
              ref={state.buttonRef}
              type="button"
              aria-label={t('brokers.infrared.remote.tileMenu', 'More for {{name}}', {
                name: button.name,
              })}
              aria-expanded={state.isOpen}
              onClick={state.toggle}
              className="flex size-6 items-center justify-center rounded-chip text-foreground-muted hover:bg-surface-high hover:text-foreground"
            >
              <AppIcon id="ellipsis-vertical" size={14} />
            </button>
          )}
        />
      ) : null}
      <Popover
        anchor={anchor}
        isOpen={props.isShowing}
        onClose={() => {
          props.onShow(false);
        }}
        label={t('brokers.infrared.remote.codeOf', 'The code of {{name}}', { name: button.name })}
        width={380}
      >
        <CodeCard button={button} />
      </Popover>
    </div>
  );
}

/**
 * A button's code: what it is, its pulses, and the formats other tools write it in.
 *
 * @param props - The button.
 * @param props.button - It.
 * @returns The card's content.
 */
export function CodeCard(props: { readonly button: InfraredButton }) {
  const { t } = useTranslation();
  const { button } = props;
  const formats = useQuery({
    queryKey: ['brokers', 'infrared', 'formats', button.id, button.code.pulses.length],

    /**
     * Has the hub write the code in the other formats.
     *
     * @returns The formats.
     */
    queryFn: async () => fetchInfraredCodeFormats(button.code),
    staleTime: Infinity,
  });
  const protocol = formats.data?.protocol ?? button.code.protocol ?? null;

  return (
    <div className="flex flex-col gap-3 p-4">
      <span className="flex items-center justify-between gap-3">
        <span className="text-ui font-medium text-foreground">{button.name}</span>
        <ProtocolPill protocol={protocol} />
      </span>
      <span className="font-mono text-mono-caption text-foreground">
        {protocol === null
          ? t('brokers.infrared.remote.rawLine', 'Raw · {{count}} pulses · {{khz}} kHz', {
              count: button.code.pulses.length,
              khz: Math.round(button.code.carrierHz / 1000),
            })
          : `${protocolName(protocol)} · ${protocolLine(protocol)}`}
      </span>
      <PulseStrip pulses={button.code.pulses} className="h-12 border border-border" />
      <span className="text-caption text-foreground-subtle">{pulsesLine(button.code)}</span>
      <span className="text-caption text-foreground-muted">
        {t('brokers.infrared.remote.copyAs', 'Copy as')}
      </span>
      <span className="flex flex-wrap gap-2">
        {formats.data?.broadlink == null ? null : (
          <CopyButton
            value={formats.data.broadlink}
            label={t('brokers.infrared.remote.broadlink', 'Broadlink base64')}
          />
        )}
        {formats.data?.pronto == null ? null : (
          <CopyButton
            value={formats.data.pronto}
            label={t('brokers.infrared.remote.pronto', 'Pronto')}
          />
        )}
        <CopyButton
          value={formats.data?.raw ?? button.code.pulses.join(' ')}
          label={t('brokers.infrared.raw', 'Raw')}
        />
      </span>
    </div>
  );
}

/**
 * Renames the remote, and changes its kind and room.
 *
 * @param props - The remote, the rooms, and how it closes.
 * @param props.remote - The remote.
 * @param props.rooms - The house's rooms.
 * @param props.onClose - Closes it.
 * @returns The dialog.
 */
function EditRemoteDialog(props: {
  readonly remote: InfraredRemoteDetail;
  readonly rooms: readonly { readonly id: string; readonly name: string }[];
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { remote, rooms, onClose } = props;
  const [name, setName] = useState(remote.name);
  const [kind, setKind] = useState<InfraredRemoteKind>(remote.kind);
  const [areaId, setAreaId] = useState(remote.areaId ?? '');
  const save = useMutation({
    /**
     * Saves the remote.
     *
     * @returns It.
     */
    mutationFn: async () =>
      saveInfraredRemote({
        id: remote.id,
        name: name.trim(),
        kind,
        blasterId: remote.blasterId,
        columns: remote.columns,
        areaId: areaId === '' ? null : areaId,
      }),

    /** Reads it again and closes. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brokers', 'infrared'] });
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
      onClose();
    },
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="medium"
      layout="card"
      title={t('brokers.infrared.remote.editTitle', 'Remote')}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={name.trim() === ''}
              isBusy={save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              {t('brokers.infrared.remote.save', 'Save')}
            </Button>
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label={t('brokers.infrared.add.name', 'Name')}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <SelectField
          label={t('brokers.infrared.add.kind', 'Kind')}
          value={kind}
          onChange={(value) => {
            setKind(INFRARED_REMOTE_KINDS.find((each) => each === value) ?? 'other');
          }}
          options={INFRARED_REMOTE_KINDS.map((each) => ({ value: each, label: kindName(each) }))}
        />
        <SelectField
          label={t('brokers.infrared.add.room', 'Room')}
          value={areaId}
          onChange={setAreaId}
          options={[
            { value: '', label: t('brokers.infrared.noRoom', 'No room') },
            ...rooms.map((room) => ({ value: room.id, label: room.name })),
          ]}
        />
        {save.error === null ? null : <Note tone="danger">{toMessage(save.error)}</Note>}
      </div>
    </Modal>
  );
}

/**
 * Renames a button and changes its icon.
 *
 * @param props - The button, and how it closes.
 * @param props.button - The button.
 * @param props.onClose - Closes it.
 * @returns The dialog.
 */
function RenameButtonDialog(props: {
  readonly button: InfraredButton;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { button, onClose } = props;
  const [name, setName] = useState(button.name);
  const [icon, setIcon] = useState(button.icon);
  const save = useMutation({
    /**
     * Saves the button.
     *
     * @returns It.
     */
    mutationFn: async () =>
      saveInfraredButton({
        remoteId: button.remoteId,
        id: button.id,
        cell: button.cell,
        name: name.trim(),
        icon,
        code: button.code,
      }),

    /** Reads the remote again and closes. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brokers', 'infrared'] });
      onClose();
    },
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="medium"
      layout="card"
      title={t('brokers.infrared.remote.renameTitle', 'Rename {{name}}', { name: button.name })}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={name.trim() === ''}
              isBusy={save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              {t('brokers.infrared.remote.save', 'Save')}
            </Button>
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <NameIconField
          value={name}
          onChange={setName}
          icon={icon}
          fallback="circle-dot"
          onIconChange={(picked) => {
            setIcon(picked.id);
          }}
          required
        />
        {save.error === null ? null : <Note tone="danger">{toMessage(save.error)}</Note>}
      </div>
    </Modal>
  );
}
