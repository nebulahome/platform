/**
 * The Then section: a sequence of cards, including nested templates with indented bodies.
 *
 * Each branch ends with a dashed Add block that opens the grouped picker. Template cards collapse
 * their indented children (and that placeholder) with a chevron, the way the plan describes.
 */
import { useState, type ReactNode } from 'react';

import type { AutomationAction } from '@nebulahome/contracts';
import { Button, SelectField, TextField } from '@nebulahome/ui';

import { blankAction, replaceAt, without } from '@/library/automation-draft';
import { ActionFields } from '@/routes/library/action-fields';
import { AddBlockPlaceholder } from '@/routes/library/add-block-placeholder';
import { BlockCard } from '@/routes/library/block-card';
import { BlockPickerModal } from '@/routes/library/block-picker-modal';
import { ConditionTreeEditor } from '@/routes/library/condition-tree-editor';
import { ACTION_CHOICE_GROUPS } from '@/routes/library/editor-choices';
import { EntityField } from '@/routes/library/entity-field';

/** What a sequence editor needs. */
export type ActionSequenceEditorProps = {
  /** Blocks in order. */
  readonly actions: readonly AutomationAction[];

  /** Called with the new sequence. */
  readonly onChange: (actions: readonly AutomationAction[]) => void;

  /** When false, skip the outer padding (inside another panel). */
  readonly isRoot?: boolean;
};

/**
 * Renders an ordered list of action blocks.
 *
 * @param props - See {@link ActionSequenceEditorProps}.
 * @returns The sequence.
 */
export function ActionSequenceEditor(props: ActionSequenceEditorProps) {
  const { actions, onChange, isRoot = false } = props;
  const [isPickerOpen, setPickerOpen] = useState(false);

  const body = (
    <div className="flex flex-col gap-3">
      {actions.map((action, index) => (
        <ActionBlock
          key={`${action.type}-${String(index)}`}
          action={action}
          position={index + 1}
          onChange={(next) => {
            onChange(replaceAt(actions, index, next));
          }}
          onRemove={() => {
            onChange(without(actions, index));
          }}
        />
      ))}

      <AddBlockPlaceholder
        onClick={() => {
          setPickerOpen(true);
        }}
      />

      <BlockPickerModal
        isOpen={isPickerOpen}
        onClose={() => {
          setPickerOpen(false);
        }}
        title="Add an action"
        description="Control flow, waits, and things that do something."
        groups={ACTION_CHOICE_GROUPS}
        onPick={(type) => {
          onChange([...actions, blankAction(type)]);
          setPickerOpen(false);
        }}
      />
    </div>
  );

  if (!isRoot) {
    return body;
  }

  return body;
}

/** What one block in a sequence needs. */
type ActionBlockProps = {
  readonly action: AutomationAction;
  readonly position: number;
  readonly onChange: (action: AutomationAction) => void;
  readonly onRemove: () => void;
};

/**
 * Renders one action, including nested templates.
 *
 * @param props - See {@link ActionBlockProps}.
 * @returns The block.
 */
