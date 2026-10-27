/**
 * An entity's settings, in a dialog: what a person calls it, what it is drawn as, what it is shown
 * as, and the tags on it.
 *
 * Opened from the settings button in the entity page's header - the way a device's settings are
 * opened from its page - rather than being a view of the page of their own: three fields do not
 * need a page, and the page behind them stays the entity's.
 *
 * Nothing the hardware or the bundle decides is here: the address is on the page as a fact,
 * because automations and history name the entity by it and it does not change here or anywhere.
 * What it is shown as does - a relay as a light, motion as presence (`entity-types.ts`) - and
 * the rest of the house follows; the address keeps the integration's domain.
 * What is saved is the difference from what was opened - a rename alone sends a name, tags alone
 * send tags - so the audit trail says what actually changed, and a dialog saved untouched asks the
 * server for nothing.
 *
 * Mounted fresh for each opening - the page keys it - so every field starts from the entity and
 * is the person's from then on.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  integrationIdSchema,
  shownAsOptions,
  type EntityUpdate,
  type EntityView,
  type ShownAs,
} from '@nebulahome/contracts';
import { Button, Modal, Segmented, SelectField } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { LIBRARY_QUERY_KEYS, updateEntity } from '@/library/api';
import { entityKindOf } from '@/library/entity-kind';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { useEntityWays } from '@/routes/library/entity/transport-panel';
import { EntityTile } from '@/routes/library/entity-tile';
import { NameIconField } from '@/routes/library/name-icon-field';
import { TagField } from '@/routes/library/tag-field';
import { useTags } from '@/routes/library/use-tags';

/** What the dialog needs. */
export type EntitySettingsDialogProps = {
  /** The entity to configure. */
  readonly entity: EntityView;

  /** Whether the dialog is open. */
  readonly isOpen: boolean;

  /** Called to shut it, saved or not. */
  readonly onClose: () => void;

  /** Whether the person may make a tag from the field. */
  readonly canCreateTags: boolean;

  /** Whether the person may change anything at all; false shows the settings read-only. */
  readonly canEdit: boolean;
};

/**
 * The key a kind is chosen by in the field.
 *
 * @param kind - A domain and a class.
 * @param kind.domain - The domain.
 * @param kind.deviceClass - The class.
 * @returns `light:` or `binary_sensor:presence`.
 */
function kindKey(kind: { readonly domain: string; readonly deviceClass: string | null }): string {
  return `${kind.domain}:${kind.deviceClass ?? ''}`;
}

/**
 * What an entity is shown as, as the field holds it.
 *
 * @param entity - The entity.
 * @returns Its kind's key, or empty when it is shown as its integration says.
 */
export function shownKeyOf(entity: EntityView): string {
  return entity.original === null ? '' : kindKey(entity);
}

/**
 * Works out what a save should send: only what differs from what was opened.
 *
 * @param opened - The entity as it was opened.
 * @param name - The name as typed.
 * @param icon - The icon as picked.
 * @param tagIds - The tags as they now stand.
 * @param transport - The way read first, as chosen; null to follow the device.
 * @param shown - What it is shown as, from the field: a kind's key, empty for as it is.
 * @param choices - The kinds it may be shown as, by key.
 * @returns The change, or null when there is none.
 */
export function diffOf(
  opened: EntityView,
  name: string,
  icon: string | null,
  tagIds: readonly string[],
  transport: string | null,
  shown = shownKeyOf(opened),
  choices: ReadonlyMap<string, ShownAs> = new Map(),
): EntityUpdate | null {
  const trimmed = name.trim();
  const sameTags =
    tagIds.length === opened.tagIds.length && tagIds.every((id, at) => id === opened.tagIds[at]);
  const change = {
    ...(trimmed === opened.name ? {} : { name: trimmed }),
    ...(icon === opened.icon ? {} : { icon }),
    ...(sameTags ? {} : { tagIds: [...tagIds] }),
    ...(opened.linked == null || transport === opened.linked.transport
      ? {}
      : { transport: transport === null ? null : integrationIdSchema.parse(transport) }),
    ...(shown === shownKeyOf(opened) ? {} : { shownAs: choices.get(shown) ?? null }),
  };

  return Object.keys(change).length === 0 ? null : change;
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link EntitySettingsDialogProps}.
 * @returns The dialog.
 */
