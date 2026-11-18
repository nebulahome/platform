/**
 * The settings of an activity card: what it follows - the whole house, one area, or a few
 * entities picked by hand.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { DashboardActivityCard } from '@nebulahome/contracts';
import { SelectField } from '@nebulahome/ui';

import { signalled } from '@/lib/signalled';
import { fetchAreas, LIBRARY_QUERY_KEYS } from '@/library/api';
import { EntityRows, PillChoice, SettingsField } from '@/routes/dashboard/settings/settings-parts';
import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function ActivitySettings(props: TypeSettingsProps<DashboardActivityCard>) {
  const { t } = useTranslation();

  const { card, data, onChange } = props;
  const areas = useQuery({ queryKey: LIBRARY_QUERY_KEYS.areas, queryFn: signalled(fetchAreas) });
  const rooms = (areas.data ?? []).filter((area) => area.kind === 'room');
  const { scope } = card;

  /**
   * Follows something else.
   *
   * @param next - The new scope.
   */
  const follow = (next: DashboardActivityCard['scope']): void => {
    onChange((current) => (current.type === 'activity' ? { ...current, scope: next } : current));
  };

  return (
    <>
      <SettingsField label={t('dashboard.activitySettings.follows', 'Follows')}>
        <PillChoice
          label={t('dashboard.activitySettings.follows', 'Follows')}
          options={[
            { value: 'house', label: t('dashboard.activitySettings.house', 'Whole house') },
            { value: 'area', label: t('dashboard.activitySettings.area', 'A room') },
            { value: 'entities', label: t('dashboard.activitySettings.entities', 'By hand') },
          ]}
          value={scope.kind}
          onChange={(kind) => {
            follow(
              kind === 'house'
                ? { kind }
                : kind === 'area'
                  ? { kind, areaKey: rooms[0]?.key ?? 'home' }
                  : { kind, entityIds: [] },
            );
          }}
        />
      </SettingsField>
      {scope.kind === 'area' ? (
        <SelectField
          label={t('dashboard.activitySettings.where', 'Where')}
          size="compact"
          options={rooms.map((area) => ({ value: area.key, label: area.name }))}
          value={scope.areaKey}
          onChange={(areaKey) => {
            follow({ kind: 'area', areaKey });
          }}
        />
      ) : null}
      {scope.kind === 'entities' ? (
        <SettingsField label={t('dashboard.activitySettings.entitiesLabel', 'Entities')}>
          <EntityRows
            entities={scope.entityIds.flatMap((id) => data.entityById.get(id) ?? [])}
            accept={() => true}
            maximum={32}
            pickerTitle={t('dashboard.activitySettings.pick', 'Entities to follow')}
            onChange={(entityIds) => {
              follow({
                kind: 'entities',
                entityIds: entityIds.flatMap((id) => data.entityById.get(id)?.entityId ?? []),
              });
            }}
          />
        </SettingsField>
      ) : null}
    </>
  );
}
