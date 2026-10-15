/**
 * Adding a floor or a room, or changing one: what to call it, for a room what it is drawn as,
 * and - for one that exists - a Remove that says what goes with it.
 *
 * The parent is decided by the button that opened the dialog - "Add floor" on the house, "Add
 * room" on a floor - and is not a field: a room made from a floor's own row is a room on that
 * floor, and asking again would be asking somebody to say where they are standing.
 *
 * A floor has a name and a number and nothing else: it is a level, not a thing with a look of
 * its own, and an icon on it would be an icon for the sake of the field. The number is which
 * storey it is - 0 the ground, 1 the one above, -1 the cellar - whatever it is called, and it is
 * what floors are ordered by everywhere; two floors cannot share one, so a new floor starts on
 * the first free number above the others and a taken one is refused before it is sent. A room
 * is drawn - a kitchen, a study - so a room picks an icon.
 *
 * Only what changed is sent, so the audit trail says what actually changed.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FLOOR_LEVEL_MAXIMUM,
  FLOOR_LEVEL_MINIMUM,
  type AreaKind,
  type AreaUpdate,
  type AreaView,
} from '@nebulahome/contracts';
import { Button, Modal, TextField } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { isApiError } from '@/lib/api-error';
import { describeRemoval, type RemovalImpact } from '@/lib/area-tree';
import { toMessage } from '@/lib/error-message';
import { createArea, deleteArea, LIBRARY_QUERY_KEYS, updateArea } from '@/library/api';
import { ConfirmRemoval } from '@/routes/library/confirm-removal';
import { NameIconField } from '@/routes/library/name-icon-field';

/** What the dialog is for: a new floor or room under a parent, or one that exists. */
export type AreaDialogTarget =
  | {
      readonly mode: 'create';
      readonly kind: Exclude<AreaKind, 'house'>;
      readonly parent: AreaView;
    }
  | { readonly mode: 'edit'; readonly area: AreaView };

/** What the dialog needs. */
export type AreaDialogProps = {
  /** What it is for, or null while it is shut. */
  readonly target: AreaDialogTarget | null;

  /** What removing the area would take with it; only read for one that exists. */
  readonly removal: RemovalImpact;

  /** Every floor in the house, for the numbers already taken. */
  readonly floors?: readonly AreaView[];

  /** Called when the dialog should shut, saved or not. */
  readonly onClose: () => void;

  /** Called with the area as the server now has it. */
  readonly onSaved: (area: AreaView) => void;

  /** Called with the id of the area that was removed. */
  readonly onDeleted: (id: string) => void;
};

/**
 * The number a new floor starts on: the one above the highest, or the ground for the first.
 *
 * @param floors - The floors there are.
 * @returns The number.
 */
export function nextFloorLevel(floors: readonly AreaView[]): number {
  const levels = floors.flatMap((floor) => (floor.level === null ? [] : [floor.level]));

  return levels.length === 0 ? 0 : Math.min(Math.max(...levels) + 1, FLOOR_LEVEL_MAXIMUM);
}

/**
 * Reads a typed floor number, or says what is wrong with it.
 *
 * @param typed - What is in the field.
 * @param floors - The floors there are.
 * @param selfId - The floor being changed, which may keep its own number.
 * @returns The number, or a sentence saying why it will not do.
 */
export function readFloorLevel(
  typed: string,
  floors: readonly AreaView[],
  selfId: string | undefined,
): { readonly level: number } | { readonly problem: string } {
  const trimmed = typed.trim();
  const level = Number(trimmed);

  if (trimmed === '' || !Number.isInteger(level)) {
    return {
      problem: translate(
        'library.areaDialog.floorNumberIsA',
        'The floor number is a whole number: 0 for the ground floor.',
      ),
    };
  }

  if (level < FLOOR_LEVEL_MINIMUM || level > FLOOR_LEVEL_MAXIMUM) {
    return {
      problem: translate(
        'library.areaDialog.floorNumberGoesFrom',
        'The floor number goes from {{min}} to {{max}}.',
        {
          min: FLOOR_LEVEL_MINIMUM,
          max: FLOOR_LEVEL_MAXIMUM,
        },
      ),
    };
  }

  const holder = floors.find((floor) => floor.level === level && floor.id !== selfId);

  return holder === undefined
    ? { level }
    : {
        problem: translate(
          'library.areaDialog.nameIsAlreadyFloor',
          '{{name}} is already floor {{level}}.',
          { name: holder.name, level: String(level) },
        ),
      };
}

/**
 * What the server said about the floor number, when a refusal was about it: the number another
 * floor already has (a `409`), or one out of range (a `400`).
 *
 * @param error - What the request threw.
 * @returns The sentence for the field, or null for a refusal about something else.
 */
