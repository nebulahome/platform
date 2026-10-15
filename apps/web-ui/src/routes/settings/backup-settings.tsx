/**
 * Backups: when they run and what they take, where they go, the key they are encrypted with, and
 * the archives to restore from.
 *
 * The schedule and the parts are settings, edited into a draft and saved together like the other
 * server settings; saving them tells the backup service at once, and the next run on this page is
 * its answer. The locations are saved as they are changed, one dialog each. Every size here is an
 * estimate - what is on disk now, or the last backup's measured parts grown in proportion - and
 * says so: an archive is compressed and encrypted, and its true size is known once it is made.
 *
 * Seeing all of it needs `settings:read`; changing it `settings:write`; the key and restoring
 * `backup:restore`, the owner's alone by default.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  backupFrequencySchema,
  backupScheduleSchema,
  backupSectionsSchema,
  type BackupArchive,
  type BackupFrequency,
  type BackupLocationView,
  type BackupSchedule,
  type BackupSections,
  type BackupStatusView,
  type DayOfWeek,
  type JsonValue,
  type SettingsResponse,
} from '@nebulahome/contracts';
import {
  Badge,
  Button,
  Modal,
  Panel,
  PanelNote,
  PanelRow,
  Segmented,
  Switch,
  TextField,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import {
  BACKUP_QUERY_KEYS,
  cancelBackup,
  downloadBackupKey,
  fetchBackupArchives,
  fetchBackupLocations,
  fetchBackupRuns,
  fetchBackupStatus,
  startBackup,
  updateBackupLocation,
} from '@/backup/api';
import { expectedArchiveBytes, retentionSummary } from '@/backup/estimates';
import { useBackupProgress } from '@/backup/use-backup-progress';
import { PasswordField } from '@/components/password-field';
import { WeekdayPicker } from '@/components/weekday-picker';
import { defineMessage, text, translate, type Message } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { formatBytes } from '@/lib/format-bytes';
import { absoluteTime, durationText, relativeTime } from '@/lib/format-time';
import { BackupLocationDialog } from '@/routes/settings/backup-location-dialog';
import { BackupProgressCard } from '@/routes/settings/backup-progress-card';
import {
  browserTimeZone,
  isSameJson,
  kindName,
  phaseName,
  runOutcome,
  sectionName,
  targetText,
  triggerName,
} from '@/routes/settings/backup-text';
import { QuietProfile } from '@/routes/settings/quiet-profile';
import { RestoreDialog } from '@/routes/settings/restore-dialog';
import { SETTINGS_QUERY_KEYS, fetchServerSettings, updateServerSettings } from '@/settings/api';

/** The settings this page edits. */
const KEYS = {
  enabled: 'backup.enabled',
  sections: 'backup.sections',
  schedule: 'backup.schedule',
  frequency: 'backup.frequency',
} as const;

/** What the page falls back to until the settings are read. */
const DEFAULT_SCHEDULE: BackupSchedule = { mode: 'quietest', time: '03:00', timezone: 'UTC' };

/** The optional parts, with a line saying what each is. */
const OPTIONAL_SECTIONS: readonly {
  readonly key: keyof BackupSections;
  readonly note: Message;
}[] = [
  {
    key: 'history',
    note: defineMessage(
      'backup.sectionNotes.history',
      'Readings, state changes, automation traces and logs',
    ),
  },
  {
    key: 'packages',
    note: defineMessage(
      'backup.sectionNotes.packages',
      'The installed feature packages and what they keep',
    ),
  },
];

/**
 * Saves a file the browser holds.
 *
 * @param name - The file's name.
 * @param text - Its content.
 */
function saveFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');

  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** What the key dialog needs. */
type KeyDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onDownloaded: () => void;
};

/**
 * Downloading the backup key, with the password typed again.
 *
 * @param props - See {@link KeyDialogProps}.
 * @returns The dialog.
 */