function ActionBlock(props: ActionBlockProps) {
  const { action, position, onChange, onRemove } = props;
  const [isExpanded, setExpanded] = useState(true);

  if (action.type === 'stop') {
    return (
      <BlockCard kind="stop" position={position} onRemove={onRemove}>
        <p className="text-ui text-foreground-subtle sm:col-span-2">Ends this run.</p>
      </BlockCard>
    );
  }

  if (action.type === 'sequence') {
    return (
      <BlockCard
        kind="sequence"
        position={position}
        isCollapsible
        isExpanded={isExpanded}
        onToggleExpanded={() => {
          setExpanded((value) => !value);
        }}
        onRemove={onRemove}
      >
        {isExpanded ? (
          <IndentedBody inCard>
            <ActionSequenceEditor
              actions={action.actions}
              onChange={(actions) => {
                onChange({ ...action, actions });
              }}
            />
          </IndentedBody>
        ) : null}
      </BlockCard>
    );
  }

  if (action.type === 'parallel') {
    return (
      <BlockCard
        kind="parallel"
        position={position}
        isCollapsible
        isExpanded={isExpanded}
        onToggleExpanded={() => {
          setExpanded((value) => !value);
        }}
        onRemove={onRemove}
        headerActions={
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              onChange({
                ...action,
                actions: [...action.actions, blankAction('sequence')],
              });
            }}
          >
            Add branch
          </Button>
        }
      >
        {isExpanded ? (
          <IndentedBody inCard>
            {action.actions.map((branch, index) => (
              <div key={`branch-${String(index)}`} className="flex flex-col gap-2">
                <p className="text-caption font-medium text-foreground-subtle">
                  Branch {index + 1}
                </p>
                <ParallelBranchEditor
                  branch={branch}
                  onChange={(next) => {
                    onChange({
                      ...action,
                      actions: replaceAt(action.actions, index, next),
                    });
                  }}
                  {...(action.actions.length <= 1
                    ? {}
                    : {
                        /** Takes this branch out of the block. */
                        onRemove: () => {
                          onChange({
                            ...action,
                            actions: without(action.actions, index),
                          });
                        },
                      })}
                />
              </div>
            ))}
          </IndentedBody>
        ) : null}
      </BlockCard>
    );
  }

  if (action.type === 'if') {
    const elseActions = action.else ?? [];

    return (
      <div className="flex flex-col gap-3">
        <BlockCard
          kind="if"
          position={position}
          isCollapsible
          isExpanded={isExpanded}
          onToggleExpanded={() => {
            setExpanded((value) => !value);
          }}
          onRemove={onRemove}
        >
          <ConditionTreeEditor
            value={action.condition}
            onChange={(condition) => {
              onChange({ ...action, condition });
            }}
          />
        </BlockCard>

        {isExpanded ? (
          <>
            <IndentedBody>
              <ActionSequenceEditor
                actions={action.then}
                onChange={(then) => {
                  onChange({ ...action, then });
                }}
              />
            </IndentedBody>

            <BlockCard kind="if" kindLabel="Else" />

            <IndentedBody>
              <ActionSequenceEditor
                actions={elseActions}
                onChange={(elseBranch) => {
                  onChange({
                    ...action,
                    else: elseBranch.length === 0 ? undefined : elseBranch,
                  });
                }}
              />
            </IndentedBody>
          </>
        ) : null}
      </div>
    );
  }

  if (action.type === 'while') {
    return (
      <BlockCard
        kind="while"
        position={position}
        isCollapsible
        isExpanded={isExpanded}
        onToggleExpanded={() => {
          setExpanded((value) => !value);
        }}
        onRemove={onRemove}
      >
        <ConditionTreeEditor
          value={action.condition}
          onChange={(condition) => {
            onChange({ ...action, condition });
          }}
        />
        {isExpanded ? (
          <IndentedBody inCard>
            <ActionSequenceEditor
              actions={action.actions}
              onChange={(actions) => {
                onChange({ ...action, actions });
              }}
            />
          </IndentedBody>
        ) : null}
      </BlockCard>
    );
  }

  if (action.type === 'do_while') {
    return (
      <BlockCard
        kind="do_while"
        position={position}
        isCollapsible
        isExpanded={isExpanded}
        onToggleExpanded={() => {
          setExpanded((value) => !value);
        }}
        onRemove={onRemove}
      >
        {isExpanded ? (
          <IndentedBody inCard>
            <ActionSequenceEditor
              actions={action.actions}
              onChange={(actions) => {
                onChange({ ...action, actions });
              }}
            />
          </IndentedBody>
        ) : null}
        <ConditionTreeEditor
          value={action.condition}
          onChange={(condition) => {
            onChange({ ...action, condition });
          }}
        />
      </BlockCard>
    );
  }

  if (action.type === 'for') {
    return (
      <BlockCard
        kind="for"
        position={position}
        isCollapsible
        isExpanded={isExpanded}
        onToggleExpanded={() => {
          setExpanded((value) => !value);
        }}
        onRemove={onRemove}
      >
        <ForFields
          over={action.over}
          onChange={(over) => {
            onChange({ ...action, over });
          }}
        />
        {isExpanded ? (
          <IndentedBody inCard>
            <ActionSequenceEditor
              actions={action.actions}
              onChange={(actions) => {
                onChange({ ...action, actions });
              }}
            />
          </IndentedBody>
        ) : null}
      </BlockCard>
    );
  }

  if (action.type === 'switch') {
    return (
      <BlockCard
        kind="switch"
        position={position}
        isCollapsible
        isExpanded={isExpanded}
        onToggleExpanded={() => {
          setExpanded((value) => !value);
        }}
        onRemove={onRemove}
        headerActions={
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              onChange({
                ...action,
                cases: [...action.cases, { value: '', actions: [] }],
              });
            }}
          >
            Add case
          </Button>
        }
      >
        <EntityField
          label="Entity"
          value={action.entityId}
          onChange={(entityId) => {
            onChange({ ...action, entityId });
          }}
        />
        {isExpanded ? (
          <IndentedBody inCard>
            {action.cases.map((caseEntry, index) => (
              <div key={`case-${String(index)}`} className="flex flex-col gap-3">
                <BlockCard
                  kind="switch"
                  kindLabel={`Case ${String(index + 1)}`}
                  {...(action.cases.length <= 1
                    ? {}
                    : {
                        /** Takes this case out of the switch. */
                        onRemove: () => {
                          onChange({
                            ...action,
                            cases: without(action.cases, index),
                          });
                        },
                      })}
                >
                  <TextField
                    label="When state is"
                    size="compact"
                    value={caseEntry.value}
                    onChange={(event) => {
                      onChange({
                        ...action,
                        cases: replaceAt(action.cases, index, {
                          ...caseEntry,
                          value: event.target.value,
                        }),
                      });
                    }}
                  />
                  <IndentedBody inCard>
                    <ActionSequenceEditor
                      actions={caseEntry.actions}
                      onChange={(actions) => {
                        onChange({
                          ...action,
                          cases: replaceAt(action.cases, index, { ...caseEntry, actions }),
                        });
                      }}
                    />
                  </IndentedBody>
                </BlockCard>
              </div>
            ))}

            <BlockCard kind="switch" kindLabel="Default">
              <IndentedBody inCard>
                <ActionSequenceEditor
                  actions={action.default ?? []}
                  onChange={(defaultActions) => {
                    onChange({
                      ...action,
                      default: defaultActions.length === 0 ? undefined : defaultActions,
                    });
                  }}
                />
              </IndentedBody>
            </BlockCard>
          </IndentedBody>
        ) : null}
      </BlockCard>
    );
  }

  return (
    <BlockCard kind={action.type} position={position} onRemove={onRemove}>
      <ActionFields action={action} onChange={onChange} />
    </BlockCard>
  );
}

