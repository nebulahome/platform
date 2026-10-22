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
 * colour. A click on the page outside every block, or Escape, lets it go. A block is dragged by its
 * grip into any list of its kind - into an If's else, out of a loop, into an OR group - or moved
 * with the arrow keys on its grip (`block-drag.tsx`); what it does to the draft is
 * `block-path.ts`'s.
 *
 * **Saving validates against the same schema the server does**, so a rule that would be refused is
 * refused here, with the field named, while the person is still looking at it. What this cannot
 * check is whether the entity exists - that is the engine's to resolve when it runs. Saving keeps
 * the page open: the answer goes into the cache the list and this page read, so neither shows the
 * automation as it was.
 *
 * **The draft is seeded once, from a fresh read.** An automation already in the cache - opened
 * from the list a moment after its switch was flipped - is read again before it becomes the
 * draft, or the page would start from the old copy and save it back.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import {
  AUTOMATION_MODES,
  renameEntities,
  type AutomationMode,
  type JsonObject,
} from '@nebulahome/contracts';
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
  toast,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { defineMessage, type Message, text } from '@/i18n/messages';
import { BlockDragProvider } from '@/lib/block-drag';
import { blockIdOf } from '@/lib/block-ids';
import { BlockUiProvider, useBlockUiStoreHandle, useClearBlockSelection } from '@/lib/block-ui';
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
  toCreate,
  toKey,
  type AutomationDraft,
  type DraftResult,
} from '@/library/automation-draft';
import { containersOf, getBlock, moveBlock, stepBlock, type BlockSlot } from '@/library/block-path';
import { automationsFile, saveJsonFile } from '@/library/library-file';
import { missingOfAutomations } from '@/library/library-import';
import { ActionLane } from '@/routes/library/automation/action-blocks';
import { ConditionLane } from '@/routes/library/automation/condition-blocks';
import { DurationField } from '@/routes/library/automation/duration-field';
import { EditorHouseProvider, useEditorHouse } from '@/routes/library/automation/editor-house';
import { LastRuns } from '@/routes/library/automation/last-runs';
import { TriggerLane } from '@/routes/library/automation/trigger-blocks';
import { BackLink } from '@/routes/library/detail-page';
import { LibraryImportFlow } from '@/routes/library/library-import-flow';
import { ResolveEntitiesModal } from '@/routes/library/resolve-entities-modal';

/** What each mode is called, and what a second trigger does in it. */
const MODES: Readonly<Record<AutomationMode, { readonly label: Message; readonly note: Message }>> =
  {
    single: {
      label: defineMessage('automations.modes.single', 'Single'),
      note: defineMessage(
        'library.automationEditor.singleATriggerWhile',
        'Single: a trigger while it runs is ignored.',
      ),
    },
    restart: {
      label: defineMessage('automations.modes.restart', 'Restart'),
      note: defineMessage(
        'library.automationEditor.restartStopTheCurrent',
        'Restart: stop the current run and start over.',
      ),
    },
    queued: {
      label: defineMessage('automations.modes.queued', 'Queued'),
      note: defineMessage(
        'library.automationEditor.queuedTheNextRun',
        'Queued: the next run waits for this one to end.',
      ),
    },
    parallel: {
      label: defineMessage('automations.modes.parallel', 'Parallel'),
      note: defineMessage(
        'library.automationEditor.parallelEachTriggerStarts',
        'Parallel: each trigger starts a run of its own.',
      ),
    },
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
      <BlockUiProvider>
        <Editor />
      </BlockUiProvider>
    </EditorHouseProvider>
  );
}

/**
 * The editor itself, inside what it reads the house and the blocks' state from.
 *
 * @returns The page.
 */
