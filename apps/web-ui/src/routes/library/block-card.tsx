/**
 * One block in the chain, whatever kind it is.
 *
 * A trigger, a condition and an action are three different things with three different sets of
 * fields, and exactly the same frame: what kind it is, what number it is in the list, its fields,
 * and the button that takes it away. Written three times the remove button ends up in three
 * places.
 *
 * The kind is a word rather than an icon. There are twenty-two of them across the three lists,
 * which is more than an icon set can distinguish without becoming a puzzle.
 */
import type { ReactNode } from 'react';

import { Badge, IconButton } from '@nebula-home/ui';

/** What one block needs. */
export type BlockCardProps = {
  /** What kind of block this is, as the format names it. */
  readonly kind: string;

  /** Where it sits in its list, counting from one. */
  readonly position: number;

  /** Its fields. */
  readonly children: ReactNode;

  /** Called to take it out of the list. */
  readonly onRemove: () => void;
};

/**
 * Renders one block.
 *
 * @param props - See {@link BlockCardProps}.
 * @returns The block.
 */
export function BlockCard(props: BlockCardProps) {
  const { kind, position, children, onRemove } = props;

  return (
    <div className="flex flex-col gap-3 rounded-panel border border-border face-card p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <span className="text-caption text-foreground-subtle tabular">{position}</span>
          <Badge tone="neutral" size="small">
            {kind.replaceAll('_', ' ')}
          </Badge>
        </span>

        <IconButton
          label={`Remove this ${kind.replaceAll('_', ' ')}`}
          variant="danger"
          size="small"
          onClick={onRemove}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
          </svg>
        </IconButton>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}
