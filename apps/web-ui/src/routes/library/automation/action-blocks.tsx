/**
 * The Then lane and every branch inside it: blocks in order, and the control blocks that hold
 * other blocks (boards N-Blocks-Actions and N-Blocks-Control).
 *
 * Each branch of a control block is a list of its own under a label - THEN, ELSE, WHEN "Done",
 * OTHERWISE, EACH TIME, BRANCH 1 - with its own Add, and a block can be dragged into it or out of
 * it from anywhere in the lane. Closed, a block says what it holds; held over while dragging, it
 * opens. Selected, the area holding its branches is tinted in its colour, so what belongs to it
 * reads at a glance.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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

import { translate } from '@/i18n/messages';
import type { DragLook } from '@/lib/block-drag';
import { carryBlockId } from '@/lib/block-ids';
import { actionSummary, type BlockNames } from '@/lib/block-summary';
import { useBlockUi } from '@/lib/block-ui';
import {
  blankAction,
  keepMeta,
  partialEntityId,
  replaceAt,
  without,
  withoutKey,
} from '@/library/automation-draft';
import { ActionFields } from '@/routes/library/action-fields';
import { AddBlock, BlockSequence } from '@/routes/library/automation/block-sequence';
import { useBlockTools } from '@/routes/library/automation/block-tools';
import { ConditionsField } from '@/routes/library/automation/condition-blocks';
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

/**
 * How a block looks under the pointer while it is dragged.
 *
 * @param action - The block.
 * @param names - The house.
 * @returns Its look.
 */
function actionLook(action: AutomationAction, names: BlockNames): DragLook {
  return {
    lane: CONTROL_KINDS.has(action.type) ? 'control' : 'then',
    glyph: glyphForKind('action', action.type),
    kind: labelForKind('action', action.type),
    summary: action.name ?? actionSummary(action, names),
  };
}

/** What a list of blocks needs. */
export type ActionListProps = {
  readonly items: readonly AutomationAction[];

  /** Where the list is: `then`, `then.2.else`, `then.3.cases.1`, `then.4.branches.0`. */
  readonly path: string;

  /** Called with the blocks as they now stand. */
  readonly onChange: (items: readonly AutomationAction[]) => void;

  /** What its Add says. */
  readonly addLabel?: string;

  /** Whether it is a branch inside another block. */
  readonly isNested?: boolean;
};

/**
 * Renders a list of blocks, in order.
 *
 * @param props - See {@link ActionListProps}.
 * @returns The list.
 */
export function ActionList(props: ActionListProps) {
  const { t } = useTranslation();

  const {
    items,
    path,
    onChange,
    addLabel = t('automation.actionBlocks.addABlock', 'Add a block'),
    isNested = false,
  } = props;
  const house = useEditorHouse();

  return (
    <BlockSequence
      items={items}
      path={path}
      family="action"
      lookOf={(action) => actionLook(action, house.names)}
      renderItem={({ item, index, id, path: blockPath, grip }) => (
        <ActionBlock
          action={item}
          id={id}
          path={blockPath}
          grip={grip}
          isNested={isNested}
          onChange={(next) => {
            onChange(replaceAt(items, index, carryBlockId(item, next)));
          }}
          onRemove={() => {
            onChange(without(items, index));
          }}
        />
      )}
      footer={
        <AddBlock
          label={addLabel}
          isWide={isNested}
          pickerTitle={t('automation.actionBlocks.addABlock', 'Add a block')}
          pickerDescription={t(
            'automation.actionBlocks.somethingToDoOr',
            'Something to do, or a block that holds other blocks.',
          )}
          groups={ACTION_CHOICE_GROUPS}
          onPick={(type) => {
            onChange([...items, blankAction(type)]);
          }}
        />
      }
    />
  );
}

/** What the Then lane needs. */
export type ActionLaneProps = {
  readonly items: readonly AutomationAction[];
  readonly onChange: (items: readonly AutomationAction[]) => void;
};

/**
 * Renders the Then lane.
 *
 * @param props - See {@link ActionLaneProps}.
 * @returns The lane.
 */
export function ActionLane(props: ActionLaneProps) {
  const { t } = useTranslation();

  const { items, onChange } = props;

  return (
    <BlockLaneSection
      lane="then"
      glyph={<AppIcon id="play" size={20} />}
      title={t('automation.actionBlocks.then', 'Then')}
      note={t(
        'automation.actionBlocks.whatItDoesIn',
        'What it does, in order. Control blocks nest.',
      )}
    >
      <ActionList items={items} path="then" onChange={onChange} />
    </BlockLaneSection>
  );
}

/**
 * Whether a block opens when it is drawn: one that still needs something before it can run, so
 * it gets it, and one that holds others, so what it holds is in view.
 *
 * @param action - The block.
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
 * Whether a block holds other blocks, and so opens when one is held over it.
 *
 * @param action - The block.
 * @returns True for the control blocks with branches or conditions.
 */
