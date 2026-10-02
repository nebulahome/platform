/**
 * A flat entity-state condition tree: cards with AND/OR between them and NOT on each card.
 *
 * Used inside if / while / do-while / wait_for action cards, and mirrors the top-level If section
 * so the same mental model applies wherever a condition is edited.
 */
import { useState } from 'react';

import {
  booleanTreeFromCondition,
  type AutomationCondition,
  type BooleanTree,
} from '@nebulahome/contracts';

import {
  blankCondition,
  conditionWithoutNot,
  flatFromBooleanTree,
  ifTreeFromFlat,
  isConditionNegated,
  replaceAt,
  resizeJoins,
  withConditionNegated,
  without,
  type BooleanJoin,
} from '@/library/automation-draft';
import { AddBlockPlaceholder } from '@/routes/library/add-block-placeholder';
import { BlockCard } from '@/routes/library/block-card';
import { BlockPickerModal } from '@/routes/library/block-picker-modal';
import { BooleanJoinPill } from '@/routes/library/boolean-join-pill';
import { ConditionFields } from '@/routes/library/condition-fields';
import { CONDITION_CHOICE_GROUPS } from '@/routes/library/editor-choices';

/** What the tree editor needs. */
export type ConditionTreeEditorProps = {
  /** The stored tree (or a single leaf). */
  readonly value: BooleanTree;

  /** Called with the tree as it now stands. */
  readonly onChange: (tree: BooleanTree) => void;
};

/**
 * Renders a flat condition tree editor.
 *
 * @param props - See {@link ConditionTreeEditorProps}.
 * @returns The editor.
 */
export function ConditionTreeEditor(props: ConditionTreeEditorProps) {
  const { value, onChange } = props;
  const flat = flatFromBooleanTree(value);
  const [isPickerOpen, setPickerOpen] = useState(false);

  /**
   * Writes the flat list back as a document tree.
   *
   * @param items - Cards.
   * @param joins - Joins between them.
   */
  const commit = (items: readonly AutomationCondition[], joins: readonly BooleanJoin[]): void => {
    const tree = ifTreeFromFlat(items, joins);

    onChange(tree ?? booleanTreeFromCondition(blankCondition('state')));
  };

  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      {flat.items.map((condition, index) => {
        const inner = conditionWithoutNot(condition);

        return (
          <div key={`${condition.type}-${String(index)}`} className="flex flex-col gap-3">
            {index > 0 ? (
              <BooleanJoinPill
                value={flat.joins[index - 1] ?? 'and'}
                onChange={(join) => {
                  commit(flat.items, replaceAt(flat.joins, index - 1, join));
                }}
              />
            ) : null}

            <BlockCard
              kind={inner.type}
              position={index + 1}
              notValue={isConditionNegated(condition)}
              onNotChange={(negated) => {
                commit(
                  replaceAt(flat.items, index, withConditionNegated(condition, negated)),
                  flat.joins,
                );
              }}
              onRemove={() => {
                const items = without(flat.items, index);
                const joins = resizeJoins(
                  without(flat.joins, Math.max(0, index - 1)),
                  items.length,
                  'and',
                );

                if (items.length === 0) {
                  onChange(booleanTreeFromCondition(blankCondition('state')));

                  return;
                }

                commit(items, joins);
              }}
            >
              <ConditionFields
                condition={inner}
                onChange={(next) => {
                  commit(
                    replaceAt(
                      flat.items,
                      index,
                      isConditionNegated(condition) ? { type: 'not', condition: next } : next,
                    ),
                    flat.joins,
                  );
                }}
              />
            </BlockCard>
          </div>
        );
      })}

      <AddBlockPlaceholder
        onClick={() => {
          setPickerOpen(true);
        }}
      />

      {flat.items.length > 1 ? null : (
        <p className="text-caption text-foreground-subtle">
          Add another check to combine with AND or OR.
        </p>
      )}

      <BlockPickerModal
        isOpen={isPickerOpen}
        onClose={() => {
          setPickerOpen(false);
        }}
        title="Add a condition"
        description="Entity state checks only."
        groups={CONDITION_CHOICE_GROUPS}
        onPick={(type) => {
          const items = [...flat.items, blankCondition(type)];
          const joins = resizeJoins(flat.joins, items.length, 'and');

          commit(items, joins);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
