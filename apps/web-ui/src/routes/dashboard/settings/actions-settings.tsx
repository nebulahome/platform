/**
 * The settings of a quick-actions card, in the floating panel, above its size: its buttons -
 * scenes, buttons and switches - each with Remove, and Add, which offers the scenes and the
 * entities that can be pressed or switched. A new card waits for its first button; once it has
 * one, it is no longer left out at Done.
 */
import { useTranslation } from 'react-i18next';

import type { DashboardActionsCard, DashboardCard, QuickAction } from '@nebulahome/contracts';
import { AppIcon, SelectField } from '@nebulahome/ui';

import { hasCapability } from '@/library/entity-control';
import { entityKindOf } from '@/library/entity-kind';
import { ChosenRow, moved, OverviewField } from '@/routes/dashboard/settings/overview-fields';
import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';
import { EntityTile } from '@/routes/library/entity-tile';

/** The most buttons a card holds: six fill a 1×2. */
const MOST = 6;

/** How an added scene is told apart from an entity among Add's choices. */
const SCENE = 'scene:';

/**
 * The key of a button, as Add offers it.
 *
 * @param item - The button.
 * @returns `scene:<id>`, or the entity's address.
 */
function keyOf(item: QuickAction): string {
  return item.kind === 'scene' ? `${SCENE}${item.sceneId}` : item.entityId;
}

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function ActionsSettings(props: TypeSettingsProps<DashboardActionsCard>) {
  const { t } = useTranslation();

  const { card, data, isPending, onChange, onSettled } = props;
  const { items } = card;
  const taken = new Set(items.map(keyOf));
  const scenes = [...data.sceneById.values()]
    .filter((scene) => !taken.has(`${SCENE}${scene.id}`))
    .map((scene) => ({
      value: `${SCENE}${scene.id}`,
      label: scene.name,
      group: t('dashboard.settings.actions.scenes', 'Scenes'),
    }));
  const entities = [...data.entityById.values()]
    .filter(
      (entity) =>
        entity.isEnabled &&
        !entity.isHidden &&
        !taken.has(entity.entityId) &&
        (hasCapability(entity, 'button') || hasCapability(entity, 'on_off')),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entity) => ({
      value: entity.entityId,
      label: entity.areaName === null ? entity.name : `${entity.name} · ${entity.areaName}`,
      group: t('dashboard.settings.actions.buttonsAndSwitches', 'Buttons and switches'),
    }));

  /**
   * Gives the card its buttons.
   *
   * @param next - The buttons, in their order.
   */
  const keep = (next: QuickAction[]): void => {
    onChange((current): DashboardCard =>
      current.type === 'actions' ? { ...current, items: next.slice(0, MOST) } : current,
    );

    if (isPending && next.length > 0) {
      onSettled();
    }
  };

  return (
    <>
      <OverviewField
        label={t('dashboard.settings.actions.buttons', 'Buttons')}
        note={t('dashboard.settings.list.countOf', '{{count}} of {{most}}', {
          count: items.length,
          most: MOST,
        })}
      >
        {items.length === 0 ? null : (
          <ul className="flex flex-col gap-1.5">
            {items.map((item, index) => {
              const scene = item.kind === 'scene' ? data.sceneById.get(item.sceneId) : undefined;
              const entity =
                item.kind === 'entity' ? data.entityById.get(item.entityId) : undefined;
              const key = keyOf(item);

              return (
                <ChosenRow
                  key={key}
                  glyph={
                    entity === undefined ? (
                      <span className="inline-flex size-5 shrink-0 items-center justify-center text-violet">
                        <AppIcon id="sparkles" size={12} />
                      </span>
                    ) : (
                      <EntityTile
                        icon={undefined}
                        kind={entityKindOf(entity)}
                        isActive={null}
                        size="tiny"
                        isPlain
                      />
                    )
                  }
                  name={scene?.name ?? entity?.name ?? key}
                  note={
                    item.kind === 'scene'
                      ? t('dashboard.settings.actions.scene', 'Scene')
                      : entity === undefined
                        ? null
                        : entityKindOf(entity).label
                  }
                  onUp={
                    index === 0
                      ? undefined
                      : () => {
                          keep(moved(items, index, -1));
                        }
                  }
                  onDown={
                    index === items.length - 1
                      ? undefined
                      : () => {
                          keep(moved(items, index, 1));
                        }
                  }
                  onRemove={() => {
                    keep(items.filter((each) => keyOf(each) !== key));
                  }}
                />
              );
            })}
          </ul>
        )}
      </OverviewField>
      {items.length >= MOST ? null : (
        <SelectField
          label={t('dashboard.settings.actions.add', 'Add a button')}
          size="compact"
          options={[...scenes, ...entities]}
          value=""
          onChange={(value) => {
            const entity = data.entityById.get(value);

            if (value.startsWith(SCENE)) {
              keep([...items, { kind: 'scene', sceneId: value.slice(SCENE.length) }]);
            } else if (entity !== undefined) {
              keep([...items, { kind: 'entity', entityId: entity.entityId }]);
            }
          }}
        />
      )}
    </>
  );
}
