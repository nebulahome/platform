/**
 * The two-line title every dashboard card carries: what it shows, and where it is or what it is.
 *
 * In the design system rather than beside the dashboard's cards because a package's card is drawn
 * beside them, and a heading that reads as the dashboard's is what makes it read as one of them.
 */
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

/** What a heading needs. */
export type CardHeadingProps = {
  /** What the card shows: a person's title for it, or the thing's own name. */
  readonly title: string;

  /** Where it is, or what it is, under the title. */
  readonly subtitle?: string | null | undefined;

  /** What sits opposite: a switch, a badge. */
  readonly tail?: ReactNode;

  /** Whether the title is drawn quieter, for something that cannot be read. */
  readonly isMuted?: boolean;
};

/**
 * Renders the two-line title every card carries.
 *
 * @param props - See {@link CardHeadingProps}.
 * @returns The heading.
 */
export function CardHeading(props: CardHeadingProps) {
  const { title, subtitle, tail, isMuted = false } = props;

  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span
          className={cn(
            'truncate text-title font-medium tracking-tight',
            isMuted ? 'text-foreground-muted' : 'text-foreground',
          )}
        >
          {title}
        </span>
        {subtitle === undefined || subtitle === null || subtitle === '' ? null : (
          <span className="truncate text-caption text-foreground-subtle">{subtitle}</span>
        )}
      </div>
      {tail === undefined ? null : <div className="flex shrink-0 items-center">{tail}</div>}
    </div>
  );
}