function holdsBlocks(action: AutomationAction): boolean {
  return CONTROL_KINDS.has(action.type) && action.type !== 'stop';
}

/** What one block needs. */
type ActionBlockProps = {
  readonly action: AutomationAction;
  readonly id: string;

  /** Its own path, under which its branches sit. */
  readonly path: string;
  readonly grip: ReactNode;
  readonly isNested: boolean;
  readonly onChange: (action: AutomationAction) => void;
  readonly onRemove: () => void;
};

/**
 * Renders one block, and the branches of one that holds others.
 *
 * @param props - See {@link ActionBlockProps}.
 * @returns The block.
 */
function ActionBlock(props: ActionBlockProps) {
  const { t } = useTranslation();

  const { action, id, path, grip, isNested, onChange, onRemove } = props;
  const house = useEditorHouse();
  const ui = useBlockUi(id, isIncomplete(action));
  const kind = labelForKind('action', action.type);
  const isForEach = action.type === 'for' && action.over.kind === 'each';
  const tools = useBlockTools({
    id,
    family: 'action',
    block: action,
    onChange,
    untestable:
      unavailableReason('action', action.type) ??
      (isForEach
        ? t('automation.actionBlocks.forEachIsNot', 'For each is not available yet')
        : action.type === 'stop'
          ? t('automation.actionBlocks.stopHasNothingTo', 'Stop has nothing to do on its own')
          : undefined),
  });
  const isGone =
    (action.type === 'command' || action.type === 'switch') &&
    action.entityId !== '' &&
    !house.isPending &&
    house.entities.length > 0 &&
    house.entityOf(action.entityId) === undefined;
  const said = isGone ? `${action.entityId} is gone` : actionSummary(action, house.names);
  const content = actionContent(action, path, (next) => {
    onChange(keepMeta(action, next));
  });

  return (
    <div data-block-closed={!ui.isOpen && holdsBlocks(action) ? id : undefined}>
      <Block
        lane={CONTROL_KINDS.has(action.type) ? 'control' : 'then'}
        glyph={<AppIcon id={glyphForKind('action', action.type)} size={15} />}
        kind={kind}
        summary={action.name === undefined ? said : <span title={said}>{action.name}</span>}
        isWarning={isGone || isForEach || unavailableReason('action', action.type) !== undefined}
        isOpen={ui.isOpen}
        onToggle={ui.toggle}
        isSelected={ui.isSelected}
        onSelect={ui.select}
        isNested={isNested}
        grip={grip}
        onRemove={onRemove}
        menu={tools.menu}
        status={tools.status}
        notice={tools.notice}
        rename={tools.rename}
        isDisabled={tools.isDisabled}
        branches={content.branches}
      >
        {content.fields}
      </Block>
    </div>
  );
}

/** A block's fields, and the branches it holds. */
type ActionContent = {
  readonly fields?: ReactNode;
  readonly branches?: ReactNode;
};

/**
 * What one block shows open: its fields, and for a control block its branches.
 *
 * @param action - The block.
 * @param path - Its path.
 * @param onChange - Called with it as it now stands.
 * @returns Its fields and branches.
 */
