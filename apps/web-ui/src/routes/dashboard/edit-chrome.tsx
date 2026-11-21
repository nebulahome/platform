/**
 * What the grid draws around and between the cards while a dashboard is edited (`N-Dashboard-Edit`).
 *
 * A card at rest stays at full strength under a dashed outline, with nothing on top of it. Under
 * the pointer, or with the focus inside, the outline turns solid and three handles come: the grip
 * on the middle of the top edge and Remove on the top right corner - both half outside the card, in
 * the gap between cards, so they never cover what it shows - and the resize corner inside, bottom
 * right. The card chosen wears the accent ring and its handles in the accent colour, and the other
 * cards step back to half strength.
 *
 * Every free cell is drawn as a dashed space; under the pointer it takes the accent and offers Add
 * card - and, first, Paste when a card was copied. A space is a real button: it takes the focus,
 * Enter adds a card there, and Ctrl or Cmd and V pastes into it.
 */
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn } from '@nebulahome/ui';

import { kindIcon, kindName } from '@/dashboard/card-options';
import type { GridItem, GridPoint } from '@/dashboard/grid-engine';

/**
 * The cells of a grid no card covers, reading row by row.
 *
 * @param items - The grid's cards.
 * @param columns - How many columns it has.
 * @param rows - How many rows to look at.
 * @returns The free cells.
 */
export function freeCells(
  items: readonly Pick<GridItem, 'x' | 'y' | 'w' | 'h'>[],
  columns: number,
  rows: number,
): GridPoint[] {
  const cells: GridPoint[] = [];

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const isTaken = items.some(
        (item) => x >= item.x && x < item.x + item.w && y >= item.y && y < item.y + item.h,
      );

      if (!isTaken) {
        cells.push({ x, y });
      }
    }
  }

  return cells;
}

/**
 * Renders the outline a card wears while the layout is edited: dashed at rest, solid under the
 * pointer or the focus, and the accent ring when it is the card chosen.
 *
 * @param props - Whether it is chosen.
 * @param props.isSelected - Whether its settings are open.
 * @returns The outline.
 */
export function CardOutline(props: { readonly isSelected: boolean }) {
  const { isSelected } = props;

  return isSelected ? (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -inset-[3px] z-[1] animate-fade-in rounded-[19px] border-2 border-primary shadow-[0_0_0_4px_rgb(124_134_255/0.16)]"
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 z-[1] rounded-card border border-dashed border-border-strong',
        'transition-[border-color] duration-150',
        'group-hover/card:border-solid group-hover/card:border-foreground-disabled/75',
        'group-focus-within/card:border-solid group-focus-within/card:border-foreground-disabled/75',
      )}
    />
  );
}

/** What a card's handles need. */
export type CardHandlesProps = {
  /** What the card is called, for the handles' labels. */
  readonly title: string;

  /** Whether it is the card chosen: the handles stay, in the accent. */
  readonly isSelected: boolean;

  /** Whether it is lifted from the keyboard. */
  readonly isLifted: boolean;

  /** Whether it may be moved and resized here; not in the tablet and phone preview. */
  readonly canMove: boolean;

  /** The grip is pressed. */
  readonly onGripDown: (event: ReactPointerEvent<HTMLElement>) => void;

  /** A key on the grip. */
  readonly onGripKey: (event: KeyboardEvent<HTMLButtonElement>) => void;

  /** The grip lost the focus. */
  readonly onGripBlur: () => void;

  /** The corner is pressed. */
  readonly onCornerDown: (event: ReactPointerEvent<HTMLElement>) => void;

  /** Remove is pressed. */
  readonly onRemove: () => void;
};

/**
 * Renders the grip, Remove and the resize corner a card gets under the pointer, with the focus,
 * or when chosen.
 *
 * @param props - See {@link CardHandlesProps}.
 * @returns The handles.
 */
