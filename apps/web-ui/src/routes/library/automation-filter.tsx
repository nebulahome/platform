/**
 * The filter on the automations page: how each rule stands, its mode, its trigger kind, and the
 * ones naming an entity the house does not have.
 *
 * Drawn as the Devices tab's: the standings as boxes with how many stand so beside each, Mode and
 * Trigger side by side, then Show only. A mode or a trigger kind no rule uses is not offered, and
 * a facet left with fewer than two choices is not shown. No Sort by and no foot: the table's
 * headings sort, and the count beside the title already says how many it shows.
 */
import { useTranslation } from 'react-i18next';

import type { TriggerType } from '@nebulahome/contracts';
import { Checkbox, cn, SelectField } from '@nebulahome/ui';

import { defineMessage, type Message, text } from '@/i18n/messages';
import {
  AUTOMATION_STANDINGS,
  automationFacetCount,
  modeLabel,
  OPEN_AUTOMATION_FILTER,
  toAutomationMode,
  toAutomationTriggerType,
  type AutomationChoices,
  type AutomationFilter,
  type AutomationStanding,
} from '@/library/automation-filters';
import { Facet, facetChoices, FilterSheet } from '@/routes/library/filter-sheet';
import { ShowOnly } from '@/routes/library/integration-filter';

/** What each standing is called. */
const STANDING_LABELS: Readonly<Record<AutomationStanding, Message>> = {
  enabled: defineMessage('library.automationFilter.enabled', 'Enabled'),
  off: defineMessage('common.off', 'Off'),
  never: defineMessage('library.automationFilter.neverRun', 'Never run'),
  failed: defineMessage('library.automationFilter.lastRunFailed', 'Last run failed'),
};

/** The dot of each standing, in the tone the row gives it. */
const DOTS: Readonly<Record<AutomationStanding, string>> = {
  enabled: 'bg-success',
  off: 'bg-foreground-subtle',
  never: 'bg-border-strong',
  failed: 'bg-danger',
};

/** How each trigger kind reads in the sheet. */
const TRIGGER_LABELS: Readonly<Record<TriggerType, Message>> = {
  entity: defineMessage('library.automationFilter.entity', 'Entity'),
  time: defineMessage('library.automationFilter.time', 'Time'),
  sun: defineMessage('library.automationFilter.sun', 'Sun'),
  quiet: defineMessage('library.automationFilter.quiet', 'Quietest time'),
  calendar: defineMessage('library.automationFilter.calendar', 'Calendar'),
  event: defineMessage('library.automationFilter.event', 'Event'),
  manual: defineMessage('library.automationFilter.manual', 'Manual'),
  webhook: defineMessage('library.automationFilter.webhook', 'Webhook'),
};

/** What the filter needs. */
export type AutomationFilterButtonProps = {
  readonly filter: AutomationFilter;

  /** The modes and trigger kinds the automations use. */
  readonly choices: AutomationChoices;

  /** How many automations stand each way. */
  readonly counts: Readonly<Record<AutomationStanding, number>>;

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

  const { filter, choices, counts, onChange } = props;
  const hasModes = choices.modes.length >= 2;
  const hasTriggers = choices.triggers.length >= 2;

  /**
   * Ticks or unticks one standing.
   *
   * @param standing - The standing.
   * @param isChecked - Whether it is now ticked.
   */
  const toggleStanding = (standing: AutomationStanding, isChecked: boolean): void => {
    onChange({
      ...filter,
      statuses: isChecked
        ? AUTOMATION_STANDINGS.filter((each) => each === standing || filter.statuses.includes(each))
        : filter.statuses.filter((each) => each !== standing),
    });
  };

  return (
    <FilterSheet
      label={t('library.automationFilter.narrowTheAutomations', 'Narrow the automations')}
      count={automationFacetCount(filter)}
      onClear={() => {
        onChange({ ...OPEN_AUTOMATION_FILTER, search: filter.search });
      }}
    >
      <Facet
        title={t('library.automationFilter.status', 'Status')}
        aside={
          filter.statuses.length === 0
            ? undefined
            : t('library.automationFilter.selected', {
                count: filter.statuses.length,
                defaultValue_one: '{{count}} selected',
                defaultValue_other: '{{count}} selected',
              })
        }
      >
        <div className="flex flex-col gap-3">
          {AUTOMATION_STANDINGS.map((standing) => (
            <Checkbox
              key={standing}
              // A standing no automation has stays offered, quieter: the list may yet have one.
              className={cn(counts[standing] === 0 && 'opacity-45')}
              label={
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn('size-1.5 rounded-full', DOTS[standing])}
                  />
                  {text(STANDING_LABELS[standing])}
                </span>
              }
              count={counts[standing]}
              isChecked={filter.statuses.includes(standing)}
              onChange={(isChecked) => {
                toggleStanding(standing, isChecked);
              }}
            />
          ))}
        </div>
      </Facet>

      {hasModes || hasTriggers ? (
        // Mode and Trigger side by side: two facets sharing one line, half a gutter between them.
        <div className="grid auto-cols-fr grid-flow-col border-t border-border">
          {hasModes ? (
            <Facet
              title={t('library.automationFilter.mode', 'Mode')}
              className={cn('border-t-0', hasTriggers && 'pr-1.5')}
            >
              <SelectField
                label={t('library.automationFilter.mode', 'Mode')}
                isLabelHidden
                size="compact"
                options={facetChoices(
                  choices.modes.map((mode) => ({ value: mode, label: modeLabel(mode) })),
                  filter.mode,
                  t('library.automationFilter.anyMode', 'Any mode'),
                  true,
                )}
                value={filter.mode}
                onChange={(value) => {
                  onChange({ ...filter, mode: toAutomationMode(value) });
                }}
              />
            </Facet>
          ) : null}
          {hasTriggers ? (
            <Facet
              title={t('library.automationFilter.trigger', 'Trigger')}
              className={cn('border-t-0', hasModes && 'pl-1.5')}
            >
              <SelectField
                label={t('library.automationFilter.trigger', 'Trigger')}
                isLabelHidden
                size="compact"
                options={facetChoices(
                  choices.triggers.map((type) => ({
                    value: type,
                    label: text(TRIGGER_LABELS[type]),
                  })),
                  filter.triggerType,
                  t('library.automationFilter.anyTrigger', 'Any trigger'),
                  true,
                )}
                value={filter.triggerType}
                onChange={(value) => {
                  onChange({ ...filter, triggerType: toAutomationTriggerType(value) });
                }}
              />
            </Facet>
          ) : null}
        </div>
      ) : null}

      <Facet title={t('library.automationFilter.showOnly', 'Show only')}>
        <ShowOnly
          icon="triangle-alert"
          label={t('library.automationFilter.missingEntities', 'Missing entities')}
          isOn={filter.isMissing}
          onChange={(isMissing) => {
            onChange({ ...filter, isMissing });
          }}
        />
      </Facet>
    </FilterSheet>
  );
}
