/**
 * System › Maintenance (board N-Settings-System, docs/releases-and-updates.md 4): every update -
 * Nebula Home, packages, integrations - with Update one and Update all, automatic updates for
 * packages and integrations, how updates run, and Restart and Shut down.
 *
 * Nebula Home never updates by itself: only its Update button does. The settings are edited into
 * a draft and saved together, as on the other settings pages. Seeing the page needs `system:read`;
 * updating `system:update`; restarting and shutting down `system:power`; the settings
 * `settings:write`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  updateChannelSchema,
  updateWindowSchema,
  type JsonValue,
  type SettingsResponse,
  type SystemUpdatesView,
  type UpdateItem,
  type UpdateWindow,
} from '@nebulahome/contracts';
import { AppIcon, Button, Modal, Segmented, Switch, TextField } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { BACKUP_QUERY_KEYS, fetchBackupStatus } from '@/backup/api';
import { toMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/format-time';
import { isSameJson } from '@/routes/settings/backup-text';
import {
  HeroCard,
  HeroIcon,
  RowIcon,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '@/routes/settings/settings-ui';
import { SETTINGS_QUERY_KEYS, fetchServerSettings, updateServerSettings } from '@/settings/api';
import {
  UPDATES_QUERY_KEY,
  checkSystemUpdates,
  fetchSystemUpdates,
  isPlatformUp,
  powerPlatform,
  runSystemUpdates,
} from '@/settings/updates-api';

/** The settings this page edits. */
const KEYS = {
  autoPackages: 'updates.auto.packages',
  autoIntegrations: 'updates.auto.integrations',
  window: 'updates.window',
  backupFirst: 'updates.backup_first',
  channelCore: 'updates.channel.core',
  channelPackages: 'updates.channel.packages',
  channelIntegrations: 'updates.channel.integrations',
} as const;

/** What a dialog of the page is open for. */
type Dialog =
  | {
      readonly kind: 'notes';
      readonly name: string;
      readonly notes: string;
      readonly url: string | null;
    }
  | { readonly kind: 'restart' }
  | { readonly kind: 'shutdown' };

/** What Nebula Home is doing while it does not answer. */
type Waiting = { readonly why: 'restart' | 'update' | 'shutdown'; readonly hasGoneAway: boolean };

/**
 * A row's kind, as its group says it.
 *
 * @param item - The row's item.
 * @returns The group.
 */
function groupOf(item: UpdateItem): 'core' | 'package' | 'integration' {
  return item.kind;
}

/**
 * The key a row is told apart by.
 *
 * @param item - The row's item.
 * @returns It.
 */
function keyOf(item: UpdateItem): string {
  return item.kind === 'core' ? 'core' : `${item.kind}:${item.id}`;
}

/**
 * Renders the Maintenance page.
 *
 * @returns The page.
 */
