/**
 * One automation in the list table.
 *
 * The whole chain on one line — what wakes it, what it checks, what it does — because the
 * question somebody scanning this page is asking is "which one is the porch light", and reading
 * the rule is how they answer it.
 *
 * **Enabled is a switch, and it writes.** It is the one thing about an automation that can be
 * changed without opening anything. Edit opens the editor; Delete removes the row.
 *
 * There is no Run button. `POST /automations/:id/trigger` does not exist, because nothing is
 * listening yet (API.md §10), and a button that posted to it would fail at the one moment it
 * mattered.
 */
import {
  migrateDefinition,
  type AutomationDefinition,
  type AutomationView,
} from '@nebula-home/contracts';
import { Badge, Button, cn } from '@nebula-home/ui';

import { describeAutomation } from '@/lib/describe-automation';
import { relativeTime } from '@/lib/format-time';

/**
 * The column widths, shared by the header and every row so they line up.
 *
 * Name and chain take the flexible room; mode, last run, status and the actions stay fixed so a
 * long summary never shoves Edit off the edge of a narrow window.
 */
export const AUTOMATION_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 ' +
  'md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_88px_104px_72px_auto]';

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
  const summary = readSummary(automation.definition);
  const lastRun =
    automation.lastTriggeredAt === null ? 'never run' : relativeTime(automation.lastTriggeredAt);

  return (
    <li className="border-b border-border-soft last:border-b-0">
      <div className={`${AUTOMATION_COLUMNS} px-4 py-3`}>
        <span className="min-w-0 truncate text-ui font-medium text-foreground">
          {automation.name}
        </span>

        <span className="hidden min-w-0 md:block">
          <Chain summary={summary} />
        </span>

        <span className="hidden text-ui text-foreground-muted md:block">{automation.mode}</span>

        <span className="hidden text-caption text-foreground-subtle tabular md:block">
          {lastRun}
        </span>

        <span className="hidden md:block">
          <Badge tone={automation.isEnabled ? 'success' : 'neutral'} size="small">
            {automation.isEnabled ? 'Enabled' : 'Off'}
          </Badge>
        </span>

        <span className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="compact" onClick={onEdit}>
            Edit
          </Button>
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
      </div>

      {/* Narrow windows: chain, mode and standing under the name, since the grid collapses. */}
      <div className="flex flex-col gap-1.5 px-4 pb-3 md:hidden">
        <Chain summary={summary} />
        <span className="text-caption text-foreground-muted">
          {automation.mode} · {lastRun}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={automation.isEnabled ? 'success' : 'neutral'} size="small">
            {automation.isEnabled ? 'Enabled' : 'Off'}
          </Badge>
        </span>
      </div>
    </li>
  );
}

/** What the chain cell needs. */
type ChainProps = {
  readonly summary: ReturnType<typeof describeAutomation> | null;
};

/**
 * The trigger → if → then line, or a warning when the document cannot be read.
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
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption">
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
  );
}

/**
 * Reads the stored document, or gives up on it.
 *
 * @param definition - Whatever the column held.
 * @returns The summary, or null when the document is not one this build can read.
 */
function readSummary(definition: unknown): ReturnType<typeof describeAutomation> | null {
  // Legacy rows may still hold `{ triggers: [...], conditions, actions }`; the schema's own
  // migration lifts them, so the list reads them exactly as a save would.
  const document: unknown = migrateDefinition(definition);

  if (document === null || typeof document !== 'object') {
    return null;
  }

  const {
    triggers,
    if: ifTree,
    then,
  } = document as { readonly triggers?: unknown; readonly if?: unknown; readonly then?: unknown };

  if (triggers === undefined || triggers === null || !Array.isArray(then)) {
    return null;
  }

  // Not parsed: a leaf this build does not know still reads as its kind, rather than the whole
  // row reading as nothing.
  return describeAutomation({
    triggers: triggers as AutomationDefinition['triggers'],
    if: ifTree as AutomationDefinition['if'],
    then: then as AutomationDefinition['then'],
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
