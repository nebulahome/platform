/**
 * The settings of an agenda card: the calendars it shows, every one when none is picked.
 */
import { useTranslation } from 'react-i18next';

import type { DashboardAgendaCard } from '@nebulahome/contracts';

import { ChoiceChips } from '@/components/choice-chips';
import { useCalendars } from '@/routes/calendar/use-calendars';
import { SettingsField } from '@/routes/dashboard/settings/settings-parts';
import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function AgendaSettings(props: TypeSettingsProps<DashboardAgendaCard>) {
  const { t } = useTranslation();

  const { card, onChange } = props;
  const calendars = useCalendars();

  return (
    <SettingsField label={t('dashboard.agendaSettings.calendars', 'Calendars')}>
      <ChoiceChips
        label={t('dashboard.agendaSettings.calendars', 'Calendars')}
        options={(calendars.data ?? []).map((calendar) => ({
          value: calendar.id,
          label: calendar.name,
        }))}
        value={card.calendarIds}
        onChange={(calendarIds) => {
          onChange((current) =>
            current.type === 'agenda' ? { ...current, calendarIds } : current,
          );
        }}
      />
      <span className="text-caption text-foreground-subtle">
        {t('dashboard.agendaSettings.nonePicked', 'None picked: every calendar.')}
      </span>
    </SettingsField>
  );
}
