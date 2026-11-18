/**
 * The settings of a room card, in the floating panel, above its size: which room it stands for.
 * A new room card waits for this choice; once made, the card is no longer left out at Done.
 */
import { useTranslation } from 'react-i18next';

import type { DashboardRoomCard } from '@nebulahome/contracts';
import { SelectField } from '@nebulahome/ui';

import { useAreaChoices } from '@/routes/dashboard/settings/overview-fields';
import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function RoomSettings(props: TypeSettingsProps<DashboardRoomCard>) {
  const { t } = useTranslation();

  const { card, data, isPending, onChange, onSettled } = props;
  const areas = useAreaChoices(data);

  return (
    <SelectField
      label={t('dashboard.settings.room.where', 'Where')}
      size="compact"
      options={areas}
      value={card.areaKey}
      hint={
        areas.length === 0
          ? t('dashboard.settings.room.noAreas', 'Make a room on the Areas page first.')
          : undefined
      }
      onChange={(areaKey) => {
        onChange((current) => (current.type === 'room' ? { ...current, areaKey } : current));

        if (isPending) {
          onSettled();
        }
      }}
    />
  );
}
