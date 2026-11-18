/**
 * The settings of a summary card, in the floating panel, above its size: what it counts, and
 * where - the whole house or one area.
 */
import { useTranslation } from 'react-i18next';

import {
  SUMMARY_SUBJECTS,
  type DashboardSummaryCard,
  type SummarySubject,
} from '@nebulahome/contracts';
import { SelectField } from '@nebulahome/ui';

import { useAreaChoices } from '@/routes/dashboard/settings/overview-fields';
import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';

/** The choice that stands for the whole house in Where. */
const HOUSE = '';

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function SummarySettings(props: TypeSettingsProps<DashboardSummaryCard>) {
  const { t } = useTranslation();

  const { card, data, onChange } = props;
  const areas = useAreaChoices(data);
  const names: Readonly<Record<SummarySubject, string>> = {
    openings: t('dashboard.cards.summaryCard.openings', 'Doors and windows'),
    lights: t('dashboard.cards.summaryCard.lights', 'Lights on'),
    batteries: t('dashboard.cards.summaryCard.batteries', 'Batteries'),
    updates: t('dashboard.cards.summaryCard.updates', 'Updates'),
    offline: t('dashboard.cards.summaryCard.offline', 'Not reachable'),
    glance: t('dashboard.settings.summary.glance', 'The house at a glance'),
  };

  return (
    <>
      <SelectField
        label={t('dashboard.settings.summary.what', 'What it counts')}
        size="compact"
        options={SUMMARY_SUBJECTS.map((subject) => ({ value: subject, label: names[subject] }))}
        value={card.what}
        onChange={(what) => {
          const subject = SUMMARY_SUBJECTS.find((each) => each === what);

          if (subject !== undefined) {
            onChange((current) =>
              current.type === 'summary' ? { ...current, what: subject } : current,
            );
          }
        }}
      />
      <SelectField
        label={t('dashboard.settings.summary.where', 'Where')}
        size="compact"
        options={[
          { value: HOUSE, label: t('dashboard.cards.summaryCard.wholeHouse', 'Whole house') },
          ...areas,
        ]}
        value={card.areaKey ?? HOUSE}
        onChange={(areaKey) => {
          onChange((current) =>
            current.type === 'summary'
              ? { ...current, areaKey: areaKey === HOUSE ? null : areaKey }
              : current,
          );
        }}
      />
    </>
  );
}