function Editor() {
  const { t } = useTranslation();

  const { automationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const clearSelection = useClearBlockSelection();
  const blockUi = useBlockUiStoreHandle();

  const isNew = automationId === undefined;
  const [draft, setDraft] = useState<AutomationDraft | null>(isNew ? emptyDraft() : null);

  // Whether the key still follows the name. It stops the moment somebody edits the key, because
  // a key that keeps moving under its author is worse than one they think about once.
  const [isKeyFollowing, setKeyFollowing] = useState(isNew);
  const [isFixing, setFixing] = useState(false);
  const house = useEditorHouse();

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
  // the answer exactly once, and after that it is the person's to change (RULES.md 15.2). Not
  // while a read is under way: what the cache holds may be older than what the server has.
  if (draft === null && existing.data !== undefined && !existing.isFetching) {
    const seeded = draftFrom(existing.data);

    setDraft(seeded);
    setInitial(seeded);
  }

  const save = useMutation({
    /**
     * Writes the draft.
     *
     * @param variables - What the draft became, and the draft as it was sent.
     * @param variables.body - The checked body.
     * @param variables.draft - The draft as it was sent, which Edited is measured from.
     * @returns The automation as saved.
     */
    mutationFn: async (variables: {
      readonly body: Extract<DraftResult, { ok: true }>['body'];
      readonly draft: AutomationDraft;
    }) => {
      const { body } = variables;

      if (isNew) {
        return createAutomation(body);
      }

      // Everything but the key. A `PATCH` does not take one, because the identifier other
      // automations refer to must not move underneath them.
      return updateAutomation(automationId, {
        name: body.name,
        description: body.description,
        definition: body.definition,
        mode: body.mode,
        maxRuntimeMs: body.maxRuntimeMs,
        isEnabled: body.isEnabled,
      });
    },

    /**
     * Stays on the page: what was sent is what is saved now, the caches hold the answer, and a
     * new automation takes its own address.
     *
     * @param view - The automation as saved.
     * @param variables - What was sent.
     */
    onSuccess: async (view, variables) => {
      setInitial(variables.draft);
      queryClient.setQueryData([...LIBRARY_QUERY_KEYS.automations, view.id], view);
      await queryClient.invalidateQueries({
        queryKey: LIBRARY_QUERY_KEYS.automations,
        exact: true,
      });

      toast.success({
        title: isNew
          ? t('library.automationEditor.created', '{{name}} created', { name: view.name })
          : t('library.automationEditor.saved', '{{name}} saved', { name: view.name }),
      });

      if (isNew) {
        setKeyFollowing(false);
        await navigate(`/automations/${view.id}`, { replace: true });
      }
    },

    /**
     * Says why the server would not save it.
     *
     * @param error - What was refused.
     */
    onError: (error) => {
      toast.error({
        title: t('library.automationEditor.notSavedTitle', 'The automation was not saved'),
        message: toMessage(error),
      });
    },
  });

  /**
   * Moves a dragged block where it was let go.
   *
   * @param from - Where it was.
   * @param to - Where it landed.
   */
  const onMove = useCallback((from: BlockSlot, to: BlockSlot): void => {
    setDraft((current) => (current === null ? current : (moveBlock(current, from, to) ?? current)));
  }, []);

  /**
   * Moves a block one place with the keyboard, opening the blocks it lands in.
   *
   * @param from - Where it is.
   * @param step - Up or down.
   * @returns Where it now is, or null at either end.
   */
  const onStep = (from: BlockSlot, step: -1 | 1): BlockSlot | null => {
    const stepped = draft === null ? null : stepBlock(draft, from, step);

    if (stepped === null) {
      return null;
    }

    setDraft(stepped.draft);

    for (const path of containersOf(stepped.at.list)) {
      const holder = getBlock(stepped.draft, path);

      if (holder !== undefined) {
        blockUi.setOpen(blockIdOf(holder), true);
      }
    }

    return stepped.at;
  };

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
      if (reply.outcome === 'started') {
        toast.success({
          title: t('library.automationEditor.started', 'Started'),
          message: t(
            'library.automationEditor.startedItShowsHere',
            'It shows in Last runs when it ends.',
          ),
        });
      } else if (reply.outcome === 'queued') {
        toast.info({
          title: t('library.automationEditor.queued', 'Queued'),
          message: t(
            'library.automationEditor.queuedBehindTheRun',
            'Queued behind the run that is going.',
          ),
        });
      } else {
        toast.warning({
          title: t('library.automationEditor.notStartedTitle', 'Not started'),
          message:
            reply.reason ??
            t('library.automationEditor.notStartedTurnedAway', 'It was turned away.'),
        });
      }

      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.automationRuns });
    },

    /**
     * Says why it could not run.
     *
     * @param error - What was refused.
     */
    onError: (error) => {
      toast.error({
        title: t('library.automationEditor.couldNotRun', 'It could not run'),
        message: toMessage(error),
      });
    },
  });

  if (draft === null) {
    return (
      <Shell title={t('library.automationEditor.automation', 'Automation')}>
        <p className="text-ui text-foreground-muted">
          {existing.isPending
            ? t('library.automationEditor.reading', 'Reading…')
            : t('library.automationEditor.noAutomationHasThat', 'No automation has that address.')}
        </p>
      </Shell>
    );
  }

  /**
   * Validates the draft and sends it.
   */
  const onSave = (): void => {
    const body = toCreate(draft);

    if (body.ok) {
      save.mutate({ body: body.body, draft });
    } else {
      toast.error({
        title: t('library.automationEditor.notSaved', 'Not saved'),
        message: body.problems.slice(0, 4).join(' · '),
      });
    }
  };

  const definition = {
    triggers: draft.triggers,
    if: draft.if,
    then: draft.then,
  } as unknown as JsonObject;
  const missing = house.isPending
    ? []
    : missingOfAutomations([{ definition }], (entityId) => house.entityOf(entityId) !== undefined);
  const isMissing = (existing.data?.missingEntities.length ?? 0) > 0;

  const isEdited = JSON.stringify(draft) !== JSON.stringify(initial);
  const canRun = !isNew && can('automation:trigger');
  const runReason = isMissing
    ? t(
        'library.automationEditor.namesMissing',
        'It names entities this house does not have; pick them and save it to run it.',
      )
    : !(existing.data?.isEnabled ?? false)
      ? t(
          'library.automationEditor.itIsTurnedOff',
          'It is turned off. Turn it on and save it to run it.',
        )
      : isEdited
        ? t(
            'library.automationEditor.runsTheSavedVersion',
            'Runs the saved version, not these changes.',
          )
        : t('library.automationEditor.runsItNowThrough', 'Runs it now, through its checks.');

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
    <BlockDragProvider onMove={onMove} onStep={onStep}>
      <Shell
        title={isNew ? t('library.automationEditor.newAutomation', 'New automation') : draft.name}
        isEdited={isEdited}
        onClick={onPageClick}
        action={
          <span className="flex items-center gap-2">
            {canRun ? (
              <Button
                variant="ghost"
                title={runReason}
                isBusy={run.isPending}
                disabled={!(existing.data?.isEnabled ?? false) || isMissing}
                onClick={() => {
                  run.mutate();
                }}
              >
                <AppIcon id="play" size={14} />
                {t('library.automationEditor.runNow', 'Run now')}
              </Button>
            ) : null}
            <Button
              variant="bare"
              title={
                isEdited
                  ? t(
                      'library.automationEditor.backToTheAutomations',
                      'Back to the automations, leaving these changes unsaved',
                    )
                  : undefined
              }
              onClick={() => {
                void navigate('/automations');
              }}
            >
              {isEdited ? t('common.cancel', 'Cancel') : t('common.close', 'Close')}
            </Button>
            <Button isBusy={save.isPending} onClick={onSave}>
              <AppIcon id="check" size={15} />
              {t('common.save', 'Save')}
            </Button>
          </span>
        }
        aside={
          <>
            <Panel title={t('library.automationEditor.whatItIs', 'What it is')}>
              <div className="flex flex-col gap-3.5 border-t border-border px-5.5 py-4">
                <TextField
                  label={t('library.automationEditor.name', 'Name')}
                  size="compact"
                  placeholder={t('library.automationEditor.eveningLights', 'Evening lights')}
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
                  label={t('library.automationEditor.key', 'Key')}
                  size="compact"
                  placeholder={t('library.automationEditor.eveningLights2', 'evening_lights')}
                  hint={t(
                    'library.automationEditor.whatOtherAutomationsCall',
                    'What other automations call it. Fixed once created.',
                  )}
                  className="font-mono"
                  value={draft.key}
                  disabled={!isNew}
                  onChange={(event) => {
                    setKeyFollowing(false);
                    setDraft({ ...draft, key: event.target.value });
                  }}
                />
                <TextArea
                  label={t('library.automationEditor.description', 'Description')}
                  rows={2}
                  placeholder={t(
                    'library.automationEditor.warmLightInThe',
                    'Warm light in the living room when someone comes in after sunset.',
                  )}
                  value={draft.description}
                  onChange={(event) => {
                    setDraft({ ...draft, description: event.target.value });
                  }}
                />
              </div>
            </Panel>

            <Panel title={t('library.automationEditor.howItRuns', 'How it runs')}>
              <div className="flex flex-col gap-2 border-t border-border px-5.5 py-4">
                <span className="text-caption font-medium text-foreground-muted">
                  {t('library.automationEditor.whenItIsAlready', 'When it is already running')}
                </span>
                <Segmented
                  label={t(
                    'library.automationEditor.whenItIsAlready',
                    'When it is already running',
                  )}
                  size="compact"
                  options={AUTOMATION_MODES.map((mode) => ({
                    value: mode,
                    label: text(MODES[mode].label),
                  }))}
                  value={draft.mode}
                  onChange={(mode) => {
                    setDraft({ ...draft, mode });
                  }}
                />
                <span className="text-caption text-foreground-subtle">
                  {text(MODES[draft.mode].note)}
                </span>
              </div>
              <div className="border-t border-border px-5.5 py-4">
                <DurationField
                  label={t('library.automationEditor.stopARunAfter', 'Stop a run after')}
                  maxMs={DAY_MS}
                  hint={t(
                    'library.automationEditor.runThatTakesLonger',
                    'A run that takes longer is ended.',
                  )}
                  value={draft.maxRuntimeMs}
                  onChange={(maxRuntimeMs) => {
                    setDraft({ ...draft, maxRuntimeMs: Math.max(1_000, maxRuntimeMs ?? 1_000) });
                  }}
                />
              </div>
              <PanelRow
                title={t('library.automationEditor.enabled', 'Enabled')}
                note={t(
                  'library.automationEditor.runsWheneverItsTriggers',
                  'Runs whenever its triggers fire.',
                )}
                control={
                  <Switch
                    label={t('library.automationEditor.enabled', 'Enabled')}
                    isOn={draft.isEnabled}
                    onChange={(isEnabled) => {
                      setDraft({ ...draft, isEnabled });
                    }}
                  />
                }
              />
            </Panel>

            <Panel title={t('library.automationEditor.file', 'File')}>
              <div className="flex flex-col gap-3 border-t border-border px-5.5 py-4">
                <p className="text-caption text-foreground-subtle">
                  {t(
                    'library.automationEditor.fileNote',
                    'As one .json file, to keep or to bring into another house. Import also reads Home Assistant automations.',
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => {
                      saveJsonFile(
                        automationsFile([{ ...draft, definition }]),
                        `${draft.key === '' ? 'automation' : draft.key}.automations.json`,
                      );
                    }}
                  >
                    <AppIcon id="download" size={14} />
                    {t('library.automationEditor.export', 'Export')}
                  </Button>
                  <LibraryImportFlow
                    kind="automations"
                    isSingle
                    takenKeys={house.automations
                      .filter((automation) => automation.id !== automationId)
                      .map((automation) => automation.key)}
                    onImport={(result) => {
                      const [item] = result.kind === 'automations' ? result.items : [];

                      if (item === undefined) {
                        return;
                      }

                      // What is in the file replaces the draft; an automation that exists keeps
                      // its key, which nothing may move.
                      setDraft({ ...draftFrom(item), key: isNew ? item.key : draft.key });

                      if (isNew) {
                        setKeyFollowing(false);
                      }

                      toast.success({
                        title: t(
                          'library.automationEditor.importedTitle',
                          'Brought into the draft',
                        ),
                        message: t('library.automationEditor.importedNote', 'Save it to keep it.'),
                      });
                    }}
                  >
                    {(choose) => (
                      <Button variant="ghost" size="compact" onClick={choose}>
                        <AppIcon id="upload" size={14} />
                        {t('library.automationEditor.import', 'Import')}
                      </Button>
                    )}
                  </LibraryImportFlow>
                </div>
              </div>
            </Panel>

            {automationId === undefined ? null : <LastRuns automationId={automationId} />}
          </>
        }
      >
        {missing.length === 0 ? null : (
          <Note tone="danger">
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {t('library.automationEditor.missingEntities', {
                  count: missing.length,
                  defaultValue_one:
                    'It names 1 entity this house does not have ({{list}}). It will not run until you pick one.',
                  defaultValue_other:
                    'It names {{count}} entities this house does not have ({{list}}). It will not run until you pick them.',
                  list: missing
                    .slice(0, 3)
                    .map((entry) => entry.entityId)
                    .join(', '),
                })}
              </span>
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  setFixing(true);
                }}
              >
                {t('library.automationEditor.fix', 'Fix')}
              </Button>
            </span>
          </Note>
        )}
        {isFixing ? (
          <ResolveEntitiesModal
            isOpen
            missing={missing}
            confirmLabel={t('library.automationEditor.useThese', 'Use these')}
            onClose={() => {
              setFixing(false);
            }}
            onConfirm={(renames) => {
              setFixing(false);
              setDraft({
                ...draft,
                triggers: renameEntities(draft.triggers, renames),
                if: renameEntities(draft.if, renames),
                then: renameEntities(draft.then, renames),
              });
            }}
          />
        ) : null}

        <TriggerLane
          triggers={draft.triggers}
          onChange={(triggers) => {
            setDraft({ ...draft, triggers: [...triggers] });
          }}
        />
        <BlockLaneConnector />
        <ConditionLane
          items={draft.if}
          onChange={(conditions) => {
            setDraft({ ...draft, if: [...conditions] });
          }}
        />
        <BlockLaneConnector />
        <ActionLane
          items={draft.then}
          onChange={(actions) => {
            setDraft({ ...draft, then: [...actions] });
          }}
        />
      </Shell>
    </BlockDragProvider>
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
  const { t } = useTranslation();

  const { title, isEdited = false, action, aside, onClick, children } = props;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a click on the page lets a selected block go; Escape does the same from the keyboard
    <div className="min-h-0 grow overflow-y-auto px-8 pt-6 pb-10" onClick={onClick}>
      <div className="flex flex-col gap-5">
        <DetailHero
          back={
            <BackLink to="/automations">
              {t('library.automationEditor.automations', 'Automations')}
            </BackLink>
          }
          title={title}
          titleAside={
            isEdited ? (
              <Pill tone="warning">{t('library.automationEditor.edited', 'Edited')}</Pill>
            ) : undefined
          }
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