function KeyDialog(props: KeyDialogProps) {
  const { t } = useTranslation();
  const { isOpen, onClose, onDownloaded } = props;
  const [password, setPassword] = useState('');
  const download = useMutation({
    /**
     * Fetches the key file.
     *
     * @returns The file.
     */
    mutationFn: async () => downloadBackupKey(password),
    /**
     * Saves the file and closes.
     *
     * @param file - The key file.
     */
    onSuccess: (file) => {
      saveFile(
        `nebulahome-backup-key-${file.keyId.slice(0, 8)}.json`,
        `${JSON.stringify(file, null, 2)}\n`,
      );
      setPassword('');
      onDownloaded();
      onClose();
    },
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="small"
      closesOnBackdrop={false}
      title={t('backup.key.downloadTitle', 'Download the backup key')}
      description={t(
        'backup.key.downloadNote',
        'Keep it somewhere other than this machine: a password manager, a USB stick in a drawer. Without it, a backup opens nowhere else; with it, anybody can open every backup.',
      )}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            isBusy={download.isPending}
            disabled={password === ''}
            onClick={() => {
              download.mutate();
            }}
          >
            {t('common.download', 'Download')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <PasswordField
          label={t('backup.key.password', 'Your password')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          hasRules={false}
        />
        {download.isError ? (
          <p role="alert" className="text-ui text-danger">
            {toMessage(download.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * The line under the switch: the next backup, and the last.
 *
 * @param status - The backups' state.
 * @param isEnabled - Whether they are on, as the page shows it.
 * @returns The line.
 */
function scheduleNote(status: BackupStatusView | undefined, isEnabled: boolean): ReactNode {
  const last = status?.lastBackup;
  const lastText =
    last?.finishedAt == null
      ? translate('backup.status.none', 'No backup yet')
      : last.archiveBytes === null
        ? translate('backup.status.last', 'Last {{when}}', { when: relativeTime(last.finishedAt) })
        : translate('backup.status.lastSized', 'Last {{when}}, {{size}}', {
            when: relativeTime(last.finishedAt),
            size: formatBytes(last.archiveBytes),
          });

  if (!isEnabled) {
    return translate('backup.status.offNote', 'Off: backups are taken only by hand. {{last}}.', {
      last: lastText,
    });
  }

  const next = status?.schedule.nextRunAt;

  return next == null
    ? translate('backup.status.atOnceNote', 'Saved changes take effect at once. {{last}}.', {
        last: lastText,
      })
    : translate('backup.status.nextNote', 'Next {{when}}. {{last}}.', {
        when: absoluteTime(next),
        last: lastText,
      });
}

/**
 * The line at the top of the page, as the board draws it: how the last backup went, whether more
 * will come on their own, and how big each is likely to be.
 *
 * @param status - The service's state.
 * @param isEnabled - Whether automatic backups are on, draft included.
 * @param archiveBytes - The expected size of an archive, or null before anything is known.
 * @returns The headline and the line under it.
 */
function statusLine(
  status: BackupStatusView,
  isEnabled: boolean,
  archiveBytes: number | null,
): { readonly title: string; readonly note: string } {
  const last = status.lastBackup;
  const next = status.schedule.nextRunAt;
  const title =
    last?.finishedAt == null
      ? translate('backup.status.none', 'No backup yet')
      : last.status === 'success'
        ? translate('backup.status.lastBackup', 'Last backup {{when}}', {
            when: relativeTime(last.finishedAt),
          })
        : translate('backup.status.lastFailed', 'The last backup did not finish');
  const parts = [
    isEnabled
      ? next === null
        ? translate('backup.status.on', 'Automatic backups are on')
        : translate('backup.status.next', 'Next {{when}}', { when: absoluteTime(next) })
      : translate('backup.status.off', 'Automatic backups are off'),
    archiveBytes === null
      ? null
      : translate('backup.status.each', '≈ {{size}} each, encrypted', {
          size: formatBytes(archiveBytes),
        }),
  ].filter((part) => part !== null);

  return { title, note: parts.join(' · ') };
}

/**
 * Renders the Backup page.
 *
 * @returns The page.
 */
export function BackupSettings() {
  const { t } = useTranslation();
  const can = useSession((state) => state.can);
  const canWrite = can('settings:write');
  const canRestore = can('backup:restore');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Readonly<Record<string, JsonValue>>>({});
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [isSaving, setSaving] = useState(false);
  const [editing, setEditing] = useState<BackupLocationView | 'new' | null>(null);
  const [isKeyOpen, setKeyOpen] = useState(false);
  const [restoring, setRestoring] = useState<BackupArchive | null>(null);
  const [isArchivesShown, setArchivesShown] = useState(false);

  const status = useQuery({
    queryKey: BACKUP_QUERY_KEYS.status,
    /**
     * How soon to ask again: often while a backup runs, rarely otherwise.
     *
     * @param query - The query, with what it last read.
     * @returns Milliseconds.
     */
    refetchInterval: (query) => (query.state.data?.active == null ? 60_000 : 2000),

    /**
     * Reads the backups' state.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The state.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchBackupStatus(signal),
  });
  const isRunning = status.data?.active != null;
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
  const locations = useQuery({
    queryKey: BACKUP_QUERY_KEYS.locations,
    refetchInterval: isRunning ? 5000 : false,

    /**
     * Reads the locations.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The locations.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchBackupLocations(signal),
  });
  const runs = useQuery({
    queryKey: BACKUP_QUERY_KEYS.runs,
    refetchInterval: isRunning ? 3000 : 60_000,

    /**
     * Reads the latest runs.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The runs.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchBackupRuns(signal),
  });
  const progress = useBackupProgress(status.data?.active, runs.data);
  const archives = useQuery({
    queryKey: BACKUP_QUERY_KEYS.archives,
    enabled: isArchivesShown,

    /**
     * Lists the archives in every location.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The archives.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchBackupArchives(signal),
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
  const isEnabled = shown(KEYS.enabled) === true;
  const sectionsParsed = backupSectionsSchema.safeParse(shown(KEYS.sections));
  const sections: BackupSections = sectionsParsed.success
    ? sectionsParsed.data
    : { history: true, packages: true };
  const scheduleParsed = backupScheduleSchema.safeParse(shown(KEYS.schedule));
  const schedule = scheduleParsed.success ? scheduleParsed.data : DEFAULT_SCHEDULE;
  const frequencyParsed = backupFrequencySchema.safeParse(shown(KEYS.frequency));
  const frequency: BackupFrequency = frequencyParsed.success
    ? frequencyParsed.data
    : { mode: 'daily' };
  const archiveBytes = expectedArchiveBytes(status.data, sections);
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
         four settings, not input. */
      delete next[key];
    } else {
      next[key] = value;
    }

    setDraft(next);
  };

  /**
   * Changes the schedule, meaning its time in this browser's time zone.
   *
   * @param change - What changes.
   */
  const editSchedule = (change: Partial<BackupSchedule>): void => {
    edit(KEYS.schedule, { ...schedule, ...change, timezone: browserTimeZone() });
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
        await queryClient.invalidateQueries({ queryKey: BACKUP_QUERY_KEYS.status });
      } catch (cause: unknown) {
        setSaveError(toMessage(cause));
      } finally {
        setSaving(false);
      }
    })();
  };

  const backUpNow = useMutation({
    /**
     * Starts a backup.
     *
     * @returns The run's id.
     */
    mutationFn: startBackup,
    /**
     * Shows what changed.
     *
     * @returns Once the page has read it again.
     */
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BACKUP_QUERY_KEYS.status });
      await queryClient.invalidateQueries({ queryKey: BACKUP_QUERY_KEYS.runs });
    },
  });
  const toggleLocation = useMutation({
    /**
     * Turns a location on or off.
     *
     * @param change - Which, and to what.
     * @param change.id - The location.
     * @param change.isEnabled - On or off.
     * @returns The location.
     */
    mutationFn: async (change: { id: string; isEnabled: boolean }) =>
      updateBackupLocation(change.id, { isEnabled: change.isEnabled }),
    /**
     * Shows what changed.
     *
     * @returns Once the page has read it again.
     */
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BACKUP_QUERY_KEYS.locations });
    },
  });

  if (status.isPending || settings.isPending) {
    return (
      <p className="text-ui text-foreground-subtle">
        {t('backup.reading', 'Reading the backups…')}
      </p>
    );
  }

  if (status.isError) {
    return (
      <p role="alert" className="text-ui text-danger">
        {t('backup.unreachable', 'The backup service could not be reached: {{message}}', {
          message: toMessage(status.error),
        })}
      </p>
    );
  }

  const data = status.data;
  const quiet = data.quietTime;
  const estimates = data.estimates;
  const active = data.active;
  const keyInfo = data.key;
  const headline = statusLine(data, isEnabled, archiveBytes);

  // A run the card shows, or one still running, is not in the list yet: it moves there once the
  // card is gone.
  const pastRuns = (runs.data ?? []).filter(
    (run) => run.status !== 'running' && run.id !== progress.shown?.runId,
  );

  return (
    <>
      {progress.shown === null ? null : (
        <BackupProgressCard
          run={progress.shown}
          hasHistory={sections.history}
          hasPackages={sections.packages}
          locationCount={(locations.data ?? []).filter((location) => location.isEnabled).length}
          onDismiss={progress.dismiss}
        />
      )}

      <Panel
        title={t('backup.title', 'Backups')}
        action={
          canWrite ? (
            isRunning && active?.kind === 'backup' ? (
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  void cancelBackup(active.runId);
                }}
              >
                {t('backup.stop', 'Stop')}
              </Button>
            ) : (
              <Button
                size="compact"
                isBusy={backUpNow.isPending}
                disabled={isRunning}
                onClick={() => {
                  backUpNow.mutate();
                }}
              >
                {t('backup.now', 'Back up now')}
              </Button>
            )
          ) : undefined
        }
      >
        <PanelRow title={headline.title} note={headline.note} />
        {active?.kind !== 'restore' ? null : (
          <PanelRow
            title={t('backup.restoring', 'Restoring…')}
            note={`${phaseName(active.phase)}${
              active.bytesTotal === null || active.bytesTotal === 0
                ? ''
                : ` · ${String(Math.round(active.bytesDone))}%`
            } · ${t('backup.started', 'started {{when}}', { when: relativeTime(active.startedAt) })}`}
          />
        )}
        {backUpNow.isError ? (
          <PanelRow
            title={t('backup.didNotStart', 'The backup did not start')}
            note={<span className="text-danger">{toMessage(backUpNow.error)}</span>}
          />
        ) : null}

        <PanelRow
          title={t('backup.automatic', 'Automatic backups')}
          note={scheduleNote(data, isEnabled)}
          control={
            <Switch
              label={t('backup.automatic', 'Automatic backups')}
              isOn={isEnabled}
              disabled={!canWrite}
              onChange={(isOn) => {
                edit(KEYS.enabled, isOn);
              }}
            />
          }
        />

        <PanelRow
          title={t('backup.frequency', 'How often')}
          note={
            frequency.mode === 'daily'
              ? t('backup.frequencyNotes.daily', 'Every day.')
              : frequency.mode === 'weekly'
                ? t('backup.frequencyNotes.weekly', 'Once a week, on the day chosen.')
                : t('backup.frequencyNotes.custom', 'On the days chosen.')
          }
          control={
            <Segmented
              label={t('backup.frequency', 'How often')}
              size="compact"
              disabled={!canWrite}
              value={frequency.mode}
              options={[
                { value: 'daily', label: t('backup.frequencies.daily', 'Daily') },
                { value: 'weekly', label: t('backup.frequencies.weekly', 'Weekly') },
                { value: 'custom', label: t('backup.frequencies.custom', 'Custom') },
              ]}
              onChange={(mode) => {
                const days: DayOfWeek[] =
                  frequency.mode === 'custom'
                    ? frequency.days
                    : frequency.mode === 'weekly'
                      ? [frequency.day]
                      : ['sunday'];

                edit(
                  KEYS.frequency,
                  mode === 'daily'
                    ? { mode }
                    : mode === 'weekly'
                      ? { mode, day: days[0] ?? 'sunday' }
                      : { mode, days },
                );
              }}
            />
          }
        >
          {frequency.mode === 'daily' ? undefined : (
            <WeekdayPicker
              label={
                frequency.mode === 'weekly'
                  ? t('backup.theDay', 'The day')
                  : t('backup.theDays', 'The days')
              }
              isSingle={frequency.mode === 'weekly'}
              disabled={!canWrite}
              value={frequency.mode === 'weekly' ? [frequency.day] : frequency.days}
              onChange={(days) => {
                if (frequency.mode === 'weekly') {
                  edit(KEYS.frequency, { mode: 'weekly', day: days[0] ?? frequency.day });
                } else if (days.length > 0) {
                  edit(KEYS.frequency, { mode: 'custom', days });
                }
              }}
            />
          )}
        </PanelRow>

        <PanelRow
          title={t('backup.when', 'When')}
          note={
            schedule.mode === 'fixed' ? (
              t('backup.whenFixed', 'At {{time}}, {{zone}} time.', {
                time: schedule.time,
                zone: schedule.timezone,
              })
            ) : quiet.state === 'ready' ? (
              <>
                {t('backup.quietest', 'When the machine is quietest:')}{' '}
                <strong className="font-medium text-foreground">{quiet.time}</strong>
                {quiet.meanLoadPercent === null
                  ? ''
                  : t('backup.busy', ', about {{percent}}% busy', {
                      percent: Math.round(quiet.meanLoadPercent),
                    })}
                {t('backup.learned', ' - learned from {{days}} days of load, {{zone}} time.', {
                  days: quiet.daysOfData,
                  zone: schedule.timezone,
                })}
              </>
            ) : quiet.state === 'learning' ? (
              t(
                'backup.learning',
                "Learning the machine's load ({{days}} of {{needed}} days): at {{time}} until then.",
                { days: quiet.daysOfData, needed: quiet.daysNeeded, time: schedule.time },
              )
            ) : (
              t('backup.cannotLearn', '{{reason}}: at {{time}} instead.', {
                reason: quiet.reason ?? t('backup.loadUnlearnable', 'The load cannot be learned'),
                time: schedule.time,
              })
            )
          }
          control={
            <div className="flex items-center gap-2">
              {schedule.mode === 'fixed' ? (
                <TextField
                  label={t('backup.time', 'Time')}
                  isLabelHidden
                  size="compact"
                  type="time"
                  disabled={!canWrite}
                  value={schedule.time}
                  className="w-28"
                  onChange={(event) => {
                    if (/^\d{2}:\d{2}$/u.test(event.target.value)) {
                      editSchedule({ time: event.target.value });
                    }
                  }}
                />
              ) : null}
              <Segmented
                label={t('backup.when', 'When')}
                size="compact"
                disabled={!canWrite}
                value={schedule.mode}
                options={[
                  { value: 'fixed', label: t('backup.modes.fixed', 'At a time') },
                  { value: 'quietest', label: t('backup.modes.quietest', 'Quietest') },
                ]}
                onChange={(mode) => {
                  editSchedule({ mode });
                }}
              />
            </div>
          }
        >
          {schedule.mode === 'quietest' && quiet.profile.length > 0 ? (
            <QuietProfile profile={quiet.profile} time={quiet.time} />
          ) : undefined}
        </PanelRow>

        {data.problems.length === 0 ? null : (
          <PanelNote>{data.problems.map((problem) => problem.message).join(' · ')}</PanelNote>
        )}
      </Panel>

      <Panel title={t('backup.what', 'What to back up')}>
        <PanelRow
          title={sectionName('configuration')}
          note={
            <>
              {t(
                'backup.sectionNotes.configuration',
                'Users, devices, automations, settings, the installed integrations and the certificate. Always taken.',
              )}
              {estimates === null ? '' : ` ≈ ${formatBytes(estimates.configuration)}`}
            </>
          }
          control={
            <Switch label={sectionName('configuration')} isOn disabled onChange={() => undefined} />
          }
        />
        {OPTIONAL_SECTIONS.map(({ key, note }) => (
          <PanelRow
            key={key}
            title={sectionName(key)}
            note={`${text(note)}.${estimates === null ? '' : ` ≈ ${formatBytes(estimates[key])}`}`}
            control={
              <Switch
                label={sectionName(key)}
                isOn={sections[key]}
                disabled={!canWrite}
                onChange={(isOn) => {
                  edit(KEYS.sections, { ...sections, [key]: isOn });
                }}
              />
            }
          />
        ))}
        <PanelNote>
          {estimates?.basis === 'last-backup'
            ? t(
                'backup.estimateLast',
                'The sizes are an estimate, not what an archive will weigh: they are worked out from what is stored now and the last backup. Every backup is full, and encrypted with the backup key.',
              )
            : t(
                'backup.estimate',
                'The sizes are an estimate, not what an archive will weigh: they are worked out from what is stored now. Every backup is full, and encrypted with the backup key.',
              )}
          {archiveBytes === null
            ? ''
            : ` ${t('backup.estimateEach', 'About {{size}} each, as chosen.', {
                size: formatBytes(archiveBytes),
              })}`}
        </PanelNote>
      </Panel>

      <Panel title={t('backup.key.title', 'Backup key')}>
        <PanelRow
          title={
            <span className="flex items-center gap-2">
              {t('backup.key.encryption', 'Encryption key')}
              {keyInfo.downloadedAt === null ? (
                <Badge tone="warning" size="small">
                  {t('backup.key.notDownloaded', 'Not downloaded yet')}
                </Badge>
              ) : null}
            </span>
          }
          note={
            <>
              <span className="font-mono">{keyInfo.keyId.slice(0, 8)}</span>
              {keyInfo.source === 'environment'
                ? ` · ${t('backup.key.fromEnvironment', 'from the environment')}`
                : ''}
              {keyInfo.downloadedAt === null
                ? ` · ${t('backup.key.onlyHere', 'without it, a backup can be restored only on this machine')}`
                : ` · ${t('backup.key.downloaded', 'downloaded {{when}}', {
                    when: relativeTime(keyInfo.downloadedAt),
                  })}`}
            </>
          }
          control={
            canRestore ? (
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  setKeyOpen(true);
                }}
              >
                {t('common.download', 'Download')}
              </Button>
            ) : undefined
          }
        />
      </Panel>

      <Panel
        title={t('backup.locations', 'Locations')}
        action={
          canWrite ? (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                setEditing('new');
              }}
            >
              {t('backup.addLocation', 'Add location')}
            </Button>
          ) : undefined
        }
      >
        {(locations.data ?? []).map((location) => (
          <PanelRow
            key={location.id}
            title={
              <span className="flex items-center gap-2">
                {location.name}
                <Badge size="small" tone="neutral">
                  {kindName(location.target.kind)}
                </Badge>
              </span>
            }
            note={
              <>
                <span className="break-all">{targetText(location)}</span>
                {' · '}
                {location.retention.mode === 'count'
                  ? t('backup.keepsLast', 'keeps the last {{count}}', {
                      count: location.retention.value,
                    })
                  : t('backup.keepsDays', 'keeps {{count}} days', {
                      count: location.retention.value,
                    })}
                {` (${t('backup.estimateOf', '{{summary}}, estimate', {
                  summary: retentionSummary(location.retention, frequency, archiveBytes),
                })})`}
                {location.lastResult === 'failure' ? (
                  <span className="text-danger">
                    {' · '}
                    {t('backup.notWorking', 'Not working - see why')}
                  </span>
                ) : location.lastSuccessAt === null ? null : (
                  <span>
                    {' · '}
                    {t('backup.lastBackupWhen', 'last backup {{when}}', {
                      when: relativeTime(location.lastSuccessAt),
                    })}
                  </span>
                )}
              </>
            }
            control={
              <div className="flex items-center gap-2">
                {canWrite ? (
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => {
                      setEditing(location);
                    }}
                  >
                    {location.lastResult === 'failure'
                      ? t('backup.why', 'Why')
                      : t('common.edit', 'Edit')}
                  </Button>
                ) : null}
                <Switch
                  label={t('backup.writeTo', 'Write backups to {{name}}', { name: location.name })}
                  isOn={location.isEnabled}
                  disabled={!canWrite}
                  isBusy={toggleLocation.isPending && toggleLocation.variables.id === location.id}
                  onChange={(isOn) => {
                    toggleLocation.mutate({ id: location.id, isEnabled: isOn });
                  }}
                />
              </div>
            }
          />
        ))}
        {data.capabilities.canMount ? null : (
          <PanelNote>
            {t(
              'backup.noMount',
              'SMB and NFS shares cannot be added here: {{problem}}. A disk mounted on the host can still be added as a folder.',
              { problem: data.capabilities.mountProblem },
            )}
          </PanelNote>
        )}
      </Panel>

      <Panel
        title={t('backup.restore', 'Restore')}
        action={
          isArchivesShown ? (
            <Button
              variant="ghost"
              size="compact"
              isBusy={archives.isFetching}
              onClick={() => {
                void archives.refetch();
              }}
            >
              {t('backup.lookAgain', 'Look again')}
            </Button>
          ) : undefined
        }
      >
        {!isArchivesShown ? (
          <PanelRow
            title={t('backup.archivesTitle', 'The backups in every location')}
            note={t(
              'backup.archivesNote',
              'Listing them opens every location, network shares too, which can take a moment.',
            )}
            control={
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  setArchivesShown(true);
                }}
              >
                {t('common.show', 'Show')}
              </Button>
            }
          />
        ) : archives.isPending ? (
          <p className="px-4 py-4 text-ui text-foreground-subtle">
            {t('backup.opening', 'Opening the locations…')}
          </p>
        ) : archives.isError ? (
          <p role="alert" className="px-4 py-4 text-ui text-danger">
            {toMessage(archives.error)}
          </p>
        ) : (
          <>
            {archives.data.items.length === 0 ? (
              <p className="px-4 py-4 text-ui text-foreground-subtle">
                {t('backup.noArchives', 'No backups yet.')}
              </p>
            ) : (
              archives.data.items.map((archive) => (
                <PanelRow
                  key={`${archive.locationId}/${archive.name}`}
                  title={absoluteTime(archive.createdAt)}
                  note={`${archive.locationName} · ${formatBytes(archive.bytes)} · ${archive.sections
                    .map((section) => sectionName(section))
                    .join(', ')}`}
                  control={
                    <div className="flex items-center gap-2">
                      {archive.restorable === 'needs-key' ? (
                        <Badge size="small" tone="warning">
                          {t('backup.anotherKey', 'Another key')}
                        </Badge>
                      ) : archive.restorable === 'schema-mismatch' ? (
                        <Badge size="small" tone="neutral">
                          {t('backup.anotherVersion', 'Another version')}
                        </Badge>
                      ) : archive.restorable === 'unreadable' ? (
                        <Badge size="small" tone="danger">
                          {t('backup.unreadable', 'Unreadable')}
                        </Badge>
                      ) : null}
                      {canRestore &&
                      data.canRestore &&
                      (archive.restorable === 'ok' || archive.restorable === 'needs-key') ? (
                        <Button
                          variant="ghost"
                          size="compact"
                          disabled={isRunning}
                          onClick={() => {
                            setRestoring(archive);
                          }}
                        >
                          {t('backup.restoreEllipsis', 'Restore…')}
                        </Button>
                      ) : null}
                    </div>
                  }
                />
              ))
            )}
            {archives.data.problems.map((problem) => (
              <PanelNote key={problem.locationId}>
                {t('backup.locationUnreadable', '{{name}} could not be read: {{message}}', {
                  name: problem.name,
                  message: problem.message,
                })}
              </PanelNote>
            ))}
          </>
        )}
        {data.canRestore ? null : (
          <PanelNote>
            {t(
              'backup.needsContainer',
              'Restoring needs the NebulaHome container, which stops and starts the services around it.',
            )}
          </PanelNote>
        )}
      </Panel>

      <Panel title={t('backup.recentRuns', 'Recent runs')}>
        {pastRuns.length === 0 ? (
          <p className="px-4 py-4 text-ui text-foreground-subtle">
            {t('backup.noRuns', 'Nothing has run yet.')}
          </p>
        ) : (
          pastRuns.map((run) => {
            const outcome = runOutcome(run);
            const took =
              run.finishedAt === null ? null : run.finishedAt.getTime() - run.startedAt.getTime();
            const taken = run.destinations.filter((each) => each.status === 'success').length;

            return (
              <PanelRow
                key={run.id}
                title={
                  <span className="flex items-center gap-2">
                    {run.kind === 'restore'
                      ? t('backup.restore', 'Restore')
                      : t('backup.backupRun', 'Backup')}
                    <Badge size="small" tone={outcome.tone}>
                      {outcome.words}
                    </Badge>
                  </span>
                }
                note={
                  <>
                    <span title={absoluteTime(run.startedAt)}>{relativeTime(run.startedAt)}</span>
                    {` · ${triggerName(run.trigger)}`}
                    {run.requestedBy === null
                      ? ''
                      : ` ${t('backup.by', 'by {{name}}', { name: run.requestedBy.username })}`}
                    {run.archiveBytes === null ? '' : ` · ${formatBytes(run.archiveBytes)}`}
                    {took === null ? '' : ` · ${durationText(took)}`}
                    {run.destinations.length === 0
                      ? ''
                      : ` · ${t('backup.locationsTaken', '{{taken}} of {{count}} locations', {
                          taken,
                          count: run.destinations.length,
                        })}`}
                  </>
                }
              >
                {run.error === null &&
                run.destinations.every((each) => each.error === null) ? undefined : (
                  <details className="rounded-field border border-border bg-surface-raised px-3 py-2">
                    <summary className="cursor-pointer text-caption text-foreground-muted">
                      {t('backup.why', 'Why')}
                    </summary>
                    <div className="mt-2 flex flex-col gap-1 text-ui break-words whitespace-pre-wrap text-danger">
                      {run.error === null ? null : <p>{run.error}</p>}
                      {run.destinations
                        .filter((each) => each.error !== null)
                        .map((each) => (
                          <p key={each.locationId}>
                            {each.name}: {each.error}
                          </p>
                        ))}
                    </div>
                  </details>
                )}
              </PanelRow>
            );
          })
        )}
      </Panel>

      {canWrite && isDirty ? (
        <div className="sticky bottom-0 flex items-center gap-4 rounded-panel border border-border bg-surface-raised px-4 py-3">
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
            className="h-8 px-3 text-ui"
            onClick={() => {
              setDraft({});
              setSaveError(undefined);
            }}
          >
            {t('common.discard', 'Discard')}
          </Button>
          <Button className="h-8 px-3 text-ui" isBusy={isSaving} onClick={save}>
            {t('common.save', 'Save')}
          </Button>
        </div>
      ) : null}

      {editing === null ? null : (
        <BackupLocationDialog
          isOpen
          location={editing === 'new' ? null : editing}
          frequency={frequency}
          archiveBytes={archiveBytes}
          mountProblem={data.capabilities.mountProblem}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      <KeyDialog
        isOpen={isKeyOpen}
        onClose={() => {
          setKeyOpen(false);
        }}
        onDownloaded={() => {
          void queryClient.invalidateQueries({ queryKey: BACKUP_QUERY_KEYS.status });
        }}
      />
      <RestoreDialog
        archive={restoring}
        onClose={() => {
          setRestoring(null);
        }}
      />
    </>
  );
}
