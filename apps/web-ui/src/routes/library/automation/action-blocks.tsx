/**
 * The Then lane and every branch inside it: actions in order, and the control blocks that hold
 * other actions (boards N-Blocks-Actions and N-Blocks-Control).
 *
 * Each branch of a control block is a lane of its own under a label - THEN, ELSE, WHEN "Done",
 * OTHERWISE, EACH TIME, BRANCH 1 - with its own Add. Closed, a block says what it holds. Selected,
 * the area holding its branches is tinted in its colour, so what belongs to it reads at a glance.
 */
import { useMemo, useState, type ReactNode } from 'react';

import type { AutomationAction } from '@nebulahome/contracts';
import {
  AppIcon,
  Block,
  BlockAdd,
  BlockBranch,
  BlockLaneSection,
  Button,
  IconButton,
  TextField,
} from '@nebulahome/ui';

import { useBlockSelection } from '@/lib/block-selection';
import { actionSummary } from '@/lib/block-summary';
import { moveItem } from '@/lib/use-sortable';
import { blankAction, partialEntityId, replaceAt, without } from '@/library/automation-draft';
import { ActionFields } from '@/routes/library/action-fields';
import { AddBlock, BlockSequence } from '@/routes/library/automation/block-sequence';
import { ConditionTreeField } from '@/routes/library/automation/condition-blocks';
import { DurationField } from '@/routes/library/automation/duration-field';
import { useEditorHouse } from '@/routes/library/automation/editor-house';
import {
  ACTION_CHOICE_GROUPS,
  CONTROL_KINDS,
  glyphForKind,
  labelForKind,
  unavailableReason,
} from '@/routes/library/editor-choices';
import { EntityField } from '@/routes/library/entity-field';
import { StateField, TriggerFields } from '@/routes/library/trigger-fields';

/** The longest a wait may be: the format's week. */
const WEEK_MS = 604_800_000;

/** What a list of actions needs. */
export type ActionListProps = {
  readonly actions: readonly AutomationAction[];
  readonly onChange: (actions: readonly AutomationAction[]) => void;

  /** What its Add says. */
  readonly addLabel?: string;

  /** Whether it is a branch inside another block. */
  readonly isNested?: boolean;
};

/**
 * Renders a list of actions, in order.
 *
 * @param props - See {@link ActionListProps}.
 * @returns The list.
 */
export function ActionList(props: ActionListProps) {
  const { actions, onChange, addLabel = 'Add an action', isNested = false } = props;

  return (
    <>
      <BlockSequence
        items={actions}
        itemLabel={(action) => labelForKind(action.type)}
        onMove={(from, to) => {
          onChange(moveItem(actions, from, to));
        }}
        renderItem={({ item, index, blockKey, grip }) => (
          <ActionBlock
            action={item}
            blockKey={blockKey}
            grip={grip}
            isNested={isNested}
            onChange={(next) => {
              onChange(replaceAt(actions, index, next));
            }}
            onRemove={() => {
              onChange(without(actions, index));
            }}
          />
        )}
      />
      <AddBlock
        label={addLabel}
        isWide={isNested}
        pickerTitle="Add an action"
        pickerDescription="Something to do, or a block that holds other actions."
        groups={ACTION_CHOICE_GROUPS}
        onPick={(type) => {
          onChange([...actions, blankAction(type)]);
        }}
      />
    </>
  );
}

/** What the Then lane needs. */
export type ActionLaneProps = {
  readonly actions: readonly AutomationAction[];
  readonly onChange: (actions: readonly AutomationAction[]) => void;
};

/**
 * Renders the Then lane.
 *
 * @param props - See {@link ActionLaneProps}.
 * @returns The lane.
 */
export function ActionLane(props: ActionLaneProps) {
  const { actions, onChange } = props;

  return (
    <BlockLaneSection
      lane="then"
      glyph={<AppIcon id="play" size={20} />}
      title="Then"
      note="What it does, in order. Control blocks nest."
    >
      <ActionList actions={actions} onChange={onChange} />
    </BlockLaneSection>
  );
}

