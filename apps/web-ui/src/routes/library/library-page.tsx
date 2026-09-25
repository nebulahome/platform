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
 *
 * The header names the page with its title, not with a strip of tabs to the pages beside it: the
 * rail already lists them, one click away, and a second set of links to the same places read as
 * the page's own sections. What the space holds instead is what the page has - how many, and the
 * one or two facts about them worth knowing before reading the list.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Panel } from '@nebula-home/ui';

import { toMessage } from '@/lib/error-message';

/** What the frame needs. */
export type LibraryPageProps = {
  /** What this page is about. */
  readonly title: string;

  /** What the collection is called when it is counted, e.g. `automation`. */
  readonly noun: string;

  /**
   * What several of them are called, when adding an `s` does not say it.
   *
   * `alias` is the one so far: without this the header read `0 aliass`, which is the kind of
   * word that makes a person doubt the number beside it.
   */
  readonly plural?: string | undefined;

  /** How many there are. Undefined while it is still being read. */
  readonly count?: number | undefined;

  /**
   * How many of them the search and the filters leave, when they leave fewer.
   *
   * The header then reads "3 of 12 devices", on every page the same way, rather than each page
   * writing its own line under the header.
   */
  readonly shownCount?: number | undefined;

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
   * Facts about the collection shown after its count, each set off by a dot: `8 enabled`,
   * `3 floors`. Empty or absent for a page whose count says it all; a fact that is null is left
   * out, so a page can list what it may know without testing each one first.
   */
  readonly summary?: readonly (string | null | undefined)[] | undefined;

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
    noun,
    plural = `${noun}s`,
    count,
    shownCount,
    parent,
    tools,
    action,
    summary = [],
    isPending,
    error,
    emptyMessage,
    isEmpty,
    children,
  } = props;

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex min-h-17 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-6 py-2.5">
        <div className="flex min-w-0 items-baseline gap-4">
          {parent === undefined ? (
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
            <span className="truncate text-caption whitespace-nowrap text-foreground-subtle tabular">
              {shownCount === undefined || shownCount === count ? '' : `${String(shownCount)} of `}
              {count} {count === 1 ? noun : plural}
              {summary
                .filter((fact): fact is string => typeof fact === 'string' && fact !== '')
                .map((fact) => ` · ${fact}`)
                .join('')}
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
          {isPending ? <Placeholder>Reading…</Placeholder> : null}

          {error === undefined || error === null ? null : <Refusal>{toMessage(error)}</Refusal>}

          {!isPending && (error === undefined || error === null) && isEmpty ? (
            <Placeholder>{emptyMessage}</Placeholder>
          ) : null}

          {isPending || isEmpty ? null : children}
        </div>
      </div>
    </div>
  );
}

/** What a one-line message needs. */
type MessageProps = {
  /** What to say. */
  readonly children: ReactNode;
};

/**
 * What a page shows where the rows would be, while there are none: still reading, or nothing
 * to read.
 *
 * Drawn the way every other "nothing here yet" in the interface is - the dashboard that is not
 * built, the tile that adds a scene - as a dashed outline standing in for the rows. It used to
 * be a panel headed STATUS, which is a word for a log line: an empty list is not a status, it is
 * a room with nothing in it, and the outline says so without a heading that has to be read.
 *
 * The outline is the same height whether it says "Reading…" or "No scenes yet", so a page that
 * turns out to be empty does not move when the answer arrives.
 *
 * @param props - See {@link MessageProps}.
 * @returns The placeholder.
 */
function Placeholder(props: MessageProps) {
  const { children } = props;

  return (
    <div
      role="status"
      className="rounded-panel border border-dashed border-border-strong px-6 py-8 text-center"
    >
      <p className="mx-auto max-w-md text-ui text-foreground-muted">{children}</p>
    </div>
  );
}

/**
 * The panel a page shows when the read failed.
 *
 * A failure is a fact with a heading, unlike an empty room: it names what went wrong, and a
 * person reading it should be able to tell at a glance that it is not the page's normal state.
 *
 * @param props - See {@link MessageProps}.
 * @returns The notice.
 */
function Refusal(props: MessageProps) {
  const { children } = props;

  return (
    <Panel title="Could not read">
      <p role="alert" className="px-4 py-3.5 text-ui text-danger">
        {children}
      </p>
    </Panel>
  );
}
