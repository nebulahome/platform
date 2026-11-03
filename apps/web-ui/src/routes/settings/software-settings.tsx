/**
 * System › Software (board N-Settings-System, docs/releases-and-updates.md 4): every update -
 * Nebula Home, packages, integrations - in a card per component, each with its own settings:
 * automatic updates and when (packages and integrations only), the release channel, Back up
 * first. Then Restart and developer mode, which for now offers the Dev channel and nothing else.
 *
 * Nebula Home never updates by itself: only its Update button does. The settings are edited into
 * a draft and saved together, as on the other settings pages. Seeing the page needs `system:read`;
 * updating `system:update`; restarting `system:power`; the settings `settings:write`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  channelIn,
  updateChannelSchema,
  updateWindowSchema,
  type JsonValue,
  type SettingsResponse,
  type SystemUpdatesView,
  type UpdateChannel,
  type UpdateItem,
  type UpdateWindow,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  Checkbox,
  cn,
  IconButton,
  Logo,
  Modal,
  Segmented,
  Switch,
  TextField,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { BACKUP_QUERY_KEYS, fetchBackupStatus } from '@/backup/api';
import { toMessage } from '@/lib/error-message';
import { formatUptime } from '@/lib/format-bytes';
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
  PLATFORM_QUERY_KEY,
  UPDATES_QUERY_KEY,
  checkSystemUpdates,
  dismissLastPlatformUpdate,
  fetchPlatformState,
  fetchSystemUpdates,
  restartPlatform,
  runSystemUpdates,
} from '@/settings/updates-api';
import { usePlatform } from '@/system/platform-store';

/** The page's own path. */
const PATH = '/settings/system/software';

/** The developer mode switch: for now it only offers the Dev channel. */
const DEVELOPER_MODE = 'system.developer_mode';

/** A component the page has a card for. */
type Kind = UpdateItem['kind'];

/** One update, ready to install. */
type SystemUpdateRow = SystemUpdatesView['rows'][number];

/** Each component's settings and colours, as the board draws them. */
const COMPONENTS = [
  {
    kind: 'core',
    anchor: 'sw-core',
    auto: null,
    window: null,
    channel: 'updates.channel.core',
    backup: 'updates.backup_first.core',
    dot: 'bg-primary',
    text: 'text-primary',
    chip: 'border-primary/28 bg-primary/12 text-primary',
  },
  {
    kind: 'package',
    anchor: 'sw-packages',
    auto: 'updates.auto.packages',
    window: 'updates.window.packages',
    channel: 'updates.channel.packages',
    backup: 'updates.backup_first.packages',
    dot: 'bg-violet',
    text: 'text-violet',
    chip: 'border-violet/28 bg-violet/12 text-violet',
  },
  {
    kind: 'integration',
    anchor: 'sw-integrations',
    auto: 'updates.auto.integrations',
    window: 'updates.window.integrations',
    channel: 'updates.channel.integrations',
    backup: 'updates.backup_first.integrations',
    dot: 'bg-cyan',
    text: 'text-cyan',
    chip: 'border-cyan/28 bg-cyan/10 text-cyan',
  },
] as const;

/** What a dialog of the page is open for. */
type Dialog =
  | {
      readonly kind: 'notes';
      readonly name: string;
      readonly notes: string;
      readonly url: string | null;
    }
  | { readonly kind: 'restart' }
  | { readonly kind: 'developer' };

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
 * The channel a version was released on, read from its suffix as the Hub reads it.
 *
 * @param version - The version.
 * @returns Beta or Dev; null for a stable release.
 */
function prereleaseOf(version: string): 'beta' | 'dev' | null {
  return version.includes('-beta.') ? 'beta' : version.includes('-alpha.') ? 'dev' : null;
}

/**
 * How long Nebula Home has run, in words, as {@link relativeTime} reads the clock.
 *
 * @param startedAt - When it started.
 * @returns The time, such as 10 h 21 min.
 */
function uptimeSince(startedAt: Date): string {
  return formatUptime(Math.max(0, (Date.now() - startedAt.getTime()) / 1000));
}

/**
 * Renders the Software page.
 *
 * @returns The page.
 */
