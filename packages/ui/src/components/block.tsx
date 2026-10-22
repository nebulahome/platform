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
 *
 * **The ⋯ menu** holds what is done to a block rather than in it - rename it, try it, turn it off.
 * A block turned off is drawn faded with an Off pill; a block being renamed swaps its summary for a
 * field. What trying it said goes in the header as a short {@link BlockStatus}; anything longer, a
 * failure's message, goes in a {@link BlockNotice} at the top of the open block, never in a row.
 */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';
import { IconButton } from './icon-button.js';
import { Menu, type MenuItem } from './menu.js';
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

/** A block's name being typed: the field that stands in for its summary meanwhile. */
export type BlockRename = {
  /** The name it starts from: the one it has, or empty. */
  readonly value: string;

  /** Keeps what was typed; empty takes the name away. */
  readonly onCommit: (name: string) => void;

  /** Leaves the name as it was. */
  readonly onCancel: () => void;
};

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

  /** What trying it said, as a {@link BlockStatus}: in the header, after the summary. */
  readonly status?: ReactNode;

  /** Something longer it has to say, as a {@link BlockNotice}: at the top of the open block. */
  readonly notice?: ReactNode;

  /** The choices of its ⋯ menu: rename, test, turn off. */
  readonly menu?: readonly MenuItem[];

  /** Whether it is turned off: kept, faded, skipped when the automation runs. */
  readonly isDisabled?: boolean;

  /** Its name being typed, which replaces the summary while it is. */
  readonly rename?: BlockRename | undefined;

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
  const { t } = useTranslation();
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
    status,
    notice,
    menu,
    isDisabled = false,
    rename,
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
      data-disabled={isDisabled ? '' : undefined}
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
            isDisabled ? 'opacity-55 grayscale' : undefined,
          )}
        >
          {glyph}
        </span>
        {rename === undefined ? (
          <button
            type="button"
            className={cn(
              'flex min-w-0 grow cursor-pointer flex-col items-start gap-px text-left focus-visible:outline-none',
              isDisabled ? 'opacity-55' : undefined,
            )}
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
        ) : (
          <div className="flex min-w-0 grow flex-col items-start gap-1">
            <span className="text-label font-medium tracking-[0.04em] text-[var(--lane)] uppercase">
              {kind}
            </span>
            <BlockNameField rename={rename} kind={kind} />
          </div>
        )}
        {isDisabled ? <BlockStatus tone="neutral">{t('ui.block.off', 'Off')}</BlockStatus> : null}
        {status}
        {negation === undefined ? null : (
          <Segmented
            label={t('ui.block.negate', 'Negate')}
            size="compact"
            options={[
              { value: 'is', label: t('ui.block.is', 'IS') },
              { value: 'not', label: t('ui.block.not', 'NOT') },
            ]}
            value={negation.isNot ? 'not' : 'is'}
            onChange={(value) => {
              negation.onChange(value === 'not');
            }}
          />
        )}
        {headerExtra}
        {menu === undefined || menu.length === 0 ? null : <BlockMenu items={menu} kind={kind} />}
        {onRemove === undefined ? null : (
          <IconButton
            label={t('ui.block.remove', 'Remove {{kind}}', { kind })}
            size="small"
            variant="danger"
            onClick={onRemove}
          >
            <AppIcon id="x" size={14} />
          </IconButton>
        )}
        <IconButton
          label={
            isOpen
              ? t('ui.block.close', 'Close {{kind}}', { kind })
              : t('ui.block.open', 'Open {{kind}}', { kind })
          }
          size="small"
          aria-expanded={isOpen}
          onClick={onToggle}
        >
          <AppIcon id={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
        </IconButton>
      </div>

      {isOpen && notice !== undefined && notice !== null ? (
        <div className="px-4 pt-1 sm:pl-14.5">{notice}</div>
      ) : null}

      {isOpen && children !== undefined && children !== null ? (
        <div
          className={cn(
            'flex flex-col gap-3.5 pt-1 pr-4 pb-4 pl-4 sm:pl-14.5',
            isDisabled ? 'opacity-70' : undefined,
          )}
        >
          {children}
        </div>
      ) : null}

      {isOpen && branches !== undefined && branches !== null ? (
        <div
          className={cn(
            'mx-2 mb-2 flex flex-col gap-3 rounded-tile px-2 py-2 transition-colors sm:ml-12.5',
            isSelected ? 'bg-[color-mix(in_srgb,var(--lane)_6%,transparent)]' : undefined,
          )}
        >
          {branches}
        </div>
      ) : null}
    </div>
  );
}

