/**
 * Conditions: the If lane, and the conditions inside an If, a loop or a wait.
 *
 * A list of conditions means all of them. To say "either", or to gather a few, there are two group
 * blocks - AND and OR - that hold a list of their own and nest; any block, a group included, can
 * be turned around with IS/NOT (board N-Blocks-Conditions). No pills join the blocks: a list is
 * AND, a group says what it is in its header.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { isConditionGroup, type ConditionGroup, type ConditionNode } from '@nebulahome/contracts';
import {
  AppIcon,
  Block,
  BlockGroup,
  BlockJoin,
  BlockLaneSection,
  BlockNotice,
  Segmented,
} from '@nebulahome/ui';

import type { DragLook } from '@/lib/block-drag';
import { carryBlockId } from '@/lib/block-ids';
import { conditionSummary, type BlockNames } from '@/lib/block-summary';
import { useBlockUi } from '@/lib/block-ui';
import {
  blankCondition,
  keepMeta,
  replaceAt,
  without,
  withoutKey,
} from '@/library/automation-draft';
import { AddBlock, BlockSequence } from '@/routes/library/automation/block-sequence';
import { useBlockTools } from '@/routes/library/automation/block-tools';
import { useEditorHouse } from '@/routes/library/automation/editor-house';
import { ConditionFields } from '@/routes/library/condition-fields';
import {
  CONDITION_CHOICE_GROUPS,
  glyphForKind,
  isKnownKind,
  labelForKind,
  unavailableReason,
} from '@/routes/library/editor-choices';

/**
 * Whether a condition still needs something: it opens so it gets it.
 *
 * @param condition - The condition.
 * @returns True when an entity or an expression is missing.
 */
function isIncomplete(condition: ConditionNode): boolean {
  switch (condition.type) {
    case 'entity': {
      return condition.entityId === '';
    }
    case 'expression': {
      return condition.expression === '';
    }
    default: {
      return false;
    }
  }
}

/**
 * The header of a group: AND, OR, either turned around.
 *
 * @param group - The group.
 * @returns Its label.
 */
function groupLabel(group: ConditionGroup): string {
  return `${group.isNot === true ? 'NOT ' : ''}${group.type.toUpperCase()}`;
}

/**
 * How a condition looks under the pointer while it is dragged.
 *
 * @param condition - The condition.
 * @param names - The house.
 * @returns Its look.
 */
function conditionLook(condition: ConditionNode, names: BlockNames): DragLook {
  return {
    lane: 'if',
    glyph: glyphForKind('condition', condition.type),
    kind: isConditionGroup(condition)
      ? groupLabel(condition)
      : labelForKind('condition', condition.type),
    summary: condition.name ?? conditionSummary(condition, names),
  };
}

/**
 * The same condition with NOT on or off.
 *
 * @param condition - The condition.
 * @param isNot - Whether NOT should be on.
 * @returns The condition, NOT kept only when on.
 */
function negated(condition: ConditionNode, isNot: boolean): ConditionNode {
  return isNot ? { ...condition, isNot: true } : (withoutKey(condition, 'isNot') as ConditionNode);
}

/** What a list of conditions needs. */
export type ConditionListProps = {
  readonly items: readonly ConditionNode[];

  /** Where the list is: `if`, `then.2.conditions`, `if.1.conditions`. */
  readonly path: string;

  /** Called with the conditions as they now stand. */
  readonly onChange: (items: readonly ConditionNode[]) => void;

  /** What the Add says. */
  readonly addLabel: string;

  /** Whether the list sits inside another block. */
  readonly isNested?: boolean;

  /** How its conditions join: AND unless it is an OR group's. */
  readonly op?: 'and' | 'or';
};

/**
 * Renders a list of conditions, all of which must hold.
 *
 * @param props - See {@link ConditionListProps}.
 * @returns The list.
 */
