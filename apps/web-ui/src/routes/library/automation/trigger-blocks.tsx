/**
 * The When lane: what wakes the automation, one block per trigger. Any one of them wakes it -
 * there is no AND between triggers, since two things seldom happen in the same instant; "this
 * happened while that holds" is what the If lane is for.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AutomationTrigger } from '@nebulahome/contracts';
import { AppIcon, Block, BlockJoin, BlockLaneSection, type UiIconId } from '@nebulahome/ui';

import type { DragLook } from '@/lib/block-drag';
import { carryBlockId } from '@/lib/block-ids';
import { triggerSummary, type BlockNames } from '@/lib/block-summary';
import { useBlockUi } from '@/lib/block-ui';
import { blankTrigger, keepMeta, replaceAt, without } from '@/library/automation-draft';
import { AddBlock, BlockSequence } from '@/routes/library/automation/block-sequence';
import { useBlockTools } from '@/routes/library/automation/block-tools';
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

  /** Called with the triggers as they now stand. */
  readonly onChange: (triggers: readonly AutomationTrigger[]) => void;
};

/**
 * A trigger's glyph.
 *
 * @param trigger - The trigger.
 * @returns Its icon: a time is a clock or a timer, the sun a sunrise or a sunset.
 */
export function triggerGlyph(trigger: AutomationTrigger): UiIconId {
  switch (trigger.type) {
    case 'time': {
      return trigger.at.kind === 'cron' ? 'timer' : 'clock';
    }
    case 'sun': {
      return ['sunrise', 'dawn', 'golden_hour_end', 'blue_hour_start', 'polar_night_end'].includes(
        trigger.event,
      )
        ? 'sunrise'
        : trigger.event === 'solar_noon' || trigger.event === 'elevation_changed'
          ? 'sun'
          : 'sunset';
    }
    case 'entity': {
      return trigger.change.kind === 'numeric' ? 'gauge' : 'activity';
    }
    case 'event': {
      return 'radio';
    }
    case 'manual': {
      return 'mouse-pointer-click';
    }
  }
}

/**
 * How a trigger looks under the pointer while it is dragged.
 *
 * @param trigger - The trigger.
 * @param names - The house.
 * @returns Its look.
 */
function triggerLook(trigger: AutomationTrigger, names: BlockNames): DragLook {
  return {
    lane: 'when',
    glyph: triggerGlyph(trigger),
    kind: labelForKind('trigger', trigger.type),
    summary: trigger.name ?? triggerSummary(trigger, names),
  };
}

/**
 * Whether a trigger still needs something before it can fire: it opens so it gets it.
 *
 * @param trigger - The trigger.
 * @returns True when an entity is missing.
 */
function isIncomplete(trigger: AutomationTrigger): boolean {
  return trigger.type === 'entity' && trigger.entityId === '';
}

/**
 * Renders the When lane.
 *
 * @param props - See {@link TriggerLaneProps}.
 * @returns The lane.
 */
export function TriggerLane(props: TriggerLaneProps) {
  const { t } = useTranslation();

  const { triggers, onChange } = props;
  const house = useEditorHouse();

  return (
    <BlockLaneSection
      lane="when"
      glyph={<AppIcon id="zap" size={20} />}
      title={t('automation.triggerBlocks.when', 'When')}
      note={t('automation.triggerBlocks.whatWakesItAny', 'What wakes it. Any one of these does.')}
    >
      <BlockSequence
        items={triggers}
        path="triggers"
        family="trigger"
        join={<BlockJoin>{t('automation.triggerBlocks.or', 'OR')}</BlockJoin>}
        lookOf={(trigger) => triggerLook(trigger, house.names)}
        renderItem={({ item, index, id, grip }) => (
          <TriggerBlock
            trigger={item}
            id={id}
            grip={grip}
            onChange={(next) => {
              onChange(replaceAt(triggers, index, carryBlockId(item, next)));
            }}
            onRemove={() => {
              onChange(without(triggers, index));
            }}
          />
        )}
        footer={
          <AddBlock
            label={t('automation.triggerBlocks.addATrigger', 'Add a trigger')}
            pickerTitle={t('automation.triggerBlocks.addATrigger', 'Add a trigger')}
            pickerDescription={t(
              'automation.triggerBlocks.whatWakesTheAutomation',
              'What wakes the automation.',
            )}
            groups={TRIGGER_CHOICE_GROUPS}
            onPick={(type) => {
              onChange([...triggers, blankTrigger(type)]);
            }}
          />
        }
      />
    </BlockLaneSection>
  );
}

/** What one trigger block needs. */
type TriggerBlockProps = {
  readonly trigger: AutomationTrigger;
  readonly id: string;
  readonly grip: ReactNode;
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
  const { t } = useTranslation();

  const { trigger, id, grip, onChange, onRemove } = props;
  const house = useEditorHouse();
  const ui = useBlockUi(id, isIncomplete(trigger));
  const kind = labelForKind('trigger', trigger.type);
  const tools = useBlockTools({
    id,
    family: 'trigger',
    block: trigger,
    onChange,
    untestable:
      trigger.type === 'manual'
        ? t(
            'automation.triggerBlocks.manualTriggerHasNothing',
            'A manual trigger has nothing to test: it fires from Run',
          )
        : trigger.type === 'event'
          ? t('automation.triggerBlocks.deviceEventsAreNot', 'Device events are not available yet')
          : undefined,
  });
  const isGone =
    trigger.type === 'entity' &&
    trigger.entityId !== '' &&
    !house.isPending &&
    house.entities.length > 0 &&
    house.entityOf(trigger.entityId) === undefined;
  const said = isGone ? `${trigger.entityId} is gone` : triggerSummary(trigger, house.names);

  return (
    <Block
      lane="when"
      glyph={<AppIcon id={triggerGlyph(trigger)} size={15} />}
      kind={kind}
      summary={trigger.name === undefined ? said : <span title={said}>{trigger.name}</span>}
      isWarning={isGone || unavailableReason('trigger', trigger.type) !== undefined}
      isOpen={ui.isOpen}
      onToggle={ui.toggle}
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
      <TriggerFields
        trigger={trigger}
        onChange={(next) => {
          onChange(keepMeta(trigger, next));
        }}
      />
    </Block>
  );
}
