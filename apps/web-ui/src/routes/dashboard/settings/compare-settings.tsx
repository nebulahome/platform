/**
 * The settings of a comparison: the sensors on it - up to four, all of one unit, the unit of the
 * first one chosen - in the order their lines are drawn.
 */
import { useTranslation } from 'react-i18next';

import type { DashboardCompareCard, EntityView } from '@nebulahome/contracts';

import { hasCapability } from '@/library/entity-control';
import { EntityRows, SettingsField } from '@/routes/dashboard/settings/settings-parts';
import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';

/** How many sensors one comparison holds. */
const MOST = 4;

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function CompareSettings(props: TypeSettingsProps<DashboardCompareCard>) {
  const { t } = useTranslation();

  const { card, data, onChange, onSettled } = props;
  const chosen = card.entityIds.flatMap((id) => data.entityById.get(id) ?? []);
  const unit = chosen[0]?.unitOfMeasurement ?? null;

  /**
   * Whether a sensor may join: it has a number, and the unit the others have.
   *
   * @param entity - The sensor.
   * @returns True when it may.
   */
  const accept = (entity: EntityView): boolean =>
    hasCapability(entity, 'sensor_numeric') && (unit === null || entity.unitOfMeasurement === unit);

  return (
    <SettingsField
      label={t('dashboard.compareSettings.sensors', 'Sensors')}
      note={unit ?? undefined}
    >
      <EntityRows
        entities={chosen}
        accept={accept}
        maximum={MOST}
        pickerTitle={t('dashboard.compareSettings.pick', 'Readings to compare')}
        onChange={(entityIds) => {
          onChange((current) =>
            current.type === 'compare'
              ? {
                  ...current,
                  entityIds: entityIds.flatMap((id) => data.entityById.get(id)?.entityId ?? []),
                }
              : current,
          );

          if (entityIds.length > 0) {
            onSettled();
          }
        }}
      />
    </SettingsField>
  );
}
