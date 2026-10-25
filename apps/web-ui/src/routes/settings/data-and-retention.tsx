/**
 * The settings the installation holds, rather than the browser.
 *
 * Everything here is edited into a draft and sent in one request. Not for the round trips - there
 * are at most a dozen keys - but because the retention levels constrain each other, and a page
 * that saved each dropdown as it changed would have to walk through invalid ladders to reach a
 * valid one. Sending the set means the server judges the destination and never the journey.
 *
 * The answer to a save is the whole set, not the changed keys, and it replaces what is on screen.
 * One key can be refused because of another, so the only honest thing to render afterwards is
 * what the server now holds.
 *
 * Reading needs `settings:read` and writing needs `settings:write`. Somebody with only the first
 * sees every value and no controls, which is the shape the permissions describe.
 *
 * The note at the foot of the last panel is not decoration and should not be removed until it
 * stops being true. Nothing in the platform re-reads these values at runtime yet: retention is
 * enforced by TimescaleDB policies fixed when the database was built, the log level comes from
 * the environment, and how long a session lasts is a constant in `@nebulahome/contracts`. So a
 * change here is recorded, audited and durable, and it changes no behaviour until the service
 * that owns each one learns to read it. A settings page that quietly did nothing would be worse
 * than no settings page. It used to be a banner above everything; the pages open on what they
 * hold now, and the caveat sits where the values end.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  type JsonValue,
  type SettingsResponse,
} from '@nebulahome/contracts';
import { Button, cn, Segmented, SelectField } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { defineMessage, text, type Message } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { absoluteTime, relativeTime } from '@/lib/format-time';
import { BROWSER_ZONE, TIME_ZONES, zoneName } from '@/lib/time-zones';
import { SettingsPage, SettingsRow, SettingsSection } from '@/routes/settings/settings-ui';
import { SETTINGS_QUERY_KEYS, fetchServerSettings, updateServerSettings } from '@/settings/api';
import { RETENTION_RUNGS, ladderProblem } from '@/settings/retention';
import {
  asWord,
  decodeNumberChoice,
  durationLabel,
  encodeChoice,
  logLevelChoices,
  retentionChoices,
  sessionLifetimeChoices,
  type Choice,
} from '@/settings/setting-choices';
import { settingDescription } from '@/settings/setting-descriptions';

/**
 * The other durations, with a short name for each.
 *
 * Named here rather than taken from the catalogue, whose descriptions are sentences - "How long
 * entity state changes are kept" reads as a note under a row and not as the row's title.
 */
const HISTORY_ROWS: readonly { readonly key: string; readonly label: Message }[] = [
  {
    key: 'history.state_history.retention_days',
    label: defineMessage('settings.data.rows.stateChanges', 'Entity state changes'),
  },
  {
    key: 'history.automation_runs.retention_days',
    label: defineMessage('settings.data.rows.automationTraces', 'Automation traces'),
  },
  { key: 'history.logs.retention_days', label: defineMessage('settings.data.rows.logs', 'Logs') },
  {
    key: 'system.audit_log.retention_days',
    label: defineMessage('settings.data.rows.audit', 'Audit trail'),
  },
];

/** What each rung of the telemetry ladder keeps, in the order the bar draws them. */
const RUNG_TITLES: readonly Message[] = [
  defineMessage('settings.data.rungTitles.raw', 'Every reading'),
  defineMessage('settings.data.rungTitles.minute', 'One per minute'),
  defineMessage('settings.data.rungTitles.hour', 'One per hour'),
  defineMessage('settings.data.rungTitles.day', 'One per day'),
];

/** The colour of each rung's stretch of the bar: newest brightest. */
const RUNG_COLOURS: readonly string[] = [
  'bg-primary',
  'bg-violet',
  'bg-cyan',
  'bg-foreground-subtle/50',
];

/** The languages the house may speak, each by its own name. */
const LANGUAGE_CHOICES: readonly Choice[] = SUPPORTED_LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_NAMES[locale],
}));

/** Every duration setting outside the telemetry ladder has the same one-day floor. */
const HISTORY_MINIMUM_DAYS = 1;

/** Every zone the browser knows, for the house's time zone (`time-zones.ts`). */
const TIME_ZONE_CHOICES: readonly Choice[] = TIME_ZONES.map((zone) => ({
  value: zone,
  label: zoneName(zone),
}));

/**
 * Renders the server settings page.
 *
 * @returns The page.
 */
