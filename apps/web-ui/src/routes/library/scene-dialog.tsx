/**
 * Making a scene or changing one: what to call it, which area it belongs to, how it transitions,
 * and which entities it sets — with the states themselves editable, not just the addresses.
 *
 * Keyed from the outside the way AreaDialog is, so opening Create or Edit always starts from a
 * fresh form rather than whatever the last visit left behind.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type {
  CapabilityState,
  EntityId,
  SceneCreate,
  SceneUpdate,
  SceneView,
} from '@nebula-home/contracts';
import { Button, Modal, Segmented, SelectField, TextField } from '@nebula-home/ui';

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
  const { target, onClose, onSaved, onDeleted } = props;
  const queryClient = useQueryClient();
  const existing = target?.mode === 'edit' ? target.scene : undefined;
  const { areas } = useAreas();

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
  const [addEntityId, setAddEntityId] = useState('');
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
  const addable = (entities.data ?? []).filter(
    (entity) => isSceneEntity(entity) && !taken.has(entity.entityId),
  );

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
   * Adds the chosen entity, seeded from its current state.
   */
  const addMember = (): void => {
    const entity = (entities.data ?? []).find((one) => one.entityId === addEntityId);

    if (entity === undefined) {
      return;
    }

    setMembers([
      ...members,
      {
        entityId: entity.entityId,
        targetState: seedTargetState(entity),
        transitionSeconds: null,
      },
    ]);
    setAddEntityId('');
  };

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
        ) : (
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
          options={[
            { value: '', label: 'None' },
            ...areas.map((area) => ({ value: area.id, label: area.name })),
          ]}
          value={areaId}
          onChange={setAreaId}
        />

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

        <div className="flex flex-col gap-3">
          <h3 className="text-caption font-medium text-foreground-muted">Members</h3>

          {members.length === 0 ? (
            <p className="text-ui text-foreground-subtle">
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
                    className="flex flex-col gap-3 rounded-panel border border-border face-card p-3.5"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 grow">
                        <p className="truncate text-ui font-medium text-foreground">{title}</p>
                        <p className="truncate text-caption text-foreground-subtle">
                          {areaName ?? member.entityId}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="compact"
                        disabled={isBusy}
                        onClick={() => {
                          setMembers(members.filter((member, at) => at !== index));
                        }}
                      >
                        Remove
                      </Button>
                    </div>

                    <SceneMemberFields
                      targetState={member.targetState}
                      onChange={(targetState) => {
                        setMembers(
                          members.map((entry, i) =>
                            i === index ? { ...entry, targetState } : entry,
                          ),
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
                      value={
                        member.transitionSeconds === null ? '' : String(member.transitionSeconds)
                      }
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

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 grow">
              <SelectField
                label="Add entity"
                size="compact"
                options={
                  addable.length === 0
                    ? [{ value: '', label: 'Nothing left to add' }]
                    : [
                        { value: '', label: 'Choose one…' },
                        ...addable.map((entity) => ({
                          value: entity.entityId,
                          label:
                            entity.areaName === null
                              ? entity.name
                              : `${entity.name} · ${entity.areaName}`,
                        })),
                      ]
                }
                value={addEntityId}
                onChange={setAddEntityId}
              />
            </div>
            <Button
              variant="ghost"
              size="compact"
              disabled={addEntityId === '' || isBusy}
              onClick={addMember}
            >
              Add
            </Button>
          </div>
        </div>

        {problem === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {problem}
          </p>
        )}
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