/** What a group of conditions needs. */
export type BlockGroupProps = {
  /** What it says: AND, OR, NOT AND, NOT OR - or the name it was given. */
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

  /** What trying it said, as a {@link BlockStatus}. */
  readonly status?: ReactNode;

  /** Something longer it has to say, as a {@link BlockNotice}, above what it holds. */
  readonly notice?: ReactNode;

  /** The choices of its ⋯ menu. */
  readonly menu?: readonly MenuItem[];

  /** Whether it is turned off. */
  readonly isDisabled?: boolean;

  /** Its name being typed, which replaces its label while it is. */
  readonly rename?: BlockRename | undefined;

  /** The conditions inside, and the group's Add. */
  readonly children: ReactNode;
};

/**
 * Renders a dashed group of conditions: AND, OR, either turned around with NOT. Groups nest.
 *
 * @param props - See {@link BlockGroupProps}.
 * @returns The group.
 */
export function BlockGroup(props: BlockGroupProps) {
  const { t } = useTranslation();
  const {
    label,
    op,
    onOpChange,
    negation,
    onRemove,
    isSelected = false,
    onSelect,
    grip,
    status,
    notice,
    menu,
    isDisabled = false,
    rename,
    children,
  } = props;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- see Block
    <div
      data-block=""
      data-selected={isSelected ? '' : undefined}
      data-disabled={isDisabled ? '' : undefined}
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
        {rename === undefined ? (
          <button
            type="button"
            className={cn(
              'grow cursor-pointer text-left text-label font-medium tracking-[0.08em] text-[var(--lane)] uppercase focus-visible:outline-none',
              isDisabled ? 'opacity-55' : undefined,
            )}
            onClick={onSelect}
          >
            {label}
          </button>
        ) : (
          <div className="min-w-0 grow">
            <BlockNameField rename={rename} kind={label} />
          </div>
        )}
        {isDisabled ? <BlockStatus tone="neutral">{t('ui.block.off', 'Off')}</BlockStatus> : null}
        {status}
        <Segmented
          label={t('ui.block.join', 'Join the conditions with')}
          size="compact"
          options={[
            { value: 'and', label: t('ui.block.and', 'AND') },
            { value: 'or', label: t('ui.block.or', 'OR') },
          ]}
          value={op}
          onChange={onOpChange}
        />
        <Segmented
          label={t('ui.block.negateGroup', 'Negate the group')}
          size="compact"
          options={[
            { value: 'is', label: t('ui.block.is', 'IS') },
            { value: 'not', label: t('ui.block.not', 'NOT') },
          ]}
          value={negation.isNot ? 'not' : 'is'}
          onChange={(value) => {
            negation.onChange(value === 'not');
          }}
        />
        {menu === undefined || menu.length === 0 ? null : <BlockMenu items={menu} kind={label} />}
        {onRemove === undefined ? null : (
          <IconButton
            label={t('ui.block.remove', 'Remove {{kind}}', { kind: label })}
            size="small"
            variant="danger"
            onClick={onRemove}
          >
            <AppIcon id="x" size={14} />
          </IconButton>
        )}
      </div>
      {notice === undefined || notice === null ? null : <div className="px-2.5 pb-2">{notice}</div>}
      <div
        className={cn('flex flex-col gap-1.5 px-2.5 pb-2.5', isDisabled ? 'opacity-70' : undefined)}
      >
        {children}
      </div>
    </div>
  );
}

/** What a block's menu needs. */
type BlockMenuProps = {
  readonly items: readonly MenuItem[];

  /** What the block is, for the button's name. */
  readonly kind: string;
};

/**
 * Renders a block's ⋯: a small button in the header and the list it opens.
 *
 * @param props - See {@link BlockMenuProps}.
 * @returns The menu.
 */
function BlockMenu(props: BlockMenuProps) {
  const { t } = useTranslation();
  const { items, kind } = props;

  return (
    <Menu
      items={items}
      align="end"
      width="wide"
      trigger={({ isOpen, toggle, buttonRef }) => (
        <IconButton
          ref={buttonRef}
          label={t('ui.block.more', 'More for {{kind}}', { kind })}
          size="small"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={toggle}
        >
          <AppIcon id="ellipsis" size={14} />
        </IconButton>
      )}
    />
  );
}

/** What the name field needs. */
type BlockNameFieldProps = {
  readonly rename: BlockRename;

  /** What the block is, for the field's name. */
  readonly kind: string;
};

/**
 * Renders the field a block's name is typed in. Enter keeps it, Escape leaves it, and leaving the
 * field keeps what was typed - as moving on from a field does everywhere else.
 *
 * @param props - See {@link BlockNameFieldProps}.
 * @returns The field.
 */