export function DataAndRetention() {
  const { t } = useTranslation();
  const can = useSession((state) => state.can);
  const refreshUser = useSession((state) => state.refreshUser);
  const queryClient = useQueryClient();
  const canWrite = can('settings:write');

  const [draft, setDraft] = useState<Readonly<Record<string, JsonValue>>>({});
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);

  const settings = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.server,

    /**
     * Reads the settings.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every setting the server holds.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchServerSettings(signal),
  });

  const stored = new Map((settings.data?.items ?? []).map((item) => [item.key, item]));
  const effective = new Map<string, JsonValue>(
    [...stored].map(([key, item]) => [key, key in draft ? (draft[key] ?? null) : item.value]),
  );
  const isDirty = Object.keys(draft).length > 0;
  const problem = settings.isSuccess ? ladderProblem(effective) : null;

  /**
   * Records an edit, or forgets it when the value goes back to what the server holds.
   *
   * Keeping the draft to genuinely changed keys is what makes "unsaved changes" mean something:
   * a person who opens a dropdown and picks the value that was already there has changed
   * nothing, and the page should agree with them.
   *
   * @param key - Which setting.
   * @param value - Its new value.
   */
  const edit = (key: string, value: JsonValue): void => {
    setError(undefined);

    const next = { ...draft };

    if (stored.get(key)?.value === value) {
      /* eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the keys are the
         settings catalogue's, not caller input, and the alternative is carrying a sentinel
         through every comparison below. */
      delete next[key];
    } else {
      next[key] = value;
    }

    setDraft(next);
  };

  /**
   * Sends the draft.
   */
  const save = (): void => {
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        const answer = await updateServerSettings(draft);

        queryClient.setQueryData<SettingsResponse>(SETTINGS_QUERY_KEYS.server, answer);

        // The house language is what the session carries for whoever follows it: read it back,
        // so this page switches at once when its reader is one of them.
        if ('house.locale' in draft) {
          await refreshUser();
        }

        setDraft({});
      } catch (cause: unknown) {
        setError(toMessage(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  /**
   * Says who last changed a setting, when anybody has.
   *
   * @param key - Which setting.
   * @returns A line for the row, or nothing.
   */
  const provenance = (key: string): ReactNode => {
    const item = stored.get(key);

    if (item?.updatedBy == null) {
      return undefined;
    }

    return (
      <>
        {` · ${t('settings.data.changedBy', 'changed by {{name}}', {
          name: item.updatedBy.displayName,
        })}`}
        <span title={absoluteTime(item.updatedAt)}> {relativeTime(item.updatedAt)}</span>
      </>
    );
  };

  /**
   * One row whose value is chosen from a list.
   *
   * @param key - Which setting.
   * @param label - What it is called on screen.
   * @param choices - What it may be set to.
   * @param decode - How to read the dropdown's string back into the value.
   * @param note - An extra line, replacing the catalogue's description.
   * @returns The row.
   */
  const choiceRow = (
    key: string,
    label: string,
    choices: readonly Choice[],
    decode: (encoded: string) => JsonValue,
    note?: string,
  ): ReactNode => (
    <SettingsRow
      key={key}
      searchId={key}
      title={label}
      note={
        <>
          {note ?? settingDescription(key, stored.get(key)?.description)}
          {provenance(key)}
        </>
      }
      control={
        <SelectField
          label={label}
          isLabelHidden
          disabled={!canWrite}
          value={encodeChoice(effective.get(key) ?? null)}
          options={choices}
          onChange={(next) => {
            edit(key, decode(next));
          }}
          className="w-56"
        />
      }
    />
  );

  if (settings.isPending) {
    return (
      <SettingsPage path="/settings/data/retention">
        <p className="text-ui text-foreground-subtle">
          {t('settings.data.reading', 'Reading the settings…')}
        </p>
      </SettingsPage>
    );
  }

  if (settings.isError) {
    return (
      <SettingsPage path="/settings/data/retention">
        <p role="alert" className="text-ui text-danger">
          {toMessage(settings.error)}
        </p>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage path="/settings/data/retention">
      <SettingsSection label={t('settings.data.readings', 'Readings')}>
        <div className="grid grid-cols-2 gap-x-1 gap-y-5 py-4.5 md:grid-cols-4">
          {RETENTION_RUNGS.map((rung, index) => {
            const before = RETENTION_RUNGS[index - 1];
            const since = before === undefined ? null : effective.get(before.key);

            return (
              <div key={rung.key} id={rung.key} className="flex min-w-0 flex-col gap-2.5 pr-3">
                <span className="font-mono text-caption text-foreground-subtle">
                  {index === 0
                    ? t('settings.data.now', 'now')
                    : typeof since === 'number'
                      ? t('settings.data.ago', '{{span}} ago', { span: durationLabel(since) })
                      : '…'}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1.5 rounded-pill',
                    RUNG_COLOURS[index] ?? 'bg-foreground-subtle/50',
                  )}
                />
                <span className="text-ui font-medium text-foreground">
                  {text(RUNG_TITLES[index] ?? rung.label)}
                </span>
                <span className="-mt-1.5 text-caption text-foreground-subtle">
                  {t('settings.data.keptFor', 'kept for')}
                  {provenance(rung.key)}
                </span>
                <SelectField
                  label={t('settings.data.rungRetention', '{{rung}} retention', {
                    rung: text(rung.label),
                  })}
                  isLabelHidden
                  disabled={!canWrite}
                  value={encodeChoice(effective.get(rung.key) ?? null)}
                  options={retentionChoices(rung.minimumDays)}
                  onChange={(next) => {
                    edit(rung.key, decodeNumberChoice(next));
                  }}
                  className="w-35"
                />
              </div>
            );
          })}
        </div>

        {problem === null ? null : (
          <p role="alert" className="border-t border-border py-3 text-caption text-danger">
            {problem}
          </p>
        )}
      </SettingsSection>

      <SettingsSection label={t('settings.data.historyAndLogs', 'History and logs')}>
        {HISTORY_ROWS.map((row) =>
          choiceRow(
            row.key,
            text(row.label),
            retentionChoices(HISTORY_MINIMUM_DAYS),
            decodeNumberChoice,
          ),
        )}

        {choiceRow(
          'history.logs.min_level',
          t('settings.data.logLevel', 'Log level'),
          logLevelChoices(),
          (encoded) => Number(encoded),
        )}
      </SettingsSection>

      <SettingsSection label={t('settings.data.installation', 'This installation')}>
        <SettingsRow
          searchId="units.temperature"
          title={t('settings.data.temperature', 'Temperature')}
          note={
            <>
              {settingDescription(
                'units.temperature',
                stored.get('units.temperature')?.description,
              )}
              {provenance('units.temperature')}
            </>
          }
          control={
            <Segmented
              label={t('settings.data.temperatureUnit', 'Temperature unit')}
              disabled={!canWrite}
              value={asWord(effective.get('units.temperature'), 'celsius')}
              options={[
                { value: 'celsius', label: '°C' },
                { value: 'fahrenheit', label: '°F' },
              ]}
              onChange={(next) => {
                edit('units.temperature', next);
              }}
            />
          }
        />

        <SettingsRow
          searchId="ui.default_theme"
          title={t('settings.data.defaultTheme', 'Default theme')}
          note={
            <>
              {settingDescription('ui.default_theme', stored.get('ui.default_theme')?.description)}
              {provenance('ui.default_theme')}
            </>
          }
          control={
            <Segmented
              label={t('settings.data.defaultTheme', 'Default theme')}
              disabled={!canWrite}
              value={asWord(effective.get('ui.default_theme'), 'system')}
              options={[
                { value: 'system', label: t('settings.interface.themes.system', 'System') },
                { value: 'light', label: t('settings.interface.themes.light', 'Light') },
                { value: 'dark', label: t('settings.interface.themes.dark', 'Dark') },
              ]}
              onChange={(next) => {
                edit('ui.default_theme', next);
              }}
            />
          }
        />

        <SettingsRow
          searchId="house.timezone"
          title={t('firstRun.home.timeZone', 'Time zone')}
          note={
            <>
              {settingDescription('house.timezone', stored.get('house.timezone')?.description)}
              {provenance('house.timezone')}
            </>
          }
          control={
            <span className="flex flex-col items-end gap-1">
              <SelectField
                label={t('firstRun.home.timeZone', 'Time zone')}
                isLabelHidden
                disabled={!canWrite}
                value={asWord(effective.get('house.timezone'), 'UTC')}
                options={TIME_ZONE_CHOICES}
                onChange={(next) => {
                  edit('house.timezone', next);
                }}
                className="w-56"
              />
              {canWrite && BROWSER_ZONE !== asWord(effective.get('house.timezone'), 'UTC') ? (
                <Button
                  variant="bare"
                  size="compact"
                  onClick={() => {
                    edit('house.timezone', BROWSER_ZONE);
                  }}
                >
                  {t('settings.data.useBrowserZone', 'Use this browser’s, {{zone}}', {
                    zone: BROWSER_ZONE,
                  })}
                </Button>
              ) : null}
            </span>
          }
        />

        <SettingsRow
          searchId="house.locale"
          title={t('settings.data.houseLanguage', 'House language')}
          note={
            <>
              {settingDescription('house.locale', stored.get('house.locale')?.description)}
              {provenance('house.locale')}
            </>
          }
          control={
            <SelectField
              label={t('settings.data.houseLanguage', 'House language')}
              isLabelHidden
              disabled={!canWrite}
              value={asWord(effective.get('house.locale'), DEFAULT_LOCALE)}
              options={LANGUAGE_CHOICES}
              onChange={(next) => {
                edit('house.locale', next);
              }}
              className="w-56"
            />
          }
        />

        {choiceRow(
          'security.session_lifetime_hours',
          t('settings.data.sessionLifetime', 'Session lifetime'),
          sessionLifetimeChoices(),
          (encoded) => Number(encoded),
        )}
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

          {error === undefined ? null : (
            <span role="alert" className="text-ui text-danger">
              {error}
            </span>
          )}

          <Button
            variant="ghost"
            onClick={() => {
              setDraft({});
              setError(undefined);
            }}
          >
            {t('common.discard', 'Discard')}
          </Button>

          <Button isBusy={isBusy} disabled={problem !== null} onClick={save}>
            {t('common.save', 'Save')}
          </Button>
        </div>
      ) : null}
    </SettingsPage>
  );
}
