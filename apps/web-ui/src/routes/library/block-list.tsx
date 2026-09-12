/**
 * One of the editor's three groups: When, If, or Then.
 *
 * All three are a titled panel holding a list of blocks and a way to add another, and the only
 * things that differ are what the blocks are and what the menu offers. Written three times, the
 * empty state gets forgotten in one of them — and the empty state is what the editor opens in.
 *
 * Adding is a dropdown rather than a row of buttons: there are five to seven kinds in each group,
 * and seven buttons above a list is a palette competing with the thing it fills.
 */
import { useState, type ReactNode } from 'react';

import { Panel, SelectField } from '@nebula-home/ui';

import { BlockCard } from '@/routes/library/block-card';
import type { EditorChoice } from '@/routes/library/editor-choices';

/** What one group needs. */
export type BlockListProps<TBlock extends { readonly type: string }> = {
  /** When, If or Then. */
  readonly title: string;

  /** A line under it saying what this group is for. */
  readonly note: string;

  /** What the Add control is called. */
  readonly addLabel: string;

  /** What can be added. */
  readonly choices: readonly EditorChoice[];

  /** What is in the group. */
  readonly items: readonly TBlock[];

  /** Called with the kind to add. */
  readonly onAdd: (type: string) => void;

  /** Called with the position to take out. */
  readonly onRemove: (index: number) => void;

  /** Draws the fields for one block. */
  readonly renderFields: (block: TBlock, index: number) => ReactNode;
};

/**
 * Renders one group of blocks.
 *
 * @param props - See {@link BlockListProps}.
 * @returns The group.
 */
export function BlockList<TBlock extends { readonly type: string }>(props: BlockListProps<TBlock>) {
  const { title, note, addLabel, choices, items, onAdd, onRemove, renderFields } = props;

  // Reset to the placeholder after each add, so the menu reads as an action rather than as a
  // setting that remembers the last thing chosen.
  const [chosen, setChosen] = useState('');

  return (
    <Panel title={title}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-caption text-foreground-subtle">{note}</p>

        {items.length === 0 ? (
          <p className="text-ui text-foreground-muted">Nothing here yet.</p>
        ) : (
          items.map((block, index) => (
            <BlockCard
              // The position is the identity: these have no ids, and two blocks of the same kind
              // are genuinely interchangeable until somebody fills them in.
              key={`${block.type}-${String(index)}`}
              kind={block.type}
              position={index + 1}
              onRemove={() => {
                onRemove(index);
              }}
            >
              {renderFields(block, index)}
            </BlockCard>
          ))
        )}

        <div className="max-w-xs">
          <SelectField
            label={addLabel}
            size="compact"
            options={[{ value: '', label: addLabel }, ...choices]}
            value={chosen}
            onChange={(value) => {
              if (value !== '') {
                onAdd(value);
                setChosen('');
              }
            }}
          />
        </div>
      </div>
    </Panel>
  );
}
