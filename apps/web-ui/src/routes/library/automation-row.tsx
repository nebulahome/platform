/**
 * One automation in the list table, as the board draws it: its name with the chain under it -
 * what wakes it, what it checks, what it does - its mode, Enabled as a switch, its last run, and a
 * menu.
 *
 * The chain is under the name because the question somebody scanning this page is asking is
 * "which one is the porch light", and reading the rule is how they answer it.
 *
 * **Enabled is a switch, and it writes.** It is the one thing about an automation that can be
 * changed without opening anything. The name opens the editor; the menu has Edit and Delete.
 *
 * There is no Run now. `POST /automations/:id/trigger` does not exist, because nothing is
 * listening yet (API.md §10), and a button that posted to it would fail at the one moment it
 * mattered. The last run says "Not run yet" for the same reason.
 */
import { Link } from 'react-router';

import type { AutomationView } from '@nebulahome/contracts';
import { OverflowMenu, Switch } from '@nebulahome/ui';

import { summaryOf, type AutomationSummary } from '@/lib/describe-automation';
import { relativeTime } from '@/lib/format-time';
import { MODE_LABELS } from '@/library/automation-filters';

/**
 * The column widths, shared by the header and every row so they line up.
 *
 * The name and its chain take the flexible room; mode, enabled, last run and the menu stay fixed
 * so a long summary never shoves the menu off the edge of a narrow window.
 */
export const AUTOMATION_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 ' +
  'md:grid-cols-[minmax(0,1fr)_96px_72px_120px_36px]';

/** What one row needs. */
export type AutomationRowProps = {
  /** The automation. */
  readonly automation: AutomationView;

  /** Whether a write for this row is in flight. */
  readonly isBusy: boolean;

  /** Called to open the editor. */
  readonly onEdit: () => void;

  /** Called to turn it on or off. */
  readonly onToggle: (isEnabled: boolean) => void;

  /** Called to delete it. */
  readonly onDelete: () => void;
};

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
  const { automation, isBusy, onEdit, onToggle, onDelete } = props;
  const summary = summaryOf(automation.definition);
  const lastRun =
    automation.lastTriggeredAt === null
      ? 'Not run yet'
      : `Ran ${relativeTime(automation.lastTriggeredAt)}`;

  return (
    <li className={`${AUTOMATION_COLUMNS} border-t border-border px-5 py-3 first:border-t-0`}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <Link
          to={`/automations/${automation.id}`}
          className="truncate text-ui font-medium text-foreground transition-colors hover:text-primary"
        >
          {automation.name}
        </Link>
        <Chain summary={summary} />
      </span>

      <span className="hidden text-ui-sm text-foreground-muted md:block">
        {MODE_LABELS[automation.mode]}
      </span>

      <span>
        <Switch
          label={`${automation.name} enabled`}
          isOn={automation.isEnabled}
          isBusy={isBusy}
          onChange={onToggle}
        />
      </span>

      <span className="hidden font-mono text-mono-caption text-foreground-subtle tabular md:block">
        {lastRun}
      </span>

      <OverflowMenu
        label={`More for ${automation.name}`}
        items={[
          { label: 'Edit', icon: 'pencil', onSelect: onEdit },
          {
            label: 'Delete',
            icon: 'trash-2',
            tone: 'danger',
            disabled: isBusy,
            onSelect: onDelete,
          },
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
  const { summary } = props;

  if (summary === null) {
    return (
      <span className="text-caption text-warning">
        Its definition is not in a shape this build understands.
      </span>
    );
  }

  return (
    <span className="truncate text-ui-sm text-foreground-subtle">
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