/**
 * Whether a block opens when it is drawn: one that still needs something before it can run, so
 * it gets it, and one that holds others, so what it holds is in view.
 *
 * @param action - The action.
 * @returns True to open it.
 */
function isIncomplete(action: AutomationAction): boolean {
  switch (action.type) {
    case 'command': {
      return action.entityId === '';
    }
    case 'scene': {
      return action.sceneKey === '';
    }
    case 'automation': {
      return action.automationKey === '';
    }
    case 'package_service': {
      return action.packageId === '';
    }
    default: {
      return CONTROL_KINDS.has(action.type) && action.type !== 'stop';
    }
  }
}

/**
 * The actions of one parallel branch.
 *
 * @param branch - One entry under `parallel.actions`.
 * @returns Its actions: a sequence's, or the one action it is.
 */
function branchActions(branch: AutomationAction): readonly AutomationAction[] {
  return branch.type === 'sequence' ? branch.actions : [branch];
}

/**
 * A branch written back as one entry under `parallel.actions`.
 *
 * @param actions - The branch's actions.
 * @returns The one action, or a sequence of them.
 */
function asBranch(actions: readonly AutomationAction[]): AutomationAction {
  const [only] = actions;

  return actions.length === 1 && only !== undefined && only.type !== 'sequence'
    ? only
    : { type: 'sequence', actions: [...actions] };
}

/** What one action block needs. */
type ActionBlockProps = {
  readonly action: AutomationAction;
  readonly blockKey: string;
  readonly grip: ReactNode;
  readonly isNested: boolean;
  readonly onChange: (action: AutomationAction) => void;
  readonly onRemove: () => void;
};

/**
 * Renders one action, and the branches of one that holds others.
 *
 * @param props - See {@link ActionBlockProps}.
 * @returns The block.
 */
function ActionBlock(props: ActionBlockProps) {
  const { action, blockKey, grip, isNested, onChange, onRemove } = props;
  const house = useEditorHouse();
  const selection = useBlockSelection(blockKey);
  const [isOpen, setOpen] = useState(() => isIncomplete(action));
  const isGone =
    (action.type === 'command' || action.type === 'switch') &&
    action.entityId !== '' &&
    !house.isPending &&
    house.entities.length > 0 &&
    house.entityOf(action.entityId) === undefined;
  const isForEach = action.type === 'for' && action.over.kind === 'each';

  const content = actionContent(action, onChange);

  return (
    <Block
      lane={CONTROL_KINDS.has(action.type) ? 'control' : 'then'}
      glyph={<AppIcon id={glyphForKind(action.type)} size={15} />}
      kind={labelForKind(action.type)}
      summary={isGone ? `${action.entityId} is gone` : actionSummary(action, house.names)}
      isWarning={isGone || isForEach || unavailableReason(action.type) !== undefined}
      isOpen={isOpen}
      onToggle={() => {
        setOpen((open) => !open);
      }}
      isSelected={selection.isSelected}
      onSelect={selection.select}
      isNested={isNested}
      grip={grip}
      onRemove={onRemove}
      branches={content.branches}
    >
      {content.fields}
    </Block>
  );
}

/** A block's fields, and the branches it holds. */
type ActionContent = {
  readonly fields?: ReactNode;
  readonly branches?: ReactNode;
};

/**
 * What one action shows open: its fields, and for a control block its branches.
 *
 * @param action - The action.
 * @param onChange - Called with it as it now stands.
 * @returns Its fields and branches.
 */
