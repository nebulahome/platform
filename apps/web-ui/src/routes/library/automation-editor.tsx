/**
 * Writing an automation (board N-Automation-Edit).
 *
 * Three lanes in the main column - **When** wakes it, **If** gates it, **Then** is what it does,
 * which is the sentence ARCHITECTURE.md §6.1 defines and the order somebody thinks in - joined by a
 * line, and a 340px column beside them: **What it is**, **How it runs** and, once it exists, its
 * **Last runs**. The title says Edited once anything changed. Run now runs the saved version, as a
 * trigger would.
 *
 * A click on a block selects it: its edge and the area holding the blocks inside it light up in its
 * colour. A click on the page outside every block, or Escape, lets it go.
 *
 * **Saving validates against the same schema the server does**, so a rule that would be refused is
 * refused here, with the field named, while the person is still looking at it. What this cannot
 * check is whether the entity exists - that is the engine's to resolve when it runs.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type MouseEvent } from 'react';
import { useNavigate, useParams } from 'react-router';

import { AUTOMATION_MODES, type AutomationMode } from '@nebulahome/contracts';
import {
  AppIcon,
  BlockLaneConnector,
  Button,
  DetailHero,
  Note,
  Panel,
  PanelRow,
  Pill,
  Segmented,
  Switch,
  TextArea,
  TextField,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { BlockSelectionProvider, useClearBlockSelection } from '@/lib/block-selection';
import { toMessage } from '@/lib/error-message';
import {
  createAutomation,
  fetchAutomation,
  LIBRARY_QUERY_KEYS,
  triggerAutomation,
  updateAutomation,
} from '@/library/api';
import {
  draftFrom,
  emptyDraft,
  isKeepingTriggers,
  toCreate,
  toKey,
  type AutomationDraft,
} from '@/library/automation-draft';
import { ActionLane } from '@/routes/library/automation/action-blocks';
import { ConditionLane } from '@/routes/library/automation/condition-blocks';
import { DurationField } from '@/routes/library/automation/duration-field';
import { EditorHouseProvider } from '@/routes/library/automation/editor-house';
import { LastRuns } from '@/routes/library/automation/last-runs';
import { TriggerLane } from '@/routes/library/automation/trigger-blocks';
import { BackLink } from '@/routes/library/detail-page';

/** What each mode is called, and what a second trigger does in it. */
const MODES: Readonly<Record<AutomationMode, { readonly label: string; readonly note: string }>> = {
  single: { label: 'Single', note: 'Single: a trigger while it runs is ignored.' },
  restart: { label: 'Restart', note: 'Restart: stop the current run and start over.' },
  queued: { label: 'Queued', note: 'Queued: the next run waits for this one to end.' },
  parallel: { label: 'Parallel', note: 'Parallel: each trigger starts a run of its own.' },
};

/** The longest a run may be: the column's day. */
const DAY_MS = 86_400_000;

/**
 * Renders the automation editor.
 *
 * @returns The page.
 */
export function AutomationEditor() {
  return (
    <EditorHouseProvider>
      <BlockSelectionProvider>
        <Editor />
      </BlockSelectionProvider>
    </EditorHouseProvider>
  );
}

/**
 * The editor itself, inside what it reads the house and the selection from.
 *
 * @returns The page.
 */
