/**
 * The unit of the automation editor: one trigger, condition, action or control block, in a row
 * that opens (design/components/Block).
 *
 * **Anatomy.** A drag grip; a 30px chip carrying the block's glyph in its lane colour; the kind in
 * small capitals above a one-line summary of what it does now; IS/NOT on a condition; a remove
 * button; a chevron. Open, a block gets a lane-coloured edge, a halo and its fields below.
 *
 * **Lanes** say what a block is, by colour: `when` cyan, `if` violet, `then` primary, and the
 * blocks that hold other blocks `control` lamp. The colour is a CSS variable, `--lane`, so every
 * part of a block reads the one value its lane sets.
 *
 * **Selected** is not open. Open is the chevron: the fields are shown. Selected is the card that
 * was clicked: its edge is drawn in its lane colour, and the area holding the blocks inside it -
 * an if's branches, a group's checks - is tinted the same, so what belongs to it reads at a glance.
 *
 * A click on the card or its title selects the innermost block it landed in, and never one whose
 * field, switch or button it landed on: those are the field's. The chevron opens and closes it, as
 * does a double click on the title. Blocks nest, so the click is not stopped from bubbling; each
 * block checks that it is the nearest one to where the click landed.
 */
import type { MouseEvent, ReactNode } from 'react';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';
import { IconButton } from './icon-button.js';
import { Segmented } from './segmented.js';

/** What a block is, which is the colour it is drawn in. */
export type BlockLane = 'when' | 'if' | 'then' | 'control';

/** The class that sets each lane's colour, as the token it is, for everything inside. */
const LANE_CLASS: Readonly<Record<BlockLane, string>> = {
  when: '[--lane:var(--color-cyan)]',
  if: '[--lane:var(--color-violet)]',
  then: '[--lane:var(--color-primary)]',
  control: '[--lane:var(--color-lamp)]',
};

/**
 * The class that sets a lane's colour for everything inside: `--lane`, which every part of a
 * block reads.
 *
 * @param lane - The lane.
 * @returns The class.
 */
export function laneClass(lane: BlockLane): string {
  return LANE_CLASS[lane];
}

/** What a click inside a block may land on that is not the block's to take. */
const INTERACTIVE =
  'button, a, input, textarea, select, label, [role="radio"], [role="slider"], [role="switch"], [role="dialog"], dialog';

/**
 * Whether a click on a block selects it: it landed in no control, and this block is the nearest
 * one to where it landed.
 *
 * @param event - The click.
 * @returns True when the block should take it.
 */
export function isBlockSelectClick(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target;

  if (!(target instanceof Element)) {
    return false;
  }

  const control = target.closest(INTERACTIVE);

  if (control !== null && event.currentTarget.contains(control)) {
    return false;
  }

  return target.closest('[data-block]') === event.currentTarget;
}

