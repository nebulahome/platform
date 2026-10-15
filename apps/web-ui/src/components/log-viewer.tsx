/**
 * A log, followed as it is written: a container's, a package's.
 *
 * What was a block of text is a table of lines: the time each was received, to the millisecond,
 * in the viewer's own time; a bar for the error stream; the line's level where it says one; and
 * the message, in the colours the program asked for, drawn with the theme's tones. A JSON line
 * shows its message, and the object it was on a click.
 *
 * **It follows on its own.** Every few seconds - the viewer picks how often, and off - it asks for
 * the lines after the last one it has (`since`, the cursor the last read answered), so a read
 * carries what is new rather than the whole log again, and nothing at all while the tab is hidden.
 * The list stays at the bottom while the reader is there; one who scrolled up to read is left
 * where they are, and a round arrow in the list's corner takes them back to the newest line -
 * lit when there is more below. The reads it makes on its own leave the chrome still: only a
 * read asked for turns the button that asked.
 *
 * The owner of the log says how to read it (`read`) and where the reads are kept (`queryKey`):
 * the viewer knows nothing of containers.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ContainerLogLine, ContainerLogsReply } from '@nebulahome/contracts';
import { AppIcon, IconButton, Segmented, SelectField, cn } from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { readLine, type LogLevel, type LogTone, type ReadLine } from '@/lib/log-lines';
import { SearchField } from '@/routes/library/search-field';

/** How often the log is read again, in seconds; 0 is never. */
const INTERVALS = [0, 2, 5, 10, 30] as const;

/** How many lines are kept. */
const LINE_COUNTS = [200, 500, 1000, 2000] as const;

/** Where the viewer's own choices are remembered, in this browser only. */
const PREFERENCES_KEY = 'nebula.log-viewer';

/** How close to the bottom still counts as at the bottom, in pixels. */
const BOTTOM_SLACK_PX = 24;

/** What the viewer remembers between visits. */
type Preferences = {
  readonly intervalSeconds: (typeof INTERVALS)[number];
  readonly lineCount: (typeof LINE_COUNTS)[number];
  readonly isWrapped: boolean;
};

/** Where the viewer starts, the first time. */
const DEFAULT_PREFERENCES: Preferences = { intervalSeconds: 5, lineCount: 500, isWrapped: true };

/** Which lines are shown, by level. */
type LevelFilter = 'all' | 'info' | 'warnings' | 'errors';

/**
 * The level filter's choices. The levels keep their English names in every language, as the log
 * lines do (RULES.md 1); only "all" is the viewer's own word.
 *
 * @returns The choices.
 */
function levelOptions(): readonly { readonly value: LevelFilter; readonly label: string }[] {
  return [
    { value: 'all', label: translate('logs.levels.all', 'All') },
    { value: 'info', label: 'Info' },
    { value: 'warnings', label: 'Warnings' },
    { value: 'errors', label: 'Errors' },
  ];
}

/** One line kept, read once. */
type KeptLine = { readonly key: number; readonly line: ContainerLogLine; readonly read: ReadLine };

/** What a read of the log has gathered so far. */
type LogBuffer = {
  readonly lines: readonly KeptLine[];
  readonly cursor: string | null;
  readonly isTruncated: boolean;
  readonly nextKey: number;
};

/** The classes of each tone a program's colour stands for. */
const TONE_CLASSES: Readonly<Record<LogTone, string>> = {
  danger: 'text-danger',
  warning: 'text-warning',
  success: 'text-success',
  accent: 'text-primary',
  subtle: 'text-foreground-subtle',
};

/** How each level is shown in its column. */
const LEVEL_STYLE: Readonly<
  Record<LogLevel, { readonly label: string; readonly className: string }>
> = {
  error: { label: 'ERR', className: 'text-danger' },
  warning: { label: 'WRN', className: 'text-warning' },
  info: { label: 'INF', className: 'text-primary' },
  debug: { label: 'DBG', className: 'text-foreground-subtle' },
};

/** A time as the table shows it: the viewer's hours, minutes, seconds and milliseconds. */
const TIME: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
};

/** A time in full, for the tooltip. */
const FULL_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'medium' };

/**
 * Reads what the viewer remembers, or where it starts.
 *
 * @returns The preferences; the defaults when storage is unavailable or holds something else.
 */
