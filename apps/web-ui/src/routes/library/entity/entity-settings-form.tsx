/**
 * An entity's Settings: what a person calls it, what it is drawn as, and the tags on it.
 *
 * Three things, and nothing the hardware or the bundle decides: the address is on the overview
 * as a fact, because automations and history name the entity by it and it does not change here
 * or anywhere. What is saved is the difference from what was opened - a rename alone sends a
 * name, tags alone send tags - so the audit trail says what actually changed, and a form saved
 * untouched asks the server for nothing.
 *
 * Mounted fresh for each entity - the page keys it - so every field starts from the entity and
 * is the person's from then on.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { EntityUpdate, EntityView } from '@nebula-home/contracts';
import { Button, Panel } from '@nebula-home/ui';

import { toMessage } from '@/lib/error-message';
import { LIBRARY_QUERY_KEYS, updateEntity } from '@/library/api';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { NameIconField } from '@/routes/library/name-icon-field';
import { TagField } from '@/routes/library/tag-field';
import { useTags } from '@/routes/library/use-tags';

/** What the form needs. */
export type EntitySettingsFormProps = {
  /** The entity to configure. */
  readonly entity: EntityView;

  /** Whether the person may make a tag from the field. */
  readonly canCreateTags: boolean;

  /** Whether the person may change anything at all; false shows the settings read-only. */
  readonly canEdit: boolean;
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
export function diffOf(
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
 * Renders the form.
 *
 * @param props - See {@link EntitySettingsFormProps}.
 * @returns The form.
 */
export function EntitySettingsForm(props: EntitySettingsFormProps) {
  const { entity, canCreateTags, canEdit } = props;
  const queryClient = useQueryClient();
  const { tags, create } = useTags();
  const tagIcons = useCatalogueIcons(tags.map((tag) => tag.icon));

  const [name, setName] = useState(entity.name);
  const [icon, setIcon] = useState<string | null>(entity.icon);
  const [tagIds, setTagIds] = useState<readonly string[]>(entity.tagIds);
  const [problem, setProblem] = useState<string | null>(null);
  const [isSaved, setSaved] = useState(false);
  const change = diffOf(entity, name, icon, tagIds);

  const save = useMutation({
    /**
     * Sends the change.
     *
     * @param update - What differs from what was opened.
     * @returns The entity as it now stands.
     */
    mutationFn: async (update: EntityUpdate) => updateEntity(entity.entityId, update),

    /** Reads the entities and the tag counts again, and says it is done. */
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities }),
        queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.tags }),
      ]);
      setSaved(true);
    },

    /**
     * Shows why the save failed, under the fields, where the person is.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setProblem(toMessage(error));
    },
  });

  /** Saves what changed. */
  const submit = (): void => {
    if (name.trim() === '') {
      setProblem('The name cannot be blank.');

      return;
    }

    if (change === null) {
      return;
    }

    setProblem(null);
    setSaved(false);
    save.mutate(change);
  };

  return (
    <Panel title="Settings">
      <form
        className="flex flex-col gap-4 px-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={!canEdit} className="flex flex-col gap-4">
          <NameIconField
            value={name}
            onChange={(next) => {
              setSaved(false);
              setName(next);
            }}
            icon={icon}
            onIconChange={(view) => {
              setSaved(false);
              setIcon(view.id);
            }}
            required
          />
          <TagField
            value={tagIds}
            onChange={(next) => {
              setSaved(false);
              setTagIds(next);
            }}
            tags={tags}
            icons={tagIcons}
            canCreate={canCreateTags && canEdit}
            onCreate={create}
          />
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          {canEdit ? (
            <Button type="submit" isBusy={save.isPending} disabled={change === null}>
              Save
            </Button>
          ) : (
            <p className="text-caption text-foreground-subtle">
              Your role lets you see these settings but not change them.
            </p>
          )}
          {problem === null ? null : (
            <p role="alert" className="text-ui text-danger">
              {problem}
            </p>
          )}
          {isSaved && change === null && problem === null ? (
            <p role="status" className="text-ui text-success">
              Saved.
            </p>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}
