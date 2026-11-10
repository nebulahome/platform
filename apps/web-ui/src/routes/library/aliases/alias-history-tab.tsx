/**
 * The History tab: what the alias's parts became and who asked (Values), and the changes to its
 * setup with a Diff of each (Setup), by day, over the period chosen.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  aliasFileEntrySchema,
  diffAliasEntry,
  type AliasChange,
  type AliasPartDef,
  type AliasSetupChange,
  type AliasView,
  type StateHistoryPoint,
} from '@nebulahome/contracts';
import { AppIcon, Button, Modal, Segmented, SelectField } from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';
import { formatPartValue, partLabel, partValueOf } from '@/library/alias-model';
import { fetchAliasSetupHistory, fetchStateHistory, LIBRARY_QUERY_KEYS } from '@/library/api';
import { useCauseNames } from '@/library/use-cause-names';

/** The periods the tab reads, in days. */
const PERIODS = [1, 7, 30] as const;

/** One row of the tab. */
type Row = {
  readonly at: Date;
  readonly kind: 'value' | 'setup';
  readonly part: string;
  readonly change: string;
  readonly origin: string;
  readonly diff?: readonly AliasChange[];
};

/** The columns, shared by the header and the rows. */
const COLUMNS =
  'grid grid-cols-[64px_132px_minmax(0,1fr)_minmax(0,1fr)_160px] items-center gap-3 px-4';

/**
 * The rows of the value changes: one per part that changed, oldest first.
 *
 * @param points - The alias's changes, oldest first.
 * @param defs - Its parts.
 * @param unit - Its unit.
 * @param originOf - Who caused a change, in words.
 * @returns The rows.
 */
export function valueRows(
  points: readonly StateHistoryPoint[],
  defs: readonly AliasPartDef[],
  unit: string | null,
  originOf: (point: StateHistoryPoint) => string,
): Row[] {
  const rows: Row[] = [];
  const previous = new Map<string, string>();

  for (const point of points) {
    for (const def of defs) {
      if (def.kind === 'picture' || def.kind === 'rooms') {
        continue;
      }

      const value = partValueOf(def, point.state);

      if (value === undefined) {
        continue;
      }

      const now = formatPartValue(def, value, unit);
      const was = previous.get(def.key);

      if (was !== undefined && was !== now) {
        rows.push({
          at: point.time,
          kind: 'value',
          part: partLabel(def),
          change: `${was} → ${now}`,
          origin: originOf(point),
        });
      }

      previous.set(def.key, now);
    }
  }

  return rows;
}

/**
 * A value in a change's words.
 *
 * @param value - The value.
 * @returns It, as text.
 */
