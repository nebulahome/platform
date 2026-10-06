/**
 * Writing an automation.
 *
 * One column, three groups: **When** wakes it, **If** gates it, **Then** is what it does — which
 * is the sentence ARCHITECTURE.md §6.1 defines and the order somebody thinks in. A page rather
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
import { Link, useNavigate, useParams } from 'react-router';

import { Button, Panel, TextField } from '@nebulahome/ui';

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
import { CONDITION_CHOICE_GROUPS, TRIGGER_CHOICE_GROUPS } from '@/routes/library/editor-choices';
import { TriggerFields } from '@/routes/library/trigger-fields';

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
    setDraft(draftFrom(loaded));
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

  return (
    <Shell
      title={isNew ? 'New automation' : draft.name}
      action={
        <span className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              void navigate('/automations');
            }}
          >
            Cancel
          </Button>
          <Button size="compact" isBusy={save.isPending} onClick={onSave}>
            {isNew ? 'Create' : 'Save'}
          </Button>
        </span>
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

      <Panel title="What it is">
        <div className="grid gap-3.5 p-4 sm:grid-cols-2">
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
            hint="What other automations and the API refer to. It never changes after this."
            value={draft.key}
            disabled={!isNew}
            onChange={(event) => {
              setKeyFollowing(false);
              setDraft({ ...draft, key: event.target.value });
            }}
          />

          <div className="sm:col-span-2">
            <TextField
              label="Description"
              size="compact"
              value={draft.description}
              onChange={(event) => {
                setDraft({ ...draft, description: event.target.value });
              }}
            />
          </div>
        </div>
      </Panel>

      <BlockList
        title="When"
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

  /** Controls in the header. */
  readonly action?: React.ReactNode;

  /** The body. */
  readonly children: React.ReactNode;
};

/**
 * The editor's frame, which is the library page's frame without the collection states.
 *
 * The heading reads `Automations / New automation`, the way the vendor page reads
 * `Integrations / Shelly`: where you are and the way back are the same three words, and the
 * first of them is a link. Cancel does the same thing, but Cancel is at the far end of the bar
 * and says "throw this away" - the crumb says "this is one of those", which is a different fact.
 *
 * @param props - See {@link ShellProps}.
 * @returns The frame.
 */
function Shell(props: ShellProps) {
  const { title, action, children } = props;

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex h-17 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
        <h1 className="flex min-w-0 items-center gap-2 text-headline-sm tracking-tight">
          <Link
            to="/automations"
            className="shrink-0 text-foreground-muted transition-colors hover:text-foreground"
          >
            Automations
          </Link>
          <span aria-hidden="true" className="font-light text-foreground-subtle">
            /
          </span>
          <span className="truncate font-semibold">{title}</span>
        </h1>
        {action}
      </header>

      <div className="min-h-0 grow overflow-y-auto p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
