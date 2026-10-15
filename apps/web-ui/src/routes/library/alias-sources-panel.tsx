/**
 * An alias's sources: each a variable the formula names, the entity it reads, and what that
 * entity reads now.
 *
 * As the board draws it: a section headed Sources with Add a source on the right, then a table -
 * Variable, Entity, Now - one row per source, the same height from end to end. The variable is a
 * chip in its colour, the colour it is drawn in inside the formula, so the eye can match the two;
 * the entity is chosen from the house in the picker; Now is its live reading, so a formula's
 * result can be checked against its inputs without leaving the page. The × that takes a row away
 * is always there and only refuses when the row is the last one, so adding a second source does
 * not shift the first. A name that is badly formed, or already taken, is said under its row as it
 * is typed rather than after a save.
 */
import { useTranslation } from 'react-i18next';

import type { EntityView, TagColor } from '@nebulahome/contracts';
import { AppIcon, Button, IconButton, Section, cn } from '@nebulahome/ui';

import { nextVariableName, variableProblem, type SourceDraft } from '@/library/alias-sources';
import { SOURCE_COLOR_CLASSES } from '@/routes/library/alias-formula-field';
import { EntityField } from '@/routes/library/entity-field';

/** The columns, shared by the header and every row so they line up. */
const SOURCE_COLUMNS =
  'grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-3 ' +
  'md:grid-cols-[9rem_minmax(0,1fr)_6rem_auto]';

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

  /** What an entity reads now, by its address; a dash before it has said anything. */
  readonly nowOf: (entityId: string) => string;
};

/**
 * Renders the panel.
 *
 * @param props - See {@link AliasSourcesPanelProps}.
 * @returns The panel.
 */
export function AliasSourcesPanel(props: AliasSourcesPanelProps) {
  const { t } = useTranslation();

  const { sources, colors, onChange, selfId, nowOf } = props;

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
    <Section
      title={t('library.aliasSourcesPanel.sources', 'Sources')}
      actions={
        <Button
          variant="ghost"
          size="compact"
          onClick={() => {
            onChange([
              ...sources,
              { rowKey: nextRowKey(), variableName: nextVariableName(sources), entityId: '' },
            ]);
          }}
        >
          <AppIcon id="plus" size={15} />
          {t('library.aliasSourcesPanel.addASource', 'Add a source')}
        </Button>
      }
    >
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <div
          aria-hidden="true"
          className={`${SOURCE_COLUMNS} border-b border-border px-4 py-2.5 font-mono text-label text-foreground-subtle uppercase`}
        >
          <span>{t('library.aliasSourcesPanel.variable', 'Variable')}</span>
          <span>{t('library.aliasSourcesPanel.entity', 'Entity')}</span>
          <span className="hidden text-right md:block">
            {t('library.aliasSourcesPanel.now', 'Now')}
          </span>
          <span className="w-8" />
        </div>
        <ol className="flex flex-col">
          {sources.map((source, index) => {
            const color = colors.get(source.rowKey) ?? 'indigo';
            const problem =
              source.variableName.trim() === '' && sources.length === 1
                ? null
                : variableProblem(sources, index);
            const inputId = `alias-source-var-${source.rowKey}`;
            const problemId = `${inputId}-problem`;
            const spoken =
              source.variableName.trim() === ''
                ? `source ${String(index + 1)}`
                : source.variableName.trim();

            return (
              <li
                key={source.rowKey}
                className="flex flex-col gap-1.5 border-t border-border px-4 py-3 first:border-t-0"
              >
                <div className={SOURCE_COLUMNS}>
                  <label className="sr-only" htmlFor={inputId}>
                    {t('library.aliasSourcesPanel.variableOfSource', 'Variable of source')}{' '}
                    {index + 1}
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
                      'h-control w-full rounded-field border px-2.5 font-mono text-ui font-medium',
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
                    label={t(
                      'library.aliasSourcesPanel.entityReadAsSpoken',
                      'Entity read as {{spoken}}',
                      { spoken },
                    )}
                    isLabelHidden
                    size="medium"
                    pickerTitle={
                      source.variableName.trim() === ''
                        ? t('library.aliasSourcesPanel.whichOneIsThis', 'Which one is this source?')
                        : t('library.aliasSourcesPanel.whichOneIs', 'Which one is {{name}}?', {
                            name: source.variableName.trim(),
                          })
                    }
                    value={source.entityId}
                    accept={accept}
                    onChange={(entityId) => {
                      update(index, { entityId });
                    }}
                  />
                  <span
                    className="hidden truncate text-right font-mono text-mono-ui text-foreground tabular md:block"
                    aria-label={t(
                      'library.aliasSourcesPanel.spokenReadsNow',
                      '{{spoken}} reads now',
                      { spoken },
                    )}
                  >
                    {source.entityId === '' ? '—' : nowOf(source.entityId)}
                  </span>
                  <IconButton
                    variant="bare"
                    size="large"
                    label={
                      source.variableName.trim() === ''
                        ? t('library.aliasSourcesPanel.removeThisSource', 'Remove this source')
                        : t('library.aliasSourcesPanel.removeName', 'Remove {{name}}', {
                            name: source.variableName.trim(),
                          })
                    }
                    disabled={sources.length < 2}
                    onClick={() => {
                      onChange(sources.filter((entry, at) => at !== index));
                    }}
                  >
                    <AppIcon id="x" size={15} />
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
        </ol>
      </div>
    </Section>
  );
}