function wordOf(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * A setup change in a few words.
 *
 * @param changes - What changed.
 * @param action - Made, changed or imported.
 * @returns The words.
 */
function setupWords(changes: readonly AliasChange[], action: AliasSetupChange['action']): string {
  if (action !== 'update') {
    return action === 'create' ? 'Created' : 'Imported';
  }

  const source = changes.find((change) => change.path.endsWith('.from'));

  if (source !== undefined && changes.length <= 3) {
    return `Source ${wordOf(source.before)} → ${wordOf(source.after)}`;
  }

  const code = changes.find((change) => change.path === 'code');

  if (code !== undefined && changes.length === 1) {
    return `${wordOf(code.after)} lines changed`;
  }

  return changes.length === 1 ? (changes[0]?.path ?? '') : `${String(changes.length)} changes`;
}

/**
 * The History tab.
 *
 * @param props - The alias and its parts.
 * @param props.alias - The alias.
 * @param props.defs - Its parts.
 * @returns The tab.
 */
export function AliasHistoryTab(props: {
  readonly alias: AliasView;
  readonly defs: readonly AliasPartDef[];
}) {
  const { t } = useTranslation();
  const { alias, defs } = props;
  const [show, setShow] = useState<'all' | 'values' | 'setup'>('all');
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const [diff, setDiff] = useState<Row | null>(null);
  const causeName = useCauseNames();
  const [openedAt] = useState(Date.now);
  const values = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.history, alias.entityId, 'alias-history', days],
    /**
     * Reads the alias's changes over the period.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The changes.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const to = new Date();
      const from = new Date(to.getTime() - days * 86_400_000);

      return fetchStateHistory({ entityId: alias.entityId, from, to }, signal);
    },
    enabled: show !== 'setup',
  });
  const setup = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.aliases, alias.id, 'setup-history', days],
    /**
     * Reads the changes to the alias's setup over the period.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The changes.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      fetchAliasSetupHistory(alias.id, days, signal),
    enabled: show !== 'values',
  });

  const rows: Row[] = [
    ...(show === 'setup'
      ? []
      : valueRows(values.data ?? [], defs, alias.display.unit, (point) => {
          if (point.context?.type === 'alias') {
            const fn = Object.values(alias.parts).find((part) => part.from === 'code');

            return fn?.from === 'code' ? `${fn.function}()` : causeName(point.context).label;
          }

          // A change nobody asked for is the alias working itself out.
          return causeName(point.context ?? { type: 'alias' }).label;
        })),
    ...(show === 'values'
      ? []
      : (setup.data ?? []).map((change): Row => {
          const before = aliasFileEntrySchema.safeParse(change.before);
          const after = aliasFileEntrySchema.safeParse(change.after);
          const changes = diffAliasEntry(
            before.success ? before.data : null,
            after.success ? after.data : null,
          );
          const part = changes.find((each) => each.path.includes('.'))?.path.split('.')[0];
          const def = defs.find((each) => each.key === part);

          return {
            at: change.at,
            kind: 'setup',
            part: def === undefined ? t('library.aliasPage.setup', 'Setup') : partLabel(def),
            change: setupWords(changes, change.action),
            origin: change.by ?? t('library.aliasPage.platform', 'Nebula'),
            diff: changes,
          };
        })),
  ].toSorted((left, right) => right.at.getTime() - left.at.getTime());

  const day = dateTimeFormat({ weekday: 'long', day: 'numeric', month: 'long' });
  const time = dateTimeFormat({ hour: '2-digit', minute: '2-digit' });
  const today = new Date(openedAt).toDateString();
  const yesterday = new Date(openedAt - 86_400_000).toDateString();

  /**
   * A day's heading.
   *
   * @param at - A time in it.
   * @returns Today, Yesterday, or the date.
   */
  const dayOf = (at: Date): string =>
    at.toDateString() === today
      ? t('library.aliasPage.today', 'Today')
      : at.toDateString() === yesterday
        ? t('library.aliasPage.yesterday', 'Yesterday')
        : day.format(at);
  const headings = [...new Set(rows.map((row) => dayOf(row.at)))];
  const isPending =
    (show !== 'setup' && values.isPending) || (show !== 'values' && setup.isPending);

  return (
    <>
      <div className="flex items-center gap-3">
        <Segmented
          label={t('library.aliases.show', 'Show')}
          size="compact"
          options={[
            { value: 'all', label: t('library.aliasPage.all', 'All') },
            { value: 'values', label: t('library.aliasPage.values', 'Values') },
            { value: 'setup', label: t('library.aliasPage.setup', 'Setup') },
          ]}
          value={show}
          onChange={setShow}
        />
        <span className="grow" />
        <span className="w-44">
          <SelectField
            label={t('library.aliasPage.period', 'Period')}
            isLabelHidden
            size="compact"
            options={[
              { value: '1', label: t('library.aliasPage.last24Hours', 'Last 24 hours') },
              { value: '7', label: t('library.aliasPage.last7Days', 'Last 7 days') },
              { value: '30', label: t('library.aliasPage.last30Days', 'Last 30 days') },
            ]}
            value={String(days)}
            onChange={(value) => {
              setDays(PERIODS.find((each) => String(each) === value) ?? 7);
            }}
          />
        </span>
      </div>
      <div className="rounded-panel border border-border bg-surface">
        <div
          className={`${COLUMNS} border-b border-border py-3 font-mono text-label text-foreground-subtle uppercase`}
        >
          <span>{t('library.aliasPage.time', 'Time')}</span>
          <span>{t('library.aliasPage.kind', 'Kind')}</span>
          <span>{t('library.aliasPage.part', 'Part')}</span>
          <span>{t('library.aliasPage.change', 'Change')}</span>
          <span>{t('library.aliasPage.origin', 'Origin')}</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-4 text-ui-sm text-foreground-subtle">
            {isPending
              ? t('library.detail.reading', 'Reading…')
              : t('library.aliasPage.nothingInPeriod', 'Nothing changed in this period.')}
          </p>
        ) : (
          headings.map((heading) => (
            <div key={heading}>
              <div className="border-b border-border bg-canvas/40 px-4 py-1.5 text-caption font-medium text-foreground-muted">
                {heading}
              </div>
              {rows
                .filter((row) => dayOf(row.at) === heading)
                .map((row) => (
                  <div
                    key={`${String(row.at.getTime())}:${row.kind}:${row.part}`}
                    className={`${COLUMNS} border-b border-border py-2.5 last:border-b-0`}
                  >
                    <span className="font-mono text-caption text-foreground-subtle">
                      {time.format(row.at)}
                    </span>
                    <span className="flex items-center gap-1.5 text-ui-sm text-foreground-muted">
                      <AppIcon
                        id={row.kind === 'value' ? 'activity' : 'pencil'}
                        size={13}
                        className="text-foreground-subtle"
                      />
                      {row.kind === 'value'
                        ? t('library.aliasPage.value', 'Value')
                        : t('library.aliasPage.setup', 'Setup')}
                    </span>
                    <span className="truncate text-ui-sm">{row.part}</span>
                    <span className="truncate text-ui-sm text-foreground">{row.change}</span>
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate text-ui-sm text-foreground-muted">
                        {row.origin}
                      </span>
                      {row.diff === undefined || row.diff.length === 0 ? null : (
                        <Button
                          variant="bare"
                          size="compact"
                          onClick={() => {
                            setDiff(row);
                          }}
                        >
                          {t('library.aliasPage.diff', 'Diff')}
                        </Button>
                      )}
                    </span>
                  </div>
                ))}
            </div>
          ))
        )}
      </div>
      <Modal
        isOpen={diff !== null}
        size="large"
        title={t('library.aliasPage.diffTitle', 'Setup changed · {{when}}', {
          when: diff === null ? '' : `${dayOf(diff.at)} ${time.format(diff.at)}`,
        })}
        onClose={() => {
          setDiff(null);
        }}
      >
        <div className="flex flex-col gap-1 font-mono text-mono-caption">
          {(diff?.diff ?? []).map((change) => (
            <div
              key={`${change.sign}${change.path}`}
              className="grid grid-cols-[16px_200px_minmax(0,1fr)] gap-3"
            >
              <span
                className={
                  change.sign === '+'
                    ? 'text-success'
                    : change.sign === '-'
                      ? 'text-danger'
                      : 'text-warning'
                }
              >
                {change.sign}
              </span>
              <span className="truncate text-foreground-muted">{change.path}</span>
              <span className="min-w-0 break-all">
                {change.before === undefined ? null : (
                  <span className="text-foreground-subtle line-through">
                    {JSON.stringify(change.before)}
                  </span>
                )}
                {change.before !== undefined && change.after !== undefined ? ' → ' : null}
                {change.after === undefined ? null : <span>{JSON.stringify(change.after)}</span>}
              </span>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
