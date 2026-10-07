/**
 * Making a scene or changing one: what to call it, which area it belongs to, how it transitions,
 * and which entities it sets — with the states themselves editable, not just the addresses.
 *
 * Keyed from the outside the way AreaDialog is, so opening Create or Edit always starts from a
 * fresh form rather than whatever the last visit left behind.
 *
 * Drawn two ways from the one form: the scene's own page, as the board draws it - its members in
 * the main column, What it is and How it applies beside them, Apply now, Delete and Save in the
 * header - and a dialog, for wherever a scene is made without leaving the page it is made from.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type {
  CapabilityState,
  EntityId,
  EntityView,
  SceneCreate,
  SceneUpdate,
  SceneView,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  DetailHero,
  IconButton,
  Modal,
  Panel,
  Section,
  Segmented,
  SelectField,
  TextField,
} from '@nebulahome/ui';

import { areaChoices } from '@/lib/area-tree';
import { toMessage } from '@/lib/error-message';
import {
  createScene,
  deleteScene,
  fetchEntities,
  LIBRARY_QUERY_KEYS,
  updateScene,
} from '@/library/api';
import { toKey } from '@/library/automation-draft';
import { isSceneEntity, narrowTargetState, seedTargetState } from '@/library/scene-target-state';
import { ConfirmRemoval } from '@/routes/library/confirm-removal';
import { BackLink } from '@/routes/library/detail-page';
import { EntityPicker } from '@/routes/library/entity-picker/entity-picker';
import { NameIconField } from '@/routes/library/name-icon-field';
import { SceneMemberFields } from '@/routes/library/scene-member-fields';
import { useAreas } from '@/routes/library/use-areas';

/** What the dialog is for: a new scene, or one that exists. */
export type SceneDialogTarget =
  { readonly mode: 'create' } | { readonly mode: 'edit'; readonly scene: SceneView };

/** One member as the form holds it. */
export type SceneMemberDraft = {
  readonly entityId: EntityId;
  readonly targetState: CapabilityState;
  /** Seconds; null means the scene's own transition. */
  readonly transitionSeconds: number | null;
};

/** What the dialog needs. */
export type SceneDialogProps = {
  /** What it is for, or null while it is shut. */
  readonly target: SceneDialogTarget | null;

  /** Called when the dialog should shut, saved or not. */
  readonly onClose: () => void;

  /** Called with the scene as the server now has it. */
  readonly onSaved: (scene: SceneView) => void;

  /** Called with the id of the scene that was removed. */
  readonly onDeleted: (id: string) => void;

  /** Whether it is a dialog over the list, or the scene's own page. */
  readonly presentation?: 'dialog' | 'page';

  /** Applies the scene, from its page. */
  readonly onApply?: (id: string) => void;
};

/** Keys the API accepts. */
const KEY_PATTERN = /^[a-z][a-z0-9_]{1,62}$/u;

/**
 * Turns seconds typed in the form into milliseconds for the API.
 *
 * @param seconds - What was typed, already clamped.
 * @returns Milliseconds.
 */
function toMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

/**
 * Turns a stored transition into seconds for the form.
 *
 * @param ms - Milliseconds from the scene or member.
 * @returns Seconds.
 */
function toSeconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

/**
 * Builds the member drafts from a saved scene.
 *
 * @param scene - The scene being edited.
 * @returns The drafts.
 */
function draftsFromScene(scene: SceneView): SceneMemberDraft[] {
  return scene.members.map((member) => ({
    entityId: member.entityId,
    targetState: narrowTargetState(member.targetState),
    transitionSeconds: member.transitionMs === null ? null : toSeconds(member.transitionMs),
  }));
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link SceneDialogProps}.
 * @returns The dialog.
 */
