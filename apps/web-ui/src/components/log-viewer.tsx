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
 * where they are, and a pill says there is more below.
 *
 * The owner of the log says how to read it (`read`) and where the reads are kept (`queryKey`):
 * the viewer knows nothing of containers.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { ContainerLogLine, ContainerLogsReply } from '@nebula-home/contracts';
import { AppIcon, Button, IconButton, Panel, Segmented, SelectField, cn } from '@nebula-home/ui';

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
type LevelFilter = 'all' | 'warnings' | 'errors';

/** The level filter's choices. */
const LEVEL_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'warnings', label: 'Warnings' },
  { value: 'errors', label: 'Errors' },
] as const;

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
const TIME = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
});

/** A time in full, for the tooltip. */
const FULL_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

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

  const level = kept.read.level ?? (kept.line.stream === 'stderr' ? 'warning' : null);

  return filter === 'errors' ? level === 'error' : level === 'error' || level === 'warning';
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
          segment.isBold && 'font-semibold',
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
            <mark key={at} className="rounded-sm bg-warning/30 text-foreground">
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
        title={line.at === null ? undefined : FULL_TIME.format(line.at)}
      >
        {line.at === null ? '—' : TIME.format(line.at)}
      </span>
      <span className={cn('font-semibold select-none', level?.className ?? 'text-transparent')}>
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
              className="rounded-sm px-1 text-foreground-subtle hover:text-foreground"
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
};

/**
 * Renders a log that follows itself.
 *
 * @param props - See {@link LogViewerProps}.
 * @returns The panel.
 */
export function LogViewer(props: LogViewerProps) {
  const { read, fileName } = props;
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState(readPreferences);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [isFollowing, setFollowing] = useState(true);
  const [hasUnseen, setUnseen] = useState(false);
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

  /** Throws away what was read and reads the newest lines again. */
  const readAgain = (): void => {
    queryClient.removeQueries({ queryKey, exact: true });
    void logs.refetch();
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
    <Panel
      title={props.title ?? 'Logs'}
      action={
        <span className="flex items-center gap-1.5">
          {logs.isFetching ? (
            <span
              aria-hidden="true"
              className="size-1.5 animate-pulse rounded-full bg-primary"
              title="Reading"
            />
          ) : null}
          <IconButton
            label="Copy the lines shown"
            onClick={() => {
              // Absent on a page served over plain HTTP from another machine: not a secure context.
              const clipboard = navigator.clipboard as Clipboard | undefined;

              void clipboard?.writeText(asText()).catch(() => undefined);
            }}
          >
            <AppIcon id="copy" size={15} />
          </IconButton>
          <IconButton
            label="Download the lines shown"
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
          <Button variant="ghost" size="compact" isBusy={logs.isFetching} onClick={readAgain}>
            Read again
          </Button>
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <SearchField
          placeholder="Search the log…"
          value={search}
          onChange={setSearch}
          className="min-w-44 grow basis-48"
        />
        <Segmented
          label="Which lines"
          size="compact"
          options={LEVEL_OPTIONS}
          value={levelFilter}
          onChange={setLevelFilter}
        />
        <SelectField
          label="Read again every"
          isLabelHidden
          size="compact"
          className="w-36"
          options={INTERVALS.map((seconds) => ({
            value: String(seconds),
            label: seconds === 0 ? 'Not on its own' : `Every ${String(seconds)} s`,
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
          label="Lines kept"
          isLabelHidden
          size="compact"
          className="w-32"
          options={LINE_COUNTS.map((count) => ({
            value: String(count),
            label: `${String(count)} lines`,
          }))}
          value={String(preferences.lineCount)}
          onChange={(value) => {
            choose({
              lineCount:
                LINE_COUNTS.find((each) => String(each) === value) ?? DEFAULT_PREFERENCES.lineCount,
            });
          }}
        />
        <Button
          variant="ghost"
          size="compact"
          aria-pressed={preferences.isWrapped}
          onClick={() => {
            choose({ isWrapped: !preferences.isWrapped });
          }}
        >
          {preferences.isWrapped ? 'Wrap on' : 'Wrap off'}
        </Button>
      </div>

      {logs.error === null ? (
        <div className="relative">
          <div
            ref={list}
            role="log"
            aria-live="off"
            className="max-h-[32rem] min-h-40 overflow-auto py-1.5 font-mono text-caption leading-relaxed"
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
                Older lines were left out: they were too many to carry at once.
              </p>
            ) : null}
            {shown.length === 0 ? (
              <p className="px-3 py-2 font-sans text-ui text-foreground-subtle">
                {logs.isPending
                  ? 'Reading…'
                  : lines.length === 0
                    ? 'It has written nothing.'
                    : 'No line matches.'}
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
          {hasUnseen ? (
            <button
              type="button"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full face-primary px-3 py-1 text-caption font-medium text-primary-foreground shadow-md"
              onClick={jumpToLatest}
            >
              New lines below
            </button>
          ) : null}
        </div>
      ) : (
        <p className="px-4 py-3.5 text-ui text-danger">{toMessage(logs.error)}</p>
      )}

      <p className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-caption text-foreground-subtle">
        <span className="tabular">
          {shown.length === lines.length
            ? `${String(lines.length)} lines`
            : `${String(shown.length)} of ${String(lines.length)} lines`}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {preferences.intervalSeconds === 0
            ? 'Read again only when asked'
            : isFollowing
              ? 'Following'
              : 'Paused where you scrolled; new lines are still read'}
        </span>
      </p>
    </Panel>
  );
}