export function ConditionList(props: ConditionListProps) {
  const { t } = useTranslation();

  const { items, path, onChange, addLabel, isNested = false, op = 'and' } = props;
  const house = useEditorHouse();

  return (
    <BlockSequence
      items={items}
      path={path}
      family="condition"
      join={
        path === 'if' ? (
          // The lane's own list is AND; choosing OR puts its conditions in one OR group.
          <BlockJoin>
            <Segmented
              label={t('automation.conditionBlocks.joinWith', 'Join the conditions with')}
              size="compact"
              options={[
                { value: 'and', label: t('automation.conditionBlocks.and', 'AND') },
                { value: 'or', label: t('automation.conditionBlocks.or', 'OR') },
              ]}
              value="and"
              onChange={(next) => {
                if (next === 'or') {
                  onChange([{ type: 'or', conditions: [...items] }]);
                }
              }}
            />
          </BlockJoin>
        ) : (
          <BlockJoin isInGroup>
            {op === 'or'
              ? t('automation.conditionBlocks.or', 'OR')
              : t('automation.conditionBlocks.and', 'AND')}
          </BlockJoin>
        )
      }
      lookOf={(condition) => conditionLook(condition, house.names)}
      renderItem={({ item, index, id, path: blockPath, grip }) => {
        /**
         * Puts a changed condition back in its place.
         *
         * @param next - The condition as it now stands.
         */
        const replace = (next: ConditionNode): void => {
          onChange(replaceAt(items, index, carryBlockId(item, next)));
        };
        /** Takes the condition away. */
        const remove = (): void => {
          onChange(without(items, index));
        };

        return isConditionGroup(item) ? (
          <ConditionGroupBlock
            group={item}
            id={id}
            path={blockPath}
            grip={grip}
            onChange={replace}
            onRemove={remove}
          />
        ) : (
          <ConditionBlock
            condition={item}
            id={id}
            grip={grip}
            isNested={isNested}
            onChange={replace}
            onRemove={remove}
          />
        );
      }}
      footer={
        <AddBlock
          label={addLabel}
          isWide={isNested}
          pickerTitle={t('automation.conditionBlocks.addACondition', 'Add a condition')}
          pickerDescription={t(
            'automation.conditionBlocks.conditionOrAnAnd',
            'A condition, or an AND or OR group of them.',
          )}
          groups={CONDITION_CHOICE_GROUPS}
          onPick={(type) => {
            onChange([...items, blankCondition(type)]);
          }}
        />
      }
    />
  );
}

/** What one condition block needs. */
type ConditionBlockProps = {
  readonly condition: ConditionNode;
  readonly id: string;
  readonly grip: ReactNode;
  readonly isNested: boolean;
  readonly onChange: (condition: ConditionNode) => void;
  readonly onRemove: () => void;
};

/**
 * Renders one condition, with IS/NOT.
 *
 * @param props - See {@link ConditionBlockProps}.
 * @returns The block.
 */
function ConditionBlock(props: ConditionBlockProps) {
  const { t } = useTranslation();

  const { condition, id, grip, isNested, onChange, onRemove } = props;
  const house = useEditorHouse();
  const ui = useBlockUi(id, isIncomplete(condition) || !isKnownKind('condition', condition.type));
  const kind = labelForKind('condition', condition.type);
  const gone = unavailableReason('condition', condition.type);
  const tools = useBlockTools({
    id,
    family: 'condition',
    block: condition,
    onChange,
    untestable: gone,
  });
  const said = conditionSummary(condition, house.names);

  return (
    <Block
      lane="if"
      glyph={<AppIcon id={glyphForKind('condition', condition.type)} size={15} />}
      kind={kind}
      summary={condition.name === undefined ? said : <span title={said}>{condition.name}</span>}
      isWarning={gone !== undefined || !isKnownKind('condition', condition.type)}
      isOpen={ui.isOpen}
      onToggle={ui.toggle}
      isSelected={ui.isSelected}
      onSelect={ui.select}
      isNested={isNested}
      grip={grip}
      negation={{
        isNot: condition.isNot === true,
        /**
         * Turns the condition around, or back.
         *
         * @param isNot - Whether NOT is on.
         */
        onChange: (isNot) => {
          onChange(negated(condition, isNot));
        },
      }}
      onRemove={onRemove}
      menu={tools.menu}
      status={tools.status}
      notice={
        gone === undefined ? (
          tools.notice
        ) : (
          <BlockNotice tone="warning">
            {t(
              'automation.conditionBlocks.thisCheckIsNot',
              'This check is not part of automations any more. Remove it to save the automation.',
            )}
          </BlockNotice>
        )
      }
      rename={tools.rename}
      isDisabled={tools.isDisabled}
    >
      <ConditionFields
        condition={condition}
        onChange={(next) => {
          onChange(keepMeta(condition, next));
        }}
      />
    </Block>
  );
}