function Editor() {
  const { automationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const clearSelection = useClearBlockSelection();

  const isNew = automationId === undefined;
  const [draft, setDraft] = useState<AutomationDraft | null>(isNew ? emptyDraft() : null);

  // Whether the key still follows the name. It stops the moment somebody edits the key, because
  // a key that keeps moving under its author is worse than one they think about once.
  const [isKeyFollowing, setKeyFollowing] = useState(isNew);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [runNotice, setRunNotice] = useState<string | null>(null);

  // The draft as it started, for whether anything changed: Edited in the title.
  const [initial, setInitial] = useState<AutomationDraft | null>(isNew ? emptyDraft() : null);

  const existing = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.automations, automationId ?? 'new'],
    enabled: !isNew,

    /**
     * Reads the automation being edited.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns The automation.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      fetchAutomation(automationId ?? '', signal),
  });

  // Derived during render rather than copied into state by an effect: the draft is seeded from
  // the answer exactly once, and after that it is the person's to change (RULES.md 15.2).
  if (draft === null && existing.data !== undefined) {
    const seeded = draftFrom(existing.data);

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

  const run = useMutation({
    /**
     * Runs the saved automation now.
     *
     * @returns What became of it.
     */
    mutationFn: async () => triggerAutomation(automationId ?? ''),

    /**
     * Says what became of it, and reads the runs again.
     *
     * @param reply - What `core` answered.
     */
    onSuccess: async (reply) => {
      setRunNotice(
        reply.outcome === 'started'
          ? 'Started. It shows here when it ends.'
          : reply.outcome === 'queued'
            ? 'Queued behind the run that is going.'
            : `Not started: ${reply.reason ?? 'it was turned away'}.`,
      );
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.automationRuns });
    },

    /**
     * Says why it could not run.
     *
     * @param error - What was refused.
     */
    onError: (error) => {
      setRunNotice(toMessage(error));
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
  const canRun = !isNew && can('automation:trigger');
  const runReason = !(existing.data?.isEnabled ?? false)
    ? 'It is turned off. Turn it on and save it to run it.'
    : isEdited
      ? 'Runs the saved version, not these changes.'
      : 'Runs it now, through its checks.';

  /**
   * Lets the selection go when the click landed outside every block.
   *
   * @param event - The click.
   */
  const onPageClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target;

    if (target instanceof Element && target.closest('[data-block], dialog') === null) {
      clearSelection();
    }
  };

  return (
    <Shell
      title={isNew ? 'New automation' : draft.name}
      isEdited={isEdited}
      onClick={onPageClick}
      action={
        <span className="flex items-center gap-2">
          {canRun ? (
            <Button
              variant="ghost"
              title={runReason}
              isBusy={run.isPending}
              disabled={!(existing.data?.isEnabled ?? false)}
              onClick={() => {
                run.mutate();
              }}
            >
              <AppIcon id="play" size={14} />
              Run now
            </Button>
          ) : null}
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
            Save
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
              <TextArea
                label="Description"
                rows={2}
                placeholder="Warm light in the living room when someone comes in after sunset."
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
              <DurationField
                label="Stop a run after"
                maxMs={DAY_MS}
                hint="A run that takes longer is ended."
                value={draft.maxRuntimeMs}
                onChange={(maxRuntimeMs) => {
                  setDraft({ ...draft, maxRuntimeMs: Math.max(1_000, maxRuntimeMs ?? 1_000) });
                }}
              />
            </div>
            <PanelRow
              title="Enabled"
              note="Runs whenever its triggers fire."
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

          {automationId === undefined ? null : (
            <LastRuns automationId={automationId} notice={runNotice} />
          )}
        </>
      }
    >
      {problems.length === 0 ? null : (
        <Note tone="danger">
          <span className="flex flex-col gap-1">
            <span className="font-medium">Not saved</span>
            {problems.map((problem) => (
              <span key={problem}>{problem}</span>
            ))}
          </span>
        </Note>
      )}

      {save.error === null ? null : <Note tone="danger">{toMessage(save.error)}</Note>}

      <TriggerLane
        triggers={draft.triggers}
        joins={draft.triggerJoins}
        note={
          isKeepingTriggers(draft)
            ? 'These triggers are grouped in a way the cards cannot show, and are saved as they were until you change one.'
            : undefined
        }
        onChange={(triggers, triggerJoins) => {
          setDraft({ ...draft, triggers, triggerJoins });
        }}
      />
      <BlockLaneConnector />
      <ConditionLane
        items={draft.conditions}
        joins={draft.conditionJoins}
        onChange={(conditions, conditionJoins) => {
          setDraft({ ...draft, conditions, conditionJoins });
        }}
      />
      <BlockLaneConnector />
      <ActionLane
        actions={draft.actions}
        onChange={(actions) => {
          setDraft({ ...draft, actions: [...actions] });
        }}
      />
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

  /** The 340px column beside the lanes. */
  readonly aside?: React.ReactNode;

  /** A click anywhere on the page. */
  readonly onClick?: (event: MouseEvent<HTMLDivElement>) => void;

  /** The lanes. */
  readonly children: React.ReactNode;
};

/**
 * The editor's frame: the way back to the automations, the title with Edited beside it once
 * anything changed, the controls on the right; then the lanes, and the side column beside them on
 * a wide window and under them on a narrow one.
 *
 * @param props - See {@link ShellProps}.
 * @returns The frame.
 */
function Shell(props: ShellProps) {
  const { title, isEdited = false, action, aside, onClick, children } = props;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a click on the page lets a selected block go; Escape does the same from the keyboard
    <div className="min-h-0 grow overflow-y-auto px-8 pt-6 pb-10" onClick={onClick}>
      <div className="flex flex-col gap-5">
        <DetailHero
          back={<BackLink to="/automations">Automations</BackLink>}
          title={title}
          titleAside={isEdited ? <Pill tone="warning">Edited</Pill> : undefined}
          actions={action}
        />
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col">{children}</div>
          {aside === undefined ? null : <div className="flex flex-col gap-4">{aside}</div>}
        </div>
      </div>
    </div>
  );
}
