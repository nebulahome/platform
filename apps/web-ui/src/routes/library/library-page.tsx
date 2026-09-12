/**
 * The frame every library page sits in.
 *
 * Five pages show a collection of one kind of thing, and all five have the same four states to
 * get through before they can show it: loading, failed, empty, and there. Written five times
 * that is five chances for one of them to forget the empty state, which is the one a new
 * installation spends its first day in.
 *
 * The count is in the header rather than at the foot of the list, because it answers a question
 * people have before they start reading rather than after.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Panel } from '@nebula-home/ui';

import { toMessage } from '@/lib/error-message';
import { LibraryTabs } from '@/routes/library/library-tabs';

/** What the frame needs. */
export type LibraryPageProps = {
  /** What this page is about. */
  readonly title: string;

  /** A line under it saying what these things are. A page about one thing has none. */
  readonly summary?: string | undefined;

  /** What the collection is called when it is counted, e.g. `automation`. */
  readonly noun: string;

  /** How many there are. Undefined while it is still being read. */
  readonly count?: number | undefined;

  /**
   * The page this one is inside, for a header that reads `Integrations / Shelly`.
   *
   * The way a repository names itself - owner, slash, name - so that where you are and the way
   * back are the same three words.
   */
  readonly parent?: { readonly to: string; readonly label: string } | undefined;

  /**
   * Controls that narrow the collection - a search, a filter - set beside the action.
   *
   * In the header rather than in a toolbar under it: they act on the whole page, and the
   * header is where the whole page is named.
   */
  readonly tools?: ReactNode;

  /** Controls in the header. */
  readonly action?: ReactNode;

  /**
   * Whether the header carries the switch between the library's four views.
   *
   * Off for a page that is not one of them. Integrations is a section of its own and has nowhere
   * to switch to; a tab bar with one tab is a tab bar that has misunderstood itself.
   */
  readonly hasTabs?: boolean;

  /** Whether the first read is still in flight. */
  readonly isPending: boolean;

  /** Why the read failed, when it did. */
  readonly error?: unknown;

  /** What to say when there is nothing yet. */
  readonly emptyMessage?: string | undefined;

  /** Whether the collection came back empty. */
  readonly isEmpty: boolean;

  /** The collection. */
  readonly children: ReactNode;
};

/**
 * Renders a library page.
 *
 * @param props - See {@link LibraryPageProps}.
 * @returns The page.
 */
export function LibraryPage(props: LibraryPageProps) {
  const {
    title,
    summary,
    noun,
    count,
    parent,
    tools,
    action,
    hasTabs = true,
    isPending,
    error,
    emptyMessage,
    isEmpty,
    children,
  } = props;

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex min-h-17 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-6 py-2.5">
        <div className="flex min-w-0 items-center gap-4">
          {hasTabs ? (
            <LibraryTabs />
          ) : parent === undefined ? (
            <h1 className="text-head font-semibold tracking-tight">{title}</h1>
          ) : (
            <h1 className="flex min-w-0 items-center gap-2 text-head tracking-tight">
              <Link
                to={parent.to}
                className="shrink-0 text-foreground-muted transition-colors hover:text-foreground"
              >
                {parent.label}
              </Link>
              <span aria-hidden="true" className="font-light text-foreground-subtle">
                /
              </span>
              <span className="truncate font-semibold">{title}</span>
            </h1>
          )}

          {count === undefined ? null : (
            <span className="text-caption whitespace-nowrap text-foreground-subtle tabular">
              {count} {noun}
              {count === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {tools === undefined && action === undefined ? null : (
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            {tools}
            {action}
          </div>
        )}
      </header>

      <div className="min-h-0 grow overflow-y-auto p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          {summary === undefined ? null : (
            <p className="text-caption text-foreground-subtle">{summary}</p>
          )}

          {isPending ? <Notice>Reading…</Notice> : null}

          {error === undefined || error === null ? null : (
            <Notice tone="danger">{toMessage(error)}</Notice>
          )}

          {!isPending && error === null && isEmpty ? <Notice>{emptyMessage}</Notice> : null}

          {isPending || isEmpty ? null : children}
        </div>
      </div>
    </div>
  );
}

/** What a notice needs. */
type NoticeProps = {
  /** Whether this is a failure or merely a fact. */
  readonly tone?: 'neutral' | 'danger';

  /** What to say. */
  readonly children: ReactNode;
};

/**
 * The one-line panel a page shows instead of a collection.
 *
 * A panel rather than bare text, so an empty page has the same shape as a full one and the
 * layout does not jump when the first row arrives.
 *
 * @param props - See {@link NoticeProps}.
 * @returns The notice.
 */
function Notice(props: NoticeProps) {
  const { tone = 'neutral', children } = props;

  return (
    <Panel title={tone === 'danger' ? 'Could not read' : 'Status'}>
      <p
        className={`px-4 py-3.5 text-ui ${tone === 'danger' ? 'text-danger' : 'text-foreground-muted'}`}
      >
        {children}
      </p>
    </Panel>
  );
}
