/**
 * A formula over entities, with their completion: a part's Formula source, and a number an
 * alias's action works out (`command.level * 0.6`).
 *
 * Entity ids are completed from the house as they are typed; names the formula may read besides
 * entities - a command's own values in an action - are offered first and counted as known. Under
 * the field: what is not in the house, or that it is valid and how many inputs it reads.
 */
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { aliasExpressionNames, ENTITY_ID_PATTERN } from '@nebulahome/contracts';
import { AppIcon } from '@nebulahome/ui';

import { AliasFormulaField, entityFormulaPainter } from '@/routes/library/alias-formula-field';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';

/** What the field needs. */
export type EntityFormulaInputProps = {
  readonly label: string;
  readonly value: string;
  readonly onChange: (formula: string) => void;
  readonly placeholder?: string;

  /** Names it may read besides entities: `command.level`. */
  readonly extraNames?: readonly string[];

  /** Something more on the line under it. */
  readonly aside?: ReactNode;
};

/** One completion: an entity of the house, or a name the formula may also read. */
type Completion = {
  readonly name: string;
  readonly description: string;
  readonly isExtra: boolean;
};

/**
 * The word the caret is in: what a completion replaces.
 *
 * @param text - The formula.
 * @param caret - Where the caret is.
 * @returns The word and where it starts, or null outside one.
 */
function wordAt(
  text: string,
  caret: number,
): { readonly word: string; readonly start: number } | null {
  const before = /[a-z_][a-z0-9_]*(?:\.[a-zA-Z0-9_]*)?$/u.exec(text.slice(0, caret));

  return before === null ? null : { word: before[0], start: caret - before[0].length };
}

/**
 * The formula field.
 *
 * @param props - See {@link EntityFormulaInputProps}.
 * @returns The field, its completions and the line under it.
 */
export function EntityFormulaInput(props: EntityFormulaInputProps) {
  const { t } = useTranslation();
  const { label, value, onChange, placeholder, extraNames = [], aside } = props;
  const { entities } = useEntityDirectory(false);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const word = caret === null ? null : wordAt(value, caret);
  const known = new Set(entities.map((entity) => entity.entityId as string));
  const matches: Completion[] =
    word === null || word.word.length < 2
      ? []
      : [
          ...extraNames
            .filter((name) => name.startsWith(word.word) && name !== word.word)
            .map((name) => ({
              name,
              description: t('library.aliasPage.commandValue', 'What the command asks'),
              isExtra: true,
            })),
          ...entities
            .filter(
              (entity) =>
                (entity.entityId as string).startsWith(word.word) ||
                entity.name.toLowerCase().includes(word.word.toLowerCase()),
            )
            .map((entity) => ({ name: entity.entityId, description: entity.name, isExtra: false })),
        ].slice(0, 8);

  /**
   * Whether a name in the formula is one it may read: an entity of the house (or one of its
   * fields), or one of the extra names.
   *
   * @param name - The name.
   * @returns True when known.
   */
  const isKnown = (name: string): boolean =>
    extraNames.includes(name) || known.has(name.split('.').slice(0, 2).join('.'));
  let names: string[] = [];
  let problem: string | null = null;

  try {
    names = [...new Set(aliasExpressionNames(value))];
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }

  const inputs = names.filter(
    (name) =>
      extraNames.includes(name) || ENTITY_ID_PATTERN.test(name.split('.').slice(0, 2).join('.')),
  );
  const unknown = inputs.filter((name) => !isKnown(name));

  /**
   * Puts a name in place of the word being typed.
   *
   * @param name - The name.
   */
  const insert = (name: string): void => {
    if (word === null) {
      return;
    }

    const end = word.start + word.word.length;
    onChange(`${value.slice(0, word.start)}${name}${value.slice(end)}`);
    setCaret(null);
  };

  /**
   * Moves through the completions, or takes one.
   *
   * @param event - The key.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (matches.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(
        (current) =>
          (current + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length,
      );
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      insert(matches[Math.min(active, matches.length - 1)]?.name ?? '');
    } else if (event.key === 'Escape') {
      setCaret(null);
    }
  };

  return (
    <>
      <span className="relative block w-full">
        <AliasFormulaField
          label={label}
          isLabelHidden
          minRows={1}
          value={value}
          onChange={(next) => {
            onChange(next);
            setActive(0);
          }}
          sources={[]}
          paint={entityFormulaPainter(isKnown)}
          {...(placeholder === undefined ? {} : { placeholder })}
          onKeyDown={onKeyDown}
          onCaret={setCaret}
          error={problem ?? undefined}
        />
        {matches.length === 0 ? null : (
          <div
            role="listbox"
            aria-label={t('library.aliasPage.entities', 'Entities')}
            className="absolute top-full left-0 z-30 mt-1.5 flex w-[340px] flex-col rounded-tile border border-border-strong bg-surface p-1 shadow-float"
          >
            <span className="px-3 pt-1.5 pb-1 font-mono text-label text-foreground-subtle uppercase">
              {t('library.aliasPage.entitiesCountHead', 'Entities · {{count}}', {
                count: matches.length,
              })}
            </span>
            {matches.map((match, index) => (
              <button
                key={match.name}
                type="button"
                role="option"
                aria-selected={index === active}
                className={`flex items-center gap-3 rounded-field px-3 py-2 text-left transition-colors ${index === active ? 'bg-surface-raised' : 'hover:bg-surface-raised/60'}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insert(match.name);
                }}
              >
                <span className="flex min-w-0 grow flex-col">
                  <span
                    className={`truncate font-mono text-[12px] ${match.isExtra ? 'text-violet' : 'text-cyan'}`}
                  >
                    {match.name}
                  </span>
                  <span className="truncate text-caption text-foreground-subtle">
                    {match.description}
                  </span>
                </span>
              </button>
            ))}
            <div className="mt-1 flex items-center gap-3 border-t border-border px-3 pt-2 pb-1 text-caption text-foreground-subtle">
              <span>{t('library.aliasPage.completeChoose', '↑↓ choose')}</span>
              <span>{t('library.aliasPage.completeInsert', 'Enter insert')}</span>
            </div>
          </div>
        )}
      </span>
      {problem === null ? (
        <span className="flex items-center gap-3 text-caption">
          {unknown.length > 0 ? (
            <span className="flex items-center gap-1 text-danger">
              <AppIcon id="triangle-alert" size={12} />
              {t('library.aliasPage.notInHouse', 'Not in this house: {{list}}', {
                list: unknown.join(', '),
              })}
            </span>
          ) : value.trim() === '' ? (
            <span className="text-foreground-subtle">
              {t(
                'library.aliasPage.formulaHelp',
                'Entity ids, numbers, + − × ÷, comparisons, avg min max sum abs round clamp',
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-success">
              <AppIcon id="check" size={12} />
              {t('library.aliasPage.validInputs', 'Valid · {{count}} inputs', {
                count: inputs.length,
              })}
            </span>
          )}
          {aside}
        </span>
      ) : null}
    </>
  );
}