function BlockNameField(props: BlockNameFieldProps) {
  const { t } = useTranslation();
  const { rename, kind } = props;
  const [value, setValue] = useState(rename.value);
  const inputRef = useRef<HTMLInputElement>(null);
  const isDone = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  /**
   * Ends the typing once, either way.
   *
   * @param keep - Whether to keep what was typed.
   */
  const finish = (keep: boolean): void => {
    if (isDone.current) {
      return;
    }

    isDone.current = true;

    if (keep) {
      rename.onCommit(value.trim());
    } else {
      rename.onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      aria-label={t('ui.block.name', 'Name of the {{kind}}', { kind })}
      placeholder={t('ui.block.namePlaceholder', 'A name of its own')}
      maxLength={80}
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => {
        finish(true);
      }}
      className="h-8 w-full rounded-field border border-[var(--lane)] bg-canvas px-2.5 text-ui text-foreground outline-none focus-visible:ring-3 focus-visible:ring-[color-mix(in_srgb,var(--lane)_25%,transparent)]"
    />
  );
}

/** How a block's status reads. */
export type BlockStatusTone = 'running' | 'success' | 'neutral' | 'warning' | 'danger';

/** The colours of each tone. */
const STATUS_TONES: Readonly<Record<BlockStatusTone, string>> = {
  running: 'bg-[color-mix(in_srgb,var(--lane)_14%,transparent)] text-[var(--lane)]',
  success: 'bg-success/12 text-success',
  neutral: 'bg-surface-high text-foreground-muted',
  warning: 'bg-warning/12 text-warning',
  danger: 'bg-danger/12 text-danger',
};

/** What a status needs. */
export type BlockStatusProps = {
  readonly tone: BlockStatusTone;

  /** What it says, a few words: "Done · 0.4 s", "True now", "Next · Thu 07:14". */
  readonly children: ReactNode;

  /** A longer line on hover. */
  readonly title?: string;
};

/**
 * Renders a short pill in a block's header: what trying it said, or that it is off.
 *
 * @param props - See {@link BlockStatusProps}.
 * @returns The pill.
 */
export function BlockStatus(props: BlockStatusProps) {
  const { tone, children, title } = props;

  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-label font-medium whitespace-nowrap',
        STATUS_TONES[tone],
      )}
    >
      {tone === 'running' ? (
        <span
          aria-hidden="true"
          className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </span>
  );
}

/** What a notice needs. */
export type BlockNoticeProps = {
  /** Danger for a failure, warning for something to fix, neutral for something to know. */
  readonly tone: 'danger' | 'warning' | 'neutral';

  /** What it says. */
  readonly children: ReactNode;

  /** Something to do about it: a Stop, a Dismiss. */
  readonly action?: ReactNode;
};

/**
 * Renders a card of its own at the top of an open block, for what is too long for the header: a
 * failure's message, a block the format no longer has.
 *
 * @param props - See {@link BlockNoticeProps}.
 * @returns The card.
 */
export function BlockNotice(props: BlockNoticeProps) {
  const { tone, children, action } = props;

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-tile border px-3 py-2.5 text-ui-sm',
        tone === 'danger'
          ? 'border-danger/30 bg-danger/8 text-danger'
          : tone === 'warning'
            ? 'border-warning/30 bg-warning/8 text-warning'
            : 'border-border bg-surface-raised text-foreground-muted',
      )}
    >
      <AppIcon
        id={tone === 'neutral' ? 'info' : 'triangle-alert'}
        size={15}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 grow break-words whitespace-pre-wrap">{children}</div>
      {action}
    </div>
  );
}

/**
 * Renders where a dragged block would land: a line in its lane colour between two blocks.
 *
 * @returns The line.
 */
export function BlockDropLine() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none h-0.5 rounded-pill bg-[var(--lane)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--lane)_20%,transparent)]"
    />
  );
}

/** What an empty list offers a dragged block. */
export type BlockDropZoneProps = {
  /** Whether the block would land here if let go now. */
  readonly isActive: boolean;
};

/**
 * Renders the place an empty list offers a dragged block, while a drag is on.
 *
 * @param props - See {@link BlockDropZoneProps}.
 * @returns The zone.
 */
export function BlockDropZone(props: BlockDropZoneProps) {
  const { t } = useTranslation();
  const { isActive } = props;

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none flex h-9.5 items-center justify-center rounded-tile border border-dashed text-ui-sm transition-colors',
        isActive
          ? 'border-[var(--lane)] bg-[color-mix(in_srgb,var(--lane)_8%,transparent)] text-[var(--lane)]'
          : 'border-border-strong text-foreground-subtle',
      )}
    >
      {t('ui.block.dropHere', 'Drop here')}
    </div>
  );
}

