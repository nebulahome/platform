/**
 * The signed-in frame: the rail, and whatever page is open beside it.
 *
 * The pages themselves are not built yet. Rather than dress that up with sample cards, each
 * route renders a placeholder that says plainly what belongs there and what has to exist first -
 * a screenshot of something that does not work is a worse lie than an empty room.
 */
import { Outlet, useLocation } from 'react-router';

import { Sidebar } from '@/components/sidebar';
import { useLiveChannel } from '@/live/use-live-channel';

/** What a not-yet-built page says about itself. */
type Placeholder = {
  /** The page's name. */
  readonly title: string;

  /** What it will show. */
  readonly summary: string;

  /** What has to exist before it can. */
  readonly blockedOn: string;
};

/** One entry per route the rail can reach. */
const PLACEHOLDERS: Readonly<Record<string, Placeholder>> = {
  '/automations': {
    title: 'Automations',
    summary: 'The rules, and the block editor that builds them.',
    blockedOn: 'The automation engine in core, which does not run yet.',
  },
  '/scenes': {
    title: 'Scenes',
    summary: 'Saved sets of entity states, each mostly a button.',
    blockedOn: 'The scene engine in core.',
  },
  '/devices': {
    title: 'Devices',
    summary: 'The registry, as the table it is.',
    blockedOn: 'Nothing. The API already serves this.',
  },
  '/aliases': {
    title: 'Aliases',
    summary: 'Derived entities and stored helpers.',
    blockedOn: 'Nothing. The API and alias engine serve this.',
  },
  '/packages': {
    title: 'Packages',
    summary: 'What the platform is supervising, and how it is faring.',
    blockedOn: 'The packet-manager service.',
  },
  '/settings': {
    title: 'Settings',
    summary: 'You, this browser, and — with the permission — the server.',
    blockedOn: 'Nothing. The API serves the reads.',
  },
};

/**
 * Renders a page that has not been built.
 *
 * @returns The placeholder.
 */
export function PagePlaceholder() {
  const { pathname } = useLocation();
  const page = PLACEHOLDERS[pathname];

  return (
    <div className="flex grow flex-col">
      <header className="shrink-0 px-8 pt-7">
        <h1 className="text-display font-medium">{page?.title ?? 'Nebula Home'}</h1>
      </header>

      <div className="flex grow items-center justify-center p-6">
        <div className="flex max-w-md flex-col gap-3 rounded-panel border border-dashed border-border-strong p-8 text-center">
          <p className="text-title text-foreground-muted">{page?.summary ?? 'Nothing here yet.'}</p>
          <p className="text-caption text-foreground-subtle">
            Not built yet — {page?.blockedOn ?? 'no page is registered for this address.'}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the signed-in frame.
 *
 * `relative overflow-hidden` is the general form of a bug the settings section found: an
 * absolutely positioned descendant with no positioned ancestor is laid out against the document
 * and clipped by nothing, so one stray hidden label anywhere inside can give the window a
 * scrollbar the page does not want. The frame is exactly one viewport tall by design, and this
 * says so in a way that holds for whatever gets built inside it.
 *
 * The live channel is opened here, once, for every page inside: it is one socket per tab by
 * design, and the shell is the one component that is mounted for exactly as long as somebody is
 * signed in.
 *
 * @returns The shell.
 */
export function Shell() {
  useLiveChannel();

  return (
    <div className="relative flex h-screen overflow-hidden bg-canvas text-foreground">
      <Sidebar />
      <Outlet />
    </div>
  );
}
