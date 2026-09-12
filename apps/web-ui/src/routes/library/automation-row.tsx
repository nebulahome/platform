/**
 * One automation in the list.
 *
 * The whole chain on one line — what wakes it, what it checks, what it does — because the
 * question somebody scanning this page is asking is "which one is the porch light", and reading
 * the rule is how they answer it. The alternative is a column of names, which tells them nothing
 * they did not already know from the sidebar.
 *
 * **Enabled is a switch, and it writes.** It is the one thing about an automation that can be
 * changed without opening anything, and it is the thing people most often want to change: an
 * automation misbehaving at two in the morning is turned off, not edited.
 *
 * There is no Run button. `POST /automations/:id/trigger` does not exist, because nothing is
 * listening yet (API.md §10), and a button that posted to it would fail at the one moment it
 * mattered.
 */
import type { AutomationDefinition, AutomationView } from '@nebula-home/contracts';
import { Badge, Button, cn, PanelRow } from '@nebula-home/ui';

import { describeAutomation } from '@/lib/describe-automation';
import { relativeTime } from '@/lib/format-time';

/** What one row needs. */
export type AutomationRowProps = {
  /** The automation. */
  readonly automation: AutomationView;

  /** Whether a write for this row is in flight. */
  readonly isBusy: boolean;

  /** Called to turn it on or off. */
  readonly onToggle: (isEnabled: boolean) => void;

  /** Called to delete it. */
  readonly onDelete: () => void;
};

/**
 * Renders one automation.
 *
 * The definition is parsed defensively. It comes from a `jsonb` column that predates the schema
 * validating it, so a row written before this release can be anything at all — and a list that
 * throws on one bad document shows nothing instead of showing the other nine.
 *
 * @param props - See {@link AutomationRowProps}.
 * @returns The row.
 */
export function AutomationRow(props: AutomationRowProps) {
  const { automation, isBusy, onToggle, onDelete } = props;
  const summary = readSummary(automation.definition);

  return (
    <PanelRow
      title={
        <span className="flex items-center gap-2.5">
          <span>{automation.name}</span>
          {automation.isEnabled ? null : <Badge tone="neutral">Off</Badge>}
          {automation.mode === 'single' ? null : (
            <Badge tone="neutral" size="small">
              {automation.mode}
            </Badge>
          )}
        </span>
      }
      note={
        summary === null ? (
          <span className="text-warning">
            Its definition is not in a shape this build understands.
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <Step>{summary.trigger}</Step>
            {summary.conditions === null ? null : (
              <>
                <Arrow />
                <Step>{summary.conditions}</Step>
              </>
            )}
            <Arrow />
            <Step>{summary.actions}</Step>
          </span>
        )
      }
      control={
        <span className="flex items-center gap-2">
          <span className="hidden text-caption text-foreground-subtle tabular sm:inline">
            {automation.lastTriggeredAt === null
              ? 'never run'
              : `ran ${relativeTime(automation.lastTriggeredAt)}`}
          </span>

          <Button
            variant="ghost"
            size="compact"
            isBusy={isBusy}
            aria-pressed={automation.isEnabled}
            onClick={() => {
              onToggle(!automation.isEnabled);
            }}
          >
            {automation.isEnabled ? 'Turn off' : 'Turn on'}
          </Button>

          <Button variant="danger" size="compact" disabled={isBusy} onClick={onDelete}>
            Delete
          </Button>
        </span>
      }
    />
  );
}

/**
 * Reads the stored document, or gives up on it.
 *
 * @param definition - Whatever the column held.
 * @returns The summary, or null when the document is not one this build can read.
 */
function readSummary(definition: unknown): ReturnType<typeof describeAutomation> | null {
  const document = definition as AutomationDefinition;

  if (!Array.isArray(document.triggers) || !Array.isArray(document.actions)) {
    return null;
  }

  return describeAutomation({
    triggers: document.triggers,
    conditions: Array.isArray(document.conditions) ? document.conditions : [],
    actions: document.actions,
  });
}

/** What one step of the chain needs. */
type StepProps = {
  /** The phrase. */
  readonly children: string;
};

/**
 * One phrase of the chain.
 *
 * @param props - See {@link StepProps}.
 * @returns The phrase.
 */
function Step(props: StepProps) {
  const { children } = props;

  return <span className={cn('text-foreground-muted')}>{children}</span>;
}

/**
 * The mark between two steps.
 *
 * Hidden from a screen reader: read aloud, the chain is three phrases in a row, and an arrow
 * between them is punctuation rather than a word.
 *
 * @returns The arrow.
 */
function Arrow() {
  return (
    <span aria-hidden="true" className="text-foreground-subtle">
      →
    </span>
  );
}
