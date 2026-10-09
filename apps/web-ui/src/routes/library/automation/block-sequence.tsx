/**
 * A list of blocks that can be reordered, and the Add at its foot.
 *
 * Every list in the editor is one of these - the triggers, the checks, a branch of actions - so a
 * block drags, keeps its open state and its selection, and is added, the same way wherever it is.
 * The keys follow each block (`block-keys.ts`); the joins between blocks stay where they are.
 */
import { useRef, useState, type ReactNode } from 'react';

import { BlockAdd, BlockGrip, cn } from '@nebulahome/ui';

import { useBlockKeys } from '@/lib/block-keys';
import { useSortable } from '@/lib/use-sortable';
import { BlockPickerModal } from '@/routes/library/block-picker-modal';
import type { EditorChoiceGroup } from '@/routes/library/editor-choices';

/** What one block in the list is handed to draw itself. */
export type BlockSlot<TItem> = {
  readonly item: TItem;
  readonly index: number;

  /** Its key, which follows it: what its selection is held by. */
  readonly blockKey: string;

  /** Its drag handle. */
  readonly grip: ReactNode;
};

/** What a list needs. */
export type BlockSequenceProps<TItem> = {
  readonly items: readonly TItem[];

  /** Moves the block at one place to another. */
  readonly onMove: (from: number, to: number) => void;

  /** What a block is called, for its grip. */
  readonly itemLabel: (item: TItem) => string;

  /** Draws one block. */
  readonly renderItem: (slot: BlockSlot<TItem>) => ReactNode;

  /** Draws what goes between a block and the one before it: AND, OR. */
  readonly renderJoin?: (index: number) => ReactNode;
};

/**
 * Renders a reorderable list of blocks.
 *
 * @param props - See {@link BlockSequenceProps}.
 * @returns The list.
 */
export function BlockSequence<TItem>(props: BlockSequenceProps<TItem>) {
  const { items, onMove, itemLabel, renderItem, renderJoin } = props;
  const keys = useBlockKeys(items);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sortable = useSortable(listRef, items.length, onMove);

  return (
    <div ref={listRef} className="flex flex-col gap-2 empty:hidden">
      {items.map((item, index) => {
        const blockKey = keys[index] ?? String(index);
        const side = sortable.dropSide(index);

        return [
          index > 0 && renderJoin !== undefined ? (
            <div key={`${blockKey}-join`}>{renderJoin(index)}</div>
          ) : null,
          <div key={blockKey} {...sortable.itemProps(index)} className="relative">
            {side === null ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-x-1 z-30 h-0.5 rounded-pill bg-[var(--lane)]',
                  side === 'before' ? '-top-1.5' : '-bottom-1.5',
                )}
              />
            )}
            {renderItem({
              item,
              index,
              blockKey,
              grip: <BlockGrip label={`Move ${itemLabel(item)}`} {...sortable.gripProps(index)} />,
            })}
          </div>,
        ];
      })}
    </div>
  );
}

/** What an Add needs. */
export type AddBlockProps = {
  /** What it says: "Add a trigger". */
  readonly label: string;

  /** The picker's heading. */
  readonly pickerTitle: string;

  /** The picker's line. */
  readonly pickerDescription?: string;

  /** What the picker offers. */
  readonly groups: readonly EditorChoiceGroup[];

  /** Called with the kind picked. */
  readonly onPick: (type: string) => void;

  /** Whether it stretches across its branch. */
  readonly isWide?: boolean;
};

/**
 * Renders the dashed Add at the foot of a list, and the picker it opens.
 *
 * @param props - See {@link AddBlockProps}.
 * @returns The button and its picker.
 */
export function AddBlock(props: AddBlockProps) {
  const { label, pickerTitle, pickerDescription, groups, onPick, isWide = false } = props;
  const [isOpen, setOpen] = useState(false);

  return (
    <>
      <BlockAdd
        isWide={isWide}
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </BlockAdd>
      {/* Mounted while open only: a long automation has an Add at the foot of every branch. */}
      {isOpen ? (
        <BlockPickerModal
          isOpen
          title={pickerTitle}
          {...(pickerDescription === undefined ? {} : { description: pickerDescription })}
          groups={groups}
          onClose={() => {
            setOpen(false);
          }}
          onPick={(type) => {
            setOpen(false);
            onPick(type);
          }}
        />
      ) : null}
    </>
  );
}