function actionContent(
  action: AutomationAction,
  path: string,
  onChange: (action: AutomationAction) => void,
): ActionContent {
  switch (action.type) {
    case 'if': {
      return {
        fields: (
          <ConditionsField
            items={action.conditions}
            path={`${path}.conditions`}
            note={
              action.conditions.length === 0
                ? translate('automation.actionBlocks.noneThenAlwaysRuns', 'None: Then always runs.')
                : undefined
            }
            onChange={(conditions) => {
              onChange({ ...action, conditions: [...conditions] });
            }}
          />
        ),
        branches: (
          <>
            <BlockBranch label={translate('automation.actionBlocks.then', 'Then')}>
              <ActionList
                isNested
                items={action.then}
                path={`${path}.then`}
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
                {translate('automation.actionBlocks.addElse', 'Add else')}
              </BlockAdd>
            ) : (
              <BlockBranch
                label={translate('automation.actionBlocks.else', 'Else')}
                aside={
                  <Button
                    variant="bare"
                    size="compact"
                    onClick={() => {
                      onChange(withoutKey(action, 'else'));
                    }}
                  >
                    {translate('automation.actionBlocks.removeElse', 'Remove else')}
                  </Button>
                }
              >
                <ActionList
                  isNested
                  addLabel={translate('automation.actionBlocks.addToElse', 'Add to else')}
                  items={action.else}
                  path={`${path}.else`}
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
              label={translate('automation.actionBlocks.entity', 'Entity')}
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
                label={translate('automation.actionBlocks.whenValue', 'When "{{value}}"', {
                  value: branch.value === '' ? '…' : branch.value,
                })}
                aside={
                  action.cases.length <= 1 ? undefined : (
                    <IconButton
                      label={translate(
                        'automation.actionBlocks.removeThisCase',
                        'Remove this case',
                      )}
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
                    label={translate('automation.actionBlocks.whenItIs', 'When it is')}
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
                  items={branch.actions}
                  path={`${path}.cases.${String(index)}`}
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
              {translate('automation.actionBlocks.addACase', 'Add a case')}
            </BlockAdd>
            <BlockBranch label={translate('automation.actionBlocks.otherwise', 'Otherwise')}>
              <ActionList
                isNested
                addLabel={translate('automation.actionBlocks.addToOtherwise', 'Add to otherwise')}
                items={action.default ?? []}
                path={`${path}.default`}
                onChange={(actions) => {
                  onChange(
                    actions.length === 0
                      ? withoutKey(action, 'default')
                      : { ...action, default: [...actions] },
                  );
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
              {translate(
                'automation.actionBlocks.forEachIsNot2',
                'For each is not available yet: a run that reaches this block records it as failed. Repeat a number of times instead.',
              )}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                label={translate('automation.actionBlocks.times', 'Times')}
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
          <BlockBranch label={translate('automation.actionBlocks.eachTime', 'Each time')}>
            <ActionList
              isNested
              items={action.actions}
              path={`${path}.actions`}
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
          <ConditionsField
            items={action.conditions}
            path={`${path}.conditions`}
            note={
              action.type === 'while'
                ? translate(
                    'automation.actionBlocks.checksFirstRunsWhile',
                    'Checks first, runs while they all hold, and checks again each time round.',
                  )
                : translate(
                    'automation.actionBlocks.runsOnceBeforeIt',
                    'Runs once before it checks, then again while they all hold.',
                  )
            }
            onChange={(conditions) => {
              onChange({ ...action, conditions: [...conditions] });
            }}
          />
        ),
        branches: (
          <BlockBranch
            label={
              action.type === 'while'
                ? translate('automation.actionBlocks.repeat', 'Repeat')
                : translate('automation.actionBlocks.do', 'Do')
            }
          >
            <ActionList
              isNested
              items={action.actions}
              path={`${path}.actions`}
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
          <BlockBranch label={translate('automation.actionBlocks.inOrder', 'In order')}>
            <ActionList
              isNested
              items={action.actions}
              path={`${path}.actions`}
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
            {translate(
              'automation.actionBlocks.branchesRunSideBy',
              'The branches run side by side; the run carries on when every branch has finished.',
            )}
          </p>
        ),
        branches: (
          <>
            {action.branches.map((branch, index) => (
              <BlockBranch
                key={`branch-${String(index)}`}
                label={translate('automation.actionBlocks.branchValue', 'Branch {{value}}', {
                  value: String(index + 1),
                })}
                aside={
                  action.branches.length > 1 ? (
                    <IconButton
                      label={translate(
                        'automation.actionBlocks.removeBranchValue',
                        'Remove branch {{value}}',
                        { value: String(index + 1) },
                      )}
                      size="small"
                      variant="danger"
                      onClick={() => {
                        onChange({ ...action, branches: without(action.branches, index) });
                      }}
                    >
                      <AppIcon id="x" size={13} />
                    </IconButton>
                  ) : undefined
                }
              >
                <ActionList
                  isNested
                  items={branch}
                  path={`${path}.branches.${String(index)}`}
                  onChange={(actions) => {
                    onChange({
                      ...action,
                      branches: replaceAt(action.branches, index, [...actions]),
                    });
                  }}
                />
              </BlockBranch>
            ))}
            <BlockAdd
              onClick={() => {
                onChange({ ...action, branches: [...action.branches, []] });
              }}
            >
              {translate('automation.actionBlocks.addABranch', 'Add a branch')}
            </BlockAdd>
          </>
        ),
      };
    }
    case 'stop': {
      return {
        fields: (
          <p className="text-ui-sm text-foreground-subtle">
            {translate(
              'automation.actionBlocks.nothingAfterThisBlock',
              'Nothing after this block runs. The automation is not turned off.',
            )}
          </p>
        ),
      };
    }
    case 'wait_for': {
      return {
        fields: (
          <>
            <ConditionsField
              items={action.conditions}
              path={`${path}.conditions`}
              note={translate(
                'automation.actionBlocks.runWaitsHereUntil',
                'The run waits here until they all hold.',
              )}
              onChange={(conditions) => {
                onChange({ ...action, conditions: [...conditions] });
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <DurationField
                label={translate('automation.actionBlocks.giveUpAfter', 'Give up after')}
                maxMs={WEEK_MS}
                hint={translate(
                  'automation.actionBlocks.thenTheRunCarries',
                  'Then the run carries on.',
                )}
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
                onChange({ ...action, trigger: keepMeta(action.trigger, trigger) });
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <DurationField
                label={translate('automation.actionBlocks.giveUpAfter', 'Give up after')}
                maxMs={WEEK_MS}
                hint={translate(
                  'automation.actionBlocks.thenTheRunCarries',
                  'Then the run carries on.',
                )}
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
