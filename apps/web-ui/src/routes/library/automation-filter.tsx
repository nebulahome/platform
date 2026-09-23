/**
 * The filter on the automations page: standing, mode, and trigger kind.
 *
 * Three dropdowns in the shared sheet. Standing and mode are short fixed lists; trigger kind is
 * the five leaves the schema knows, so the sheet does not grow with every rule on the page.
 */
import { SelectField } from '@nebula-home/ui';

import {
  AUTOMATION_MODE_CHOICES,
  AUTOMATION_STATUSES,
  AUTOMATION_TRIGGER_CHOICES,
  toAutomationMode,
  toAutomationStatus,
  toAutomationTriggerType,
  type AutomationFilter,
} from '@/library/automation-filters';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';

/** One thing a facet may be set to. */
type FacetOption = {
  readonly value: string;
  readonly label: string;
};

/** Standing choices, with any first. */
const STATUSES: readonly FacetOption[] = AUTOMATION_STATUSES.map((status) => ({
  value: status,
  label:
    status === 'any'
      ? 'Any status'
      : status === 'off'
        ? 'Off'
        : status.charAt(0).toUpperCase() + status.slice(1),
}));

/** Mode choices, with any first. */
const MODES: readonly FacetOption[] = AUTOMATION_MODE_CHOICES.map((mode) => ({
  value: mode,
  label: mode === 'any' ? 'Any mode' : mode.charAt(0).toUpperCase() + mode.slice(1),
}));

/** How each trigger kind reads in the sheet. */
const TRIGGER_LABELS: Readonly<Record<string, string>> = {
  any: 'Any trigger',
  state: 'State',
  numeric_state: 'Numeric state',
  time: 'Time',
  event: 'Event',
  manual: 'Manual',
};

/** Trigger-kind choices, with any first. */
const TRIGGERS: readonly FacetOption[] = AUTOMATION_TRIGGER_CHOICES.map((type) => ({
  value: type,
  label: TRIGGER_LABELS[type] ?? type,
}));

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
  const { filter, onChange } = props;
  const count =
    Number(filter.status !== 'any') +
    Number(filter.mode !== 'any') +
    Number(filter.triggerType !== 'any');

  return (
    <FilterSheet
      label="Narrow the automations"
      count={count}
      width="wide"
      onClear={() => {
        onChange({ ...filter, status: 'any', mode: 'any', triggerType: 'any' });
      }}
    >
      <Facet title="Status">
        <SelectField
          label="Status"
          isLabelHidden
          size="compact"
          options={STATUSES}
          value={filter.status}
          onChange={(value) => {
            onChange({ ...filter, status: toAutomationStatus(value) });
          }}
        />
      </Facet>
      <Facet title="Mode">
        <SelectField
          label="Mode"
          isLabelHidden
          size="compact"
          options={MODES}
          value={filter.mode}
          onChange={(value) => {
            onChange({ ...filter, mode: toAutomationMode(value) });
          }}
        />
      </Facet>
      <Facet title="Trigger">
        <SelectField
          label="Trigger"
          isLabelHidden
          size="compact"
          options={TRIGGERS}
          value={filter.triggerType}
          onChange={(value) => {
            onChange({ ...filter, triggerType: toAutomationTriggerType(value) });
          }}
        />
      </Facet>
    </FilterSheet>
  );
}