export function EntitySettingsDialog(props: EntitySettingsDialogProps) {
  const { t } = useTranslation();

  const { entity, isOpen, onClose, canCreateTags, canEdit } = props;
  const queryClient = useQueryClient();
  const { tags, create } = useTags();
  const tagIcons = useCatalogueIcons(tags.map((tag) => tag.icon));

  const [name, setName] = useState(entity.name);
  const [icon, setIcon] = useState<string | null>(entity.icon);
  const [tagIds, setTagIds] = useState<readonly string[]>(entity.tagIds);
  const [problem, setProblem] = useState<string | null>(null);
  // A reading read two ways: which is read first, the device's choice or one of its own.
  const ways = useEntityWays(entity);
  const [transport, setTransport] = useState<string | null>(entity.linked?.transport ?? null);
  // What it may be shown as, besides what its integration says: never an alias, whose kind is
  // the formula's.
  const original = entity.original ?? { domain: entity.domain, deviceClass: entity.deviceClass };
  const choices = new Map(
    (entity.domain === 'alias'
      ? []
      : shownAsOptions(
          original,
          entity.capabilities.map((each) => each.capability),
        )
    ).map((kind) => [kindKey(kind), kind] as const),
  );
  const [shown, setShown] = useState(shownKeyOf(entity));
  const change = diffOf(entity, name, icon, tagIds, transport, shown, choices);
  const devicePrefers = ways?.sources.find(
    (each) => each.source.deviceId === entity.linked?.preferred,
  );
  const chosen =
    transport === null
      ? devicePrefers
      : ways?.sources.find((each) => each.source.deviceId === transport);
  const otherOfChosen = ways?.sources.find((each) => each !== chosen);

  const save = useMutation({
    /**
     * Sends the change.
     *
     * @param update - What differs from what was opened.
     * @returns The entity as it now stands.
     */
    mutationFn: async (update: EntityUpdate) => updateEntity(entity.entityId, update),

    /** Reads the entities and the tag counts again, and shuts the dialog. */
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities }),
        queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.tags }),
      ]);
      onClose();
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
      setProblem(t('entity.entitySettingsDialog.nameCannotBeBlank', 'The name cannot be blank.'));

      return;
    }

    if (change === null) {
      return;
    }

    setProblem(null);
    save.mutate(change);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('entity.entitySettingsDialog.configureName', 'Configure {{name}}', {
        name: entity.name,
      })}
      {...(ways === null
        ? {}
        : {
            layout: 'card' as const,
            size: 'brief' as const,
            description: t('entity.entitySettingsDialog.kindLinked', '{{kind}} · linked', {
              kind: entityKindOf(entity).label,
            }),
            lead: (
              <EntityTile
                icon={undefined}
                kind={entityKindOf(entity)}
                isActive={null}
                size="large"
                isPlain
                className="size-11 rounded-inner border border-border-strong"
              />
            ),
          })}
      footer={
        canEdit ? (
          <>
            {ways === null ? null : <span />}
            <span className="flex items-center gap-2.5">
              <Button
                variant={ways === null ? 'ghost' : 'bare'}
                disabled={save.isPending}
                onClick={onClose}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button isBusy={save.isPending} disabled={change === null} onClick={submit}>
                {t('common.save', 'Save')}
              </Button>
            </span>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t('common.close', 'Close')}
          </Button>
        )
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={!canEdit} className="flex flex-col gap-4">
          <NameIconField
            value={name}
            onChange={setName}
            icon={icon}
            fallback={entityKindOf({ ...entity, ...(choices.get(shown) ?? original) }).icon}
            onIconChange={(view) => {
              setIcon(view.id);
            }}
            required
          />
          {choices.size === 0 ? null : (
            <SelectField
              label={t('entity.entitySettingsDialog.shownAs', 'Shown as')}
              options={[
                {
                  value: '',
                  label: t(
                    'entity.entitySettingsDialog.asItIs',
                    '{{kind}}, as its integration says',
                    {
                      kind: entityKindOf({ ...entity, ...original }).label,
                    },
                  ),
                },
                ...[...choices].map(([value, kind]) => ({
                  value,
                  label: entityKindOf({ ...entity, ...kind }).label,
                })),
              ]}
              value={shown}
              onChange={(value) => {
                setShown(value);
                // The new kind's own icon, until another is picked.
                setIcon(null);
              }}
              hint={t(
                'entity.entitySettingsDialog.shownAsHint',
                'The whole house treats it as this: cards, automations, history. Its address stays {{address}}.',
                { address: entity.entityId },
              )}
            />
          )}
          <TagField
            value={tagIds}
            onChange={setTagIds}
            tags={tags}
            icons={tagIcons}
            canCreate={canCreateTags && canEdit}
            onCreate={create}
          />
          {ways === null || chosen === undefined || otherOfChosen === undefined ? null : (
            <div className="flex flex-col gap-2">
              <span aria-hidden="true" className="text-ui-sm font-medium text-foreground-muted">
                {t('entity.entitySettingsDialog.transport', 'Transport')}
              </span>
              <Segmented
                label={t('entity.entitySettingsDialog.transport', 'Transport')}
                options={[
                  {
                    value: '',
                    label: t('entity.entitySettingsDialog.fromTheDevice', 'From the device'),
                  },
                  ...ways.sources.map((each) => ({
                    value: each.source.deviceId,
                    label: each.name,
                  })),
                ]}
                value={transport ?? ''}
                onChange={(value) => {
                  setTransport(value === '' ? null : value);
                }}
                isFilled
              />
              <span className="text-caption text-foreground-subtle">
                {transport === null
                  ? t(
                      'entity.entitySettingsDialog.likeTheDevice',
                      'Like the device: {{first}} first, {{second}} when {{first}} is silent.',
                      { first: chosen.name, second: otherOfChosen.name },
                    )
                  : t(
                      'entity.entitySettingsDialog.forThisEntityOnly',
                      'For this entity only: {{first}} first, {{second}} when {{first}} is silent. The device prefers {{device}}.',
                      {
                        first: chosen.name,
                        second: otherOfChosen.name,
                        device: devicePrefers?.name ?? '',
                      },
                    )}
              </span>
            </div>
          )}
        </fieldset>

        {canEdit ? null : (
          <p className="text-caption text-foreground-subtle">
            {t(
              'entity.entitySettingsDialog.yourRoleLetsYou',
              'Your role lets you see these settings but not change them.',
            )}
          </p>
        )}
        {problem === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {problem}
          </p>
        )}
      </form>
    </Modal>
  );
}
