/**
 * One block in the chain, whatever kind it is.
 *
 * A trigger, a condition and an action are three different things with three different sets of
 * fields, and exactly the same frame: what kind it is, optional controls (NOT, collapse), its
 * fields, and the button that takes it away.
 */
import type { ReactNode } from 'react';

import { AppIcon, IconButton, Segmented, cn } from '@nebulahome/ui';

import { labelForKind } from '@/routes/library/editor-choices';

/**
 * The lane a block runs in, which colours its kind: When `cyan`, If `violet`, Then `primary`, and
 * the blocks that hold other blocks `lamp`.
 */
export type BlockLane = 'when' | 'if' | 'then' | 'control';

/** The blocks that hold other blocks: their lane is `control`, whatever list they are in. */
const CONTROL_KINDS: ReadonlySet<string> = new Set([
  'if',
  'switch',
  'for',
  'while',
  'do_while',
  'sequence',
  'parallel',
  'stop',
]);

/** The colour of each lane's kind label. */
const LANE_TEXT: Readonly<Record<BlockLane, string>> = {
  when: 'text-cyan',
  if: 'text-violet',
  then: 'text-primary',
  control: 'text-lamp',
};

/** What one block needs. */
export type BlockCardProps = {
  /** What kind of block this is, as the format names it. */
  readonly kind: string;

  /** The lane it runs in; Then - or control, for a block that holds others - when not said. */
  readonly lane?: BlockLane;

  /** Optional override for the badge text (e.g. "else", "case"). */
  readonly kindLabel?: string;

  /** Where it sits in its list, counting from one. Absent for branch headers like else. */
  readonly position?: number;

  /** Its fields. */
  readonly children?: ReactNode;

  /** Called to take it out of the list. Absent when the card cannot be removed (e.g. else). */
  readonly onRemove?: () => void;

  /** Whether NOT is available on this card. */
  readonly notValue?: boolean;

  /** Called when NOT is flipped. */
  readonly onNotChange?: (negated: boolean) => void;

  /** Whether this card has a collapsible body below it. */
  readonly isCollapsible?: boolean;

  /** Whether the body is currently expanded. */
  readonly isExpanded?: boolean;

  /** Called to toggle the body. */
  readonly onToggleExpanded?: () => void;

  /** Extra controls in the header (Add case, Add else-if, …). */
  readonly headerActions?: ReactNode;
};

/**
 * Renders one block.
 *
 * @param props - See {@link BlockCardProps}.
 * @returns The block.
 */
export function BlockCard(props: BlockCardProps) {
  const {
    kind,
    lane = CONTROL_KINDS.has(kind) ? 'control' : 'then',
    kindLabel,
    position,
    children,
    onRemove,
    notValue,
    onNotChange,
    isCollapsible = false,
    isExpanded = true,
    onToggleExpanded,
    headerActions,
  } = props;

  const label = kindLabel ?? labelForKind(kind);

  return (
    <div className="flex flex-col gap-3 rounded-inner border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          {isCollapsible ? (
            <IconButton
              label={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
              variant="bare"
              size="small"
              onClick={onToggleExpanded}
            >
              <AppIcon
                id="chevron-down"
                size={14}
                strokeWidth={2.1}
                className={cn('transition-transform', isExpanded ? '' : '-rotate-90')}
              />
            </IconButton>
          ) : null}

          {position === undefined ? null : (
            <span className="font-mono text-mono-caption text-foreground-subtle tabular">
              {position}
            </span>
          )}

          <span className={cn('text-label font-medium tracking-wider uppercase', LANE_TEXT[lane])}>
            {label}
          </span>

          {onNotChange === undefined ? null : (
            <Segmented
              label="Negate"
              size="compact"
              options={[
                { value: 'off', label: 'IS' },
                { value: 'on', label: 'NOT' },
              ]}
              value={notValue === true ? 'on' : 'off'}
              onChange={(value) => {
                onNotChange(value === 'on');
              }}
            />
          )}
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          {headerActions}
          {onRemove === undefined ? null : (
            <IconButton
              label={`Remove this ${label}`}
              variant="danger"
              size="small"
              onClick={onRemove}
            >
              <AppIcon id="x" size={14} strokeWidth={2.1} />
            </IconButton>
          )}
        </span>
      </div>

      {children === undefined || children === null ? null : (
        <div className="grid gap-3 sm:grid-cols-2">{children}</div>
      )}
    </div>
  );
}
