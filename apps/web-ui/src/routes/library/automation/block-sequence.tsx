/**
 * A list of blocks, and the Add at its foot.
 *
 * Every list in the editor is one of these - the triggers, the conditions, a branch of actions -
 * so a block is drawn, dragged and added the same way wherever it is. The list says where it is
 * (`path`) and what it holds (`family`), which is how a block dragged anywhere in the editor finds
 * the lists it may land in (`block-drag.tsx`). Blocks are keyed by their id, which follows them
 * from one list to another (`block-ids.ts`).
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { BlockAdd, BlockDropLine, BlockDropZone, BlockGrip } from '@nebulahome/ui';

import { useBlockDrag, type DragLook } from '@/lib/block-drag';
import { blockIdOf } from '@/lib/block-ids';
import type { BlockFamily } from '@/library/block-path';
import { BlockPickerModal } from '@/routes/library/block-picker-modal';
import type { EditorChoiceGroup } from '@/routes/library/editor-choices';

/** What one block in the list is handed to draw itself. */
export type BlockSlotProps<TItem> = {
  readonly item: TItem;
  readonly index: number;

  /** Its id, which follows it wherever it is moved. */
  readonly id: string;

  /** Its path: the list's, and its place in it. */
  readonly path: string;

  /** Its drag handle. */
  readonly grip: ReactNode;
};

/** What a list needs. */
export type BlockSequenceProps<TItem extends object> = {
  readonly items: readonly TItem[];

  /** Where the list is: `then`, `then.2.else`, `if.1.conditions`. */
  readonly path: string;

  /** What it holds. */
  readonly family: BlockFamily;

  /** How a block looks under the pointer and is named on its grip. */
  readonly lookOf: (item: TItem) => DragLook;

  /** Draws one block. */
  readonly renderItem: (slot: BlockSlotProps<TItem>) => ReactNode;

  /**
   * What closes the list: its Add. Inside the list, so a block dragged over it lands at the end -
   * an empty branch is mostly its Add.
   */
  readonly footer?: ReactNode;
};

/**
 * Renders a list of blocks that can be moved, here and into other lists.
 *
 * @param props - See {@link BlockSequenceProps}.
 * @returns The list.
 */
export function BlockSequence<TItem extends object>(props: BlockSequenceProps<TItem>) {
  const { t } = useTranslation();

  const { items, path, family, lookOf, renderItem, footer } = props;
  const { drag, startPointer, onGripKey } = useBlockDrag();
  const drop = drag?.drop?.list === path ? drag.drop : null;
  const isOffering = drag !== null && drag.source.family === family;

  return (
    <div data-block-list={path} data-family={family} className="flex flex-col gap-2">
      {items.map((item, index) => {
        const id = blockIdOf(item);
        const look = lookOf(item);
        const source = { id, slot: { list: path, index }, family, look };
        const isSource = drag?.source.id === id;

        return [
          drop?.index === index ? <BlockDropLine key={`${id}-drop`} /> : null,
          <div
            key={id}
            data-sort-item=""
            data-block-item={id}
            className={isSource ? 'pointer-events-none opacity-40' : undefined}
          >
            {renderItem({
              item,
              index,
              id,
              path: `${path}.${String(index)}`,
              grip: (
                <BlockGrip
                  label={t('automation.blockSequence.moveKind', 'Move {{kind}}', {
                    kind: look.kind,
                  })}
                  blockId={id}
                  onPointerDown={(event) => {
                    startPointer(event, source);
                  }}
                  onKeyDown={(event) => {
                    onGripKey(event, source);
                  }}
                />
              ),
            })}
          </div>,
        ];
      })}
      {drop !== null && drop.index >= items.length && items.length > 0 ? <BlockDropLine /> : null}
      {items.length === 0 && isOffering ? <BlockDropZone isActive={drop !== null} /> : null}
      {footer}
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