/** What a block needs. */
export type BlockProps = {
  readonly lane: BlockLane;

  /** The glyph in its chip: an `AppIcon`. */
  readonly glyph: ReactNode;

  /** What kind of block it is, in words: "Entity state", "If / else". */
  readonly kind: string;

  /** What it does now, as a sentence a person could read aloud. */
  readonly summary: ReactNode;

  /** Whether its fields are shown. */
  readonly isOpen: boolean;

  /** Opens or closes it. */
  readonly onToggle: () => void;

  /** Whether it is the selected block. */
  readonly isSelected?: boolean;

  /** Selects it. */
  readonly onSelect?: () => void;

  /** Whether it sits inside another block, on a raised surface. */
  readonly isNested?: boolean;

  /** IS/NOT, for a condition. */
  readonly negation?: {
    readonly isNot: boolean;
    readonly onChange: (isNot: boolean) => void;
  };

  /** Takes it away. Absent for a block that cannot be removed. */
  readonly onRemove?: () => void;

  /** The drag handle, from whatever orders the list. */
  readonly grip?: ReactNode;

  /** Something more in the header, before the remove button. */
  readonly headerExtra?: ReactNode;

  /** Whether something about it needs attention: an entity that is gone, a block not built. */
  readonly isWarning?: boolean;

  /** Its fields, shown open. */
  readonly children?: ReactNode;

  /** The blocks it holds - an if's branches, a loop's body - shown open, tinted when selected. */
  readonly branches?: ReactNode;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders one block.
 *
 * @param props - See {@link BlockProps}.
 * @returns The block.
 */
export function Block(props: BlockProps) {
  const {
    lane,
    glyph,
    kind,
    summary,
    isOpen,
    onToggle,
    isSelected = false,
    onSelect,
    isNested = false,
    negation,
    onRemove,
    grip,
    headerExtra,
    isWarning = false,
    children,
    branches,
    className,
  } = props;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- selecting by a click on the card is a pointer shortcut; the header's own button takes focus and selects from the keyboard
    <div
      data-block=""
      data-selected={isSelected ? '' : undefined}
      onClick={(event) => {
        if (onSelect !== undefined && isBlockSelectClick(event)) {
          onSelect();
        }
      }}
      className={cn(
        laneClass(lane),
        'rounded-inner border transition-[border-color,box-shadow] duration-150',
        isNested ? 'bg-surface-raised' : 'bg-surface',
        isSelected
          ? 'border-[var(--lane)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--lane)_22%,transparent)]'
          : isOpen
            ? 'border-[color-mix(in_srgb,var(--lane)_45%,transparent)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--lane)_8%,transparent)]'
            : 'border-border',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-t-inner py-2.5 pr-2 pl-1.5',
          isOpen ? undefined : 'rounded-b-inner',
          isSelected ? 'bg-[color-mix(in_srgb,var(--lane)_7%,transparent)]' : undefined,
        )}
      >
        {grip}
        <span
          className={cn(
            'flex size-7.5 shrink-0 items-center justify-center rounded-field text-[var(--lane)]',
            isNested ? 'bg-surface-high' : 'bg-surface-raised',
          )}
        >
          {glyph}
        </span>
        <button
          type="button"
          className="flex min-w-0 grow cursor-pointer flex-col items-start gap-px text-left focus-visible:outline-none"
          onClick={onSelect ?? onToggle}
          onDoubleClick={onSelect === undefined ? undefined : onToggle}
          onFocus={onSelect}
        >
          <span className="text-label font-medium tracking-[0.04em] text-[var(--lane)] uppercase">
            {kind}
          </span>
          <span
            className={cn(
              'w-full truncate text-ui',
              isWarning ? 'text-warning' : 'text-foreground',
            )}
          >
            {summary}
          </span>
        </button>
        {negation === undefined ? null : (
          <Segmented
            label="Negate"
            size="compact"
            options={[
              { value: 'is', label: 'IS' },
              { value: 'not', label: 'NOT' },
            ]}
            value={negation.isNot ? 'not' : 'is'}
            onChange={(value) => {
              negation.onChange(value === 'not');
            }}
          />
        )}
        {headerExtra}
        {onRemove === undefined ? null : (
          <IconButton label={`Remove ${kind}`} size="small" variant="danger" onClick={onRemove}>
            <AppIcon id="x" size={14} />
          </IconButton>
        )}
        <IconButton
          label={isOpen ? `Close ${kind}` : `Open ${kind}`}
          size="small"
          aria-expanded={isOpen}
          onClick={onToggle}
        >
          <AppIcon id={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
        </IconButton>
      </div>

      {isOpen && children !== undefined && children !== null ? (
        <div className="flex flex-col gap-3.5 pt-1 pr-4 pb-4 pl-4 sm:pl-14.5">{children}</div>
      ) : null}

      {isOpen && branches !== undefined && branches !== null ? (
        <div
          className={cn(
            'mx-2 mb-2 flex flex-col gap-2 rounded-tile border-l-2 px-3 py-2.5 transition-colors sm:ml-8',
            isSelected
              ? 'border-[var(--lane)] bg-[color-mix(in_srgb,var(--lane)_6%,transparent)]'
              : 'border-border',
          )}
        >
          {branches}
        </div>
      ) : null}
    </div>
  );
}

/** What a group of checks needs. */
export type BlockGroupProps = {
  /** What it says: ALL OF, ANY OF, NONE OF. */
  readonly label: string;

  /** Whether its checks join with AND or OR. */
  readonly op: 'and' | 'or';

  /** Changes how they join. */
  readonly onOpChange: (op: 'and' | 'or') => void;

  /** IS/NOT on the whole group. */
  readonly negation: { readonly isNot: boolean; readonly onChange: (isNot: boolean) => void };

  /** Takes the group away. */
  readonly onRemove?: () => void;

  /** Whether it is the selected block. */
  readonly isSelected?: boolean;

  /** Selects it. */
  readonly onSelect?: () => void;

  /** The drag handle. */
  readonly grip?: ReactNode;

  /** The checks inside, with their joins and the group's Add. */
  readonly children: ReactNode;
};

/**
 * Renders a dashed group of checks: ALL OF, ANY OF, NONE OF. Groups nest inside each other.
 *
 * @param props - See {@link BlockGroupProps}.
 * @returns The group.
 */
export function BlockGroup(props: BlockGroupProps) {
  const {
    label,
    op,
    onOpChange,
    negation,
    onRemove,
    isSelected = false,
    onSelect,
    grip,
    children,
  } = props;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- see Block
    <div
      data-block=""
      data-selected={isSelected ? '' : undefined}
      onClick={(event) => {
        if (onSelect !== undefined && isBlockSelectClick(event)) {
          onSelect();
        }
      }}
      className={cn(
        laneClass('if'),
        'rounded-inner border border-dashed transition-[border-color,background-color,box-shadow] duration-150',
        isSelected
          ? 'border-[var(--lane)] bg-[color-mix(in_srgb,var(--lane)_9%,transparent)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--lane)_18%,transparent)]'
          : 'border-[color-mix(in_srgb,var(--lane)_50%,transparent)] bg-[color-mix(in_srgb,var(--lane)_4%,transparent)]',
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5 py-2 pr-2 pl-1.5">
        {grip}
        <button
          type="button"
          className="grow cursor-pointer text-left text-label font-medium tracking-[0.08em] text-[var(--lane)] uppercase focus-visible:outline-none"
          onClick={onSelect}
        >
          {label}
        </button>
        <Segmented
          label="Join the checks with"
          size="compact"
          options={[
            { value: 'and', label: 'AND' },
            { value: 'or', label: 'OR' },
          ]}
          value={op}
          onChange={onOpChange}
        />
        <Segmented
          label="Negate the group"
          size="compact"
          options={[
            { value: 'is', label: 'IS' },
            { value: 'not', label: 'NOT' },
          ]}
          value={negation.isNot ? 'not' : 'is'}
          onChange={(value) => {
            negation.onChange(value === 'not');
          }}
        />
        {onRemove === undefined ? null : (
          <IconButton label={`Remove ${label}`} size="small" variant="danger" onClick={onRemove}>
            <AppIcon id="x" size={14} />
          </IconButton>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">{children}</div>
    </div>
  );
}

/** What the join between two blocks needs. */
export type BlockJoinProps = {
  /** How the two join. */
  readonly value: 'and' | 'or';

  /** Changes it. Absent where the join is fixed, inside a group. */
  readonly onChange?: (value: 'and' | 'or') => void;
};

/**
 * Renders the AND/OR between two blocks, on the line that runs down the lane.
 *
 * @param props - See {@link BlockJoinProps}.
 * @returns The join.
 */
export function BlockJoin(props: BlockJoinProps) {
  const { value, onChange } = props;

  return (
    <div className="flex h-7.5 items-center gap-2.5 pl-5.5">
      <span aria-hidden="true" className="-ml-px h-7.5 w-0.5 bg-border" />
      {onChange === undefined ? (
        <span className="inline-flex h-5.5 items-center rounded-pill bg-[color-mix(in_srgb,var(--lane)_12%,transparent)] px-2.5 text-label font-medium text-[var(--lane)] uppercase">
          {value}
        </span>
      ) : (
        <Segmented
          label="Join with"
          size="compact"
          options={[
            { value: 'and', label: 'AND' },
            { value: 'or', label: 'OR' },
          ]}
          value={value}
          onChange={onChange}
        />
      )}
    </div>
  );
}

/** What an Add button needs. */
export type BlockAddProps = {
  /** What it says: "Add a trigger", "Add to else". */
  readonly children: ReactNode;

  /** Opens the picker. */
  readonly onClick: () => void;

  /** Whether it stretches across its lane, as at the foot of a branch. */
  readonly isWide?: boolean;
};

/**
 * Renders the dashed Add at the end of a lane or a branch, its plus in the lane colour.
 *
 * @param props - See {@link BlockAddProps}.
 * @returns The button.
 */
export function BlockAdd(props: BlockAddProps) {
  const { children, onClick, isWide = false } = props;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'press flex h-9.5 items-center gap-2 rounded-tile border border-dashed border-border-strong px-3.5 text-ui-sm text-foreground-muted transition-colors',
        'hover:border-foreground-subtle hover:text-foreground focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
        isWide ? 'w-full' : 'self-start',
      )}
    >
      <AppIcon id="plus" size={14} className="text-[var(--lane)]" />
      {children}
    </button>
  );
}

/** What a lane needs. */
export type BlockLaneHeaderProps = {
  readonly lane: BlockLane;

  /** Its glyph: an `AppIcon`. */
  readonly glyph: ReactNode;

  /** When, If, Then. */
  readonly title: string;

  /** What it is for. */
  readonly note: string;

  /** Its blocks, joins and Add. */
  readonly children: ReactNode;
};

/**
 * Renders one lane of the editor: a 44px tinted chip, its title and a line under it, then its
 * blocks indented beside the chip.
 *
 * @param props - See {@link BlockLaneHeaderProps}.
 * @returns The lane.
 */
export function BlockLaneSection(props: BlockLaneHeaderProps) {
  const { lane, glyph, title, note, children } = props;

  return (
    <section className={cn(laneClass(lane), 'flex flex-col gap-2')} aria-label={title}>
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-inner bg-[color-mix(in_srgb,var(--lane)_14%,transparent)] text-[var(--lane)]">
          {glyph}
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-headline-sm font-medium">{title}</h2>
          <p className="text-ui-sm text-foreground-subtle">{note}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:pl-14.5">{children}</div>
    </section>
  );
}

/**
 * The line that runs from one lane down to the next.
 *
 * @returns The connector.
 */
export function BlockLaneConnector() {
  return <div aria-hidden="true" className="ml-5.25 h-6 w-0.5 bg-border-strong" />;
}

/** What a branch inside a control block needs. */
export type BlockBranchProps = {
  /** What it is: THEN, ELSE, WHEN "Done", OTHERWISE. */
  readonly label: ReactNode;

  /** Something beside the label: a case's value, a branch's remove. */
  readonly aside?: ReactNode;

  /** Its blocks and Add. */
  readonly children: ReactNode;
};

/**
 * Renders one branch of a control block under its label.
 *
 * @param props - See {@link BlockBranchProps}.
 * @returns The branch.
 */
export function BlockBranch(props: BlockBranchProps) {
  const { label, aside, children } = props;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-6 items-center gap-2">
        <span className="font-mono text-label text-foreground-subtle uppercase">{label}</span>
        {aside}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

/** What the grip needs. */
export type BlockGripProps = {
  /** What it moves, for a screen reader. */
  readonly label: string;

  /** Starts a drag. */
  readonly onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;

  /** Moves with the keyboard: up and down. */
  readonly onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
};

/**
 * Renders a block's drag handle. A button, so it can be reached and moved with the keyboard.
 *
 * @param props - See {@link BlockGripProps}.
 * @returns The grip.
 */
export function BlockGrip(props: BlockGripProps) {
  const { label, onPointerDown, onKeyDown } = props;

  return (
    <button
      type="button"
      aria-label={label}
      title="Drag to move, or Alt and an arrow key"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-field text-border-strong transition-colors hover:text-foreground-subtle focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none active:cursor-grabbing"
    >
      <AppIcon id="grip-vertical" size={15} />
    </button>
  );
}
