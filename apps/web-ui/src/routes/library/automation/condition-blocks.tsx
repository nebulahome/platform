/**
 * Checks: the If lane, and the checks inside an if/else, a loop or a wait.
 *
 * A list of check blocks joined by AND or OR, where any card can be negated and any card can be a
 * group - ALL OF, ANY OF, NONE OF - holding a list of its own (board N-Blocks-Conditions). Inside a
 * group the join is the group's: an ALL OF joins its checks with AND. Groups nest.
 */
import { useMemo, useState, type ReactNode } from 'react';

import {
  booleanTreeFromCondition,
  type AutomationCondition,
  type BooleanTree,
} from '@nebulahome/contracts';
import { AppIcon, Block, BlockGroup, BlockJoin, BlockLaneSection } from '@nebulahome/ui';

import { useBlockSelection } from '@/lib/block-selection';
import { conditionSummary } from '@/lib/block-summary';
import { moveItem } from '@/lib/use-sortable';
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
import { AddBlock, BlockSequence } from '@/routes/library/automation/block-sequence';
import { useEditorHouse } from '@/routes/library/automation/editor-house';
import { ConditionFields } from '@/routes/library/condition-fields';
import {
  CONDITION_CHOICE_GROUPS,
  glyphForKind,
  labelForKind,
} from '@/routes/library/editor-choices';

/** A group of checks: ALL OF, ANY OF. */
type Group = Extract<AutomationCondition, { type: 'and' | 'or' }>;

/**
 * The group a card is, when it is one: itself, or the group under its NOT.
 *
 * @param condition - The card.
 * @returns The group, or undefined for a single check.
 */
function groupOf(condition: AutomationCondition): Group | undefined {
  const inner = conditionWithoutNot(condition);

  return inner.type === 'and' || inner.type === 'or' ? inner : undefined;
}

/**
 * Whether a check still needs something: it opens so it gets it.
 *
 * @param condition - The check.
 * @returns True when an entity, an area or an expression is missing.
 */
function isIncomplete(condition: AutomationCondition): boolean {
  switch (condition.type) {
    case 'state':
    case 'numeric': {
      return condition.entityId === '';
    }
    case 'area_occupancy': {
      return condition.areaKey === '';
    }
    case 'expression': {
      return condition.expression === '';
    }
    default: {
      return false;
    }
  }
}

/** What a list of checks needs. */
export type ConditionListProps = {
  readonly items: readonly AutomationCondition[];
  readonly joins: readonly BooleanJoin[];

  /** Inside a group: the group's join, shown between its checks and not changed there. */
  readonly fixedJoin?: BooleanJoin;

  /** Called with the checks and joins as they now stand. */
  readonly onChange: (items: readonly AutomationCondition[], joins: readonly BooleanJoin[]) => void;

  /** What the Add says. */
  readonly addLabel: string;

  /** Whether the list sits inside another block. */
  readonly isNested?: boolean;
};

/**
 * Renders a list of checks.
 *
 * @param props - See {@link ConditionListProps}.
 * @returns The list.
 */
export function ConditionList(props: ConditionListProps) {
  const { items, joins, fixedJoin, onChange, addLabel, isNested = false } = props;

  return (
    <>
      <BlockSequence
        items={items}
        itemLabel={(condition) => labelForKind(conditionWithoutNot(condition).type)}
        onMove={(from, to) => {
          onChange(moveItem(items, from, to), joins);
        }}
        renderJoin={(index) =>
          fixedJoin === undefined ? (
            <BlockJoin
              value={joins[index - 1] ?? 'and'}
              onChange={(join) => {
                onChange(items, replaceAt(joins, index - 1, join));
              }}
            />
          ) : (
            <BlockJoin value={fixedJoin} />
          )
        }
        renderItem={({ item, index, blockKey, grip }) => {
          /**
           * Puts a changed check back in its place.
           *
           * @param next - The check as it now stands.
           */
          const replace = (next: AutomationCondition): void => {
            onChange(replaceAt(items, index, next), joins);
          };
          /** Takes the check away, and the join before it. */
          const remove = (): void => {
            const rest = without(items, index);

            onChange(rest, resizeJoins(without(joins, Math.max(0, index - 1)), rest.length, 'and'));
          };

          return groupOf(item) === undefined ? (
            <ConditionBlock
              condition={item}
              blockKey={blockKey}
              grip={grip}
              isNested={isNested}
              onChange={replace}
              onRemove={remove}
            />
          ) : (
            <ConditionGroupBlock
              condition={item}
              blockKey={blockKey}
              grip={grip}
              onChange={replace}
              onRemove={remove}
            />
          );
        }}
      />
      <AddBlock
        label={addLabel}
        isWide={isNested}
        pickerTitle="Add a condition"
        pickerDescription="A check, or a group of them."
        groups={CONDITION_CHOICE_GROUPS}
        onPick={(type) => {
          const next = [...items, blankCondition(type)];

          onChange(next, resizeJoins(joins, next.length, 'and'));
        }}
      />
    </>
  );
}

/** What one check block needs. */
type ConditionBlockProps = {
  readonly condition: AutomationCondition;
  readonly blockKey: string;
  readonly grip: ReactNode;
  readonly isNested: boolean;
  readonly onChange: (condition: AutomationCondition) => void;
  readonly onRemove: () => void;
};

/**
 * Renders one check, with IS/NOT.
 *
 * @param props - See {@link ConditionBlockProps}.
 * @returns The block.
 */