/** What the dragged block's shadow needs. */
export type BlockDragGhostProps = {
  readonly lane: BlockLane;
  readonly glyph: ReactNode;
  readonly kind: string;
  readonly summary: ReactNode;

  /** Where the pointer is, in the viewport. */
  readonly x: number;
  readonly y: number;
};

/**
 * Renders the block being dragged under the pointer: its header, lifted.
 *
 * @param props - See {@link BlockDragGhostProps}.
 * @returns The ghost.
 */
export function BlockDragGhost(props: BlockDragGhostProps) {
  const { lane, glyph, kind, summary, x, y } = props;

  return (
    <div
      aria-hidden="true"
      // eslint-disable-next-line react/forbid-dom-props -- where the pointer is, which changes on every move and is no token
      style={{ transform: `translate(${String(x + 12)}px, ${String(y - 18)}px)` }}
      className={cn(
        laneClass(lane),
        'pointer-events-none fixed top-0 left-0 z-50 flex w-72 items-center gap-2.5 rounded-inner border border-[var(--lane)] bg-surface px-3 py-2 opacity-95 shadow-float',
      )}
    >
      <span className="flex size-7.5 shrink-0 items-center justify-center rounded-field bg-surface-raised text-[var(--lane)]">
        {glyph}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-label font-medium tracking-[0.04em] text-[var(--lane)] uppercase">
          {kind}
        </span>
        <span className="truncate text-ui text-foreground">{summary}</span>
      </span>
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
 * The divider between one lane and the next (N-Automation-Edit): a line in the lanes' colours
 * across the column, and the link mark at its middle.
 *
 * @returns The connector.
 */
export function BlockLaneConnector() {
  return (
    <div aria-hidden="true" className="relative flex h-13 items-center justify-center">
      <span className="absolute inset-x-[-6px] top-1/2 h-0.5 -translate-y-1/2 bg-linear-to-r from-cyan to-violet opacity-85" />
      <span className="relative flex size-8 items-center justify-center rounded-full border border-primary/60 bg-surface text-primary shadow-[0_0_0_5px_color-mix(in_srgb,var(--color-primary)_12%,transparent),0_0_22px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]">
        <AppIcon id="link-2" size={15} />
      </span>
    </div>
  );
}

/** What a join between two cards needs. */
export type BlockJoinProps = {
  /** How they join: a pill that says it, or the AND/OR that changes it. */
  readonly children: ReactNode;

  /** Inside a group, where the join is a pill in the line of the cards rather than a step down. */
  readonly isInGroup?: boolean;
};

/**
 * Renders what joins one card to the next in a list: a short line down with the AND/OR beside
 * it, or, inside a group, the group's word as a small pill.
 *
 * @param props - See {@link BlockJoinProps}.
 * @returns The join.
 */
export function BlockJoin(props: BlockJoinProps) {
  const { children, isInGroup = false } = props;

  if (isInGroup) {
    return (
      <span className="ml-2.5 self-start rounded-pill bg-[color-mix(in_srgb,var(--lane)_12%,transparent)] px-2 py-px text-label font-medium text-[var(--lane)]">
        {children}
      </span>
    );
  }

  return (
    <div className="flex h-7.5 items-center gap-2.5 pl-5.5">
      <span aria-hidden="true" className="h-7.5 w-0.5 bg-border-strong" />
      {typeof children === 'string' ? (
        <span className="rounded-pill bg-[color-mix(in_srgb,var(--lane)_12%,transparent)] px-2 py-px text-label font-medium text-[var(--lane)]">
          {children}
        </span>
      ) : (
        children
      )}
    </div>
  );
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
    <div className="flex flex-col gap-2 border-l-2 border-[color-mix(in_srgb,var(--lane)_50%,transparent)] py-1 pl-3.5">
      <div className="flex min-h-6 items-center gap-2">
        <span className="text-label font-medium tracking-[0.08em] text-[var(--lane)] uppercase">
          {label}
        </span>
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

  /** Which block it moves, for the drag to find it and the focus to come back to it. */
  readonly blockId?: string;
};

/**
 * Renders a block's drag handle. A button, so it can be reached and moved with the keyboard.
 *
 * @param props - See {@link BlockGripProps}.
 * @returns The grip.
 */
export function BlockGrip(props: BlockGripProps) {
  const { t } = useTranslation();
  const { label, onPointerDown, onKeyDown, blockId } = props;

  return (
    <button
      type="button"
      aria-label={label}
      data-grip={blockId}
      title={t(
        'ui.block.dragHint',
        'Drag to move it, here or into another block - or the arrow keys',
      )}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-field text-border-strong transition-colors hover:text-foreground-subtle focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none active:cursor-grabbing"
    >
      <AppIcon id="grip-vertical" size={15} />
    </button>
  );
}