/**
 * Indented branch body, like Python nesting under a header card.
 *
 * @param props - What it holds and where it sits.
 * @param props.children - The branch's cards.
 * @param props.inCard - Whether it sits inside a card's grid rather than on the page.
 * @returns The indented column.
 */
function IndentedBody(props: { readonly children: ReactNode; readonly inCard?: boolean }) {
  const { children, inCard = false } = props;

  return (
    <div
      className={
        inCard
          ? 'col-span-2 ml-1 flex flex-col gap-3 border-l border-border pl-4 sm:col-span-2'
          : 'ml-3 flex flex-col gap-3 border-l border-border pl-4'
      }
    >
      {children}
    </div>
  );
}

/** One branch inside a parallel block. */
type ParallelBranchEditorProps = {
  readonly branch: AutomationAction;
  readonly onChange: (branch: AutomationAction) => void;
  readonly onRemove?: () => void;
};

/**
 * Edits one parallel branch as a mini-sequence.
 *
 * @param props - See {@link ParallelBranchEditorProps}.
 * @returns The branch editor.
 */
function ParallelBranchEditor(props: ParallelBranchEditorProps) {
  const { branch, onChange, onRemove } = props;
  const actions = branchActions(branch);

  return (
    <div className="flex flex-col gap-2">
      {onRemove === undefined ? null : (
        <div className="flex justify-end">
          <Button variant="ghost" size="compact" onClick={onRemove}>
            Remove branch
          </Button>
        </div>
      )}
      <ActionSequenceEditor
        actions={actions}
        onChange={(next) => {
          onChange(actionsToBranch(next));
        }}
      />
    </div>
  );
}

/**
 * Reads the actions stored in one parallel branch.
 *
 * @param branch - One entry under `parallel.actions`.
 * @returns A flat sequence to edit.
 */
function branchActions(branch: AutomationAction): AutomationAction[] {
  if (branch.type === 'sequence') {
    return [...branch.actions];
  }

  return [branch];
}

/**
 * Writes a flat sequence back as one parallel branch.
 *
 * @param actions - What the branch editor holds.
 * @returns What to store under `parallel.actions`.
 */
function actionsToBranch(actions: readonly AutomationAction[]): AutomationAction {
  const [only] = actions;

  if (actions.length === 1 && only !== undefined) {
    return only;
  }

  return { type: 'sequence', actions: [...actions] };
}

/** Fields for a `for` block's repeat mode. */
type ForFieldsProps = {
  readonly over: Extract<AutomationAction, { readonly type: 'for' }>['over'];
  readonly onChange: (over: Extract<AutomationAction, { readonly type: 'for' }>['over']) => void;
};

/**
 * Renders count vs for-each controls.
 *
 * @param props - See {@link ForFieldsProps}.
 * @returns The fields.
 */
function ForFields(props: ForFieldsProps) {
  const { over, onChange } = props;

  return (
    <>
      <SelectField
        label="Repeat"
        size="compact"
        options={[
          { value: 'count', label: 'A number of times' },
          { value: 'each', label: 'For each item' },
        ]}
        value={over.kind}
        onChange={(kind) => {
          if (kind === 'count') {
            onChange({ kind: 'count', count: over.kind === 'count' ? over.count : 1 });
          } else {
            onChange({ kind: 'each', items: over.kind === 'each' ? over.items : '' });
          }
        }}
      />
      {over.kind === 'count' ? (
        <TextField
          label="Times"
          size="compact"
          type="number"
          value={String(over.count)}
          onChange={(event) => {
            onChange({ kind: 'count', count: Number(event.target.value) });
          }}
        />
      ) : (
        <TextField
          label="Items"
          size="compact"
          hint="Expression or list the engine understands."
          value={over.items}
          onChange={(event) => {
            onChange({ kind: 'each', items: event.target.value });
          }}
        />
      )}
    </>
  );
}
