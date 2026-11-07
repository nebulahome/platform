/**
 * The entity dialog's settings: a sheet that rises over the controls, as the Nebula canvas draws
 * it - the icon and the name, what it is shown as and the way it is read when it has those, the
 * tags, whether it is enabled, its address and its device. An entity has no room of its own: it
 * is where its device is.
 *
 * The fields are the platform's own: the name with the icon picker, the tags with their colours.
 * What a save sends is worked out as the settings dialog does it, so that only what changed goes.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  shownAsOptions,
  type EntityUpdate,
  type EntityView,
  type IconView,
} from '@nebulahome/contracts';
import { AppIcon, Button, Segmented, SelectField, Switch } from '@nebulahome/ui';

import { entityKindOf } from '@/library/entity-kind';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { diffOf, kindKey, shownKeyOf } from '@/routes/library/entity/entity-settings-dialog';
import { SheetIconButton } from '@/routes/library/entity/sheet/parts/sheet-parts';
import { useEntityWays } from '@/routes/library/entity/transport-panel';
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
};

/**
 * Renders the sheet's head, fields and foot.
 *
 * @param props - See {@link SettingsSheetProps}.
 * @returns The sheet's content.
 */
export function SettingsSheet(props: SettingsSheetProps) {
  const { t } = useTranslation();
  const { entity, deviceName, onSave, onClose, onOpenDevice } = props;
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
      <div
        data-sheet-grip
        aria-hidden="true"
        className="group flex h-4.5 shrink-0 cursor-grab touch-none items-end justify-center active:cursor-grabbing"
      >
        <span className="h-1 w-10 rounded-pill bg-border-strong transition-[width,background-color] duration-200 group-hover:w-12 group-hover:bg-foreground-subtle" />
      </div>
      <div
        data-sheet-grip
        className="flex cursor-grab touch-none items-center gap-2.5 pt-3 pr-3.5 pb-3.5 pl-5 active:cursor-grabbing"
      >
        <div className="flex min-w-0 grow flex-col gap-0.75">
          <span className="text-[17px] font-medium">
            {t('entity.sheet.settings.title', 'Settings')}
          </span>
          <span className="truncate text-ui-sm text-foreground-subtle">{entity.name}</span>
        </div>
        <SheetIconButton
          icon="chevron-down"
          label={t('entity.sheet.settings.close', 'Close settings')}
          onClick={onClose}
        />
      </div>

      <div className="entity-stagger flex min-h-0 grow flex-col gap-4.5 overflow-auto px-5 pt-1 pb-5">
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
                ...ways.sources.map((each) => ({ value: each.source.deviceId, label: each.name })),
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
          canCreate
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

        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-border py-3">
            <span className="text-ui-sm text-foreground-subtle">
              {t('entity.sheet.settings.entityId', 'Entity id')}
            </span>
            <span className="font-mono text-mono-caption text-foreground">{entity.entityId}</span>
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
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button onClick={save}>{t('common.save', 'Save')}</Button>
      </div>
    </>
  );
}
