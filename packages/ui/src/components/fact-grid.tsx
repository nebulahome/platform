/**
 * The About and Details panels at the foot of a detail page: what the thing is, as facts - its
 * id, its version, where it came from - three to a row on a wide window, one on a phone.
 *
 * Each fact is a 12px label over its value; an id or a version is mono. Rows are parted by a 1px
 * line. The lines are drawn above every cell and the grid is pulled up by a pixel under a clip,
 * so the first row's lines disappear whatever the number of columns.
 */
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/** One fact. */
export type Fact = {
  /** What it is: "Version". */
  readonly label: string;

  /** Its value: text, or a link. */
  readonly value: ReactNode;

  /** An id, a version, an address: set in mono. */
  readonly isMono?: boolean;
};

/** What the grid needs. */
export type FactGridProps = {
  /** The facts, in reading order. A fact with no value is not drawn. */
  readonly facts: readonly Fact[];

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders the facts in their panel.
 *
 * @param props - See {@link FactGridProps}.
 * @returns The panel.
 */
export function FactGrid(props: FactGridProps) {
  const { facts, className } = props;

  return (
    <div
      className={cn('overflow-hidden rounded-card border border-border bg-surface px-5', className)}
    >
      <dl className="-mt-px grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="flex min-w-0 flex-col gap-1 border-t border-border py-3.5"
          >
            <dt className="text-caption text-foreground-subtle">{fact.label}</dt>
            <dd
              className={cn(
                'min-w-0 break-words text-foreground',
                fact.isMono === true ? 'font-mono text-mono-ui' : 'text-ui',
              )}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