export function MaintenanceSettings() {
  const { t } = useTranslation();
  const can = useSession((state) => state.can);
  const canUpdate = can('system:update');
  const canPower = can('system:power');
  const canWrite = can('settings:write');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Readonly<Record<string, JsonValue>>>({});
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [isSaving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);

  const updates = useQuery({
    queryKey: UPDATES_QUERY_KEY,

    /**
     * How soon to ask again: often while a round runs, rarely otherwise.
     *
     * @param query - The query, with what it last read.
     * @returns Milliseconds, or false while Nebula Home restarts.
     */
    refetchInterval: (query) =>
      waiting !== null ? false : query.state.data?.round?.status === 'running' ? 2000 : 60_000,

    /**
     * Reads the list.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The list.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchSystemUpdates(signal),
  });
  const settings = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.server,

    /**
     * Reads the settings.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns Every setting.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchServerSettings(signal),
  });
  const backup = useQuery({
    queryKey: BACKUP_QUERY_KEYS.status,

    /**
     * Reads the backups' state, for the quietest time it reports.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The state.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchBackupStatus(signal),
  });

  // While Nebula Home restarts: wait for it to go away and answer again, then read the page anew.
  useEffect(() => {
    if (waiting === null || waiting.why === 'shutdown') {
      return undefined;
    }

    const timer = setInterval(() => {
      void (async (): Promise<void> => {
        const isUp = await isPlatformUp();

        if (!isUp && !waiting.hasGoneAway) {
          setWaiting({ ...waiting, hasGoneAway: true });
        } else if (isUp && waiting.hasGoneAway) {
          window.location.reload();
        }
      })();
    }, 3000);

    return (): void => {
      clearInterval(timer);
    };
  }, [waiting]);

  const stored = new Map((settings.data?.items ?? []).map((item) => [item.key, item.value]));
  /**
   * A setting as the page shows it: the draft's value, or the stored one.
   *
   * @param key - The setting.
   * @returns Its value.
   */
  const shown = (key: string): JsonValue | undefined =>
    key in draft ? draft[key] : stored.get(key);
  const windowParsed = updateWindowSchema.safeParse(shown(KEYS.window));
  const updateWindow: UpdateWindow = windowParsed.success
    ? windowParsed.data
    : { mode: 'quietest', time: '03:00' };
  const channel = updateChannelSchema.catch('stable').parse(shown(KEYS.channelCore));
  const isDirty = Object.keys(draft).length > 0;

  /**
   * Records an edit, or forgets it when it matches what the server holds.
   *
   * @param key - The setting.
   * @param value - Its new value.
   */
  const edit = (key: string, value: JsonValue): void => {
    setSaveError(undefined);

    const next = { ...draft };

    if (isSameJson(stored.get(key), value)) {
      /* eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the keys are this page's
         settings, not input. */
      delete next[key];
    } else {
      next[key] = value;
    }

    setDraft(next);
  };

  /** Sends the draft. */
  const save = (): void => {
    setSaveError(undefined);
    setSaving(true);

    void (async (): Promise<void> => {
      try {
        const answer = await updateServerSettings(draft);

        queryClient.setQueryData<SettingsResponse>(SETTINGS_QUERY_KEYS.server, answer);
        setDraft({});
        await queryClient.invalidateQueries({ queryKey: UPDATES_QUERY_KEY });
      } catch (cause: unknown) {
        setSaveError(toMessage(cause));
      } finally {
        setSaving(false);
      }
    })();
  };

  const check = useMutation({
    /** Asks GitHub again, then reads the list. */
    mutationFn: async (): Promise<void> => {
      await checkSystemUpdates();
      await queryClient.invalidateQueries({ queryKey: UPDATES_QUERY_KEY });
    },
  });
  const run = useMutation({
    /**
     * Starts a round.
     *
     * @param items - What to update; every row when absent.
     */
    mutationFn: async (items?: readonly UpdateItem[]): Promise<void> => {
      await runSystemUpdates(items);
      await queryClient.invalidateQueries({ queryKey: UPDATES_QUERY_KEY });
    },
  });
  const power = useMutation({
    /**
     * Restarts or shuts down Nebula Home.
     *
     * @param action - Which.
     * @returns Which it was.
     */
    mutationFn: async (action: 'restart' | 'shutdown'): Promise<'restart' | 'shutdown'> => {
      await powerPlatform(action);

      return action;
    },

    /**
     * Shows what Nebula Home is doing while it does not answer.
     *
     * @param action - Which it was.
     */
    onSuccess: (action) => {
      setDialog(null);

      setWaiting({ why: action, hasGoneAway: false });
    },
  });

  if (waiting !== null) {
    return (
      <SettingsPage path="/settings/system/maintenance">
        <HeroCard
          leading={<HeroIcon icon="loader-circle" />}
          title={
            waiting.why === 'update'
              ? t('settingsMaintenance.updating', 'Nebula Home is updating')
              : waiting.why === 'restart'
                ? t('settingsMaintenance.restarting', 'Nebula Home is restarting')
                : t('settingsMaintenance.shuttingDown', 'Nebula Home is shutting down')
          }
          subtitle={
            waiting.why === 'shutdown'
              ? t(
                  'settingsMaintenance.shutDownNote',
                  'Start its container again on the machine to come back.',
                )
              : t(
                  'settingsMaintenance.waitingNote',
                  'The page opens again by itself once it answers.',
                )
          }
        />
      </SettingsPage>
    );
  }

  if (updates.data === undefined) {
    return (
      <SettingsPage path="/settings/system/maintenance">
        <p className="text-ui text-foreground-muted">
          {updates.isError
            ? toMessage(updates.error)
            : t('settingsMaintenance.loading', 'Reading the updates…')}
        </p>
      </SettingsPage>
    );
  }

  const data: SystemUpdatesView = updates.data;
  const { core, rows, round } = data;
  const isRoundRunning = round?.status === 'running';
  const quiet = backup.data?.quietTime;
  const groups = [
    { id: 'core', label: t('settingsMaintenance.system', 'System') },
    { id: 'package', label: t('settingsMaintenance.packages', 'Packages') },
    { id: 'integration', label: t('settingsMaintenance.integrations', 'Integrations') },
  ] as const;

  /**
   * Starts a round; a round with Nebula Home in it ends with it restarting.
   *
   * @param items - What to update; every row when absent.
   */
  const startRound = (items?: readonly UpdateItem[]): void => {
    run.mutate(items, {
      /** Waits for Nebula Home when it is in the round. */
      onSuccess: () => {
        if ((items ?? rows.map((row) => row.item)).some((item) => item.kind === 'core')) {
          setWaiting({ why: 'update', hasGoneAway: false });
        }
      },
    });
  };

  return (
    <SettingsPage path="/settings/system/maintenance">
      <HeroCard
        leading={<HeroIcon icon="download" />}
        title={
          rows.length === 0
            ? t('settingsMaintenance.upToDate', 'Everything is up to date')
            : t('settingsMaintenance.available', {
                count: rows.length,
                defaultValue_one: '{{count}} update available',
                defaultValue_other: '{{count}} updates available',
              })
        }
        subtitle={[
          core === null
            ? null
            : t('settingsMaintenance.running', 'Nebula Home {{version}}', {
                version: core.installedVersion,
              }),
          core?.checkedAt == null
            ? null
            : t('settingsMaintenance.checked', 'checked {{when}}', {
                when: relativeTime(core.checkedAt),
              }),
        ]
          .filter((part) => part !== null)
          .join(' · ')}
        actions={
          canUpdate ? (
            <>
              <Button
                variant="bare"
                isBusy={check.isPending}
                onClick={() => {
                  check.mutate();
                }}
              >
                <AppIcon id="refresh-cw" size={16} />
                {t('settingsMaintenance.checkNow', 'Check now')}
              </Button>
              <Button
                isBusy={run.isPending}
                disabled={rows.length === 0 || isRoundRunning}
                onClick={() => {
                  startRound();
                }}
              >
                <AppIcon id="download" size={16} />
                {t('settingsMaintenance.updateAll', 'Update all')}
              </Button>
            </>
          ) : undefined
        }
      />

      {round === null || (round.status === 'done' && round.trigger === 'schedule') ? null : (
        <SettingsSection
          label={
            isRoundRunning
              ? t('settingsMaintenance.roundRunning', 'Updating')
              : t('settingsMaintenance.lastRound', 'Last updates')
          }
        >
          <SettingsRow
            title={
              round.backup === 'taken'
                ? t('settingsMaintenance.backupTaken', 'Backed up first')
                : round.backup === 'recent'
                  ? t('settingsMaintenance.backupRecent', 'A backup of minutes ago was enough')
                  : round.backup === 'failed'
                    ? t(
                        'settingsMaintenance.backupFailed',
                        'The backup first failed: nothing was updated',
                      )
                    : round.backup === 'off'
                      ? t('settingsMaintenance.backupOff', 'No backup first')
                      : t('settingsMaintenance.backingUp', 'Backing up first…')
            }
            note={t('settingsMaintenance.roundStarted', 'Started {{when}}', {
              when: relativeTime(round.startedAt),
            })}
          />
          {round.items.map((entry) => (
            <SettingsRow
              key={keyOf(entry.item)}
              title={
                entry.item.kind === 'core'
                  ? t('settingsMaintenance.nebulaHome', 'Nebula Home')
                  : entry.item.id
              }
              note={
                entry.error === null ? (
                  {
                    pending: t('settingsMaintenance.status.pending', 'Waiting'),
                    running: t('settingsMaintenance.status.running', 'Updating…'),
                    done: t('settingsMaintenance.status.done', 'Updated'),
                    failed: t('settingsMaintenance.status.failed', 'Failed'),
                    skipped: t('settingsMaintenance.status.skipped', 'Skipped'),
                  }[entry.status]
                ) : (
                  <span className="text-danger">{entry.error}</span>
                )
              }
            />
          ))}
        </SettingsSection>
      )}

      {core?.lastUpdate == null || core.lastUpdate.status === 'success' ? null : (
        <SettingsCard>
          <SettingsRow
            leading={
              <RowIcon>
                <AppIcon id="triangle-alert" size={16} />
              </RowIcon>
            }
            title={
              core.lastUpdate.status === 'rolled_back'
                ? t('settingsMaintenance.rolledBack', 'The update to {{version}} was undone', {
                    version: core.lastUpdate.toVersion,
                  })
                : t('settingsMaintenance.updateFailed', 'The update to {{version}} failed', {
                    version: core.lastUpdate.toVersion,
                  })
            }
            note={<span className="text-danger">{core.lastUpdate.error}</span>}
          />
        </SettingsCard>
      )}

      {data.problems.length === 0 ? null : (
        <SettingsCard>
          {data.problems.map((problem) => (
            <SettingsRow
              key={problem}
              title={t('settingsMaintenance.notRead', 'Not everything could be read')}
              note={<span className="text-warning">{problem}</span>}
            />
          ))}
        </SettingsCard>
      )}

      {rows.length === 0 ? null : (
        <SettingsSection label={t('settingsMaintenance.updates', 'Updates')}>
          {groups.map((group) => {
            const inGroup = rows.filter((row) => groupOf(row.item) === group.id);

            return inGroup.length === 0
              ? null
              : [
                  <span
                    key={group.id}
                    className="flex items-center gap-2 pt-3 font-mono text-caption tracking-wider text-foreground-subtle uppercase"
                  >
                    {group.label}
                    <span className="rounded-full bg-surface-high px-1.5 text-foreground-muted">
                      {inGroup.length}
                    </span>
                  </span>,
                  ...inGroup.map((row) => {
                    const refusal = row.item.kind === 'core' ? (core?.refusal ?? null) : null;

                    return (
                      <SettingsRow
                        key={keyOf(row.item)}
                        leading={
                          <RowIcon>
                            <AppIcon
                              id={
                                row.item.kind === 'core'
                                  ? 'circle-dot'
                                  : row.item.kind === 'package'
                                    ? 'package'
                                    : 'plug'
                              }
                              size={16}
                            />
                          </RowIcon>
                        }
                        title={row.name}
                        note={
                          <>
                            <span className="me-2 font-mono">
                              {row.installedVersion} → {row.latestVersion}
                            </span>
                            {refusal ??
                              (row.item.kind === 'core'
                                ? t(
                                    'settingsMaintenance.restartsServices',
                                    'Restarts the services, about 30 s',
                                  )
                                : row.item.kind === 'package'
                                  ? t('settingsMaintenance.restartsPackage', 'Restarts the package')
                                  : t(
                                      'settingsMaintenance.reloadsIntegration',
                                      'Reloads its devices',
                                    ))}
                          </>
                        }
                        control={
                          <div className="flex items-center gap-2">
                            {row.notes === null && row.notesUrl === null ? null : (
                              <Button
                                variant="bare"
                                size="compact"
                                onClick={() => {
                                  if (row.notes === null) {
                                    window.open(row.notesUrl ?? '', '_blank', 'noopener');
                                  } else {
                                    setDialog({
                                      kind: 'notes',
                                      name: `${row.name} ${row.latestVersion}`,
                                      notes: row.notes,
                                      url: row.notesUrl,
                                    });
                                  }
                                }}
                              >
                                <AppIcon id="external-link" size={14} />
                                {t('settingsMaintenance.notes', 'Notes')}
                              </Button>
                            )}
                            {canUpdate ? (
                              <Button
                                variant="ghost"
                                size="compact"
                                disabled={isRoundRunning || refusal !== null}
                                onClick={() => {
                                  startRound([row.item]);
                                }}
                              >
                                {t('settingsMaintenance.update', 'Update')}
                              </Button>
                            ) : null}
                          </div>
                        }
                      />
                    );
                  }),
                ];
          })}
        </SettingsSection>
      )}

      {run.isError ? (
        <SettingsCard>
          <SettingsRow
            title={t('settingsMaintenance.didNotStart', 'The updates did not start')}
            note={<span className="text-danger">{toMessage(run.error)}</span>}
          />
        </SettingsCard>
      ) : null}

      <SettingsSection label={t('settingsMaintenance.automatic', 'Automatic updates')}>
        <SettingsRow
          searchId="updates.auto.packages"
          leading={
            <RowIcon>
              <AppIcon id="package" size={16} />
            </RowIcon>
          }
          title={t('settingsMaintenance.packages', 'Packages')}
          note={t('settingsMaintenance.autoPackagesNote', 'Updated at the time below, each night.')}
          control={
            <Switch
              label={t('settingsMaintenance.packages', 'Packages')}
              isOn={shown(KEYS.autoPackages) === true}
              disabled={!canWrite}
              onChange={(isOn) => {
                edit(KEYS.autoPackages, isOn);
              }}
            />
          }
        />
        <SettingsRow
          searchId="updates.auto.integrations"
          leading={
            <RowIcon>
              <AppIcon id="plug" size={16} />
            </RowIcon>
          }
          title={t('settingsMaintenance.integrations', 'Integrations')}
          note={t(
            'settingsMaintenance.autoIntegrationsNote',
            'Updated at the time below; their devices reload.',
          )}
          control={
            <Switch
              label={t('settingsMaintenance.integrations', 'Integrations')}
              isOn={shown(KEYS.autoIntegrations) === true}
              disabled={!canWrite}
              onChange={(isOn) => {
                edit(KEYS.autoIntegrations, isOn);
              }}
            />
          }
        />
      </SettingsSection>

      <SettingsSection label={t('settingsMaintenance.howTheyRun', 'How updates run')}>
        <SettingsRow
          searchId="updates.window"
          title={t('settingsMaintenance.when', 'When')}
          note={
            updateWindow.mode === 'fixed'
              ? t('settingsMaintenance.whenFixed', "At {{time}} on the house's clock.", {
                  time: updateWindow.time,
                })
              : quiet?.state === 'ready'
                ? t('settingsMaintenance.whenQuietest', 'When the machine is quietest: {{time}}.', {
                    time: quiet.time,
                  })
                : t('settingsMaintenance.whenLearning', 'Learning the load: {{time}} for now.', {
                    time: quiet?.time ?? updateWindow.time,
                  })
          }
          control={
            <div className="flex items-center gap-2">
              {updateWindow.mode === 'fixed' ? (
                <TextField
                  label={t('settingsMaintenance.time', 'Time')}
                  isLabelHidden
                  size="compact"
                  type="time"
                  className="font-mono"
                  disabled={!canWrite}
                  value={updateWindow.time}
                  onChange={(event) => {
                    edit(KEYS.window, { ...updateWindow, time: event.target.value });
                  }}
                />
              ) : null}
              <Segmented
                label={t('settingsMaintenance.when', 'When')}
                disabled={!canWrite}
                value={updateWindow.mode}
                options={[
                  { value: 'fixed', label: t('settingsMaintenance.atATime', 'At a time') },
                  { value: 'quietest', label: t('settingsMaintenance.quietest', 'Quietest') },
                ]}
                onChange={(mode) => {
                  edit(KEYS.window, { ...updateWindow, mode });
                }}
              />
            </div>
          }
        />
        <SettingsRow
          searchId="updates.backup_first"
          title={t('settingsMaintenance.backupFirst', 'Back up first')}
          note={t(
            'settingsMaintenance.backupFirstNote',
            'A backup before each round, unless one finished minutes ago.',
          )}
          control={
            <Switch
              label={t('settingsMaintenance.backupFirst', 'Back up first')}
              isOn={shown(KEYS.backupFirst) !== false}
              disabled={!canWrite}
              onChange={(isOn) => {
                edit(KEYS.backupFirst, isOn);
              }}
            />
          }
        />
        <SettingsRow
          searchId="updates.channel.core"
          title={t('settingsMaintenance.channelCore', 'Nebula Home channel')}
          note={t(
            'settingsMaintenance.channelNote',
            'Beta gets versions first; Dev gets development builds too.',
          )}
          control={
            <Segmented
              label={t('settingsMaintenance.channelCore', 'Nebula Home channel')}
              disabled={!canWrite}
              value={channel}
              options={[
                { value: 'stable', label: t('settingsMaintenance.stable', 'Stable') },
                { value: 'beta', label: t('settingsMaintenance.beta', 'Beta') },
                { value: 'dev', label: t('settingsMaintenance.dev', 'Dev') },
              ]}
              onChange={(value) => {
                edit(KEYS.channelCore, value);
              }}
            />
          }
        />
        {(
          [
            [KEYS.channelPackages, t('settingsMaintenance.channelPackages', 'Packages channel')],
            [
              KEYS.channelIntegrations,
              t('settingsMaintenance.channelIntegrations', 'Integrations channel'),
            ],
          ] as const
        ).map(([key, title]) => (
          <SettingsRow
            key={key}
            searchId={key}
            title={title}
            note={t('settingsMaintenance.noBetasYet', 'Betas are not published yet.')}
            control={
              <Segmented
                label={title}
                disabled
                value="stable"
                options={[
                  { value: 'stable', label: t('settingsMaintenance.stable', 'Stable') },
                  { value: 'beta', label: t('settingsMaintenance.beta', 'Beta') },
                  { value: 'dev', label: t('settingsMaintenance.dev', 'Dev') },
                ]}
                onChange={() => undefined}
              />
            }
          />
        ))}
      </SettingsSection>

      <SettingsSection label={t('settingsMaintenance.power', 'Restart and power')}>
        <SettingsRow
          searchId="system.restart"
          title={t('settingsMaintenance.restartTitle', 'Restart Nebula Home')}
          note={t('settingsMaintenance.restartNote', 'About 30 s without services.')}
          control={
            <Button
              variant="ghost"
              disabled={!canPower}
              onClick={() => {
                setDialog({ kind: 'restart' });
              }}
            >
              <AppIcon id="rotate-ccw" size={16} />
              {t('settingsMaintenance.restart', 'Restart')}
            </Button>
          }
        />
        <SettingsRow
          searchId="system.shutdown"
          title={t('settingsMaintenance.shutdownTitle', 'Shut down')}
          note={t('settingsMaintenance.shutdownNote', 'Until the container starts again.')}
          control={
            <Button
              variant="danger"
              disabled={!canPower}
              onClick={() => {
                setDialog({ kind: 'shutdown' });
              }}
            >
              <AppIcon id="power" size={16} />
              {t('settingsMaintenance.shutdown', 'Shut down')}
            </Button>
          }
        />
      </SettingsSection>

      {canWrite && isDirty ? (
        <div className="sticky bottom-4 flex animate-rise items-center gap-4 rounded-card border border-border-strong bg-surface-raised px-4 py-3 shadow-popover">
          <span className="grow text-ui text-foreground-muted">
            {t('settings.data.unsaved', {
              count: Object.keys(draft).length,
              defaultValue_one: '{{count}} unsaved change',
              defaultValue_other: '{{count}} unsaved changes',
            })}
          </span>
          {saveError === undefined ? null : (
            <span role="alert" className="text-ui text-danger">
              {saveError}
            </span>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setDraft({});
              setSaveError(undefined);
            }}
          >
            {t('common.discard', 'Discard')}
          </Button>
          <Button isBusy={isSaving} onClick={save}>
            {t('common.save', 'Save')}
          </Button>
        </div>
      ) : null}

      {dialog?.kind === 'notes' ? (
        <Modal
          isOpen
          title={dialog.name}
          onClose={() => {
            setDialog(null);
          }}
          footer={
            dialog.url === null ? undefined : (
              <Button
                variant="ghost"
                onClick={() => {
                  window.open(dialog.url ?? '', '_blank', 'noopener');
                }}
              >
                <AppIcon id="external-link" size={16} />
                {t('settingsMaintenance.onGithub', 'On GitHub')}
              </Button>
            )
          }
        >
          <pre className="max-h-[60vh] overflow-auto font-sans text-ui whitespace-pre-wrap text-foreground-muted">
            {dialog.notes === '' ? t('settingsMaintenance.noNotes', 'No notes.') : dialog.notes}
          </pre>
        </Modal>
      ) : null}

      {dialog?.kind === 'restart' || dialog?.kind === 'shutdown' ? (
        <Modal
          isOpen
          title={
            dialog.kind === 'restart'
              ? t('settingsMaintenance.restartConfirm', 'Restart Nebula Home?')
              : t('settingsMaintenance.shutdownConfirm', 'Shut Nebula Home down?')
          }
          description={
            dialog.kind === 'restart'
              ? t(
                  'settingsMaintenance.restartWhat',
                  'Automations, devices and this page stop for about 30 seconds.',
                )
              : t(
                  'settingsMaintenance.shutdownWhat',
                  'Everything stops until the container is started again on the machine: this page cannot start it.',
                )
          }
          onClose={() => {
            setDialog(null);
          }}
          footer={
            <>
              {power.isError ? (
                <span role="alert" className="grow text-ui text-danger">
                  {toMessage(power.error)}
                </span>
              ) : null}
              <Button
                variant="bare"
                onClick={() => {
                  setDialog(null);
                }}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                variant={dialog.kind === 'restart' ? 'primary' : 'danger'}
                isBusy={power.isPending}
                onClick={() => {
                  power.mutate(dialog.kind);
                }}
              >
                {dialog.kind === 'restart'
                  ? t('settingsMaintenance.restart', 'Restart')
                  : t('settingsMaintenance.shutdown', 'Shut down')}
              </Button>
            </>
          }
        >
          {null}
        </Modal>
      ) : null}
    </SettingsPage>
  );
}
