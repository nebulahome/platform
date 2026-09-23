/**
 * Configuring one entity: what a person calls it, what it is drawn as, and the tags on it.
 *
 * Three things, and nothing the hardware or the bundle decides: the address is shown as a fact
 * in the description because automations and history name the entity by it, and it does not
 * change here or anywhere. What is saved is the difference from what was opened - a rename
 * alone sends a name, tags alone send tags - so the audit trail says what actually changed,
 * and a dialog opened and saved untouched asks the server for nothing.
 *
 * Mounted fresh each time it opens - the page gives it a key - so every piece of state below
 * starts from the entity and the fields are the person's from then on.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { EntityUpdate, EntityView } from '@nebula-home/contracts';
import { Button, Modal } from '@nebula-home/ui';

import { toMessage } from '@/lib/error-message';
import { LIBRARY_QUERY_KEYS, updateEntity } from '@/library/api';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { NameIconField } from '@/routes/library/name-icon-field';
import { TagField } from '@/routes/library/tag-field';
import { useTags } from '@/routes/library/use-tags';

/** What the dialog needs. */
export type EntityDialogProps = {
  /** The entity to configure, or null while the dialog is shut. */
  readonly entity: EntityView | null;

  /** Whether the person may make a tag from the field. */
  readonly canCreateTags: boolean;

  /** Called when the dialog should shut, saved or not. */
  readonly onClose: () => void;

  /** Called with the entity as the server now has it. */
  readonly onSaved: (entity: EntityView) => void;
};

/**
 * Works out what a save should send: only what differs from what was opened.
 *
 * @param opened - The entity as it was opened.
 * @param name - The name as typed.
 * @param icon - The icon as picked.
 * @param tagIds - The tags as they now stand.
 * @returns The change, or null when there is none.
 */
function diffOf(
  opened: EntityView,
  name: string,
  icon: string | null,
  tagIds: readonly string[],
): EntityUpdate | null {
  const trimmed = name.trim();
  const sameTags =
    tagIds.length === opened.tagIds.length && tagIds.every((id, at) => id === opened.tagIds[at]);
  const change = {
    ...(trimmed === opened.name ? {} : { name: trimmed }),
    ...(icon === opened.icon ? {} : { icon }),
    ...(sameTags ? {} : { tagIds: [...tagIds] }),
  };

  return Object.keys(change).length === 0 ? null : change;
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link EntityDialogProps}.
 * @returns The dialog.
 */
export function EntityDialog(props: EntityDialogProps) {
  const { entity, canCreateTags, onClose, onSaved } = props;
  const queryClient = useQueryClient();
  const { tags, create } = useTags();
  const tagIcons = useCatalogueIcons(tags.map((tag) => tag.icon));

  const [name, setName] = useState(entity?.name ?? '');
  const [icon, setIcon] = useState<string | null>(entity?.icon ?? null);
  const [tagIds, setTagIds] = useState<readonly string[]>(entity?.tagIds ?? []);
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    /**
     * Sends the change.
     *
     * @param change - What differs from what was opened.
     * @returns The entity as it now stands.
     */
    mutationFn: async (change: EntityUpdate) => updateEntity(entity?.entityId ?? '', change),

    /**
     * Reads the entities and the tag counts again, and hands the result back.
     *
     * @param saved - What the server now has.
     */
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities }),
        queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.tags }),
      ]);
      onSaved(saved);
    },

    /**
     * Shows why the save failed, in the dialog, where the person is.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setProblem(toMessage(error));
    },
  });

  /** Saves what changed, or shuts when nothing did. */
  const submit = (): void => {
    if (entity === null) {
      return;
    }

    if (name.trim() === '') {
      setProblem('The name cannot be blank.');

      return;
    }

    const change = diffOf(entity, name, icon, tagIds);

    if (change === null) {
      onClose();

      return;
    }

    setProblem(null);
    save.mutate(change);
  };

  return (
    <Modal
      isOpen={entity !== null}
      onClose={onClose}
      title={`Configure ${entity?.name ?? 'entity'}`}
      description={
        <span className="font-mono text-caption text-foreground-muted">{entity?.entityId}</span>
      }
      footer={
        <>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button isBusy={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <NameIconField
          value={name}
          onChange={setName}
          icon={icon}
          onIconChange={(view) => {
            setIcon(view.id);
          }}
          required
        />
        <TagField
          value={tagIds}
          onChange={setTagIds}
          tags={tags}
          icons={tagIcons}
          canCreate={canCreateTags}
          onCreate={create}
        />
        {problem === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {problem}
          </p>
        )}
      </div>
    </Modal>
  );
}
