/**
 * The signed-in frame: the rail, and whatever page is open beside it.
 *
 * The pages themselves are not built yet. Rather than dress that up with sample cards, each
 * route renders a placeholder that says plainly what belongs there and what has to exist first -
 * a screenshot of something that does not work is a worse lie than an empty room.
 */
import { Outlet, useLocation } from 'react-router';

import { Sidebar } from '@/components/sidebar';

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
  '/dashboards': {
    title: 'Dashboards',
    summary: 'The grid of cards, shaped by what each entity can do.',
    blockedOn: 'Nothing. This is the next screen to build.',
  },
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
    summary: 'Derived entities: a formula over other entities.',
    blockedOn: 'The alias engine in core.',
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
      <header className="flex h-[68px] shrink-0 items-center border-b border-border px-6">
        <h1 className="text-lg font-medium tracking-tight">{page?.title ?? 'Nebula'}</h1>
      </header>

      <div className="flex grow items-center justify-center p-6">
        <div className="flex max-w-md flex-col gap-3 rounded-[14px] border border-dashed border-border-strong p-8 text-center">
          <p className="text-sm text-foreground-muted">{page?.summary ?? 'Nothing here yet.'}</p>
          <p className="text-xs text-foreground-subtle">
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
 * @returns The shell.
 */
export function Shell() {
  return (
    <div className="flex h-screen bg-canvas text-foreground">
      <Sidebar />
      <Outlet />
    </div>
  );
}
