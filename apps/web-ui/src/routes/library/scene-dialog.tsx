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
import { useTranslation } from 'react-i18next';

import type {
  CapabilityState,
  EntityId,
  EntityView,
  JsonObject,
  SceneCreate,
  SceneUnresolvedMember,
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
  toast,
} from '@nebulahome/ui';

import { areaChoices } from '@/lib/area-tree';
import { toMessage } from '@/lib/error-message';
import {
  createScene,
  deleteScene,
  fetchEntities,
  fetchScenes,
  LIBRARY_QUERY_KEYS,
  updateScene,
} from '@/library/api';
import { toKey } from '@/library/automation-draft';
import { entityKindOf } from '@/library/entity-kind';
import { saveJsonFile, scenesFile } from '@/library/library-file';
import {
  isSceneEntity,
  narrowTargetState,
  resolveTargetState,
  seedTargetState,
} from '@/library/scene-target-state';
import { ConfirmRemoval } from '@/routes/library/confirm-removal';
import { BackLink } from '@/routes/library/detail-page';
import { EntityField } from '@/routes/library/entity-field';
import { EntityPicker } from '@/routes/library/entity-picker/entity-picker';
import { EntityTile } from '@/routes/library/entity-tile';
import { LibraryImportFlow, type ImportResult } from '@/routes/library/library-import-flow';
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
  const { t } = useTranslation();

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
  const allScenes = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.scenes,
    /**
     * Reads the scenes, for the keys an imported one must not land on.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The scenes.
     */
    queryFn: async ({ signal }) => fetchScenes(signal),
  });

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
  const [unresolved, setUnresolved] = useState<readonly SceneUnresolvedMember[]>(
    existing?.unresolvedMembers ?? [],
  );
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [timing, setTiming] = useState<string | null>(null);
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
          unresolvedMembers: [...unresolved],
        };

        return createScene(body);
      }

      if (existing === undefined) {
        throw new Error(t('library.sceneDialog.dialogIsShut', 'The dialog is shut'));
      }

      const change: SceneUpdate = {
        name: trimmedName,
        icon,
        areaId: areaId === '' ? null : areaId,
        transitionMs: toMs(seconds),
        rollbackOnPartialFailure: rollback,
        members: payloadMembers,
        unresolvedMembers: [...unresolved],
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
      toast.success({
        title:
          existing === undefined
            ? t('library.sceneDialog.created', '{{name}} created', { name: saved.name })
            : t('library.sceneDialog.saved', '{{name}} saved', { name: saved.name }),
      });
      onSaved(saved);
    },

    /**
     * Says why the save failed.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      toast.error({
        title: t('library.sceneDialog.notSaved', 'The scene was not saved'),
        message: toMessage(error),
      });
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
        toast.success({
          title: t('library.sceneDialog.removed', '{{name}} removed', { name: existing.name }),
        });
        onDeleted(existing.id);
      }
    },

    /**
     * Says why the removal failed.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setConfirming(false);
      toast.error({
        title: t('library.sceneDialog.notRemoved', 'The scene was not removed'),
        message: toMessage(error),
      });
    },
  });

  const isBusy = save.isPending || removing.isPending;

  const taken = new Set(members.map((member) => member.entityId));

  /**
   * Gives a member that was waiting for an entity the one picked, with as much of what it was
   * going to set as that entity takes.
   *
   * @param index - Which waiting member.
   * @param entity - The entity picked for it.
   */
  const resolveMember = (index: number, entity: EntityView): void => {
    const waiting = unresolved[index];

    if (waiting === undefined) {
      return;
    }

    setUnresolved(unresolved.filter((member, at) => at !== index));
    setMembers([
      ...members,
      {
        entityId: entity.entityId,
        targetState: resolveTargetState(waiting.targetState, entity),
        transitionSeconds: waiting.transitionMs === null ? null : toSeconds(waiting.transitionMs),
      },
    ]);
  };

  /** Saves, unless the name or key is wrong. */
  const submit = (): void => {
    if (name.trim() === '') {
      setProblem(t('library.sceneDialog.nameCannotBeBlank', 'The name cannot be blank.'));

      return;
    }

    if (existing === undefined && !KEY_PATTERN.test(key.trim())) {
      setProblem(
        t(
          'library.sceneDialog.keyMustStartWith',
          'The key must start with a letter and use only lower case letters, digits and underscores.',
        ),
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
        label={t('library.sceneDialog.key', 'Key')}
        size="medium"
        value={key}
        required={existing === undefined}
        disabled={existing !== undefined}
        autoComplete="off"
        className="font-mono"
        hint={
          existing === undefined
            ? t(
                'library.sceneDialog.whatTheApiAnd',
                'What the API and automations refer to. It never changes after this.',
              )
            : t('library.sceneDialog.keyNeverChanges', 'The key never changes.')
        }
        onChange={(event) => {
          setKeyFollowing(false);
          setKey(event.target.value);
        }}
      />

      <SelectField
        label={t('library.sceneDialog.area', 'Area')}
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
        label={t('library.sceneDialog.transition', 'Transition')}
        size="medium"
        type="number"
        min={0}
        max={600}
        step={0.1}
        value={String(transitionSeconds)}
        hint={t(
          'library.sceneDialog.seconds0MeansImmediate',
          'Seconds. 0 means immediate. Lights that cannot fade change at once.',
        )}
        onChange={(event) => {
          const next = Number(event.target.value);

          setTransitionSeconds(Number.isFinite(next) ? next : 0);
        }}
      />

      <div className="flex flex-col gap-2">
        <span className="text-caption font-medium text-foreground-muted">
          {t('library.sceneDialog.onPartialFailure', 'On partial failure')}
        </span>
        <Segmented
          label={t('library.sceneDialog.onPartialFailure', 'On partial failure')}
          options={[
            { value: 'leave', label: t('library.sceneDialog.leavePartial', 'Leave partial') },
            { value: 'rollback', label: t('library.sceneDialog.rollBack', 'Roll back') },
          ]}
          value={rollback ? 'rollback' : 'leave'}
          onChange={(value) => {
            setRollback(value === 'rollback');
          }}
        />
        <span className="text-caption text-foreground-subtle">
          {rollback
            ? t(
                'library.sceneDialog.rollBackWhenOne',
                'Roll back: when one entity refuses, the others go back to how they were.',
              )
            : t(
                'library.sceneDialog.leavePartialWhatCould',
                'Leave partial: what could be set stays set.',
              )}
        </span>
      </div>
    </>
  );

  const addButton = (
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
      {t('library.sceneDialog.addToTheScene', 'Add to the scene')}
    </Button>
  );

  const membersBlock = (
    <div className="flex flex-col gap-3">
      {unresolved.length === 0 ? null : (
        <ul className="flex flex-col gap-3">
          {unresolved.map((member, index) => (
            <li
              key={member.entityId}
              className="flex flex-col gap-3 rounded-inner border border-warning-line bg-surface px-3.5 py-3"
            >
              <div className="flex items-center gap-3">
                <AppIcon id="triangle-alert" size={16} className="shrink-0 text-warning" />
                <div className="min-w-0 grow">
                  <p className="truncate font-mono text-ui text-foreground">{member.entityId}</p>
                  <p className="text-caption text-warning">
                    {t(
                      'library.sceneDialog.notInTheHouse',
                      'Not in this house. Pick the entity it stands for; until then the scene cannot be applied.',
                    )}
                  </p>
                </div>
                <IconButton
                  label={t('library.sceneDialog.removeTitle', 'Remove {{title}}', {
                    title: member.entityId,
                  })}
                  disabled={isBusy}
                  onClick={() => {
                    setUnresolved(unresolved.filter((entry, at) => at !== index));
                  }}
                >
                  <AppIcon id="x" size={14} />
                </IconButton>
              </div>
              <EntityField
                label={t('library.sceneDialog.standsFor', 'Stands for')}
                value={entityById.has(member.entityId) ? member.entityId : ''}
                accept={(entity) => isSceneEntity(entity) && !taken.has(entity.entityId)}
                onChange={(entityId, entity) => {
                  if (entity !== undefined) {
                    resolveMember(index, entity);
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {members.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong px-5 py-4 text-ui text-foreground-subtle">
          {t(
            'library.sceneDialog.noneYetAddAn',
            'None yet. Add an entity to capture what it is on right now.',
          )}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {members.map((member, index) => {
            const entity = entityById.get(member.entityId);
            const title = entity?.name ?? member.entityId;
            const areaName = entity?.areaName;
            const isOpen = !closed.has(member.entityId);

            return (
              <li key={member.entityId} className="rounded-inner border border-border bg-surface">
                <div className="flex items-center gap-3 px-3.5 py-3">
                  {entity === undefined ? (
                    <span className="size-8 shrink-0 rounded-field bg-surface-raised" />
                  ) : (
                    <EntityTile
                      size="medium"
                      icon={undefined}
                      kind={entityKindOf(entity)}
                      isActive={null}
                      isAvailable={entity.isAvailable}
                    />
                  )}
                  <div className="min-w-0 grow">
                    <p className="truncate text-ui font-medium text-foreground">{title}</p>
                    <p className="truncate text-caption text-foreground-subtle">
                      {areaName === null || areaName === undefined ? null : `${areaName} · `}
                      <span className="font-mono">{member.entityId}</span>
                    </p>
                  </div>
                  {timing === member.entityId ? (
                    <input
                      type="number"
                      min={0}
                      max={600}
                      step={0.1}
                      // The field it opens is the next thing the person types in.
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      aria-label={t(
                        'library.sceneDialog.transitionForTitle',
                        'Transition of {{title}}, in seconds',
                        { title },
                      )}
                      placeholder={t('library.sceneDialog.asTheScene', 'As the scene')}
                      className="h-7 w-28 rounded-field border border-border-strong bg-surface-raised px-2 font-mono text-mono-ui text-foreground outline-none focus-visible:ring-3 focus-visible:ring-primary/25"
                      defaultValue={
                        member.transitionSeconds === null ? '' : String(member.transitionSeconds)
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === 'Escape') {
                          event.currentTarget.blur();
                        }
                      }}
                      onBlur={(event) => {
                        const raw = event.target.value.trim();
                        const next = Number(raw);

                        setTiming(null);
                        setMembers(
                          members.map((entry, i) =>
                            i === index
                              ? {
                                  ...entry,
                                  transitionSeconds:
                                    raw === '' || !Number.isFinite(next)
                                      ? null
                                      : clampSeconds(next),
                                }
                              : entry,
                          ),
                        );
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      title={t('library.sceneDialog.changeTransition', 'Change its transition')}
                      className={
                        member.transitionSeconds === null
                          ? 'hidden rounded-field px-1.5 text-caption text-foreground-subtle hover:text-foreground sm:inline'
                          : 'hidden rounded-field px-1.5 text-caption text-foreground-muted hover:text-foreground sm:inline'
                      }
                      onClick={() => {
                        setTiming(member.entityId);
                      }}
                    >
                      {member.transitionSeconds === null
                        ? t('library.sceneDialog.transitionAsTheScene', 'Transition as the scene')
                        : t('library.sceneDialog.transitionSeconds', 'Transition {{seconds}} s', {
                            seconds: String(member.transitionSeconds),
                          })}
                    </button>
                  )}
                  <IconButton
                    label={t('library.sceneDialog.removeFromTheScene', 'Remove from the scene')}
                    size="small"
                    disabled={isBusy}
                    onClick={() => {
                      setMembers(members.filter((member, at) => at !== index));
                    }}
                  >
                    <AppIcon id="x" size={14} />
                  </IconButton>
                  <IconButton
                    label={
                      isOpen
                        ? t('library.sceneDialog.closeTitle', 'Close {{title}}', { title })
                        : t('library.sceneDialog.openTitle', 'Open {{title}}', { title })
                    }
                    size="small"
                    aria-expanded={isOpen}
                    onClick={() => {
                      const next = new Set(closed);

                      if (isOpen) {
                        next.add(member.entityId);
                      } else {
                        next.delete(member.entityId);
                      }

                      setClosed(next);
                    }}
                  >
                    <AppIcon id={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                  </IconButton>
                </div>

                {isOpen ? (
                  <div className="flex flex-col gap-3.5 px-4 pt-0.5 pb-4 sm:pl-19">
                    {entity !== undefined && !entity.isAvailable ? (
                      <p className="flex items-center gap-1.5 text-ui-sm text-warning">
                        <AppIcon id="triangle-alert" size={14} />
                        {t(
                          'library.sceneDialog.unavailableKeepsValues',
                          'Unavailable now · it keeps the values it last had.',
                        )}
                      </p>
                    ) : null}
                    <SceneMemberFields
                      targetState={member.targetState}
                      entity={entity}
                      onChange={(targetState) => {
                        setMembers(
                          members.map((entry, i) =>
                            i === index ? { ...entry, targetState } : entry,
                          ),
                        );
                      }}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {presentation === 'page' ? null : addButton}
      <EntityPicker
        isOpen={isAdding}
        title={t('library.sceneDialog.addToTheScene', 'Add to the scene')}
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

  /** Hands over the scene as it stands in the form, as a file. */
  const exportScene = (): void => {
    saveJsonFile(
      scenesFile([
        {
          id: existing?.id ?? '',
          key: key.trim(),
          name: name.trim(),
          icon,
          areaKey: areas.find((area) => area.id === areaId)?.key ?? null,
          transitionMs: toMs(clampSeconds(transitionSeconds)),
          rollbackOnPartialFailure: rollback,
          members: members.map((member) => ({
            entityId: member.entityId,
            entityName: entityById.get(member.entityId)?.name ?? member.entityId,
            targetState: member.targetState as JsonObject,
            transitionMs:
              member.transitionSeconds === null
                ? null
                : toMs(clampSeconds(member.transitionSeconds)),
          })),
          unresolvedMembers: [...unresolved],
        },
      ]),
      `${key.trim() === '' ? 'scene' : key.trim()}.scenes.json`,
    );
  };

  /**
   * Puts a scene from a file into the form, in place of what it held. A scene that exists keeps
   * its key, which nothing may move.
   *
   * @param result - What the import produced.
   */
  const importScene = (result: ImportResult): void => {
    const [item] = result.kind === 'scenes' ? result.items : [];

    if (item === undefined) {
      return;
    }

    setName(item.name);

    if (existing === undefined) {
      setKey(item.key);
      setKeyFollowing(false);
    }

    setIcon(item.icon);
    setAreaId(
      item.areaKey === null ? '' : (areas.find((area) => area.key === item.areaKey)?.id ?? ''),
    );
    setTransitionSeconds(toSeconds(item.transitionMs));
    setRollback(item.rollbackOnPartialFailure);
    setMembers(
      item.members.map((member) => ({
        entityId: member.entityId as EntityId,
        targetState: narrowTargetState(member.targetState),
        transitionSeconds: member.transitionMs === null ? null : toSeconds(member.transitionMs),
      })),
    );
    setUnresolved(
      item.unresolvedMembers.map((member) => ({
        ...member,
        entityId: member.entityId as EntityId,
      })),
    );
    toast.success({
      title: t('library.sceneDialog.importedTitle', 'Brought into the form'),
      message: t('library.sceneDialog.importedNote', 'Save it to keep it.'),
    });
  };

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
        <div className="flex flex-col gap-5">
          <DetailHero
            back={<BackLink to="/scenes">{t('library.sceneDialog.scenes', 'Scenes')}</BackLink>}
            title={
              existing === undefined
                ? t('library.sceneDialog.newScene', 'New scene')
                : existing.name
            }
            actions={
              confirm ?? (
                <>
                  {existing === undefined || onApply === undefined ? null : (
                    <Button
                      variant="ghost"
                      disabled={isBusy || existing.unresolvedMembers.length > 0}
                      title={
                        existing.unresolvedMembers.length > 0
                          ? t(
                              'library.sceneDialog.cannotApplyYet',
                              'Some members wait for an entity: pick them first.',
                            )
                          : undefined
                      }
                      onClick={() => {
                        onApply(existing.id);
                      }}
                    >
                      <AppIcon id="play" size={15} />
                      {t('library.sceneDialog.applyNow', 'Apply now')}
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
                      {t('common.delete', 'Delete')}
                    </Button>
                  )}
                  <Button variant="bare" disabled={isBusy} onClick={onClose}>
                    {t('common.cancel', 'Cancel')}
                  </Button>
                  <Button isBusy={save.isPending} disabled={removing.isPending} onClick={submit}>
                    <AppIcon id="check" size={15} />
                    {existing === undefined
                      ? t('common.create', 'Create')
                      : t('common.save', 'Save')}
                  </Button>
                </>
              )
            }
          />
          {problemLine}
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Section
              title={t('library.sceneDialog.members', 'Members')}
              note={t('library.sceneDialog.membersNote', {
                count: members.length + unresolved.length,
                defaultValue_one:
                  '{{count}} entity · each added with its current state, then changed here.',
                defaultValue_other:
                  '{{count}} entities · each added with its current state, then changed here.',
              })}
              actions={addButton}
            >
              {membersBlock}
            </Section>
            <div className="flex flex-col gap-4">
              <Panel title={t('library.sceneDialog.whatItIs', 'What it is')}>
                <div className="flex flex-col gap-3.5 border-t border-border px-5.5 py-4">
                  {identity}
                </div>
              </Panel>
              <Panel title={t('library.sceneDialog.howItApplies', 'How it applies')}>
                <div className="flex flex-col gap-3.5 border-t border-border px-5.5 py-4">
                  {applying}
                </div>
              </Panel>
              <Panel title={t('library.sceneDialog.file', 'File')}>
                <div className="flex flex-col gap-3 border-t border-border px-5.5 py-4">
                  <p className="text-caption text-foreground-subtle">
                    {t(
                      'library.sceneDialog.fileNote',
                      'As one .json file, to keep or to bring into another house. Import also reads Home Assistant scenes.',
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="compact" onClick={exportScene}>
                      <AppIcon id="download" size={14} />
                      {t('library.sceneDialog.export', 'Export')}
                    </Button>
                    <LibraryImportFlow
                      kind="scenes"
                      isSingle
                      takenKeys={(allScenes.data ?? [])
                        .filter((scene) => scene.id !== existing?.id)
                        .map((scene) => scene.key)}
                      onImport={importScene}
                    >
                      {(choose) => (
                        <Button variant="ghost" size="compact" onClick={choose}>
                          <AppIcon id="upload" size={14} />
                          {t('library.sceneDialog.import', 'Import')}
                        </Button>
                      )}
                    </LibraryImportFlow>
                  </div>
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
      title={
        existing === undefined
          ? t('library.sceneDialog.newScene', 'New scene')
          : t('library.sceneDialog.configureName', 'Configure {{name}}', { name: existing.name })
      }
      description={
        existing === undefined
          ? t(
              'library.sceneDialog.savedSetOfStates',
              'A saved set of states. Each entity you add starts from what it is reading now.',
            )
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
                {t('common.remove', 'Remove')}
              </Button>
            )}
            <Button variant="ghost" disabled={isBusy} onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button isBusy={save.isPending} disabled={removing.isPending} onClick={submit}>
              {existing === undefined ? t('common.create', 'Create') : t('common.save', 'Save')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {identity}
        {applying}
        <div className="flex flex-col gap-3">
          <h3 className="text-caption font-medium text-foreground-muted">
            {t('library.sceneDialog.members', 'Members')}
          </h3>
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
