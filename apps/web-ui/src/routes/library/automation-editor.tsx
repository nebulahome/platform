/**
 * Writing an automation.
 *
 * As the board draws it: three lanes in the main column - **When** wakes it, **If** gates it,
 * **Then** is what it does, which is the sentence ARCHITECTURE.md §6.1 defines and the order
 * somebody thinks in - and a 340px column beside them: **What it is** (name, key, description) and
 * **How it runs** (what a second trigger does while it runs, how long a run may take, whether it is
 * on). The title says Edited once anything changed. A page rather
 * than a dialog, because a rule with four actions does not fit in a box over a list, and a
 * dialog that scrolls is a page with the escape key wired wrong.
 *
 * The same page creates and edits. The only difference is where the draft starts and which verb
 * the save uses, and splitting that into two screens would have been two of everything.
 *
 * **Saving validates against the same schema the server does**, so a rule that would be refused
 * is refused here, with the field named, while the person is still looking at it. What this
 * cannot check is whether the entity exists — that is the engine's to resolve when it runs, and
 * it can stop being true after the rule is saved.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { AUTOMATION_MODES, type AutomationMode } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  DetailHero,
  Panel,
  PanelRow,
  Pill,
  Segmented,
  Switch,
  TextField,
} from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import {
  createAutomation,
  fetchAutomations,
  LIBRARY_QUERY_KEYS,
  updateAutomation,
} from '@/library/api';
import {
  blankCondition,
  blankTrigger,
  conditionWithoutNot,
  draftFrom,
  emptyDraft,
  isConditionNegated,
  isKeepingTriggers,
  replaceAt,
  resizeJoins,
  toCreate,
  toKey,
  withConditionNegated,
  without,
  type AutomationDraft,
} from '@/library/automation-draft';
import { ActionSequenceEditor } from '@/routes/library/action-sequence-editor';
import { BlockList } from '@/routes/library/block-list';
import { ConditionFields } from '@/routes/library/condition-fields';
import { BackLink } from '@/routes/library/detail-page';
import { CONDITION_CHOICE_GROUPS, TRIGGER_CHOICE_GROUPS } from '@/routes/library/editor-choices';
import { TriggerFields } from '@/routes/library/trigger-fields';

/** What each mode is called, and what a second trigger does in it. */
const MODES: Readonly<Record<AutomationMode, { readonly label: string; readonly note: string }>> = {
  single: { label: 'Single', note: 'Single: a trigger while it runs is ignored.' },
  restart: { label: 'Restart', note: 'Restart: stop the current run and start over.' },
  queued: { label: 'Queued', note: 'Queued: the next run waits for this one to end.' },
  parallel: { label: 'Parallel', note: 'Parallel: each trigger starts a run of its own.' },
};

/**
 * Renders the automation editor.
 *
 * @returns The page.
 */
