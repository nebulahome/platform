/**
 * Adding a floor or a room, or changing one: what to call it, for a room what it is drawn as,
 * and - for one that exists - a Remove that says what goes with it.
 *
 * The parent is decided by the button that opened the dialog - "Add floor" on the house, "Add
 * room" on a floor - and is not a field: a room made from a floor's own row is a room on that
 * floor, and asking again would be asking somebody to say where they are standing.
 *
 * A floor has a name and nothing else: it is a level, not a thing with a look of its own, and
 * an icon on it would be an icon for the sake of the field. A room is drawn - a kitchen, a
 * study - so a room picks one.
 *
 * Only what changed is sent, so the audit trail says what actually changed.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { AreaKind, AreaUpdate, AreaView } from '@nebula-home/contracts';
import { Button, Modal, TextField } from '@nebula-home/ui';

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

  /** Called when the dialog should shut, saved or not. */
  readonly onClose: () => void;

  /** Called with the area as the server now has it. */
  readonly onSaved: (area: AreaView) => void;

  /** Called with the id of the area that was removed. */
  readonly onDeleted: (id: string) => void;
};

/**
 * Renders the dialog.
 *
 * @param props - See {@link AreaDialogProps}.
 * @returns The dialog.
 */
export function AreaDialog(props: AreaDialogProps) {
  const { target, removal, onClose, onSaved, onDeleted } = props;
  const queryClient = useQueryClient();
  const existing = target?.mode === 'edit' ? target.area : undefined;
  const kind = target === null ? 'room' : target.mode === 'create' ? target.kind : target.area.kind;

  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState<string | null>(existing?.icon ?? null);
  const [isConfirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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
     * @returns The area as it now stands.
     */
    mutationFn: async (): Promise<AreaView> => {
      const trimmed = name.trim();

      if (target?.mode === 'create') {
        return createArea({
          kind: target.kind,
          name: trimmed,
          parentId: target.parent.id,
          ...(icon === null ? {} : { icon }),
        });
      }

      if (existing === undefined) {
        throw new Error('The dialog is shut');
      }

      const change: AreaUpdate = {
        ...(trimmed === existing.name ? {} : { name: trimmed }),
        ...(icon === existing.icon ? {} : { icon }),
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
      setProblem(toMessage(error));
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

  /** Saves, unless the name is blank. */
  const submit = (): void => {
    if (name.trim() === '') {
      setProblem('The name cannot be blank.');

      return;
    }

    setProblem(null);
    save.mutate();
  };

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      title={existing === undefined ? `New ${kind}` : `Configure ${existing.name}`}
      description={
        target?.mode === 'create'
          ? `${kind === 'floor' ? 'A floor in' : 'A room on'} ${target.parent.name}.`
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
        {kind === 'floor' ? (
          <TextField
            label="Name"
            size="medium"
            value={name}
            required
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
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
