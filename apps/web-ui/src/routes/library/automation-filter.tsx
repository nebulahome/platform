/**
 * The filter on the automations page: standing, mode, and trigger kind.
 *
 * Three dropdowns in the shared sheet. Standing and mode are short fixed lists; trigger kind is
 * the six leaves the schema knows, so the sheet does not grow with every rule on the page.
 */
import { useTranslation } from 'react-i18next';

import { SelectField } from '@nebulahome/ui';

import { defineMessage, type Message, text, translate } from '@/i18n/messages';
import {
  AUTOMATION_MODE_CHOICES,
  AUTOMATION_STATUSES,
  AUTOMATION_TRIGGER_CHOICES,
  automationFacetCount,
  modeLabel,
  toAutomationMode,
  toAutomationStatus,
  toAutomationTriggerType,
  type AutomationFilter,
} from '@/library/automation-filters';
import { Facet, FilterSheet, type FacetOption } from '@/routes/library/filter-sheet';

/** What each standing is called. */
const STATUS_LABELS: Readonly<Record<(typeof AUTOMATION_STATUSES)[number], Message>> = {
  any: defineMessage('library.automationFilter.anyStatus', 'Any status'),
  enabled: defineMessage('library.automationFilter.enabled', 'Enabled'),
  off: defineMessage('common.off', 'Off'),
  never: defineMessage('library.automationFilter.neverRun', 'Never run'),
};

/**
 * Standing choices, with any first.
 *
 * @returns The choices, in the reader's language.
 */
function statusOptions(): readonly FacetOption[] {
  return AUTOMATION_STATUSES.map((status) => ({
    value: status,
    label: text(STATUS_LABELS[status]),
  }));
}

/**
 * Mode choices, with any first.
 *
 * @returns The choices, in the reader's language.
 */
function modeOptions(): readonly FacetOption[] {
  return AUTOMATION_MODE_CHOICES.map((mode) => ({
    value: mode,
    label:
      mode === 'any' ? translate('library.automationFilter.anyMode', 'Any mode') : modeLabel(mode),
  }));
}

/** How each trigger kind reads in the sheet. */
const TRIGGER_LABELS: Readonly<Record<string, Message>> = {
  any: defineMessage('library.automationFilter.anyTrigger', 'Any trigger'),
  entity: defineMessage('library.automationFilter.entity', 'Entity'),
  time: defineMessage('library.automationFilter.time', 'Time'),
  sun: defineMessage('library.automationFilter.sun', 'Sun'),
  event: defineMessage('library.automationFilter.event', 'Event'),
  manual: defineMessage('library.automationFilter.manual', 'Manual'),
  webhook: defineMessage('library.automationFilter.webhook', 'Webhook'),
};

/**
 * Trigger-kind choices, with any first.
 *
 * @returns The choices, in the reader's language.
 */
function triggerOptions(): readonly FacetOption[] {
  return AUTOMATION_TRIGGER_CHOICES.map((type) => {
    const label = TRIGGER_LABELS[type];

    return { value: type, label: label === undefined ? type : text(label) };
  });
}

/** What the filter needs. */
export type AutomationFilterButtonProps = {
  readonly filter: AutomationFilter;

  /** Called with the filter as it now stands. */
  readonly onChange: (filter: AutomationFilter) => void;
};

/**
 * Renders the button and its sheet.
 *
 * @param props - See {@link AutomationFilterButtonProps}.
 * @returns The control.
 */
export function AutomationFilterButton(props: AutomationFilterButtonProps) {
  const { t } = useTranslation();

  const { filter, onChange } = props;
  const count = automationFacetCount(filter);

  return (
    <FilterSheet
      label={t('library.automationFilter.narrowTheAutomations', 'Narrow the automations')}
      count={count}
      onClear={() => {
        onChange({ ...filter, status: 'any', mode: 'any', triggerType: 'any' });
      }}
    >
      <Facet title={t('library.automationFilter.status', 'Status')}>
        <SelectField
          label={t('library.automationFilter.status', 'Status')}
          isLabelHidden
          size="compact"
          options={statusOptions()}
          value={filter.status}
          onChange={(value) => {
            onChange({ ...filter, status: toAutomationStatus(value) });
          }}
        />
      </Facet>
      <Facet title={t('library.automationFilter.mode', 'Mode')}>
        <SelectField
          label={t('library.automationFilter.mode', 'Mode')}
          isLabelHidden
          size="compact"
          options={modeOptions()}
          value={filter.mode}
          onChange={(value) => {
            onChange({ ...filter, mode: toAutomationMode(value) });
          }}
        />
      </Facet>
      <Facet title={t('library.automationFilter.trigger', 'Trigger')}>
        <SelectField
          label={t('library.automationFilter.trigger', 'Trigger')}
          isLabelHidden
          size="compact"
          options={triggerOptions()}
          value={filter.triggerType}
          onChange={(value) => {
            onChange({ ...filter, triggerType: toAutomationTriggerType(value) });
          }}
        />
      </Facet>
    </FilterSheet>
  );
}