export function AutomationEditor() {
  const { automationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isNew = automationId === undefined;
  const [draft, setDraft] = useState<AutomationDraft | null>(isNew ? emptyDraft() : null);

  // Whether the key still follows the name. It stops the moment somebody edits the key, because
  // a key that keeps moving under its author is worse than one they think about once.
  const [isKeyFollowing, setKeyFollowing] = useState(isNew);
  const [problems, setProblems] = useState<readonly string[]>([]);

  // The draft as it started, for whether anything changed: Edited in the title.
  const [initial, setInitial] = useState<AutomationDraft | null>(isNew ? emptyDraft() : null);

  const existing = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.automations,
    enabled: !isNew,

    /**
     * Reads every automation, so the one being edited can be found in it.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every rule the house follows.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAutomations(signal),
  });

  // Derived during render rather than copied into state by an effect: the draft is seeded from
  // the answer exactly once, and after that it is the person's to change (RULES.md 15.2).
  const loaded = existing.data?.find((one) => one.id === automationId);

  if (draft === null && loaded !== undefined) {
    const seeded = draftFrom(loaded);

    setDraft(seeded);
    setInitial(seeded);
  }

  const save = useMutation({
    /**
     * Writes the draft.
     *
     * @param body - What the draft became.
     */
    mutationFn: async (body: ReturnType<typeof toCreate>): Promise<void> => {
      if (!body.ok) {
        return;
      }

      if (isNew) {
        await createAutomation(body.body);

        return;
      }

      // Everything but the key. A `PATCH` does not take one, because the identifier other
      // automations refer to must not move underneath them.
      await updateAutomation(automationId, {
        name: body.body.name,
        description: body.body.description,
        definition: body.body.definition,
        mode: body.body.mode,
        maxRuntimeMs: body.body.maxRuntimeMs,
        isEnabled: body.body.isEnabled,
      });
    },

    /** Reads the collection back and returns to it. */
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.automations });
      await navigate('/automations');
    },
  });

  if (draft === null) {
    return (
      <Shell title="Automation">
        <p className="text-ui text-foreground-muted">
          {existing.isPending ? 'Reading…' : 'No automation has that address.'}
        </p>
      </Shell>
    );
  }

  /**
   * Validates the draft and sends it.
   */
  const onSave = (): void => {
    const body = toCreate(draft);

    setProblems(body.ok ? [] : body.problems);

    if (body.ok) {
      save.mutate(body);
    }
  };

  const isEdited = JSON.stringify(draft) !== JSON.stringify(initial);

  return (
    <Shell
      title={isNew ? 'New automation' : draft.name}
      isEdited={isEdited}
      action={
        <span className="flex items-center gap-2">
          <Button
            variant="bare"
            onClick={() => {
              void navigate('/automations');
            }}
          >
            Cancel
          </Button>
          <Button isBusy={save.isPending} onClick={onSave}>
            <AppIcon id="check" size={15} />
            {isNew ? 'Create' : 'Save'}
          </Button>
        </span>
      }
      aside={
        <>
          <Panel title="What it is">
            <div className="flex flex-col gap-3.5 border-t border-border px-5.5 py-4">
              <TextField
                label="Name"
                size="compact"
                placeholder="Evening lights"
                value={draft.name}
                onChange={(event) => {
                  const name = event.target.value;

                  setDraft({
                    ...draft,
                    name,
                    ...(isKeyFollowing ? { key: toKey(name) } : {}),
                  });
                }}
              />
              <TextField
                label="Key"
                size="compact"
                placeholder="evening_lights"
                hint="What other automations call it. Fixed once created."
                className="font-mono"
                value={draft.key}
                disabled={!isNew}
                onChange={(event) => {
                  setKeyFollowing(false);
                  setDraft({ ...draft, key: event.target.value });
                }}
              />
              <TextField
                label="Description"
                size="compact"
                value={draft.description}
                onChange={(event) => {
                  setDraft({ ...draft, description: event.target.value });
                }}
              />
            </div>
          </Panel>

          <Panel title="How it runs">
            <div className="flex flex-col gap-2 border-t border-border px-5.5 py-4">
              <span className="text-caption font-medium text-foreground-muted">
                When it is already running
              </span>
              <Segmented
                label="When it is already running"
                size="compact"
                options={AUTOMATION_MODES.map((mode) => ({
                  value: mode,
                  label: MODES[mode].label,
                }))}
                value={draft.mode}
                onChange={(mode) => {
                  setDraft({ ...draft, mode });
                }}
              />
              <span className="text-caption text-foreground-subtle">{MODES[draft.mode].note}</span>
            </div>
            <div className="border-t border-border px-5.5 py-4">
              <TextField
                label="Stop a run after"
                size="compact"
                inputMode="numeric"
                hint="Seconds. A run that takes longer is ended."
                className="font-mono"
                value={String(draft.maxRuntimeSeconds)}
                onChange={(event) => {
                  const seconds = Number(event.target.value);

                  if (Number.isFinite(seconds)) {
                    setDraft({ ...draft, maxRuntimeSeconds: seconds });
                  }
                }}
              />
            </div>
            <PanelRow
              title="Enabled"
              note="Saved rules run once the engine is on."
              control={
                <Switch
                  label="Enabled"
                  isOn={draft.isEnabled}
                  onChange={(isEnabled) => {
                    setDraft({ ...draft, isEnabled });
                  }}
                />
              }
            />
          </Panel>
        </>
      }
    >
      {problems.length === 0 ? null : (
        <Panel title="Not saved">
          <ul className="flex flex-col gap-1 px-4 py-3.5 text-ui text-danger">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Panel>
      )}

      {save.error === null ? null : (
        <Panel title="The server refused it">
          <p className="px-4 py-3.5 text-ui text-danger">{toMessage(save.error)}</p>
        </Panel>
      )}

      <BlockList
        title="When"
        lane="when"
        note={
          isKeepingTriggers(draft)
            ? 'These triggers are grouped in a way the cards cannot show, and are saved as they were until you change one.'
            : 'What wakes it. Combine cards with AND or OR (default OR between new cards).'
        }
        pickerTitle="Add a trigger"
        pickerDescription="State, time, events, or manual."
        groups={TRIGGER_CHOICE_GROUPS}
        items={draft.triggers}
        joins={draft.triggerJoins}
        onAdd={(type) => {
          const triggers = [...draft.triggers, blankTrigger(type)];
          const triggerJoins = resizeJoins(draft.triggerJoins, triggers.length, 'or');

          setDraft({ ...draft, triggers, triggerJoins });
        }}
        onRemove={(index) => {
          const triggers = without(draft.triggers, index);
          const triggerJoins = resizeJoins(
            without(draft.triggerJoins, Math.max(0, index - 1)),
            triggers.length,
            'or',
          );

          setDraft({ ...draft, triggers, triggerJoins });
        }}
        onJoinChange={(index, join) => {
          setDraft({
            ...draft,
            triggerJoins: replaceAt(draft.triggerJoins, index, join),
          });
        }}
        renderFields={(trigger, index) => (
          <TriggerFields
            trigger={trigger}
            onChange={(next) => {
              setDraft({
                ...draft,
                triggers: replaceAt(draft.triggers, index, next),
              });
            }}
          />
        )}
      />

      <BlockList
        title="If"
        lane="if"
        note="Entity state checks before it acts. AND between new cards by default. NOT on a card negates that check."
        pickerTitle="Add a condition"
        pickerDescription="Entity state checks only."
        groups={CONDITION_CHOICE_GROUPS}
        items={draft.conditions}
        joins={draft.conditionJoins}
        getNot={isConditionNegated}
        kindOf={(condition) => conditionWithoutNot(condition).type}
        onNotChange={(index, negated) => {
          const current = draft.conditions[index];

          if (current !== undefined) {
            setDraft({
              ...draft,
              conditions: replaceAt(
                draft.conditions,
                index,
                withConditionNegated(current, negated),
              ),
            });
          }
        }}
        onAdd={(type) => {
          const conditions = [...draft.conditions, blankCondition(type)];
          const conditionJoins = resizeJoins(draft.conditionJoins, conditions.length, 'and');

          setDraft({ ...draft, conditions, conditionJoins });
        }}
        onRemove={(index) => {
          const conditions = without(draft.conditions, index);
          const conditionJoins = resizeJoins(
            without(draft.conditionJoins, Math.max(0, index - 1)),
            conditions.length,
            'and',
          );

          setDraft({ ...draft, conditions, conditionJoins });
        }}
        onJoinChange={(index, join) => {
          setDraft({
            ...draft,
            conditionJoins: replaceAt(draft.conditionJoins, index, join),
          });
        }}
        renderFields={(condition, index) => (
          <ConditionFields
            condition={conditionWithoutNot(condition)}
            onChange={(next) => {
              const wrapped = isConditionNegated(condition)
                ? { type: 'not' as const, condition: next }
                : next;

              setDraft({
                ...draft,
                conditions: replaceAt(draft.conditions, index, wrapped),
              });
            }}
          />
        )}
      />

      <Panel title="Then">
        <div className="flex flex-col gap-3 p-4">
          <p className="text-caption text-foreground-subtle">
            What it does, in order — including nested control flow.
          </p>
          <ActionSequenceEditor
            isRoot
            actions={draft.actions}
            onChange={(actions) => {
              setDraft({ ...draft, actions: [...actions] });
            }}
          />
        </div>
      </Panel>
    </Shell>
  );
}

/** What the editor's frame needs. */
type ShellProps = {
  /** The heading. */
  readonly title: string;

  /** Whether anything changed since it was opened. */
  readonly isEdited?: boolean;

  /** Controls in the header. */
  readonly action?: React.ReactNode;

  /** The 340px column beside the lanes: what it is, how it runs. */
  readonly aside?: React.ReactNode;

  /** The lanes. */
  readonly children: React.ReactNode;
};

/**
 * The editor's frame: the way back to the automations, the title with Edited beside it once
 * anything changed, Cancel and Save on the right; then the lanes, and the side column beside them
 * on a wide window and under them on a narrow one.
 *
 * @param props - See {@link ShellProps}.
 * @returns The frame.
 */
function Shell(props: ShellProps) {
  const { title, isEdited = false, action, aside, children } = props;

  return (
    <div className="min-h-0 grow overflow-y-auto px-8 pt-6 pb-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <DetailHero
          back={<BackLink to="/automations">Automations</BackLink>}
          title={title}
          titleAside={isEdited ? <Pill tone="warning">Edited</Pill> : undefined}
          actions={action}
        />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">{children}</div>
          {aside === undefined ? null : <div className="flex flex-col gap-4">{aside}</div>}
        </div>
      </div>
    </div>
  );
}