export function CardHandles(props: CardHandlesProps) {
  const { t } = useTranslation();

  const {
    title,
    isSelected,
    isLifted,
    canMove,
    onGripDown,
    onGripKey,
    onGripBlur,
    onCornerDown,
    onRemove,
  } = props;
  const isShown = isSelected || isLifted;
  const reveal = cn(
    'transition-[opacity,transform] duration-150 ease-out',
    isShown
      ? 'opacity-100'
      : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100',
  );
  const line = isShown
    ? 'border-primary text-primary-hover'
    : 'border-foreground-disabled/75 text-foreground-muted';

  return (
    <>
      {canMove ? (
        <button
          type="button"
          aria-label={t('dashboard.dashboardGrid.moveTitle', 'Move {{title}}', { title })}
          aria-pressed={isLifted}
          aria-describedby="dashboard-grid-help"
          title={t('dashboard.editChrome.dragToMove', 'Drag to move')}
          className={cn(
            'absolute -top-2.5 left-1/2 z-20 flex h-5 w-10 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded-pill border bg-surface-high',
            'focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            line,
            reveal,
            isLifted ? 'cursor-grabbing' : undefined,
          )}
          onPointerDown={onGripDown}
          onKeyDown={onGripKey}
          onBlur={onGripBlur}
        >
          <AppIcon id="grip-horizontal" size={14} />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={t('dashboard.dashboardGrid.removeTitle', 'Remove {{title}}', { title })}
        title={t('dashboard.editChrome.removeCard', 'Remove card')}
        className={cn(
          'absolute -top-[9px] -right-[9px] z-20 flex size-[22px] items-center justify-center rounded-pill border bg-surface-high',
          'hover:border-danger hover:text-danger focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          line,
          reveal,
        )}
        onClick={onRemove}
      >
        <AppIcon id="x" size={12} />
      </button>
      {canMove ? (
        <span
          aria-hidden="true"
          title={t('dashboard.editChrome.dragToResize', 'Drag to resize')}
          className={cn(
            'absolute right-0 bottom-0 z-20 flex size-7 cursor-nwse-resize touch-none items-end justify-end p-1.5',
            reveal,
          )}
          onPointerDown={onCornerDown}
        >
          <span
            className={cn(
              'size-3.5 rounded-br-[6px] border-r-2 border-b-2',
              isShown ? 'border-primary-hover' : 'border-foreground-muted',
            )}
          />
        </span>
      ) : null}
    </>
  );
}

/** What an empty space needs. */
export type EmptySpaceProps = {
  /** Where it is drawn, in pixels on its grid. */
  readonly style: CSSProperties;

  /** The copied card's name, when there is one to paste. */
  readonly clipboardName: string | null;

  /** Add card is chosen. */
  readonly onAdd: () => void;

  /** Paste is chosen. */
  readonly onPaste: () => void;
};

/**
 * Renders a free cell of the grid while it is edited: a dashed space that, under the pointer or
 * with the focus, offers Add card, and Paste first when a card was copied.
 *
 * @param props - See {@link EmptySpaceProps}.
 * @returns The space.
 */
export function EmptySpace(props: EmptySpaceProps) {
  const { t } = useTranslation();

  const { style, clipboardName, onAdd, onPaste } = props;
  const pill =
    'inline-flex h-8 items-center gap-[7px] rounded-pill border pr-3.5 pl-2.5 text-ui-sm font-medium whitespace-nowrap text-foreground transition-colors duration-150';
  const strong = 'border-primary/60 bg-primary/14';

  return (
    <div
      className="group/space absolute top-0 left-0"
      /* eslint-disable-next-line react/forbid-dom-props -- a space sits on its cell, in pixels
      measured from the window (RULES.md 15.3). */
      style={style}
    >
      <button
        type="button"
        aria-label={t('dashboard.editChrome.addCardHere', 'Add a card here')}
        aria-keyshortcuts={clipboardName === null ? undefined : 'Control+V Meta+V'}
        className={cn(
          'absolute inset-0 rounded-card border border-dashed border-border',
          'transition-[border-color,background-color] duration-150 ease-out',
          'group-hover/space:border-primary group-hover/space:bg-primary/6',
          'focus-visible:border-primary focus-visible:bg-primary/6 focus-visible:outline-none',
        )}
        onClick={(event) => {
          // Clicked, the space lets go of the focus before Add card opens: the dialog hands it
          // back when it closes, and the space stayed lit until the next click elsewhere. From
          // the keyboard (no click count) it keeps it, so the person is back where they were.
          if (event.detail > 0) {
            event.currentTarget.blur();
          }

          onAdd();
        }}
        onKeyDown={(event) => {
          if (
            clipboardName !== null &&
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'v'
          ) {
            event.preventDefault();
            onPaste();
          }
        }}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center gap-2 px-3',
          'translate-y-0.5 opacity-0 transition-[opacity,transform] duration-150 ease-out',
          'group-focus-within/space:translate-y-0 group-focus-within/space:opacity-100',
          'group-hover/space:translate-y-0 group-hover/space:opacity-100',
        )}
      >
        {clipboardName === null ? null : (
          <button
            type="button"
            tabIndex={-1}
            className={cn(pill, strong, 'pointer-events-auto min-w-0 hover:bg-primary/22')}
            onClick={onPaste}
          >
            <AppIcon id="clipboard-paste" size={15} />
            <span className="truncate">
              {t('dashboard.editChrome.pasteName', 'Paste {{name}}', { name: clipboardName })}
            </span>
          </button>
        )}
        <span
          aria-hidden="true"
          className={cn(
            pill,
            clipboardName === null ? strong : 'border-border-strong bg-surface-raised',
          )}
        >
          <AppIcon id="plus" size={15} />
          {t('dashboard.editChrome.addCard', 'Add card')}
        </span>
      </div>
    </div>
  );
}

/**
 * Renders the size a corner being dragged will take, beside the pointer.
 *
 * @param props - What and where.
 * @param props.size - The size, "2×2".
 * @param props.at - The pointer, in the window.
 * @returns The label.
 */
export function SizeTag(props: { readonly size: string; readonly at: GridPoint }): ReactNode {
  const { size, at } = props;

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none fixed z-50 rounded-chip border border-primary/60 bg-surface-high px-2 py-0.5 font-mono text-mono-caption text-foreground tabular shadow-float"
      /* eslint-disable-next-line react/forbid-dom-props -- the tag follows the pointer. */
      style={{ left: at.x + 14, top: at.y + 14 }}
    >
      {size}
    </span>
  );
}

/**
 * Renders a card added from the catalogue that still waits for its entity: dashed, with what it
 * will be and where to choose it (`N-Dashboard-Card-Settings-New`). It is left out by Done.
 *
 * @param props - The kind of card.
 * @param props.kind - The kind it will be.
 * @returns The card.
 */
export function PendingCard(props: { readonly kind: string }) {
  const { t } = useTranslation();

  const { kind } = props;

  return (
    <article className="flex h-full min-w-0 flex-col rounded-card border border-dashed border-border-strong bg-surface p-4">
      <div className="flex h-8 shrink-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-subtle">
          <AppIcon id={kindIcon(kind)} size={16} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-ui leading-[18px] font-medium">{kindName(kind)}</span>
          <span className="truncate text-caption leading-4 text-foreground-subtle">
            {t('dashboard.editChrome.noEntityYet', 'No entity yet')}
          </span>
        </span>
      </div>
      <div className="grow" />
      <span className="truncate text-caption text-primary-hover">
        {t('dashboard.editChrome.chooseItInSettings', 'Choose it in the settings')}
      </span>
    </article>
  );
}