export function SoftwareSettings() {
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
  const [isAcknowledged, setAcknowledged] = useState(false);
  const [closed, setClosed] = useState<ReadonlySet<Kind>>(new Set());

  const updates = useQuery({
    queryKey: UPDATES_QUERY_KEY,

    /**
     * How soon to ask again: often while a round runs, rarely otherwise.
     *
     * @param query - The query, with what it last read.
     * @returns Milliseconds.
     */
    refetchInterval: (query) => (query.state.data?.round?.status === 'running' ? 2000 : 60_000),

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
  const platform = useQuery({
    queryKey: PLATFORM_QUERY_KEY,

    /**
     * Reads Nebula Home's own state, for how long it has run.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The state.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchPlatformState(signal),
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

  const stored = new Map((settings.data?.items ?? []).map((item) => [item.key, item.value]));
  /**
   * A setting as the page shows it: the draft's value, or the stored one.
   *
   * @param key - The setting.
   * @returns Its value.
   */
  const shown = (key: string): JsonValue | undefined =>
    key in draft ? draft[key] : stored.get(key);
  const isDeveloperMode = shown(DEVELOPER_MODE) === true;
  /**
   * A component's channel as the page shows it: Dev reads as Beta without developer mode.
   *
   * @param key - The channel's setting.
   * @returns The channel.
   */
  const channelOf = (key: string): UpdateChannel =>
    channelIn(updateChannelSchema.catch('stable').parse(shown(key)), isDeveloperMode);
  const isDirty = Object.keys(draft).length > 0;

  /**
   * Records edits, forgetting any that match what the server holds.
   *
   * @param changes - The settings and their new values.
   */
  const edit = (changes: Readonly<Record<string, JsonValue>>): void => {
    setSaveError(undefined);
    setDraft((current) => {
      const next = { ...current };

      for (const [key, value] of Object.entries(changes)) {
        if (isSameJson(stored.get(key), value)) {
          /* eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the keys are this
             page's settings, not input. */
          delete next[key];
        } else {
          next[key] = value;
        }
      }

      return next;
    });
  };

  /**
   * Turns developer mode on or off. Off, every Dev channel goes to Beta with it.
   *
   * @param isOn - Which.
   */
  const setDeveloperMode = (isOn: boolean): void => {
    edit({
      [DEVELOPER_MODE]: isOn,
      ...(isOn
        ? {}
        : Object.fromEntries(
            COMPONENTS.filter((each) => shown(each.channel) === 'dev').map((each) => [
              each.channel,
              'beta',
            ]),
          )),
    });
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
  const dismiss = useMutation({
    /** Forgets how the last update ended, then reads the list. */
    mutationFn: async (): Promise<void> => {
      await dismissLastPlatformUpdate();
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
  const restart = useMutation({
    /** Restarts Nebula Home. */
    mutationFn: async (): Promise<void> => {
      await restartPlatform();
    },

    /** Shows the restart at once; the supervisor tells every other page the same. */
    onSuccess: () => {
      setDialog(null);

      const version = updates.data?.core?.installedVersion;

      if (version !== undefined) {
        usePlatform.getState().follow({
          kind: 'restart',
          phase: 'stopping',
          fromVersion: version,
          toVersion: null,
          percent: null,
          backupBytes: null,
          downloadBytes: null,
          startedAt: new Date(),
        });
      }
    },
  });

  const state = platform.data;
  const line =
    state === undefined
      ? undefined
      : [
          t('settingsMaintenance.runningFor', 'Running for {{uptime}}', {
            uptime: uptimeSince(state.startedAt),
          }),
          state.machine === null
            ? state.version
            : t('settingsMaintenance.versionOn', '{{version}} on {{machine}}', {
                version: state.version,
                machine: state.machine,
              }),
        ].join(' · ');
  const badge = isDeveloperMode ? (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-warning/30 bg-warning/10 px-2.5 text-caption font-medium whitespace-nowrap text-warning">
      <AppIcon id="code-xml" size={12} />
      {t('settingsMaintenance.developerMode', 'Developer mode')}
    </span>
  ) : null;

  if (updates.data === undefined) {
    return (
      <SettingsPage path={PATH} badge={badge} line={line}>
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
  /**
   * A component's rows.
   *
   * @param kind - The component.
   * @returns What it has to update.
   */
  const rowsOf = (kind: Kind): readonly SystemUpdateRow[] =>
    rows.filter((row) => row.item.kind === kind);
  const names: Readonly<Record<Kind, string>> = {
    core: t('settingsMaintenance.core', 'Core'),
    package: t('settingsMaintenance.packages', 'Packages'),
    integration: t('settingsMaintenance.integrations', 'Integrations'),
  };
  const descriptions: Readonly<Record<Kind, string>> = {
    core: t(
      'settingsMaintenance.coreNote',
      'The heart of Nebula Home. Updating it restarts the services.',
    ),
    package: t('settingsMaintenance.packagesNote', 'Extra features you add to Nebula Home.'),
    integration: t(
      'settingsMaintenance.integrationsNote',
      'Connections to your devices and services.',
    ),
  };
  /**
   * How many updates, in words.
   *
   * @param count - How many.
   * @returns The words.
   */
  const countOf = (count: number): string =>
    t('settingsMaintenance.updateCount', {
      count,
      defaultValue_one: '{{count}} update',
      defaultValue_other: '{{count}} updates',
    });

  /**
   * Starts a round. One with Nebula Home in it ends with every page showing the update, once the
   * supervisor takes it up (platform-overlay.tsx).
   *
   * @param items - What to update; every row when absent.
   */
  const startRound = (items?: readonly UpdateItem[]): void => {
    run.mutate(items);
  };

  /**
   * One update, ready to install.
   *
   * @param row - The update.
   * @returns Its row.
   */
  const updateRow = (row: SystemUpdateRow): ReactNode => {
    const refusal = row.item.kind === 'core' ? (core?.refusal ?? null) : null;
    const prerelease = prereleaseOf(row.latestVersion);
    const tone = COMPONENTS.find((each) => each.kind === row.item.kind)?.text;

    return (
      <SettingsRow
        key={keyOf(row.item)}
        leading={
          <RowIcon>
            <span className={cn('font-mono text-ui', tone)}>
              {row.name.slice(0, 1).toUpperCase()}
            </span>
          </RowIcon>
        }
        title={row.name}
        note={
          <>
            <span className="inline-flex items-center gap-1.5 font-mono">
              {row.installedVersion}
              <AppIcon id="arrow-right" size={12} />
              <span className="text-foreground">{row.latestVersion}</span>
              {prerelease === null ? null : (
                <span className="rounded-md bg-violet/12 px-1.5 text-label text-violet uppercase">
                  {prerelease}
                </span>
              )}
            </span>
            {refusal === null ? null : <span className="ms-2">{refusal}</span>}
          </>
        }
        control={
          <>
            {row.notes === null && row.notesUrl === null ? null : (
              <Button
                variant="bare"
                size="compact"
                aria-label={t('settingsMaintenance.notesOf', 'Release notes for {{name}}', {
                  name: row.name,
                })}
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
          </>
        }
      />
    );
  };

  return (
    <SettingsPage path={PATH} badge={badge} line={line}>
      <HeroCard
        leading={<HeroIcon icon="download" />}
        title={
          rows.length === 0
            ? t('settingsMaintenance.upToDate', 'Everything is up to date')
            : t('settingsMaintenance.ready', {
                count: rows.length,
                defaultValue_one: '{{count}} update ready',
                defaultValue_other: '{{count}} updates ready',
              })
        }
        subtitle={
          core?.checkedAt == null
            ? undefined
            : t('settingsMaintenance.checked', 'Checked {{when}}', {
                when: relativeTime(core.checkedAt),
              })
        }
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
      >
        {rows.length === 0 ? null : (
          <div className="flex flex-col gap-3 pt-1">
            <div aria-hidden="true" className="flex h-1.5 gap-1">
              {COMPONENTS.flatMap((each) =>
                rowsOf(each.kind).map((row) => (
                  <span key={keyOf(row.item)} className={cn('flex-1 rounded-pill', each.dot)} />
                )),
              )}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {COMPONENTS.map((each) => (
                <a
                  key={each.kind}
                  href={`#${each.anchor}`}
                  className="flex items-center gap-2 text-ui-sm text-foreground-muted hover:text-foreground"
                >
                  <span aria-hidden="true" className={cn('size-2 rounded-full', each.dot)} />
                  <span className="font-medium text-foreground">{names[each.kind]}</span>
                  {countOf(rowsOf(each.kind).length)}
                </a>
              ))}
            </div>
          </div>
        )}
      </HeroCard>

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
                    // Nebula Home's is done once the updater starts; a row still here after
                    // that means it did not restart, and the card below says why.
                    done:
                      entry.item.kind === 'core'
                        ? t('settingsMaintenance.status.coreStarted', 'Update started')
                        : t('settingsMaintenance.status.done', 'Updated'),
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
            control={
              canUpdate ? (
                <Button
                  variant="bare"
                  size="compact"
                  className="px-2"
                  aria-label={t('settingsMaintenance.dismissUpdate', 'Dismiss')}
                  title={t('settingsMaintenance.dismissUpdate', 'Dismiss')}
                  disabled={dismiss.isPending}
                  onClick={() => {
                    dismiss.mutate();
                  }}
                >
                  <AppIcon id="x" size={16} />
                </Button>
              ) : undefined
            }
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

      {run.isError ? (
        <SettingsCard>
          <SettingsRow
            title={t('settingsMaintenance.didNotStart', 'The updates did not start')}
            note={<span className="text-danger">{toMessage(run.error)}</span>}
          />
        </SettingsCard>
      ) : null}

      <SettingsSection label={t('settingsMaintenance.components', 'Components')} isBare>
        <div className="flex flex-col gap-4">
          {COMPONENTS.map((each) => {
            const inKind = rowsOf(each.kind);
            const isOpen = !closed.has(each.kind);
            const name = names[each.kind];
            const channel = channelOf(each.channel);
            const isCore = each.kind === 'core';
            const isAuto = each.auto !== null && shown(each.auto) === true;
            const updateWindow: UpdateWindow =
              each.window === null
                ? { mode: 'quietest', time: '03:00' }
                : updateWindowSchema
                    .catch({ mode: 'quietest', time: '03:00' })
                    .parse(shown(each.window));

            return (
              <section
                key={each.kind}
                id={each.anchor}
                aria-label={name}
                className="scroll-mt-24 overflow-hidden rounded-card border border-border bg-surface shadow-edge"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 pt-5 pb-4.5">
                  <span
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-tile border',
                      each.chip,
                    )}
                  >
                    {isCore ? (
                      <Logo size={18} />
                    ) : (
                      <AppIcon id={each.kind === 'package' ? 'package' : 'plug'} size={18} />
                    )}
                  </span>
                  <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.75">
                    <span className="flex flex-wrap items-center gap-2.5">
                      <span className="text-subhead font-medium text-foreground">{name}</span>
                      <span className="rounded-pill bg-surface-raised px-2 py-0.5 font-mono text-label text-foreground-muted">
                        {inKind.length === 0
                          ? t('settingsMaintenance.upToDateShort', 'Up to date')
                          : countOf(inKind.length)}
                      </span>
                    </span>
                    <span className="text-ui-sm text-foreground-subtle">
                      {descriptions[each.kind]}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canUpdate && inKind.length > 0 ? (
                      <Button
                        variant="ghost"
                        size="compact"
                        aria-label={t('settingsMaintenance.updateAllOf', 'Update all {{name}}', {
                          name,
                        })}
                        disabled={isRoundRunning || (isCore && (core?.refusal ?? null) !== null)}
                        onClick={() => {
                          startRound(inKind.map((row) => row.item));
                        }}
                      >
                        {inKind.length === 1
                          ? t('settingsMaintenance.update', 'Update')
                          : t('settingsMaintenance.updateN', 'Update {{count}}', {
                              count: inKind.length,
                            })}
                      </Button>
                    ) : null}
                    <IconButton
                      variant="bare"
                      className="size-9 border-border-strong"
                      label={
                        isOpen
                          ? t('settingsMaintenance.hideSettings', 'Hide {{name}} settings', {
                              name,
                            })
                          : t('settingsMaintenance.showSettings', 'Show {{name}} settings', {
                              name,
                            })
                      }
                      aria-expanded={isOpen}
                      aria-controls={`${each.anchor}-settings`}
                      onClick={() => {
                        const next = new Set(closed);

                        if (isOpen) {
                          next.add(each.kind);
                        } else {
                          next.delete(each.kind);
                        }

                        setClosed(next);
                      }}
                    >
                      <AppIcon
                        id="chevron-down"
                        size={16}
                        className={cn(
                          'transition-transform duration-250 ease-out motion-reduce:transition-none',
                          isOpen && 'rotate-180',
                        )}
                      />
                    </IconButton>
                  </div>
                </div>

                {/* Folded rather than removed, so it can open and shut; what is folded away is
                    inert, out of reach of the keyboard and a screen reader. */}
                <div
                  className={cn(
                    'grid transition-[grid-template-rows,opacity] duration-250 ease-out motion-reduce:transition-none',
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                  )}
                  inert={!isOpen}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div
                      id={`${each.anchor}-settings`}
                      className="mx-3 rounded-tile border border-border bg-canvas/40 px-4"
                    >
                      {each.auto === null ? null : (
                        <SettingsRow
                          searchId={each.auto}
                          title={t('settingsMaintenance.automatic', 'Automatic updates')}
                          note={
                            isAuto
                              ? t('settingsMaintenance.autoOn', 'Installs new versions on its own.')
                              : t(
                                  'settingsMaintenance.autoOff',
                                  'New versions wait until you install them.',
                                )
                          }
                          control={
                            <Switch
                              label={t(
                                'settingsMaintenance.autoOf',
                                'Update {{name}} automatically',
                                {
                                  name,
                                },
                              )}
                              isOn={isAuto}
                              disabled={!canWrite}
                              onChange={(isOn) => {
                                edit({ [each.auto]: isOn });
                              }}
                            />
                          }
                        />
                      )}
                      {each.window === null || !isAuto ? null : (
                        <SettingsRow
                          searchId={each.window}
                          title={t('settingsMaintenance.when', 'When')}
                          note={
                            updateWindow.mode === 'fixed'
                              ? t('settingsMaintenance.whenFixed', 'Every day at {{time}}.', {
                                  time: updateWindow.time,
                                })
                              : quiet?.state === 'ready'
                                ? t(
                                    'settingsMaintenance.whenQuietest',
                                    'When the house is quietest: {{time}}.',
                                    { time: quiet.time },
                                  )
                                : t(
                                    'settingsMaintenance.whenLearning',
                                    'Learning when the house is idle: {{time}} for now.',
                                    { time: quiet?.time ?? updateWindow.time },
                                  )
                          }
                          control={
                            <>
                              {updateWindow.mode === 'fixed' ? (
                                <TextField
                                  label={t('settingsMaintenance.timeOf', '{{name}} update time', {
                                    name,
                                  })}
                                  isLabelHidden
                                  size="compact"
                                  type="time"
                                  className="font-mono"
                                  disabled={!canWrite}
                                  value={updateWindow.time}
                                  onChange={(event) => {
                                    edit({
                                      [each.window]: { ...updateWindow, time: event.target.value },
                                    });
                                  }}
                                />
                              ) : null}
                              <Segmented
                                label={t('settingsMaintenance.whenOf', 'When {{name}} update', {
                                  name,
                                })}
                                disabled={!canWrite}
                                value={updateWindow.mode}
                                options={[
                                  {
                                    value: 'quietest',
                                    label: t('settingsMaintenance.quietest', 'Quietest hour'),
                                  },
                                  {
                                    value: 'fixed',
                                    label: t('settingsMaintenance.atATime', 'Set time'),
                                  },
                                ]}
                                onChange={(mode) => {
                                  edit({ [each.window]: { ...updateWindow, mode } });
                                }}
                              />
                            </>
                          }
                        />
                      )}
                      <SettingsRow
                        searchId={each.channel}
                        title={
                          isCore
                            ? t('settingsMaintenance.releaseChannel', 'Release channel')
                            : t('settingsMaintenance.hubVersions', 'Versions in the Hub')
                        }
                        note={
                          isCore
                            ? {
                                stable: t(
                                  'settingsMaintenance.coreStable',
                                  'Gets tested releases only.',
                                ),
                                beta: t(
                                  'settingsMaintenance.coreBeta',
                                  'Gets new releases earlier. They may still have bugs.',
                                ),
                                dev: t(
                                  'settingsMaintenance.coreDev',
                                  'Gets every build as soon as it is made. Things may break.',
                                ),
                              }[channel]
                            : {
                                stable: t(
                                  'settingsMaintenance.hubStable',
                                  'The Hub shows stable versions only.',
                                ),
                                beta: t(
                                  'settingsMaintenance.hubBeta',
                                  'The Hub also shows beta versions when you browse.',
                                ),
                                dev: t(
                                  'settingsMaintenance.hubDev',
                                  'The Hub shows every build, beta and dev included.',
                                ),
                              }[channel]
                        }
                        control={
                          <Segmented
                            label={t('settingsMaintenance.channelOf', '{{name}} channel', { name })}
                            disabled={!canWrite}
                            value={channel}
                            options={[
                              { value: 'stable', label: t('settingsMaintenance.stable', 'Stable') },
                              { value: 'beta', label: t('settingsMaintenance.beta', 'Beta') },
                              ...(isDeveloperMode
                                ? [
                                    {
                                      value: 'dev' as const,
                                      label: t('settingsMaintenance.dev', 'Dev'),
                                    },
                                  ]
                                : []),
                            ]}
                            onChange={(value) => {
                              edit({ [each.channel]: value });
                            }}
                          />
                        }
                      />
                      <SettingsRow
                        searchId={each.backup}
                        title={t('settingsMaintenance.backupFirst', 'Back up first')}
                        note={
                          shown(each.backup) === false
                            ? t(
                                'settingsMaintenance.backupFirstOff',
                                'Installs updates without taking a backup.',
                              )
                            : t(
                                'settingsMaintenance.backupFirstOn',
                                'Takes a backup before each update, so you can roll back.',
                              )
                        }
                        control={
                          <Switch
                            label={t(
                              'settingsMaintenance.backupFirstOf',
                              'Back up before updating {{name}}',
                              {
                                name,
                              },
                            )}
                            isOn={shown(each.backup) !== false}
                            disabled={!canWrite}
                            onChange={(isOn) => {
                              edit({ [each.backup]: isOn });
                            }}
                          />
                        }
                      />
                    </div>
                  </div>
                </div>

                {inKind.length === 0 ? (
                  <div
                    className={cn(
                      'transition-[height] duration-250 ease-out motion-reduce:transition-none',
                      isOpen ? 'h-3' : 'h-0',
                    )}
                  />
                ) : (
                  <div
                    className={cn(
                      'flex flex-col px-5 pb-1.5 transition-[padding] duration-250 ease-out motion-reduce:transition-none',
                      isOpen ? 'pt-2' : 'pt-0',
                    )}
                  >
                    <span
                      className={cn(
                        'font-mono text-label text-foreground-subtle uppercase transition-[padding] duration-250 ease-out motion-reduce:transition-none',
                        isOpen ? 'pt-2.5' : 'pt-0',
                      )}
                    >
                      {t('settingsMaintenance.readyToInstall', 'Ready to install')}
                    </span>
                    <div>{inKind.map(updateRow)}</div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection label={t('settingsMaintenance.advanced', 'Advanced')} isBare>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
          <SettingsCard>
            <SettingsRow
              searchId="system.restart"
              leading={
                <RowIcon>
                  <AppIcon id="rotate-ccw" size={16} />
                </RowIcon>
              }
              title={t('settingsMaintenance.restart', 'Restart')}
              note={t(
                'settingsMaintenance.restartNote',
                'Restarts Nebula Home. Devices and automations pause until it is back.',
              )}
              control={
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={!canPower}
                  onClick={() => {
                    setDialog({ kind: 'restart' });
                  }}
                >
                  {t('settingsMaintenance.restart', 'Restart')}
                </Button>
              }
            />
          </SettingsCard>
          <SettingsCard
            className={cn(
              'transition-colors duration-200',
              isDeveloperMode && 'warning-glow border-warning/35 [--glow-at:100%_0%]',
            )}
          >
            <SettingsRow
              searchId={DEVELOPER_MODE}
              leading={
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-field border transition-colors duration-200',
                    isDeveloperMode
                      ? 'border-warning/30 bg-warning/14 text-warning'
                      : 'border-border-strong bg-surface-raised text-foreground-muted',
                  )}
                >
                  <AppIcon id="code-xml" size={16} />
                </span>
              }
              title={t('settingsMaintenance.developerMode', 'Developer mode')}
              note={
                isDeveloperMode
                  ? t(
                      'settingsMaintenance.developerOn',
                      'The Dev channel is offered. Turn it off when you are done.',
                    )
                  : t(
                      'settingsMaintenance.developerOff',
                      'Adds tools for building and testing, starting with the Dev channel.',
                    )
              }
              control={
                <Switch
                  label={t('settingsMaintenance.developerMode', 'Developer mode')}
                  tone="warning"
                  isOn={isDeveloperMode}
                  disabled={!canWrite}
                  onChange={(isOn) => {
                    if (isOn) {
                      setAcknowledged(false);
                      setDialog({ kind: 'developer' });
                    } else {
                      setDeveloperMode(false);
                    }
                  }}
                />
              }
            />
          </SettingsCard>
        </div>
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

      {dialog?.kind === 'restart' ? (
        <Modal
          isOpen
          title={t('settingsMaintenance.restartConfirm', 'Restart Nebula Home?')}
          description={t(
            'settingsMaintenance.restartWhat',
            'Automations, devices and this page stop for about 30 seconds.',
          )}
          onClose={() => {
            setDialog(null);
          }}
          footer={
            <>
              {restart.isError ? (
                <span role="alert" className="grow text-ui text-danger">
                  {toMessage(restart.error)}
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
                isBusy={restart.isPending}
                onClick={() => {
                  restart.mutate();
                }}
              >
                {t('settingsMaintenance.restart', 'Restart')}
              </Button>
            </>
          }
        >
          {null}
        </Modal>
      ) : null}

      {dialog?.kind === 'developer' ? (
        <Modal
          isOpen
          className="warning-glow backdrop:backdrop-blur-[6px]"
          lead={
            <span className="flex size-11 shrink-0 items-center justify-center rounded-inner border border-warning/30 bg-warning/14 text-warning">
              <AppIcon id="triangle-alert" size={20} />
            </span>
          }
          title={t('settingsMaintenance.developerConfirm', 'Turn on developer mode?')}
          description={t(
            'settingsMaintenance.developerWhat',
            'It adds tools for building and testing. Used the wrong way, they can stop devices and automations from working.',
          )}
          onClose={() => {
            setDialog(null);
          }}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setDialog(null);
                }}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                className="bg-warning text-canvas hover:enabled:bg-warning/90 disabled:bg-surface-high disabled:text-foreground-subtle disabled:opacity-100"
                disabled={!isAcknowledged}
                onClick={() => {
                  setDeveloperMode(true);
                  setDialog(null);
                }}
              >
                {t('settingsMaintenance.developerTurnOn', 'Turn on developer mode')}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2.5 rounded-inner border border-border bg-canvas/40 px-4 py-3.5">
              <span className="font-mono text-label text-foreground-subtle uppercase">
                {t('settingsMaintenance.developerTurnsOn', 'It turns on')}
              </span>
              <span className="flex items-center gap-2.5 text-ui text-foreground">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
                {t(
                  'settingsMaintenance.developerDevChannel',
                  'The Dev channel for Core, Packages and Integrations',
                )}
              </span>
            </div>
            <Checkbox
              label={t(
                'settingsMaintenance.developerAcknowledge',
                'I understand that problems caused in developer mode are on me, and I have a recent backup.',
              )}
              tone="warning"
              isChecked={isAcknowledged}
              onChange={setAcknowledged}
            />
          </div>
        </Modal>
      ) : null}
    </SettingsPage>
  );
}
