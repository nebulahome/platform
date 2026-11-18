/**
 * The settings of an automation card: which automation it shows.
 */
import { useTranslation } from 'react-i18next';

import type { DashboardAutomationCard } from '@nebulahome/contracts';
import { SelectField } from '@nebulahome/ui';

import { NO_AUTOMATION } from '@/dashboard/new-cards';
import { useAutomationList } from '@/routes/dashboard/cards/timeline-data';
import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function AutomationSettings(props: TypeSettingsProps<DashboardAutomationCard>) {
  const { t } = useTranslation();

  const { card, onChange, onSettled } = props;
  const automations = useAutomationList();

  return (
    <SelectField
      label={t('dashboard.automationSettings.automation', 'Automation')}
      size="compact"
      options={[
        ...(card.automationId === NO_AUTOMATION
          ? [
              {
                value: NO_AUTOMATION,
                label: t('dashboard.automationSettings.choose', 'Choose one'),
              },
            ]
          : []),
        ...automations.map((automation) => ({ value: automation.id, label: automation.name })),
      ]}
      value={card.automationId}
      onChange={(automationId) => {
        if (automationId === NO_AUTOMATION) {
          return;
        }

        onChange((current) =>
          current.type === 'automation' ? { ...current, automationId } : current,
        );
        onSettled();
      }}
    />
  );
}