function actionContent(
  action: AutomationAction,
  onChange: (action: AutomationAction) => void,
): ActionContent {
  switch (action.type) {
    case 'if': {
      return {
        fields: (
          <ConditionTreeField
            value={action.condition}
            onChange={(condition) => {
              onChange({ ...action, condition });
            }}
          />
        ),
        branches: (
          <>
            <BlockBranch label="Then">
              <ActionList
                isNested
                actions={action.then}
                onChange={(then) => {
                  onChange({ ...action, then: [...then] });
                }}
              />
            </BlockBranch>
            {action.else === undefined ? (
              <BlockAdd
                onClick={() => {
                  onChange({ ...action, else: [] });
                }}
              >
                Add else
              </BlockAdd>
            ) : (
              <BlockBranch
                label="Else"
                aside={
                  <Button
                    variant="bare"
                    size="compact"
                    onClick={() => {
                      onChange({ ...action, else: undefined });
                    }}
                  >
                    Remove else
                  </Button>
                }
              >
                <ActionList
                  isNested
                  addLabel="Add to else"
                  actions={action.else}
                  onChange={(elseActions) => {
                    onChange({ ...action, else: [...elseActions] });
                  }}
                />
              </BlockBranch>
            )}
          </>
        ),
      };
    }
    case 'switch': {
      return {
        fields: (
          <div className="grid gap-3 sm:grid-cols-2">
            <EntityField
              label="Entity"
              value={action.entityId}
              onChange={(entityId) => {
                onChange({ ...action, entityId: partialEntityId(entityId) });
              }}
            />
          </div>
        ),
        branches: (
          <>
            {action.cases.map((branch, index) => (
              <BlockBranch
                key={`case-${String(index)}`}
                label={`When "${branch.value === '' ? '…' : branch.value}"`}
                aside={
                  action.cases.length <= 1 ? undefined : (
                    <IconButton
                      label="Remove this case"
                      size="small"
                      variant="danger"
                      onClick={() => {
                        onChange({ ...action, cases: without(action.cases, index) });
                      }}
                    >
                      <AppIcon id="x" size={13} />
                    </IconButton>
                  )
                }
              >
                <div className="max-w-xs">
                  <StateField
                    label="When it is"
                    entityId={action.entityId}
                    value={branch.value}
                    onChange={(value) => {
                      onChange({
                        ...action,
                        cases: replaceAt(action.cases, index, { ...branch, value }),
                      });
                    }}
                  />
                </div>
                <ActionList
                  isNested
                  actions={branch.actions}
                  onChange={(actions) => {
                    onChange({
                      ...action,
                      cases: replaceAt(action.cases, index, { ...branch, actions: [...actions] }),
                    });
                  }}
                />
              </BlockBranch>
            ))}
            <BlockAdd
              onClick={() => {
                onChange({ ...action, cases: [...action.cases, { value: '', actions: [] }] });
              }}
            >
              Add a case
            </BlockAdd>
            <BlockBranch label="Otherwise">
              <ActionList
                isNested
                addLabel="Add to otherwise"
                actions={action.default ?? []}
                onChange={(actions) => {
                  onChange({ ...action, default: actions.length === 0 ? undefined : [...actions] });
                }}
              />
            </BlockBranch>
          </>
        ),
      };
    }
    case 'for': {
      return {
        fields:
          action.over.kind === 'each' ? (
            <p className="text-ui-sm text-warning">
              For each is not available yet: a run that reaches this block records it as failed.
              Repeat a number of times instead.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                label="Times"
                size="compact"
                type="number"
                min={1}
                max={10_000}
                className="font-mono"
                value={String(action.over.count)}
                onChange={(event) => {
                  const count = Math.round(Number(event.target.value));

                  onChange({
                    ...action,
                    over: { kind: 'count', count: Number.isFinite(count) && count > 0 ? count : 1 },
                  });
                }}
              />
            </div>
          ),
        branches: (
          <BlockBranch label="Each time">
            <ActionList
              isNested
              actions={action.actions}
              onChange={(actions) => {
                onChange({ ...action, actions: [...actions] });
              }}
            />
          </BlockBranch>
        ),
      };
    }
    case 'while':
    case 'do_while': {
      return {
        fields: (
          <>
            <ConditionTreeField
              value={action.condition}
              onChange={(condition) => {
                onChange({ ...action, condition });
              }}
            />
            <p className="text-caption text-foreground-subtle">
              {action.type === 'while'
                ? 'Checks first, runs while it holds, and checks again each time round.'
                : 'Runs once before it checks, then again while it holds.'}
            </p>
          </>
        ),
        branches: (
          <BlockBranch label={action.type === 'while' ? 'Repeat' : 'Do'}>
            <ActionList
              isNested
              actions={action.actions}
              onChange={(actions) => {
                onChange({ ...action, actions: [...actions] });
              }}
            />
          </BlockBranch>
        ),
      };
    }
    case 'sequence': {
      return {
        branches: (
          <BlockBranch label="In order">
            <ActionList
              isNested
              actions={action.actions}
              onChange={(actions) => {
                onChange({ ...action, actions: [...actions] });
              }}
            />
          </BlockBranch>
        ),
      };
    }
    case 'parallel': {
      return {
        fields: (
          <p className="text-caption text-foreground-subtle">
            The branches run side by side; the run carries on when every branch has finished.
          </p>
        ),
        branches: (
          <>
            {action.actions.map((branch, index) => (
              <ParallelBranch
                key={`branch-${String(index)}`}
                index={index}
                branch={branch}
                canRemove={action.actions.length > 1}
                onChange={(next) => {
                  onChange({ ...action, actions: replaceAt(action.actions, index, next) });
                }}
                onRemove={() => {
                  onChange({ ...action, actions: without(action.actions, index) });
                }}
              />
            ))}
            <BlockAdd
              onClick={() => {
                onChange({ ...action, actions: [...action.actions, blankAction('sequence')] });
              }}
            >
              Add a branch
            </BlockAdd>
          </>
        ),
      };
    }
    case 'stop': {
      return {
        fields: (
          <p className="text-ui-sm text-foreground-subtle">
            Nothing after this block runs. The automation is not turned off.
          </p>
        ),
      };
    }
    case 'wait_for': {
      return {
        fields: (
          <>
            <ConditionTreeField
              value={action.condition}
              onChange={(condition) => {
                onChange({ ...action, condition });
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <DurationField
                label="Give up after"
                maxMs={WEEK_MS}
                hint="Then the run carries on."
                value={action.timeoutMs}
                onChange={(timeoutMs) => {
                  onChange({ ...action, timeoutMs: timeoutMs ?? 0 });
                }}
              />
            </div>
          </>
        ),
      };
    }
    case 'wait_for_trigger': {
      return {
        fields: (
          <>
            <TriggerFields
              trigger={action.trigger}
              onChange={(trigger) => {
                onChange({ ...action, trigger });
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <DurationField
                label="Give up after"
                maxMs={WEEK_MS}
                hint="Then the run carries on."
                value={action.timeoutMs}
                onChange={(timeoutMs) => {
                  onChange({ ...action, timeoutMs: timeoutMs ?? 0 });
                }}
              />
            </div>
          </>
        ),
      };
    }
    default: {
      return { fields: <ActionFields action={action} onChange={onChange} /> };
    }
  }
}

/**
 * One branch of a parallel block.
 *
 * @param props - The branch, its place and its change handlers.
 * @param props.index - Its place.
 * @param props.branch - Its action, or the sequence of them.
 * @param props.canRemove - Whether it may be removed: a parallel keeps one branch at least.
 * @param props.onChange - Called with the branch as it now stands.
 * @param props.onRemove - Takes the branch away.
 * @returns The branch.
 */
function ParallelBranch(props: {
  readonly index: number;
  readonly branch: AutomationAction;
  readonly canRemove: boolean;
  readonly onChange: (branch: AutomationAction) => void;
  readonly onRemove: () => void;
}) {
  const { index, branch, canRemove, onChange, onRemove } = props;
  const actions = useMemo(() => branchActions(branch), [branch]);

  return (
    <BlockBranch
      label={`Branch ${String(index + 1)}`}
      aside={
        canRemove ? (
          <IconButton
            label={`Remove branch ${String(index + 1)}`}
            size="small"
            variant="danger"
            onClick={onRemove}
          >
            <AppIcon id="x" size={13} />
          </IconButton>
        ) : undefined
      }
    >
      <ActionList
        isNested
        actions={actions}
        onChange={(next) => {
          onChange(asBranch(next));
        }}
      />
    </BlockBranch>
  );
}
