/**
 * The entity dialog's settings: a sheet that rises over the controls, as the Nebula canvas draws
 * it - the icon and the name, what it is shown as and the way it is read when it has those, the
 * tags, whether it is enabled, its address and its device. An entity has no room of its own: it
 * is where its device is.
 *
 * The fields are the platform's own: the name with the icon picker, the tags with their colours.
 * What is saved is the difference from what was opened - a rename alone sends a name - so the
 * audit trail says what changed, and a sheet saved untouched asks the server for nothing. Someone
 * who may look but not change sees the fields read-only and no Save; a reading linked across two
 * ways can be unlinked from here, by whoever may change its device.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  integrationIdSchema,
  shownAsOptions,
  type EntityUpdate,
  type EntityView,
  type IconView,
  type ShownAs,
} from '@nebulahome/contracts';
import { AppIcon, Button, Segmented, SelectField, Switch } from '@nebulahome/ui';

import { entityKindOf } from '@/library/entity-kind';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { useEntityWays } from '@/routes/library/entity/entity-ways';
import { RaisedHead } from '@/routes/library/entity/sheet/parts/sheet-parts';
import { NameIconField } from '@/routes/library/name-icon-field';
import { TagField } from '@/routes/library/tag-field';
import { useTags } from '@/routes/library/use-tags';

/** What a save asks for. */
export type SheetSettingsChange = {
  /** What the entity endpoint takes today: name, icon, tags, shown as, transport; null for none. */
  readonly update: EntityUpdate | null;

  /** Whether it is enabled; undefined when it did not change. Not saved by the API yet. */
  readonly isEnabled?: boolean;
};

/** What the sheet needs. */
export type SettingsSheetProps = {
  /** The entity. */
  readonly entity: EntityView;

  /** The name of its device, for the link at the foot; null for an entity without one. */
  readonly deviceName: string | null;

  /** Called with what changed when Save is pressed. */
  readonly onSave: (change: SheetSettingsChange) => void;

  /** Called when the sheet is put away, saved or not. */
  readonly onClose: () => void;

  /** Called when the device's row is pressed. */
  readonly onOpenDevice?: () => void;

  /** Whether the person may change anything; false shows the settings read-only. */
  readonly canEdit?: boolean;

  /** Whether the person may make a tag from the field. */
  readonly canCreateTags?: boolean;

  /** Called when Unlink is pressed, for a linked reading; without it there is no Unlink. */
  readonly onUnlink?: () => void;
};

/**
 * The key a kind is chosen by in the field.
 *
 * @param kind - A domain and a class.
 * @param kind.domain - The domain.
 * @param kind.deviceClass - The class.
 * @returns `light:` or `binary_sensor:presence`.
 */
export function kindKey(kind: {
  readonly domain: string;
  readonly deviceClass: string | null;
}): string {
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
 * Renders the sheet's head, fields and foot.
 *
 * @param props - See {@link SettingsSheetProps}.
 * @returns The sheet's content.
 */
export function SettingsSheet(props: SettingsSheetProps) {
  const { t } = useTranslation();
  const { entity, deviceName, onSave, onClose, onOpenDevice, onUnlink } = props;
  const canEdit = props.canEdit ?? true;
  const { tags, create } = useTags();
  const tagIcons = useCatalogueIcons(tags.map((tag) => tag.icon));
  const ways = useEntityWays(entity);

  const [name, setName] = useState(entity.name);
  const [icon, setIcon] = useState<string | null>(entity.icon);
  const [tagIds, setTagIds] = useState<readonly string[]>(entity.tagIds);
  const [transport, setTransport] = useState<string | null>(entity.linked?.transport ?? null);
  const [isEnabled, setIsEnabled] = useState(entity.isEnabled);

  // What it may be shown as, besides what its integration says: never an alias.
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

  /** Hands what changed over, and puts the sheet away. */
  const save = (): void => {
    onSave({
      update: diffOf(entity, name, icon, tagIds, transport, shown, choices),
      ...(isEnabled === entity.isEnabled ? {} : { isEnabled }),
    });
    onClose();
  };

  return (
    <>
      <RaisedHead
        title={t('entity.sheet.settings.title', 'Settings')}
        sub={entity.name}
        closeLabel={t('entity.sheet.settings.close', 'Close settings')}
        onClose={onClose}
      />

      {/* The fields and the facts each rise in turn: the read-only fieldset sits between. */}
      <div className="entity-stagger-deep flex min-h-0 grow flex-col gap-4.5 overflow-auto px-5 pt-1 pb-5">
        <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-4.5">
          <NameIconField
            label={t('entity.sheet.settings.iconAndName', 'Icon and name')}
            value={name}
            onChange={setName}
            icon={icon}
            fallback={entityKindOf({ ...entity, ...(choices.get(shown) ?? original) }).icon}
            onIconChange={(view: IconView) => {
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
                setIcon(null);
              }}
            />
          )}

          {ways === null ? null : (
            <div className="flex flex-col gap-2">
              <span aria-hidden="true" className="text-caption font-medium text-foreground-muted">
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
            </div>
          )}

          <TagField
            label={t('entity.sheet.settings.tags', 'Tags')}
            value={tagIds}
            onChange={setTagIds}
            tags={tags}
            icons={tagIcons}
            canCreate={canEdit && (props.canCreateTags ?? true)}
            onCreate={create}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-inner border border-border bg-well px-4 py-3.5">
            <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.75">
              <span className="text-ui">{t('entity.sheet.settings.enabled', 'Enabled')}</span>
              <span className="text-caption leading-[1.45] text-foreground-subtle">
                {isEnabled
                  ? t(
                      'entity.sheet.settings.enabledHint',
                      'Shows up when you pick entities, and its states are recorded.',
                    )
                  : t(
                      'entity.sheet.settings.disabledHint',
                      'Hidden when you pick entities, and its states are no longer recorded.',
                    )}
              </span>
            </div>
            <Switch
              label={t('entity.sheet.settings.enabled', 'Enabled')}
              isOn={isEnabled}
              onChange={setIsEnabled}
            />
          </div>
        </fieldset>

        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-border py-3">
            <span className="text-ui-sm text-foreground-subtle">
              {t('entity.sheet.settings.entityId', 'Entity id')}
            </span>
            <span className="font-mono text-mono-caption text-foreground select-text">
              {entity.entityId}
            </span>
          </div>
          {deviceName === null ? null : (
            <button
              type="button"
              onClick={onOpenDevice}
              className="flex cursor-pointer items-center justify-between gap-3 py-3 text-left"
            >
              <span className="text-ui-sm text-foreground-subtle">
                {t('entity.sheet.settings.device', 'Device')}
              </span>
              <span className="inline-flex items-center gap-1.5 text-ui-sm text-foreground">
                {deviceName}
                <AppIcon id="chevron-right" size={14} className="text-foreground-subtle" />
              </span>
            </button>
          )}
          {onUnlink === undefined || ways === null ? null : (
            <button
              type="button"
              onClick={onUnlink}
              className="flex cursor-pointer items-center justify-between gap-3 border-t border-border py-3 text-left text-danger"
            >
              <span className="text-ui-sm">{t('entity.sheet.settings.unlink', 'Unlink…')}</span>
              <AppIcon id="unlink-2" size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        {canEdit ? <Button onClick={save}>{t('common.save', 'Save')}</Button> : null}
      </div>
    </>
  );
}
