/**
 * One result of an install dialog's search, across the whole dialog: the logo, the name with the
 * official mark, one line of what it is, and a line of what the Community Hub says of it - its
 * stars, its installs, who publishes it, what it needs. On the right, Installed, or the way to
 * its page. The whole row opens the item's page.
 */
import type { ReactNode } from 'react';

import { AppIcon } from '@nebulahome/ui';

import { shortCount } from '@/lib/format-count';

/** What a row needs. */
export type CatalogueRowProps = {
  /** The logo, or a monogram: 48px. */
  readonly logo: ReactNode;

  readonly name: string;

  /** Whether the Hub's team publishes it: a mark beside the name. */
  readonly isOfficial: boolean;

  /** One line of what it is. */
  readonly description: string;

  /** The line under it: stars, installs, author, chips. */
  readonly facts: ReactNode;

  /** Whether it is installed here: said in place of the way to its page. */
  readonly isInstalled: boolean;

  /** Called when the row is pressed: opens its page. */
  readonly onOpen: () => void;
};

/**
 * Renders one result.
 *
 * @param props - See {@link CatalogueRowProps}.
 * @returns The row.
 */
export function CatalogueRow(props: CatalogueRowProps) {
  const { logo, name, isOfficial, description, facts, isInstalled, onOpen } = props;

  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-4 rounded-inner border border-transparent px-4 py-3.5 text-left transition-colors hover:border-border-strong hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {logo}

        <span className="flex min-w-0 grow flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-title font-medium text-foreground">{name}</span>
            {isOfficial ? (
              <span role="img" aria-label="Official" title="Official" className="flex shrink-0">
                <AppIcon id="badge-check" size={15} className="text-primary" />
              </span>
            ) : null}
          </span>
          {description === '' ? null : (
            <span className="truncate text-ui-sm text-foreground-muted">{description}</span>
          )}
          <span className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-caption text-foreground-subtle">
            {facts}
          </span>
        </span>

        {isInstalled ? (
          <span className="flex shrink-0 items-center gap-1.5 text-caption text-success">
            <AppIcon id="check" size={14} />
            Installed
          </span>
        ) : (
          <AppIcon id="chevron-right" size={17} className="shrink-0 text-foreground-subtle" />
        )}
      </button>
    </li>
  );
}

/** What a star count needs. */
export type StarsProps = {
  /** How many people starred it. */
  readonly count: number;
};

/**
 * How many people starred an item, behind a star.
 *
 * @param props - See {@link StarsProps}.
 * @returns The count.
 */
export function Stars(props: StarsProps) {
  const { count } = props;

  return (
    <span className="flex items-center gap-1 tabular" title={`${String(count)} stars`}>
      <AppIcon id="star" size={13} className="text-lamp" />
      <span className="font-mono text-foreground-muted">{shortCount(count)}</span>
      <span className="sr-only">stars</span>
    </span>
  );
}

/** What an install count needs. */
export type InstallsProps = {
  /** How many houses installed it. */
  readonly count: number;
};

/**
 * How many houses installed an item, behind a download.
 *
 * @param props - See {@link InstallsProps}.
 * @returns The count.
 */
export function Installs(props: InstallsProps) {
  const { count } = props;

  return (
    <span className="flex items-center gap-1 tabular" title={`${String(count)} installs`}>
      <AppIcon id="download" size={13} />
      <span className="font-mono">{shortCount(count)}</span>
      <span className="sr-only">installs</span>
    </span>
  );
}
