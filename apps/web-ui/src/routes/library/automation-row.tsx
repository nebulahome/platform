/**
 * One automation in the list table, as the board draws it (N-Automations): its name with the
 * chain under it - what wakes it, what it checks, what it does - its mode, Enabled as a switch,
 * how its last run went, and a menu.
 *
 * The chain is under the name because the question somebody scanning this page is asking is
 * "which one is the porch light", and reading the rule is how they answer it. The last run is a
 * dot and a word: green Ran, amber Skipped when its checks said no, red Failed.
 *
 * **Enabled is a switch, and it writes** - for somebody who may change automations; for anybody
 * else it is shown and cannot be moved.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { AutomationView } from '@nebulahome/contracts';
import { OverflowMenu, StatusDot, Switch, type StatusDotTone } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import type { BlockNames } from '@/lib/block-summary';
import { summaryOf, type AutomationSummary } from '@/lib/describe-automation';
import { absoluteTime, runMoment } from '@/lib/format-time';
import { runOutcome } from '@/lib/run-outcome';
import { modeLabel } from '@/library/automation-filters';

/**
 * The column widths, shared by the header and every row so they line up.
 *
 * The name and its chain take the flexible room; mode, enabled, last run and the menu stay fixed
 * so a long summary never shoves the menu off the edge of a narrow window.
 */
export const AUTOMATION_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 ' +
  'md:grid-cols-[minmax(0,2.6fr)_100px_90px_160px_40px]';

/** What one row needs. */
export type AutomationRowProps = {
  /** The automation. */
  readonly automation: AutomationView;

  /** Whether a write for this row is in flight. */
  readonly isBusy: boolean;

  /** Whether the person may change it: turn it on or off, delete it. */
  readonly canWrite?: boolean;

  /** Where the chain's names come from. */
  readonly names?: BlockNames;

  /** Called to open the editor. */
  readonly onEdit: () => void;

  /** Called to turn it on or off. */
  readonly onToggle: (isEnabled: boolean) => void;

  /** Called to delete it. */
  readonly onDelete: () => void;
};

/**
 * How the last run reads: a dot, a word and a time, or a dash.
 *
 * @param automation - The automation.
 * @returns The tone, the text and the exact moment.
 */
function lastRunOf(automation: AutomationView): {
  readonly tone: StatusDotTone;
  readonly text: string;
  readonly title: string | undefined;
} {
  if (automation.lastRun === null) {
    return {
      tone: 'neutral',
      text: '—',
      title: translate('library.automationRow.notRunYet', 'Not run yet'),
    };
  }

  const outcome = runOutcome(automation.lastRun.result);

  return {
    tone: outcome.tone,
    text: `${outcome.word} ${runMoment(automation.lastRun.time)}`,
    title: absoluteTime(automation.lastRun.time),
  };
}

/**
 * Renders one automation as a table row.
 *
 * The definition is parsed defensively. It comes from a `jsonb` column that predates the schema
 * validating it, so a row written before this release can be anything at all — and a list that
 * throws on one bad document shows nothing instead of showing the other nine.
 *
 * @param props - See {@link AutomationRowProps}.
 * @returns The row.
 */
export function AutomationRow(props: AutomationRowProps) {
  const { t } = useTranslation();

  const { automation, isBusy, canWrite = true, names, onEdit, onToggle, onDelete } = props;
  const summary = summaryOf(automation.definition, names);
  const lastRun = lastRunOf(automation);

  return (
    <li className={`${AUTOMATION_COLUMNS} border-t border-border px-5 py-3.5 first:border-t-0`}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <Link
          to={`/automations/${automation.id}`}
          className="truncate text-ui font-medium text-foreground transition-colors hover:text-primary"
        >
          {automation.name}
        </Link>
        <Chain summary={summary} />
      </span>

      <span className="hidden font-mono text-mono-ui text-foreground-muted md:block">
        {modeLabel(automation.mode)}
      </span>

      <span>
        <Switch
          label={t('library.automationRow.nameEnabled', '{{name}} enabled', {
            name: automation.name,
          })}
          isOn={automation.isEnabled}
          isBusy={isBusy}
          disabled={!canWrite}
          onChange={onToggle}
        />
      </span>

      <span className="hidden min-w-0 items-center gap-2 md:flex" title={lastRun.title}>
        <StatusDot isBare tone={lastRun.tone} title={lastRun.title ?? lastRun.text} />
        <span
          className={`truncate text-ui-sm tabular ${lastRun.tone === 'danger' ? 'text-danger' : 'text-foreground-muted'}`}
        >
          {lastRun.text}
        </span>
      </span>

      <OverflowMenu
        label={t('library.automationRow.moreForName', 'More for {{name}}', {
          name: automation.name,
        })}
        items={[
          { label: t('common.edit', 'Edit'), icon: 'pencil', onSelect: onEdit },
          ...(canWrite
            ? [
                {
                  label: t('common.delete', 'Delete'),
                  icon: 'trash-2' as const,
                  tone: 'danger' as const,
                  disabled: isBusy,
                  onSelect: onDelete,
                },
              ]
            : []),
        ]}
      />
    </li>
  );
}

/** What the chain line needs. */
type ChainProps = {
  readonly summary: AutomationSummary | null;
};

/**
 * The trigger → if → then line, or a warning when the document cannot be read.
 *
 * The arrows are hidden from a screen reader: read aloud, the chain is three phrases in a row,
 * and an arrow between them is punctuation rather than a word.
 *
 * @param props - See {@link ChainProps}.
 * @returns The chain.
 */
function Chain(props: ChainProps) {
  const { t } = useTranslation();

  const { summary } = props;

  if (summary === null) {
    return (
      <span className="text-caption text-warning">
        {t(
          'library.automationRow.itsDefinitionIsNot',
          'Its definition is not in a shape this build understands.',
        )}
      </span>
    );
  }

  return (
    <span className="truncate text-caption text-foreground-subtle">
      <span>{summary.trigger}</span>
      {summary.conditions === null ? null : (
        <>
          <span aria-hidden="true"> → </span>
          <span>{summary.conditions}</span>
        </>
      )}
      <span aria-hidden="true"> → </span>
      <span>{summary.actions}</span>
    </span>
  );
}