function readPreferences(): Preferences {
  try {
    const raw = globalThis.localStorage.getItem(PREFERENCES_KEY);
    const value: unknown = raw === null ? null : JSON.parse(raw);

    if (typeof value !== 'object' || value === null) {
      return DEFAULT_PREFERENCES;
    }

    const saved = value as Record<string, unknown>;
    const intervalSeconds = INTERVALS.find((each) => each === saved['intervalSeconds']);
    const lineCount = LINE_COUNTS.find((each) => each === saved['lineCount']);

    return {
      intervalSeconds: intervalSeconds ?? DEFAULT_PREFERENCES.intervalSeconds,
      lineCount: lineCount ?? DEFAULT_PREFERENCES.lineCount,
      isWrapped:
        typeof saved['isWrapped'] === 'boolean'
          ? saved['isWrapped']
          : DEFAULT_PREFERENCES.isWrapped,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Remembers the viewer's choices, when the browser lets it.
 *
 * @param preferences - What to remember.
 */
function writePreferences(preferences: Preferences): void {
  try {
    globalThis.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // A private window or blocked storage: the choice lasts as long as the page.
  }
}

/**
 * Whether a line passes the level filter.
 *
 * @param kept - The line.
 * @param filter - Which lines to show.
 * @returns True when it is shown.
 */
function passesLevel(kept: KeptLine, filter: LevelFilter): boolean {
  if (filter === 'all') {
    return true;
  }

  const level = levelOf(kept);

  return filter === 'info'
    ? level !== 'debug'
    : filter === 'errors'
      ? level === 'error'
      : level === 'error' || level === 'warning';
}

/**
 * A line's level: the one it says, or a warning for one written to the error stream that says
 * none.
 *
 * @param kept - The line.
 * @returns Its level, or null for one that says none.
 */
function levelOf(kept: KeptLine): LogLevel | null {
  return kept.read.level ?? (kept.line.stream === 'stderr' ? 'warning' : null);
}

/**
 * A message, with what was searched for marked.
 *
 * @param props - The line and the search.
 * @param props.read - The line, read.
 * @param props.search - What was searched for; empty for nothing.
 * @returns The message.
 */
function Message(props: { readonly read: ReadLine; readonly search: string }) {
  const { read, search } = props;
  const needle = search.trim().toLowerCase();

  return (
    <>
      {read.segments.map((segment, index) => {
        const className = cn(
          segment.tone === null ? undefined : TONE_CLASSES[segment.tone],
          segment.isBold && 'font-medium',
        );

        if (needle === '') {
          return (
            // eslint-disable-next-line react/no-array-index-key -- stretches of one line never move
            <span key={index} className={className}>
              {segment.text}
            </span>
          );
        }

        const parts: ReactNode[] = [];
        const lower = segment.text.toLowerCase();
        let from = 0;
        let at = lower.indexOf(needle);

        while (at !== -1) {
          parts.push(segment.text.slice(from, at));
          parts.push(
            <mark key={at} className="rounded-chip bg-warning/30 text-foreground">
              {segment.text.slice(at, at + needle.length)}
            </mark>,
          );
          from = at + needle.length;
          at = lower.indexOf(needle, from);
        }

        parts.push(segment.text.slice(from));

        return (
          // eslint-disable-next-line react/no-array-index-key -- stretches of one line never move
          <span key={index} className={className}>
            {parts}
          </span>
        );
      })}
    </>
  );
}

/**
 * One row of the table.
 *
 * @param props - The line, the search, and whether long lines wrap.
 * @param props.kept - The line.
 * @param props.search - What was searched for.
 * @param props.isWrapped - Whether a long line wraps rather than scrolls.
 * @returns The row.
 */
function LogRow(props: {
  readonly kept: KeptLine;
  readonly search: string;
  readonly isWrapped: boolean;
}) {
  const { kept, search, isWrapped } = props;
  const [isOpen, setOpen] = useState(false);
  const { line, read } = kept;
  const level = read.level === null ? null : LEVEL_STYLE[read.level];

  return (
    <li
      className={cn(
        'grid grid-cols-[auto_2.25rem_minmax(0,1fr)] gap-x-3 border-l-2 px-3 py-0.5 hover:bg-surface-raised',
        line.stream === 'stderr' ? 'border-danger/60' : 'border-transparent',
      )}
    >
      <span
        className="text-foreground-subtle tabular select-none"
        title={line.at === null ? undefined : dateTimeFormat(FULL_TIME).format(line.at)}
      >
        {line.at === null ? '—' : dateTimeFormat(TIME).format(line.at)}
      </span>
      <span className={cn('font-medium select-none', level?.className ?? 'text-transparent')}>
        {level?.label ?? '·'}
      </span>
      <span
        className={cn(
          'min-w-0 text-foreground',
          isWrapped ? 'break-words whitespace-pre-wrap' : 'whitespace-pre',
        )}
      >
        <Message read={read} search={search} />
        {read.json === null ? null : (
          <>
            {' '}
            <button
              type="button"
              className="rounded-chip px-1 text-foreground-subtle hover:text-foreground"
              aria-expanded={isOpen}
              onClick={() => {
                setOpen(!isOpen);
              }}
            >
              {isOpen ? '{−}' : '{…}'}
            </button>
            {isOpen ? (
              <pre className="mt-1 mb-1.5 overflow-x-auto rounded-field bg-surface-raised px-2.5 py-1.5 text-foreground-muted">
                {JSON.stringify(read.json, null, 2)}
              </pre>
            ) : null}
          </>
        )}
      </span>
    </li>
  );
}

/** What the viewer needs. */
export type LogViewerProps = {
  /** What the panel is called. */
  readonly title?: string;

  /** Where the reads are kept; the viewer adds its line count to it. */
  readonly queryKey: readonly unknown[];

  /**
   * Reads the log: the newest `tail` lines, or those after `since`.
   *
   * @param tail - How many lines at most.
   * @param since - After which cursor, for a read that follows the last.
   * @param signal - Cancels the read.
   * @returns The lines, oldest first, and where the next read carries on.
   */
  readonly read: (
    tail: number,
    since: string | undefined,
    signal: AbortSignal,
  ) => Promise<ContainerLogsReply>;

  /** What the downloaded file is called, without `.log`. */
  readonly fileName: string;

  /**
   * Whether the viewer takes the height it is given - a tab that is nothing but the log - rather
   * than a list of its own height with the page scrolling past it.
   */
  readonly isFilled?: boolean;
};

/**
 * Renders a log that follows itself.
 *
 * @param props - See {@link LogViewerProps}.
 * @returns The panel.
 */
export function LogViewer(props: LogViewerProps) {
  const { t } = useTranslation();
  const { read, fileName, isFilled = false } = props;
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState(readPreferences);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [isFollowing, setFollowing] = useState(true);
  const [hasUnseen, setUnseen] = useState(false);
  const [isRereading, setRereading] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const queryKey = useMemo(
    () => [...props.queryKey, preferences.lineCount] as const,
    [props.queryKey, preferences.lineCount],
  );

  const logs = useQuery({
    queryKey,

    /**
     * Reads the lines after the last one kept, or the newest ones the first time, and adds them.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns Every line kept now.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<LogBuffer> => {
      const kept = queryClient.getQueryData<LogBuffer>(queryKey);
      const since = kept?.cursor ?? undefined;
      const reply = await read(preferences.lineCount, since, signal);
      let nextKey = kept?.nextKey ?? 0;
      const fresh = reply.lines.map((line): KeptLine => {
        nextKey += 1;

        return { key: nextKey, line, read: readLine(line.text) };
      });
      const lines = [...(since === undefined ? [] : (kept?.lines ?? [])), ...fresh].slice(
        -preferences.lineCount,
      );

      return {
        lines,
        cursor: reply.cursor,
        isTruncated: (kept?.isTruncated ?? false) || reply.isTruncated,
        nextKey,
      };
    },
    refetchInterval: preferences.intervalSeconds === 0 ? false : preferences.intervalSeconds * 1000,
    refetchIntervalInBackground: false,
  });

  const lines = logs.data?.lines ?? [];
  const shown = lines.filter(
    (kept) =>
      passesLevel(kept, levelFilter) &&
      (search.trim() === '' ||
        kept.read.message.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const lastKey = lines.at(-1)?.key ?? 0;
  const isStreaming = preferences.intervalSeconds > 0;
  const errorCount = lines.filter((kept) => levelOf(kept) === 'error').length;
  const warningCount = lines.filter((kept) => levelOf(kept) === 'warning').length;

  // Following is keeping the list at its bottom as lines arrive: the DOM, after React drew it.
  useLayoutEffect(() => {
    const element = list.current;

    if (element !== null && isFollowing) {
      element.scrollTop = element.scrollHeight;
    }
  }, [lastKey, isFollowing, shown.length]);

  // A reader who scrolled up is told there is more below, once there is.
  const seenKey = useRef(lastKey);

  useEffect(() => {
    if (isFollowing) {
      seenKey.current = lastKey;
    } else if (lastKey !== seenKey.current) {
      setUnseen(true);
    }
  }, [lastKey, isFollowing]);

  /**
   * Keeps a choice and remembers it.
   *
   * @param change - What changed.
   */
  const choose = (change: Partial<Preferences>): void => {
    const next = { ...preferences, ...change };

    setPreferences(next);
    writePreferences(next);
  };

  /** Goes back to the newest line, and follows again. */
  const jumpToLatest = (): void => {
    setFollowing(true);
    setUnseen(false);
  };

  /**
   * Throws away what was read and reads the newest lines again. Only this read turns the button:
   * the ones the viewer makes on its own every few seconds change nothing in the chrome.
   */
  const readAgain = (): void => {
    setRereading(true);
    queryClient.removeQueries({ queryKey, exact: true });
    void logs.refetch().finally(() => {
      setRereading(false);
    });
  };

  /**
   * The lines shown, as text.
   *
   * @returns One line each: the time, the stream, the text.
   */
  const asText = (): string =>
    shown
      .map(
        ({ line }) =>
          `${line.at === null ? '' : line.at.toISOString()} ${line.stream} ${line.text}`,
      )
      .join('\n');

  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden rounded-panel border border-border bg-surface',
        isFilled ? 'min-h-0 grow' : undefined,
      )}
    >
      <header className="flex min-h-12 items-center justify-between gap-3 px-5.5 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="text-subhead font-medium text-foreground">
            {props.title ?? t('logs.title', 'Logs')}
          </h2>
          {/* What the viewer is doing, said once and left alone: it does not blink with every read
              it makes in the background, which is what made the corner flash. */}
          <span className="flex items-center gap-1.5 font-mono text-mono-caption text-foreground-subtle">
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 rounded-full',
                isStreaming ? 'bg-success ring-3 ring-success/15' : 'bg-foreground-subtle',
              )}
            />
            {isStreaming
              ? t('logs.live', 'Live · every {{seconds}} s', {
                  seconds: preferences.intervalSeconds,
                })
              : t('logs.manual', 'Manual')}
          </span>
        </div>

        <span className="flex items-center gap-1">
          <IconButton
            label={t('logs.copy', 'Copy the lines shown')}
            onClick={() => {
              // Absent on a page served over plain HTTP from another machine: not a secure context.
              const clipboard = navigator.clipboard as Clipboard | undefined;

              void clipboard?.writeText(asText()).catch(() => undefined);
            }}
          >
            <AppIcon id="copy" size={15} />
          </IconButton>
          <IconButton
            label={t('logs.download', 'Download the lines shown')}
            onClick={() => {
              const url = URL.createObjectURL(new Blob([asText()], { type: 'text/plain' }));
              const link = document.createElement('a');

              link.href = url;
              link.download = `${fileName}.log`;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            <AppIcon id="download" size={15} />
          </IconButton>
          <IconButton
            label={t('logs.readAgain', 'Read the log again')}
            disabled={isRereading}
            onClick={readAgain}
          >
            <AppIcon
              id="refresh-cw"
              size={15}
              className={isRereading ? 'animate-spin' : undefined}
            />
          </IconButton>
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-y border-border px-4 py-2.5">
        <SearchField
          placeholder={t('logs.search', 'Search the log…')}
          value={search}
          onChange={setSearch}
          className="min-w-44 grow basis-56 lg:w-auto"
        />
        <Segmented
          label={t('logs.which', 'Which lines')}
          size="compact"
          className="h-control"
          options={levelOptions()}
          value={levelFilter}
          onChange={setLevelFilter}
        />
        <span className="flex items-center gap-2">
          <SelectField
            label={t('logs.interval', 'Read again every')}
            isLabelHidden
            size="compact"
            className="h-control w-36 rounded-pill bg-surface"
            options={INTERVALS.map((seconds) => ({
              value: String(seconds),
              label:
                seconds === 0
                  ? t('logs.intervalNever', 'Not on its own')
                  : t('logs.intervalEvery', 'Every {{seconds}} s', { seconds }),
            }))}
            value={String(preferences.intervalSeconds)}
            onChange={(value) => {
              choose({
                intervalSeconds:
                  INTERVALS.find((each) => String(each) === value) ??
                  DEFAULT_PREFERENCES.intervalSeconds,
              });
            }}
          />
          <SelectField
            label={t('logs.kept', 'Lines kept')}
            isLabelHidden
            size="compact"
            className="h-control w-32 rounded-pill bg-surface"
            options={LINE_COUNTS.map((count) => ({
              value: String(count),
              label: t('logs.lineCount', {
                count,
                defaultValue_one: '{{count}} line',
                defaultValue_other: '{{count}} lines',
              }),
            }))}
            value={String(preferences.lineCount)}
            onChange={(value) => {
              choose({
                lineCount:
                  LINE_COUNTS.find((each) => String(each) === value) ??
                  DEFAULT_PREFERENCES.lineCount,
              });
            }}
          />
          <IconButton
            label={
              preferences.isWrapped
                ? t('logs.unwrap', 'Keep each line on one row')
                : t('logs.wrap', 'Wrap long lines')
            }
            variant="raised"
            size="large"
            aria-pressed={preferences.isWrapped}
            className={cn(
              preferences.isWrapped ? 'border-primary-ring text-primary' : 'bg-surface',
            )}
            onClick={() => {
              choose({ isWrapped: !preferences.isWrapped });
            }}
          >
            <AppIcon id="text-wrap" size={16} />
          </IconButton>
        </span>
      </div>

      {logs.error === null ? (
        <div className={cn('relative flex flex-col', isFilled ? 'min-h-0 grow' : undefined)}>
          <div
            ref={list}
            role="log"
            aria-live="off"
            className={cn(
              'overflow-auto bg-rail py-1.5 font-mono text-caption leading-relaxed',
              isFilled ? 'min-h-80 grow basis-0' : 'max-h-[32rem] min-h-40',
            )}
            onScroll={(event) => {
              const element = event.currentTarget;
              const isAtBottom =
                element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_SLACK_PX;

              if (isAtBottom !== isFollowing) {
                setFollowing(isAtBottom);
              }

              if (isAtBottom) {
                setUnseen(false);
              }
            }}
          >
            {logs.data?.isTruncated === true ? (
              <p className="px-3 pb-1 text-foreground-subtle">
                {t(
                  'logs.truncated',
                  'Older lines were left out: they were too many to carry at once.',
                )}
              </p>
            ) : null}
            {shown.length === 0 ? (
              <p className="px-3 py-2 font-sans text-ui text-foreground-subtle">
                {logs.isPending
                  ? t('logs.reading', 'Reading…')
                  : lines.length === 0
                    ? t('logs.empty', 'It has written nothing.')
                    : t('logs.noMatch', 'No line matches.')}
              </p>
            ) : (
              <ul>
                {shown.map((kept) => (
                  <LogRow
                    key={kept.key}
                    kept={kept}
                    search={search}
                    isWrapped={preferences.isWrapped}
                  />
                ))}
              </ul>
            )}
          </div>
          {/* Following is the default and needs no control; the way back to it appears only once
              the reader has scrolled away, where the newest line would be. */}
          {isFollowing ? null : (
            <IconButton
              label={
                hasUnseen
                  ? t('logs.newBelow', 'New lines below: follow them')
                  : t('logs.follow', 'Follow the newest lines')
              }
              variant={hasUnseen ? 'primary' : 'raised'}
              size="large"
              className="absolute right-6 bottom-4 animate-rise shadow-float"
              onClick={jumpToLatest}
            >
              <AppIcon id="arrow-down" size={16} />
            </IconButton>
          )}
        </div>
      ) : (
        <p className="px-4 py-3.5 text-ui text-danger">{toMessage(logs.error)}</p>
      )}

      <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2 font-mono text-mono-caption text-foreground-subtle">
        <span className="flex flex-wrap items-center gap-1.5 tabular">
          <span>
            {shown.length === lines.length
              ? t('logs.lineCount', {
                  count: lines.length,
                  defaultValue_one: '{{count}} line',
                  defaultValue_other: '{{count}} lines',
                })
              : t('logs.shownOf', {
                  count: lines.length,
                  shown: shown.length,
                  defaultValue_one: '{{shown}} of {{count}} line',
                  defaultValue_other: '{{shown}} of {{count}} lines',
                })}
          </span>
          {errorCount === 0 ? null : (
            <>
              <span aria-hidden="true">·</span>
              {/* A log level's name, in English like the lines it counts. */}
              <span className="text-danger" translate="no">
                {errorCount} {errorCount === 1 ? 'error' : 'errors'}
              </span>
            </>
          )}
          {warningCount === 0 ? null : (
            <>
              <span aria-hidden="true">·</span>
              {/* A log level's name, in English like the lines it counts. */}
              <span className="text-warning" translate="no">
                {warningCount} {warningCount === 1 ? 'warning' : 'warnings'}
              </span>
            </>
          )}
        </span>
        <span>
          {!isStreaming
            ? t('logs.onlyAsked', 'Read again only when asked')
            : isFollowing
              ? t('logs.following', 'Following')
              : t('logs.paused', 'Paused where you scrolled; new lines are still read')}
        </span>
      </p>
    </section>
  );
}