/** What one group block needs. */
type ConditionGroupBlockProps = {
  readonly group: ConditionGroup;
  readonly id: string;

  /** The group's own path, under which its conditions sit. */
  readonly path: string;
  readonly grip: ReactNode;
  readonly onChange: (condition: ConditionNode) => void;
  readonly onRemove: () => void;
};

/**
 * Renders a group of conditions: AND, OR, either turned around.
 *
 * @param props - See {@link ConditionGroupBlockProps}.
 * @returns The group.
 */
function ConditionGroupBlock(props: ConditionGroupBlockProps) {
  const { t } = useTranslation();

  const { group, id, path, grip, onChange, onRemove } = props;
  const ui = useBlockUi(id, true);
  const tools = useBlockTools({
    id,
    family: 'condition',
    block: group,
    onChange,
  });

  return (
    <BlockGroup
      label={group.name ?? groupLabel(group)}
      op={group.type}
      onOpChange={(op) => {
        onChange({ ...group, type: op });
      }}
      negation={{
        isNot: group.isNot === true,
        /**
         * Turns the group around, or back.
         *
         * @param isNot - Whether NOT is on.
         */
        onChange: (isNot) => {
          onChange(negated(group, isNot));
        },
      }}
      isSelected={ui.isSelected}
      onSelect={ui.select}
      grip={grip}
      onRemove={onRemove}
      menu={tools.menu}
      status={tools.status}
      notice={tools.notice}
      rename={tools.rename}
      isDisabled={tools.isDisabled}
    >
      <ConditionList
        items={group.conditions}
        path={`${path}.conditions`}
        isNested
        op={group.type}
        addLabel={t('automation.conditionBlocks.addToTheGroup', 'Add to the group')}
        onChange={(conditions) => {
          onChange({ ...group, conditions: [...conditions] });
        }}
      />
    </BlockGroup>
  );
}

/** What the If lane needs. */
export type ConditionLaneProps = {
  readonly items: readonly ConditionNode[];
  readonly onChange: (items: readonly ConditionNode[]) => void;
};

/**
 * Renders the If lane.
 *
 * @param props - See {@link ConditionLaneProps}.
 * @returns The lane.
 */
export function ConditionLane(props: ConditionLaneProps) {
  const { t } = useTranslation();

  const { items, onChange } = props;

  return (
    <BlockLaneSection
      lane="if"
      glyph={<AppIcon id="list-filter" size={20} />}
      title={t('automation.conditionBlocks.if', 'If')}
      note={t(
        'automation.conditionBlocks.allOfTheseMust',
        'All of these must hold. Group them with AND or OR; NOT turns one around. Optional.',
      )}
    >
      <ConditionList
        items={items}
        path="if"
        onChange={onChange}
        addLabel={t('automation.conditionBlocks.addACondition', 'Add a condition')}
      />
    </BlockLaneSection>
  );
}

/** What the conditions of a block that holds them need. */
export type ConditionsFieldProps = {
  readonly items: readonly ConditionNode[];

  /** The list's path: the block's, then `conditions`. */
  readonly path: string;

  /** Called with the conditions as they now stand. */
  readonly onChange: (items: readonly ConditionNode[]) => void;

  /** A line under them: what an empty list means here. */
  readonly note?: string | undefined;
};

/**
 * Renders the conditions of an If, a loop or a wait.
 *
 * @param props - See {@link ConditionsFieldProps}.
 * @returns The conditions.
 */
export function ConditionsField(props: ConditionsFieldProps) {
  const { t } = useTranslation();

  const { items, path, onChange, note } = props;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption font-medium text-foreground-muted">
        {t('automation.conditionBlocks.conditions', 'Conditions')}
      </span>
      <ConditionList
        items={items}
        path={path}
        isNested
        addLabel={t('automation.conditionBlocks.addACondition', 'Add a condition')}
        onChange={onChange}
      />
      {note === undefined ? null : (
        <span className="text-caption text-foreground-subtle">{note}</span>
      )}
    </div>
  );
}
