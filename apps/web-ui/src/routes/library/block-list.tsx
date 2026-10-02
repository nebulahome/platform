/**
 * A flat section of blocks: Trigger or If.
 *
 * Cards one under another, an AND/OR pill between them, and a dashed Add block at the bottom that
 * opens the picker modal. If also carries a NOT toggle on each card. Nested Then templates are
 * drawn elsewhere — this component stays flat on purpose.
 */
import { useState, type ReactNode } from 'react';

import { Panel } from '@nebulahome/ui';

import type { BooleanJoin } from '@/library/automation-draft';
import { AddBlockPlaceholder } from '@/routes/library/add-block-placeholder';
import { BlockCard } from '@/routes/library/block-card';
import { BlockPickerModal } from '@/routes/library/block-picker-modal';
import { BooleanJoinPill } from '@/routes/library/boolean-join-pill';
import type { EditorChoiceGroup } from '@/routes/library/editor-choices';

/** What one flat group needs. */
export type BlockListProps<TBlock extends { readonly type: string }> = {
  /** When or If. */
  readonly title: string;

  /** A line under it saying what this group is for. */
  readonly note: string;

  /** Heading for the picker. */
  readonly pickerTitle: string;

  /** Line under the picker heading. */
  readonly pickerDescription?: string;

  /** What the picker offers. */
  readonly groups: readonly EditorChoiceGroup[];

  /** What is in the group. */
  readonly items: readonly TBlock[];

  /** Joins between consecutive items. */
  readonly joins: readonly BooleanJoin[];

  /** Called with the kind to add. */
  readonly onAdd: (type: string) => void;

  /** Called with the position to take out. */
  readonly onRemove: (index: number) => void;

  /** Called when a join between two cards changes. */
  readonly onJoinChange: (index: number, join: BooleanJoin) => void;

  /** Draws the fields for one block. */
  readonly renderFields: (block: TBlock, index: number) => ReactNode;

  /** Optional NOT toggle per card (If section). */
  readonly getNot?: (block: TBlock) => boolean;

  /** Optional NOT change handler. */
  readonly onNotChange?: (index: number, negated: boolean) => void;

  /** Optional kind label override (e.g. when the card wraps `not`). */
  readonly kindOf?: (block: TBlock) => string;
};

/**
 * Renders one flat group of blocks.
 *
 * @param props - See {@link BlockListProps}.
 * @returns The group.
 */
export function BlockList<TBlock extends { readonly type: string }>(props: BlockListProps<TBlock>) {
  const {
    title,
    note,
    pickerTitle,
    pickerDescription,
    groups,
    items,
    joins,
    onAdd,
    onRemove,
    onJoinChange,
    renderFields,
    getNot,
    onNotChange,
    kindOf,
  } = props;

  const [isPickerOpen, setPickerOpen] = useState(false);

  return (
    <Panel title={title}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-caption text-foreground-subtle">{note}</p>

        {items.map((block, index) => (
          <div
            key={`${kindOf?.(block) ?? block.type}-${String(index)}`}
            className="flex flex-col gap-3"
          >
            {index > 0 ? (
              <BooleanJoinPill
                value={joins[index - 1] ?? 'or'}
                onChange={(join) => {
                  onJoinChange(index - 1, join);
                }}
              />
            ) : null}

            <BlockCard
              kind={kindOf?.(block) ?? block.type}
              position={index + 1}
              {...(getNot === undefined || onNotChange === undefined
                ? {}
                : {
                    notValue: getNot(block),

                    /**
                     * Negates this block, or stops negating it.
                     *
                     * @param negated - Whether it should now be negated.
                     */
                    onNotChange: (negated: boolean) => {
                      onNotChange(index, negated);
                    },
                  })}
              onRemove={() => {
                onRemove(index);
              }}
            >
              {renderFields(block, index)}
            </BlockCard>
          </div>
        ))}

        <AddBlockPlaceholder
          onClick={() => {
            setPickerOpen(true);
          }}
        />
      </div>

      <BlockPickerModal
        isOpen={isPickerOpen}
        onClose={() => {
          setPickerOpen(false);
        }}
        title={pickerTitle}
        {...(pickerDescription === undefined ? {} : { description: pickerDescription })}
        groups={groups}
        onPick={(type) => {
          onAdd(type);
          setPickerOpen(false);
        }}
      />
    </Panel>
  );
}