export function SceneDialog(props: SceneDialogProps) {
  const { target, onClose, onSaved, onDeleted, presentation = 'dialog', onApply } = props;
  const queryClient = useQueryClient();
  const existing = target?.mode === 'edit' ? target.scene : undefined;
  const { areas, tree } = useAreas();

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    /**
     * Reads every entity, for the picker and for seeding.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the dialog goes away.
     * @returns Every entity.
     */
    queryFn: async ({ signal }) => fetchEntities(signal),
  });

  const entityById = new Map((entities.data ?? []).map((entity) => [entity.entityId, entity]));

  const [name, setName] = useState(existing?.name ?? '');
  const [key, setKey] = useState(existing?.key ?? '');
  const [isKeyFollowing, setKeyFollowing] = useState(existing === undefined);
  const [icon, setIcon] = useState<string | null>(existing?.icon ?? null);
  const [areaId, setAreaId] = useState<string>(() => {
    if (existing?.areaKey === null || existing?.areaKey === undefined) {
      return '';
    }

    return areas.find((area) => area.key === existing.areaKey)?.id ?? '';
  });
  const [transitionSeconds, setTransitionSeconds] = useState(
    existing === undefined ? 0 : toSeconds(existing.transitionMs),
  );
  const [rollback, setRollback] = useState(existing?.rollbackOnPartialFailure ?? false);
  const [members, setMembers] = useState<SceneMemberDraft[]>(() =>
    existing === undefined ? [] : draftsFromScene(existing),
  );
  const [isAdding, setAdding] = useState(false);
  const [isConfirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /** Reads the scenes list again. */
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.scenes });
  };

  const save = useMutation({
    /**
     * Makes the scene, or sends what changed on it.
     *
     * @returns The scene as it now stands.
     */
    mutationFn: async (): Promise<SceneView> => {
      const trimmedName = name.trim();
      const trimmedKey = key.trim();
      const seconds = clampSeconds(transitionSeconds);
      const payloadMembers = members.map((member) => ({
        entityId: member.entityId,
        targetState: member.targetState,
        transitionMs:
          member.transitionSeconds === null ? null : toMs(clampSeconds(member.transitionSeconds)),
      }));

      if (target?.mode === 'create') {
        const body: SceneCreate = {
          key: trimmedKey,
          name: trimmedName,
          icon,
          areaId: areaId === '' ? null : areaId,
          transitionMs: toMs(seconds),
          rollbackOnPartialFailure: rollback,
          members: payloadMembers,
        };

        return createScene(body);
      }

      if (existing === undefined) {
        throw new Error('The dialog is shut');
      }

      const change: SceneUpdate = {
        name: trimmedName,
        icon,
        areaId: areaId === '' ? null : areaId,
        transitionMs: toMs(seconds),
        rollbackOnPartialFailure: rollback,
        members: payloadMembers,
      };

      return updateScene(existing.id, change);
    },

    /**
     * Hands the scene back once the list has it.
     *
     * @param saved - The scene as the server has it.
     */
    onSuccess: async (saved) => {
      await refresh();
      onSaved(saved);
    },

    /**
     * Shows why the save failed.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setProblem(toMessage(error));
    },
  });

  const removing = useMutation({
    /** Removes the scene. */
    mutationFn: async (): Promise<void> => {
      if (existing !== undefined) {
        await deleteScene(existing.id);
      }
    },

    /** Tells the page once the list has let go of it. */
    onSuccess: async () => {
      await refresh();

      if (existing !== undefined) {
        onDeleted(existing.id);
      }
    },

    /**
     * Shows why the removal failed.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setConfirming(false);
      setProblem(toMessage(error));
    },
  });

  const isBusy = save.isPending || removing.isPending;

  const taken = new Set(members.map((member) => member.entityId));

  /** Saves, unless the name or key is wrong. */
  const submit = (): void => {
    if (name.trim() === '') {
      setProblem('The name cannot be blank.');

      return;
    }

    if (existing === undefined && !KEY_PATTERN.test(key.trim())) {
      setProblem(
        'The key must start with a letter and use only lower case letters, digits and underscores.',
      );

      return;
    }

    setProblem(null);
    save.mutate();
  };

  /**
   * Adds the chosen entities, each seeded from its current state.
   *
   * @param chosen - The entities picked.
   */
  const addMembers = (chosen: readonly EntityView[]): void => {
    setMembers([
      ...members,
      ...chosen.map((entity) => ({
        entityId: entity.entityId,
        targetState: seedTargetState(entity),
        transitionSeconds: null,
      })),
    ]);
  };

  const identity = (
    <>
      <NameIconField
        value={name}
        required
        onChange={(next) => {
          setName(next);

          if (isKeyFollowing) {
            setKey(toKey(next));
          }
        }}
        icon={icon}
        onIconChange={(view) => {
          setIcon(view.id);
        }}
      />

      <TextField
        label="Key"
        size="medium"
        value={key}
        required={existing === undefined}
        disabled={existing !== undefined}
        autoComplete="off"
        className="font-mono"
        hint={
          existing === undefined
            ? 'What the API and automations refer to. It never changes after this.'
            : 'The key never changes.'
        }
        onChange={(event) => {
          setKeyFollowing(false);
          setKey(event.target.value);
        }}
      />

      <SelectField
        label="Area"
        size="medium"
        options={areaChoices(tree)}
        value={areaId}
        onChange={setAreaId}
      />
    </>
  );

  const applying = (
    <>
      <TextField
        label="Transition"
        size="medium"
        type="number"
        min={0}
        max={600}
        step={0.1}
        value={String(transitionSeconds)}
        hint="Seconds. 0 means immediate."
        onChange={(event) => {
          const next = Number(event.target.value);

          setTransitionSeconds(Number.isFinite(next) ? next : 0);
        }}
      />

      <div className="flex flex-col gap-2">
        <span className="text-caption font-medium text-foreground-muted">On partial failure</span>
        <Segmented
          label="On partial failure"
          options={[
            { value: 'leave', label: 'Leave partial' },
            { value: 'rollback', label: 'Roll back' },
          ]}
          value={rollback ? 'rollback' : 'leave'}
          onChange={(value) => {
            setRollback(value === 'rollback');
          }}
        />
        <span className="text-caption text-foreground-subtle">
          {rollback
            ? 'Roll back: when one entity refuses, the others go back to how they were.'
            : 'Leave partial: what could be set stays set.'}
        </span>
      </div>
    </>
  );

  const membersBlock = (
    <div className="flex flex-col gap-3">
      {members.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong px-5 py-4 text-ui text-foreground-subtle">
          None yet. Add an entity to capture what it is on right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {members.map((member, index) => {
            const entity = entityById.get(member.entityId);
            const title = entity?.name ?? member.entityId;
            const areaName = entity?.areaName;

            return (
              <li
                key={member.entityId}
                className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 grow">
                    <p className="truncate text-ui font-medium text-foreground">{title}</p>
                    <p className="truncate text-caption text-foreground-subtle">
                      {areaName ?? member.entityId}
                      {entity !== undefined && !entity.isAvailable ? (
                        <span className="text-warning"> · Unavailable now</span>
                      ) : null}
                    </p>
                  </div>
                  <IconButton
                    label={`Remove ${title}`}
                    disabled={isBusy}
                    onClick={() => {
                      setMembers(members.filter((member, at) => at !== index));
                    }}
                  >
                    <AppIcon id="x" size={14} />
                  </IconButton>
                </div>

                <SceneMemberFields
                  targetState={member.targetState}
                  onChange={(targetState) => {
                    setMembers(
                      members.map((entry, i) => (i === index ? { ...entry, targetState } : entry)),
                    );
                  }}
                />

                <TextField
                  label="Transition"
                  size="compact"
                  type="number"
                  min={0}
                  max={600}
                  step={0.1}
                  value={member.transitionSeconds === null ? '' : String(member.transitionSeconds)}
                  hint="Seconds for this entity only. Leave blank for the scene default."
                  onChange={(event) => {
                    const raw = event.target.value.trim();

                    setMembers(
                      members.map((entry, i) => {
                        if (i !== index) {
                          return entry;
                        }

                        if (raw === '') {
                          return { ...entry, transitionSeconds: null };
                        }

                        const next = Number(raw);

                        return {
                          ...entry,
                          transitionSeconds: Number.isFinite(next) ? next : null,
                        };
                      }),
                    );
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}

      <Button
        variant="ghost"
        size="compact"
        className="self-start"
        disabled={isBusy}
        onClick={() => {
          setAdding(true);
        }}
      >
        <AppIcon id="plus" size={14} />
        Add entities
      </Button>
      <EntityPicker
        isOpen={isAdding}
        title="Add to the scene"
        isMultiple
        accept={(entity) => isSceneEntity(entity) && !taken.has(entity.entityId)}
        onClose={() => {
          setAdding(false);
        }}
        onChoose={(chosen) => {
          addMembers(chosen);
          setAdding(false);
        }}
      />
    </div>
  );

  const confirm =
    isConfirming && existing !== undefined ? (
      <ConfirmRemoval
        question={`Remove ${existing.name}? Applying it will no longer be possible.`}
        isBusy={removing.isPending}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          removing.mutate();
        }}
      />
    ) : null;

  const problemLine =
    problem === null ? null : (
      <p role="alert" className="text-ui text-danger">
        {problem}
      </p>
    );

  if (presentation === 'page') {
    return (
      <div className="min-h-0 grow overflow-y-auto px-8 pt-6 pb-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          <DetailHero
            back={<BackLink to="/scenes">Scenes</BackLink>}
            title={existing === undefined ? 'New scene' : existing.name}
            actions={
              confirm ?? (
                <>
                  {existing === undefined || onApply === undefined ? null : (
                    <Button
                      variant="ghost"
                      disabled={isBusy}
                      onClick={() => {
                        onApply(existing.id);
                      }}
                    >
                      <AppIcon id="play" size={15} />
                      Apply now
                    </Button>
                  )}
                  {existing === undefined ? null : (
                    <Button
                      variant="danger"
                      disabled={isBusy}
                      onClick={() => {
                        setProblem(null);
                        setConfirming(true);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                  <Button variant="bare" disabled={isBusy} onClick={onClose}>
                    Cancel
                  </Button>
                  <Button isBusy={save.isPending} disabled={removing.isPending} onClick={submit}>
                    <AppIcon id="check" size={15} />
                    {existing === undefined ? 'Create' : 'Save'}
                  </Button>
                </>
              )
            }
          />
          {problemLine}
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Section title="Members" note="What the scene sets, each entity with what it is told.">
              {membersBlock}
            </Section>
            <div className="flex flex-col gap-4">
              <Panel title="What it is">
                <div className="flex flex-col gap-3.5 border-t border-border px-5.5 py-4">
                  {identity}
                </div>
              </Panel>
              <Panel title="How it applies">
                <div className="flex flex-col gap-3.5 border-t border-border px-5.5 py-4">
                  {applying}
                </div>
              </Panel>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      size="large"
      title={existing === undefined ? 'New scene' : `Configure ${existing.name}`}
      description={
        existing === undefined
          ? 'A saved set of states. Each entity you add starts from what it is reading now.'
          : undefined
      }
      footer={
        confirm ?? (
          <>
            {existing === undefined ? null : (
              <Button
                variant="danger"
                disabled={isBusy}
                className="mr-auto"
                onClick={() => {
                  setProblem(null);
                  setConfirming(true);
                }}
              >
                Remove
              </Button>
            )}
            <Button variant="ghost" disabled={isBusy} onClick={onClose}>
              Cancel
            </Button>
            <Button isBusy={save.isPending} disabled={removing.isPending} onClick={submit}>
              {existing === undefined ? 'Create' : 'Save'}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {identity}
        {applying}
        <div className="flex flex-col gap-3">
          <h3 className="text-caption font-medium text-foreground-muted">Members</h3>
          {membersBlock}
        </div>
        {problemLine}
      </div>
    </Modal>
  );
}

/**
 * Clamps a transition into the 0–600 second range the form accepts.
 *
 * @param seconds - What was typed.
 * @returns The clamped figure.
 */
function clampSeconds(seconds: number): number {
  return Math.min(600, Math.max(0, seconds));
}
