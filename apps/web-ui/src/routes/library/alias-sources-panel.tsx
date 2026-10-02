/**
 * An alias's sources: each a variable the formula names, and the entity it reads.
 *
 * One row per source, the same height from end to end: the variable as a chip in its colour -
 * the colour it is drawn in inside the formula, so the eye can match the two - the entity it
 * reads, chosen from the house in the picker, and a button that takes the row away. The button
 * is always there and only refuses when the row is the last one, so adding a second source does
 * not shift the first. A name that is badly formed, or already taken, is said under its row as
 * it is typed rather than after a save.
 *
 * "Add a source" is a dashed row at the foot, the way every other "nothing here yet" in the
 * interface is drawn.
 */
import type { EntityView, TagColor } from '@nebulahome/contracts';
import { AppIcon, IconButton, Panel, cn } from '@nebulahome/ui';

import { nextVariableName, variableProblem, type SourceDraft } from '@/library/alias-sources';
import { SOURCE_COLOR_CLASSES } from '@/routes/library/alias-formula-field';
import { EntityField } from '@/routes/library/entity-field';

/** How many source rows have been made, so each can be told apart. */
let sourceRowCount = 0;

/**
 * A key for a new source row.
 *
 * @returns One no other row has.
 */
export function nextRowKey(): string {
  sourceRowCount += 1;

  return `source-${String(sourceRowCount)}`;
}

/** What the panel needs. */
export type AliasSourcesPanelProps = {
  readonly sources: readonly SourceDraft[];

  /** Each row's colour, by its key. */
  readonly colors: ReadonlyMap<string, TagColor>;

  /** Called with the rows as they now stand. */
  readonly onChange: (sources: SourceDraft[]) => void;

  /** The alias's own address, which cannot be one of its sources. */
  readonly selfId: string | null;
};

/**
 * Renders the panel.
 *
 * @param props - See {@link AliasSourcesPanelProps}.
 * @returns The panel.
 */
export function AliasSourcesPanel(props: AliasSourcesPanelProps) {
  const { sources, colors, onChange, selfId } = props;

  /**
   * Replaces one row.
   *
   * @param index - Which row.
   * @param change - What differs.
   */
  const update = (index: number, change: Partial<SourceDraft>): void => {
    onChange(sources.map((entry, at) => (at === index ? { ...entry, ...change } : entry)));
  };

  /**
   * Whether an entity may be read by this alias.
   *
   * @param entity - The candidate.
   * @returns False for the alias itself, which would read its own result.
   */
  const accept = (entity: EntityView): boolean => entity.entityId !== selfId;

  return (
    <Panel title="Sources">
      <ol className="flex flex-col gap-3 p-4">
        {sources.map((source, index) => {
          const color = colors.get(source.rowKey) ?? 'indigo';
          const problem =
            source.variableName.trim() === '' && sources.length === 1
              ? null
              : variableProblem(sources, index);
          const inputId = `alias-source-var-${source.rowKey}`;
          const problemId = `${inputId}-problem`;

          return (
            <li key={source.rowKey} className="flex flex-col gap-1.5">
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2">
                <label className="sr-only" htmlFor={inputId}>
                  Variable of source {index + 1}
                </label>
                <input
                  id={inputId}
                  value={source.variableName}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-invalid={problem !== null}
                  aria-describedby={problem === null ? undefined : problemId}
                  className={cn(
                    'h-control w-full rounded-field border px-2.5 text-center font-mono text-ui font-medium',
                    'transition-shadow focus-visible:ring-3 focus-visible:ring-current/25 focus-visible:outline-none',
                    problem === null
                      ? SOURCE_COLOR_CLASSES[color]
                      : 'border-danger bg-danger/10 text-danger',
                  )}
                  onChange={(event) => {
                    update(index, { variableName: event.target.value });
                  }}
                />
                <EntityField
                  label={`Entity read as ${source.variableName.trim() === '' ? `source ${String(index + 1)}` : source.variableName.trim()}`}
                  isLabelHidden
                  size="medium"
                  pickerTitle={`Which one is ${source.variableName.trim() === '' ? 'this source' : source.variableName.trim()}?`}
                  value={source.entityId}
                  accept={accept}
                  onChange={(entityId) => {
                    update(index, { entityId });
                  }}
                />
                <IconButton
                  variant="bare"
                  size="large"
                  label={`Remove ${source.variableName.trim() === '' ? 'this source' : source.variableName.trim()}`}
                  disabled={sources.length < 2}
                  onClick={() => {
                    onChange(sources.filter((entry, at) => at !== index));
                  }}
                >
                  <AppIcon id="trash-2" size={15} />
                </IconButton>
              </div>
              {problem === null ? null : (
                <p id={problemId} className="text-caption text-danger">
                  {problem}
                </p>
              )}
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className="press flex h-control w-full items-center justify-center gap-2 rounded-field border border-dashed border-border-strong text-ui text-foreground-muted transition-colors hover:border-control hover:text-foreground focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none"
            onClick={() => {
              onChange([
                ...sources,
                { rowKey: nextRowKey(), variableName: nextVariableName(sources), entityId: '' },
              ]);
            }}
          >
            <AppIcon id="plus" size={15} />
            Add a source
          </button>
        </li>
      </ol>
    </Panel>
  );
}
