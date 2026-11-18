/**
 * The settings of an entity list, in the floating panel, above its size: its entities, in their
 * order, each with Move up, Move down and Remove, and Add, which opens the platform's entity
 * picker. A new list waits for its first entity; once it has one, it is no longer left out at
 * Done.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardCard, DashboardListCard, EntityView } from '@nebulahome/contracts';

import { entityKindOf } from '@/library/entity-kind';
import {
  AddButton,
  ChosenRow,
  moved,
  OverviewField,
} from '@/routes/dashboard/settings/overview-fields';
import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';
import { EntityPicker } from '@/routes/library/entity-picker/entity-picker';
import { EntityTile } from '@/routes/library/entity-tile';

/** The most entities a list holds, as the layout allows (`dashboardListCardSchema`). */
const MOST = 12;

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function ListSettings(props: TypeSettingsProps<DashboardListCard>) {
  const { t } = useTranslation();

  const { card, data, isPending, onChange, onSettled } = props;
  const [isPicking, setPicking] = useState(false);
  const { entityIds } = card;

  /**
   * Gives the list its entities.
   *
   * @param next - The entities, in their order.
   */
  const keep = (next: DashboardListCard['entityIds']): void => {
    onChange((current): DashboardCard =>
      current.type === 'list' ? { ...current, entityIds: next.slice(0, MOST) } : current,
    );

    if (isPending && next.length > 0) {
      onSettled();
    }
  };

  /**
   * Takes what the picker chose: the ones already on the list keep their places, the new ones
   * join at the end, the ones un-chosen leave.
   *
   * @param chosen - The entities chosen.
   */
  const choose = (chosen: readonly EntityView[]): void => {
    const ids = chosen.map((entity) => entity.entityId);

    keep([
      ...entityIds.filter((entityId) => ids.includes(entityId)),
      ...ids.filter((entityId) => !entityIds.includes(entityId)),
    ]);
  };

  return (
    <OverviewField
      label={t('dashboard.settings.list.entities', 'Entities')}
      note={t('dashboard.settings.list.countOf', '{{count}} of {{most}}', {
        count: entityIds.length,
        most: MOST,
      })}
    >
      {entityIds.length === 0 ? null : (
        <ul className="flex flex-col gap-1.5">
          {entityIds.map((entityId, index) => {
            const entity = data.entityById.get(entityId);

            return (
              <ChosenRow
                key={entityId}
                glyph={
                  entity === undefined ? null : (
                    <EntityTile
                      icon={undefined}
                      kind={entityKindOf(entity)}
                      isActive={null}
                      size="tiny"
                      isPlain
                    />
                  )
                }
                name={entity?.name ?? entityId}
                note={entity?.areaName}
                onUp={
                  index === 0
                    ? undefined
                    : () => {
                        keep(moved(entityIds, index, -1));
                      }
                }
                onDown={
                  index === entityIds.length - 1
                    ? undefined
                    : () => {
                        keep(moved(entityIds, index, 1));
                      }
                }
                onRemove={() => {
                  keep(entityIds.filter((each) => each !== entityId));
                }}
              />
            );
          })}
        </ul>
      )}
      <AddButton
        label={t('dashboard.settings.list.add', 'Add entities')}
        disabled={entityIds.length >= MOST}
        onPress={() => {
          setPicking(true);
        }}
      />
      <EntityPicker
        isOpen={isPicking}
        title={t('dashboard.settings.list.pickTitle', 'Entities on the list')}
        value={entityIds}
        isMultiple
        onClose={() => {
          setPicking(false);
        }}
        onChoose={(chosen) => {
          setPicking(false);
          choose(chosen);
        }}
      />
    </OverviewField>
  );
}