function levelIssueOf(error: unknown): string | null {
  if (!isApiError(error)) {
    return null;
  }

  const issues = error.details['issues'];
  const found = Array.isArray(issues)
    ? issues.find(
        (issue: unknown): issue is { readonly path: string; readonly message: string } =>
          typeof issue === 'object' &&
          issue !== null &&
          (issue as { path?: unknown }).path === 'level' &&
          typeof (issue as { message?: unknown }).message === 'string',
      )
    : undefined;

  if (found === undefined) {
    return null;
  }

  // A conflict's own message names the floor that has the number; a validation's is generic.
  return error.code === 'CONFLICT' ? error.message : found.message;
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link AreaDialogProps}.
 * @returns The dialog.
 */
export function AreaDialog(props: AreaDialogProps) {
  const { t } = useTranslation();

  const { target, removal, floors = [], onClose, onSaved, onDeleted } = props;
  const queryClient = useQueryClient();
  const existing = target?.mode === 'edit' ? target.area : undefined;
  const kind = target === null ? 'room' : target.mode === 'create' ? target.kind : target.area.kind;

  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState<string | null>(existing?.icon ?? null);
  const [levelText, setLevelText] = useState(() =>
    String(existing?.level ?? nextFloorLevel(floors)),
  );
  const [isConfirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [levelProblem, setLevelProblem] = useState<string | null>(null);

  /** Reads everything that shows areas again. */
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.areas }),
      queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices }),
      queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities }),
    ]);
  };

  const save = useMutation({
    /**
     * Makes the area, or sends what changed on it.
     *
     * @param level - A floor's number, as read from its field; null for a room.
     * @returns The area as it now stands.
     */
    mutationFn: async (level: number | null): Promise<AreaView> => {
      const trimmed = name.trim();

      if (target?.mode === 'create') {
        return createArea({
          kind: target.kind,
          name: trimmed,
          parentId: target.parent.id,
          ...(icon === null ? {} : { icon }),
          ...(level === null ? {} : { level }),
        });
      }

      if (existing === undefined) {
        throw new Error(t('library.areaDialog.dialogIsShut', 'The dialog is shut'));
      }

      const change: AreaUpdate = {
        ...(trimmed === existing.name ? {} : { name: trimmed }),
        ...(icon === existing.icon ? {} : { icon }),
        ...(level === null || level === existing.level ? {} : { level }),
      };

      return Object.keys(change).length === 0 ? existing : updateArea(existing.id, change);
    },

    /**
     * Hands the area back once every list has it.
     *
     * @param saved - The area as the server has it.
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
      const onLevel = levelIssueOf(error);

      if (onLevel === null) {
        setProblem(toMessage(error));
      } else {
        setLevelProblem(onLevel);
      }
    },
  });

  const removing = useMutation({
    /** Removes the area. */
    mutationFn: async (): Promise<void> => {
      if (existing !== undefined) {
        await deleteArea(existing.id);
      }
    },

    /** Tells the page once every list has let go of it. */
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

  /** Saves, unless the name is blank or a floor's number will not do. */
  const submit = (): void => {
    if (name.trim() === '') {
      setProblem(t('library.areaDialog.nameCannotBeBlank', 'The name cannot be blank.'));

      return;
    }

    setProblem(null);

    if (kind !== 'floor') {
      save.mutate(null);

      return;
    }

    const reading = readFloorLevel(levelText, floors, existing?.id);

    if ('problem' in reading) {
      setLevelProblem(reading.problem);

      return;
    }

    setLevelProblem(null);
    save.mutate(reading.level);
  };

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      title={
        existing === undefined
          ? t('library.areaDialog.newKind', 'New {{kind}}', { kind })
          : t('library.areaDialog.configureName', 'Configure {{name}}', { name: existing.name })
      }
      description={
        target?.mode === 'create'
          ? kind === 'floor'
            ? t('library.areaDialog.floorIn', 'A floor in {{name}}.', { name: target.parent.name })
            : t('library.areaDialog.roomOn', 'A room on {{name}}.', { name: target.parent.name })
          : undefined
      }
      footer={
        isConfirming && existing !== undefined ? (
          <ConfirmRemoval
            question={`Remove ${existing.name}? ${describeRemoval(removal)}`}
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
        {kind === 'floor' ? (
          <>
            <TextField
              label={t('library.areaDialog.name', 'Name')}
              size="medium"
              value={name}
              required
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <TextField
              label={t('library.areaDialog.floorNumber', 'Floor number')}
              size="medium"
              type="number"
              inputMode="numeric"
              step={1}
              min={FLOOR_LEVEL_MINIMUM}
              max={FLOOR_LEVEL_MAXIMUM}
              value={levelText}
              required
              hint={t(
                'library.areaDialog.whichStoreyItIs',
                'Which storey it is, whatever it is called: 0 the ground floor, 1 the one above, -1 a cellar. Floors are listed by it.',
              )}
              {...(levelProblem === null ? {} : { error: levelProblem })}
              onChange={(event) => {
                setLevelText(event.target.value);
                setLevelProblem(null);
              }}
            />
          </>
        ) : (
          <NameIconField
            value={name}
            required
            onChange={setName}
            icon={icon}
            onIconChange={(view) => {
              setIcon(view.id);
            }}
          />
        )}
        {problem === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {problem}
          </p>
        )}
      </div>
    </Modal>
  );
}
