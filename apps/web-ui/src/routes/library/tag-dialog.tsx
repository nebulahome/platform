/**
 * Making a tag, or changing one: a name and a colour, and for a tag that exists, a way out.
 *
 * The key is nowhere in it. It is derived from the name when the tag is made and never changes,
 * so a rename here is only a rename: a scope granted on the tag keeps meaning it, and nothing
 * the owner sees or types is a slug. Deleting is a second press with the count of what the tag
 * comes off, in the footer where Save was, rather than a second dialog.
 *
 * Mounted fresh each time it opens - the page gives it a key - so the fields start from the
 * target and are the person's from then on.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { TAG_COLORS, type TagColor, type TagUpdate, type TagView } from '@nebulahome/contracts';
import { Button, ColorSwatches, Modal } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { createTag, deleteTag, LIBRARY_QUERY_KEYS, updateTag } from '@/library/api';
import { ConfirmRemoval } from '@/routes/library/confirm-removal';
import { NameIconField } from '@/routes/library/name-icon-field';

/** What the dialog is for: a new tag, or one that exists. */
export type TagDialogTarget =
  { readonly mode: 'create' } | { readonly mode: 'edit'; readonly tag: TagView };

/** What the dialog needs. */
export type TagDialogProps = {
  /** What it is for, or null while it is shut. */
  readonly target: TagDialogTarget | null;

  /** Called when the dialog should shut, saved or not. */
  readonly onClose: () => void;

  /** Called with the tag as the server now has it. */
  readonly onSaved: (tag: TagView) => void;

  /** Called with the id of the tag that was deleted. */
  readonly onDeleted: (id: string) => void;
};

/**
 * Says what a tag comes off when deleted.
 *
 * @param tag - The tag.
 * @returns "2 devices and 3 entities", or "nothing yet".
 */
function describeUse(tag: TagView): string {
  const parts = [
    tag.deviceCount === 0
      ? null
      : `${String(tag.deviceCount)} device${tag.deviceCount === 1 ? '' : 's'}`,
    tag.entityCount === 0
      ? null
      : `${String(tag.entityCount)} entit${tag.entityCount === 1 ? 'y' : 'ies'}`,
  ].filter((part) => part !== null);

  return parts.length === 0 ? 'nothing yet' : parts.join(' and ');
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link TagDialogProps}.
 * @returns The dialog.
 */
export function TagDialog(props: TagDialogProps) {
  const { target, onClose, onSaved, onDeleted } = props;
  const queryClient = useQueryClient();
  const existing = target?.mode === 'edit' ? target.tag : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState<string | null>(existing?.icon ?? null);
  const [color, setColor] = useState<TagColor>(existing?.color ?? TAG_COLORS[0]);
  const [isConfirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /** Reads everything that shows tags again. */
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.tags }),
      queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices }),
      queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities }),
    ]);
  };

  const save = useMutation({
    /**
     * Makes the tag, or sends what changed on it.
     *
     * @returns The tag as it now stands.
     */
    mutationFn: async (): Promise<TagView> => {
      const trimmed = name.trim();

      if (existing === undefined) {
        return createTag({ name: trimmed, color, ...(icon === null ? {} : { icon }) });
      }

      const change: TagUpdate = {
        ...(trimmed === existing.name ? {} : { name: trimmed }),
        ...(color === existing.color ? {} : { color }),
        ...(icon === existing.icon ? {} : { icon }),
      };

      return Object.keys(change).length === 0 ? existing : updateTag(existing.id, change);
    },

    /**
     * Hands the tag back once every list has it.
     *
     * @param saved - The tag as the server has it.
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

  const removal = useMutation({
    /** Deletes the tag. */
    mutationFn: async (): Promise<void> => {
      if (existing !== undefined) {
        await deleteTag(existing.id);
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
     * Shows why the deletion failed.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setConfirming(false);
      setProblem(toMessage(error));
    },
  });

  const isBusy = save.isPending || removal.isPending;

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
      title={existing === undefined ? 'New tag' : `Configure ${existing.name}`}
      description={
        existing === undefined
          ? 'A name and a colour. Put it on devices and entities from their own dialogs.'
          : `On ${describeUse(existing)}.`
      }
      footer={
        isConfirming && existing !== undefined ? (
          <ConfirmRemoval
            question={`Delete ${existing.name}? It comes off ${describeUse(existing)}.`}
            label="Delete"
            isBusy={removal.isPending}
            onCancel={() => {
              setConfirming(false);
            }}
            onConfirm={() => {
              removal.mutate();
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
                Delete
              </Button>
            )}
            <Button variant="ghost" disabled={isBusy} onClick={onClose}>
              Cancel
            </Button>
            <Button isBusy={save.isPending} disabled={removal.isPending} onClick={submit}>
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
          onChange={setName}
          icon={icon}
          onIconChange={(view) => {
            setIcon(view.id);
          }}
        />
        <ColorSwatches label="Colour" value={color} onChange={setColor} disabled={isBusy} />
        {problem === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {problem}
          </p>
        )}
      </div>
    </Modal>
  );
}