function ConditionBlock(props: ConditionBlockProps) {
  const { condition, blockKey, grip, isNested, onChange, onRemove } = props;
  const house = useEditorHouse();
  const selection = useBlockSelection(blockKey);
  const inner = conditionWithoutNot(condition);
  const isNot = isConditionNegated(condition);
  const [isOpen, setOpen] = useState(() => isIncomplete(inner));

  return (
    <Block
      lane="if"
      glyph={<AppIcon id={glyphForKind(inner.type)} size={15} />}
      kind={labelForKind(inner.type)}
      summary={conditionSummary(condition, house.names)}
      isOpen={isOpen}
      onToggle={() => {
        setOpen((open) => !open);
      }}
      isSelected={selection.isSelected}
      onSelect={selection.select}
      isNested={isNested}
      grip={grip}
      negation={{
        isNot,
        /**
         * Negates the check, or stops negating it.
         *
         * @param negated - Whether NOT is on.
         */
        onChange: (negated) => {
          onChange(withConditionNegated(condition, negated));
        },
      }}
      onRemove={onRemove}
    >
      <ConditionFields
        condition={inner}
        onChange={(next) => {
          onChange(isNot ? { type: 'not', condition: next } : next);
        }}
      />
      {isNot && inner.type === 'day_of_week' ? (
        <p className="text-caption text-foreground-subtle">
          NOT is on: it runs on the days left unmarked.
        </p>
      ) : null}
    </Block>
  );
}

/** What one group block needs. */
type ConditionGroupBlockProps = {
  readonly condition: AutomationCondition;
  readonly blockKey: string;
  readonly grip: ReactNode;
  readonly onChange: (condition: AutomationCondition) => void;
  readonly onRemove: () => void;
};

/**
 * Renders a group of checks: ALL OF, ANY OF, NONE OF.
 *
 * @param props - See {@link ConditionGroupBlockProps}.
 * @returns The group.
 */
function ConditionGroupBlock(props: ConditionGroupBlockProps) {
  const { condition, blockKey, grip, onChange, onRemove } = props;
  const selection = useBlockSelection(blockKey);
  const group = groupOf(condition);
  const isNot = isConditionNegated(condition);

  if (group === undefined) {
    return null;
  }

  /**
   * Writes the group back, keeping its NOT.
   *
   * @param next - The group as it now stands.
   */
  const write = (next: Group): void => {
    onChange(isNot ? { type: 'not', condition: next } : next);
  };

  const label = isNot
    ? group.type === 'or'
      ? 'None of'
      : 'Not all of'
    : group.type === 'and'
      ? 'All of'
      : 'Any of';

  return (
    <BlockGroup
      label={label}
      op={group.type}
      onOpChange={(op) => {
        write({ type: op, conditions: group.conditions });
      }}
      negation={{
        isNot,
        /**
         * Negates the group, or stops negating it.
         *
         * @param negated - Whether NOT is on.
         */
        onChange: (negated) => {
          onChange(negated ? { type: 'not', condition: group } : group);
        },
      }}
      isSelected={selection.isSelected}
      onSelect={selection.select}
      grip={grip}
      onRemove={onRemove}
    >
      <ConditionList
        items={group.conditions}
        joins={[]}
        fixedJoin={group.type}
        isNested
        addLabel="Add to the group"
        onChange={(conditions) => {
          write({ type: group.type, conditions: [...conditions] });
        }}
      />
    </BlockGroup>
  );
}

/** What the If lane needs. */
export type ConditionLaneProps = {
  readonly items: readonly AutomationCondition[];
  readonly joins: readonly BooleanJoin[];
  readonly onChange: (items: readonly AutomationCondition[], joins: readonly BooleanJoin[]) => void;
};

/**
 * Renders the If lane.
 *
 * @param props - See {@link ConditionLaneProps}.
 * @returns The lane.
 */
export function ConditionLane(props: ConditionLaneProps) {
  const { items, joins, onChange } = props;

  return (
    <BlockLaneSection
      lane="if"
      glyph={<AppIcon id="list-filter" size={20} />}
      title="If"
      note="Checks before it acts. NOT on a card negates it. Optional."
    >
      <ConditionList items={items} joins={joins} onChange={onChange} addLabel="Add a condition" />
    </BlockLaneSection>
  );
}

/** What a field of checks needs: the checks of an if/else, a loop or a wait. */
export type ConditionTreeFieldProps = {
  /** The checks, as the document stores them. */
  readonly value: BooleanTree;

  /** Called with the checks as they now stand. */
  readonly onChange: (tree: BooleanTree) => void;
};

/**
 * Renders the checks of a block that holds them.
 *
 * @param props - See {@link ConditionTreeFieldProps}.
 * @returns The checks.
 */
export function ConditionTreeField(props: ConditionTreeFieldProps) {
  const { value, onChange } = props;

  // Kept for as long as the tree is the same tree: a list that is new on every render would give
  // its blocks new keys on every render.
  const flat = useMemo(() => flatFromBooleanTree(value), [value]);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption font-medium text-foreground-muted">Checks</span>
      <ConditionList
        items={flat.items}
        joins={flat.joins}
        isNested
        addLabel="Add a check"
        onChange={(items, joins) => {
          // A block that checks has to check something: emptied, it starts again from a blank.
          onChange(
            ifTreeFromFlat(items, joins) ?? booleanTreeFromCondition(blankCondition('state')),
          );
        }}
      />
    </div>
  );
}
