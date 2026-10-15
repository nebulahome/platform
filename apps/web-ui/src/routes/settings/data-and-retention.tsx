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

import type { JsonValue, SettingsResponse } from '@nebulahome/contracts';
import { Button, Panel, PanelNote, PanelRow, Segmented, SelectField } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { absoluteTime, relativeTime } from '@/lib/format-time';
import { BROWSER_ZONE, TIME_ZONES, zoneName } from '@/lib/time-zones';
import { SETTINGS_QUERY_KEYS, fetchServerSettings, updateServerSettings } from '@/settings/api';
import { RETENTION_RUNGS, ladderProblem } from '@/settings/retention';
import {
  LOG_LEVEL_CHOICES,
  SESSION_LIFETIME_CHOICES,
  asWord,
  decodeNumberChoice,
  encodeChoice,
  retentionChoices,
  type Choice,
} from '@/settings/setting-choices';

/**
 * The other durations, with a short name for each.
 *
 * Named here rather than taken from the catalogue, whose descriptions are sentences - "How long
 * entity state changes are kept" reads as a note under a row and not as the row's title.
 */
const HISTORY_ROWS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'history.state_history.retention_days', label: 'Entity state changes' },
  { key: 'history.automation_runs.retention_days', label: 'Automation traces' },
  { key: 'history.logs.retention_days', label: 'Logs' },
  { key: 'system.audit_log.retention_days', label: 'Audit trail' },
];

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
  const can = useSession((state) => state.can);
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
        {' · changed by '}
        {item.updatedBy.displayName}
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
    <PanelRow
      key={key}
      title={label}
      note={
        <>
          {note ?? stored.get(key)?.description ?? ''}
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
          className="w-37.5"
        />
      }
    />
  );

  if (settings.isPending) {
    return <p className="text-ui text-foreground-subtle">Reading the settings…</p>;
  }

  if (settings.isError) {
    return (
      <p role="alert" className="text-ui text-danger">
        {toMessage(settings.error)}
      </p>
    );
  }

  return (
    <>
      <Panel title="Telemetry retention">
        {RETENTION_RUNGS.map((rung) => (
          <PanelRow
            key={rung.key}
            title={<span className="font-mono">{rung.label}</span>}
            note={
              <>
                {rung.note}
                {provenance(rung.key)}
              </>
            }
            control={
              <SelectField
                label={`${rung.label} retention`}
                isLabelHidden
                disabled={!canWrite}
                value={encodeChoice(effective.get(rung.key) ?? null)}
                options={retentionChoices(rung.minimumDays)}
                onChange={(next) => {
                  edit(rung.key, decodeNumberChoice(next));
                }}
                className="w-37.5"
              />
            }
          />
        ))}

        {problem === null ? (
          <PanelNote>
            A level cannot keep data for less time than the one below it. Each roll-up reads a fixed
            distance back into the level beneath, so a shorter rung would drop the rows before the
            coarser level had read them — and nothing would report it.
          </PanelNote>
        ) : (
          <p role="alert" className="border-t border-border px-4 py-3 text-caption text-danger">
            {problem}
          </p>
        )}
      </Panel>

      <Panel title="How long the rest is kept">
        {HISTORY_ROWS.map((row) =>
          choiceRow(row.key, row.label, retentionChoices(HISTORY_MINIMUM_DAYS), decodeNumberChoice),
        )}

        {choiceRow('history.logs.min_level', 'Log level', LOG_LEVEL_CHOICES, (encoded) =>
          Number(encoded),
        )}
      </Panel>

      <Panel title="This installation">
        <PanelRow
          title="Temperature"
          note={
            <>
              {stored.get('units.temperature')?.description ?? ''}
              {provenance('units.temperature')}
            </>
          }
          control={
            <Segmented
              label="Temperature unit"
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

        <PanelRow
          title="Default theme"
          note={
            <>
              {stored.get('ui.default_theme')?.description ?? ''}
              {provenance('ui.default_theme')}
            </>
          }
          control={
            <Segmented
              label="Default theme"
              disabled={!canWrite}
              value={asWord(effective.get('ui.default_theme'), 'system')}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              onChange={(next) => {
                edit('ui.default_theme', next);
              }}
            />
          }
        />

        <PanelRow
          title="Time zone"
          note={
            <>
              {stored.get('house.timezone')?.description ?? ''}
              {provenance('house.timezone')}
            </>
          }
          control={
            <span className="flex flex-col items-end gap-1">
              <SelectField
                label="Time zone"
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
                  Use this browser’s, {BROWSER_ZONE}
                </Button>
              ) : null}
            </span>
          }
        />

        {choiceRow(
          'security.session_lifetime_hours',
          'Session lifetime',
          SESSION_LIFETIME_CHOICES,
          (encoded) => Number(encoded),
        )}

        <PanelNote>
          Where the house stands is set on the house itself, under Library → Areas. The map around
          it is drawn from that position, and sunrise and sunset triggers are timed from it.
        </PanelNote>
        <PanelNote>
          A saved value is recorded and audited. The time zone and the house’s position reach the
          automations at once; retention, the log level and session lifetime take effect once the
          service that owns them learns to re-read them, and until then follow what the platform was
          started with.
        </PanelNote>
      </Panel>

      {canWrite && isDirty ? (
        <div className="sticky bottom-0 flex items-center gap-4 rounded-panel border border-border bg-surface-raised px-4 py-3">
          <span className="grow text-ui text-foreground-muted">
            {Object.keys(draft).length === 1
              ? '1 unsaved change'
              : `${String(Object.keys(draft).length)} unsaved changes`}
          </span>

          {error === undefined ? null : (
            <span role="alert" className="text-ui text-danger">
              {error}
            </span>
          )}

          <Button
            variant="ghost"
            className="h-8 px-3 text-ui"
            onClick={() => {
              setDraft({});
              setError(undefined);
            }}
          >
            Discard
          </Button>

          <Button
            className="h-8 px-3 text-ui"
            isBusy={isBusy}
            disabled={problem !== null}
            onClick={save}
          >
            Save
          </Button>
        </div>
      ) : null}
    </>
  );
}
