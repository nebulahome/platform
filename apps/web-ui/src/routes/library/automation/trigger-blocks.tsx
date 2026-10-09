/**
 * The When lane: what wakes the automation, one block per trigger, joined by AND or OR.
 *
 * AND binds tighter than OR, as the document says it does: two cards joined by AND are a group
 * that fires when one of them fires while the other holds, and the note says so.
 */
import { useState } from 'react';

import type { AutomationTrigger } from '@nebulahome/contracts';
import { AppIcon, Block, BlockJoin, BlockLaneSection, type UiIconId } from '@nebulahome/ui';

import { useBlockSelection } from '@/lib/block-selection';
import { triggerSummary } from '@/lib/block-summary';
import { moveItem } from '@/lib/use-sortable';
import {
  blankTrigger,
  replaceAt,
  resizeJoins,
  without,
  type BooleanJoin,
} from '@/library/automation-draft';
import { AddBlock, BlockSequence } from '@/routes/library/automation/block-sequence';
import { useEditorHouse } from '@/routes/library/automation/editor-house';
import {
  labelForKind,
  TRIGGER_CHOICE_GROUPS,
  unavailableReason,
} from '@/routes/library/editor-choices';
import { TriggerFields } from '@/routes/library/trigger-fields';

/** What the lane needs. */
export type TriggerLaneProps = {
  readonly triggers: readonly AutomationTrigger[];
  readonly joins: readonly BooleanJoin[];

  /** Called with the triggers and joins as they now stand. */
  readonly onChange: (
    triggers: readonly AutomationTrigger[],
    joins: readonly BooleanJoin[],
  ) => void;

  /** Said under the title instead of the usual line: the triggers are kept as they were. */
  readonly note?: string | undefined;
};

/**
 * A trigger's glyph.
 *
 * @param trigger - The trigger.
 * @returns Its icon: a time is a clock, the sun, or a timer.
 */
export function triggerGlyph(trigger: AutomationTrigger): UiIconId {
  if (trigger.type === 'time') {
    if (trigger.at.kind === 'solar') {
      return trigger.at.event === 'sunrise' ? 'sunrise' : 'sunset';
    }

    return trigger.at.kind === 'cron' ? 'timer' : 'clock';
  }

  return (
    {
      state: 'activity',
      numeric_state: 'gauge',
      event: 'radio',
      manual: 'mouse-pointer-click',
    } as const
  )[trigger.type];
}

/**
 * Whether a trigger still needs something before it can fire: it opens so it gets it.
 *
 * @param trigger - The trigger.
 * @returns True when an entity is missing.
 */
function isIncomplete(trigger: AutomationTrigger): boolean {
  return (trigger.type === 'state' || trigger.type === 'numeric_state') && trigger.entityId === '';
}

/**
 * Renders the When lane.
 *
 * @param props - See {@link TriggerLaneProps}.
 * @returns The lane.
 */
export function TriggerLane(props: TriggerLaneProps) {
  const { triggers, joins, onChange, note } = props;

  return (
    <BlockLaneSection
      lane="when"
      glyph={<AppIcon id="zap" size={20} />}
      title="When"
      note={
        note ??
        'What wakes it. Cards combine with AND or OR; an AND fires when one card fires while the others hold.'
      }
    >
      <BlockSequence
        items={triggers}
        itemLabel={(trigger) => labelForKind(trigger.type)}
        onMove={(from, to) => {
          onChange(moveItem(triggers, from, to), joins);
        }}
        renderJoin={(index) => (
          <BlockJoin
            value={joins[index - 1] ?? 'or'}
            onChange={(join) => {
              onChange(triggers, replaceAt(joins, index - 1, join));
            }}
          />
        )}
        renderItem={({ item, index, blockKey, grip }) => (
          <TriggerBlock
            trigger={item}
            blockKey={blockKey}
            grip={grip}
            onChange={(next) => {
              onChange(replaceAt(triggers, index, next), joins);
            }}
            onRemove={() => {
              const rest = without(triggers, index);

              onChange(
                rest,
                resizeJoins(without(joins, Math.max(0, index - 1)), rest.length, 'or'),
              );
            }}
          />
        )}
      />
      <AddBlock
        label="Add a trigger"
        pickerTitle="Add a trigger"
        pickerDescription="What wakes the automation."
        groups={TRIGGER_CHOICE_GROUPS}
        onPick={(type) => {
          const next = [...triggers, blankTrigger(type)];

          onChange(next, resizeJoins(joins, next.length, 'or'));
        }}
      />
    </BlockLaneSection>
  );
}

/** What one trigger block needs. */
type TriggerBlockProps = {
  readonly trigger: AutomationTrigger;
  readonly blockKey: string;
  readonly grip: React.ReactNode;
  readonly onChange: (trigger: AutomationTrigger) => void;
  readonly onRemove: () => void;
};

/**
 * Renders one trigger.
 *
 * @param props - See {@link TriggerBlockProps}.
 * @returns The block.
 */
function TriggerBlock(props: TriggerBlockProps) {
  const { trigger, blockKey, grip, onChange, onRemove } = props;
  const house = useEditorHouse();
  const selection = useBlockSelection(blockKey);
  const [isOpen, setOpen] = useState(() => isIncomplete(trigger));
  const isGone =
    (trigger.type === 'state' || trigger.type === 'numeric_state') &&
    trigger.entityId !== '' &&
    !house.isPending &&
    house.entities.length > 0 &&
    house.entityOf(trigger.entityId) === undefined;

  return (
    <Block
      lane="when"
      glyph={<AppIcon id={triggerGlyph(trigger)} size={15} />}
      kind={labelForKind(trigger.type)}
      summary={isGone ? `${trigger.entityId} is gone` : triggerSummary(trigger, house.names)}
      isWarning={isGone || unavailableReason(trigger.type) !== undefined}
      isOpen={isOpen}
      onToggle={() => {
        setOpen((open) => !open);
      }}
      isSelected={selection.isSelected}
      onSelect={selection.select}
      grip={grip}
      onRemove={onRemove}
    >
      <TriggerFields trigger={trigger} onChange={onChange} />
    </Block>
  );
}
