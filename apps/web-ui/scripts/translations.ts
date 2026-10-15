/**
 * What the translation check reads and what it holds the catalogues to (RULES.md 1).
 *
 * Every string the interface says goes through `t('key', 'English')` - or `translate`, or
 * `defineMessage`, or `<Trans i18nKey defaults>` - and this reads them out of the source with
 * the TypeScript parser, then holds each catalogue to them:
 *
 * - every key is written out and carries its English, so the English is the fallback and the
 *   check can see the key at all;
 * - a key says one thing in English wherever it is used;
 * - a catalogue has every key, a plural in every form its language has (`one`, `many`, `other`
 *   for Italian), and nothing nobody uses;
 * - a translation fills only the `{{placeholders}}` its English has.
 *
 * And, beside the catalogues, that no source file outside them holds a letter outside ASCII:
 * nothing in the code is written in another language.
 *
 * Pure functions over text, so the tests feed them strings; `check-translations.ts` reads the
 * files and runs them.
 */
import ts from 'typescript';

/** One string the source says. */
export type TranslationUse = {
  /** Its key in the catalogue. */
  readonly key: string;

  /** Its English: one form, under `''`, or one per plural category. */
  readonly english: Readonly<Record<string, string>>;

  /** Whether it is chosen by a count. */
  readonly isPlural: boolean;

  /** Where it is said, for the report. */
  readonly where: string;
};

/** One thing wrong. */
export type TranslationProblem = {
  readonly where: string;
  readonly message: string;
};

/** The functions that say a string, by name. `i18n.t` is matched separately. */
const SAYERS = new Set(['t', 'translate', 'defineMessage']);

/** A `{{placeholder}}`, with or without a format after a comma. */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g;

/** A letter that is not ASCII: a word in some other language. */
const FOREIGN_LETTER = /(?!\p{ASCII})\p{L}/u;

/**
 * Reads a node as a string written out in full.
 *
 * @param node - The node.
 * @returns The string, or undefined when it is not one.
 */
function literalOf(node: ts.Node | undefined): string | undefined {
  if (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return node.text;
  }

  return undefined;
}

/**
 * Names a property of an object literal.
 *
 * @param property - The property.
 * @returns Its name, or undefined for a spread or a computed one.
 */
function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (
    (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
  ) {
    return property.name.text;
  }

  return undefined;
}

/**
 * Reads the English out of the second argument of `t`.
 *
 * @param argument - A string, or the options.
 * @returns The forms and whether a count chooses between them, or undefined when there is no
 * English written out.
 */
function englishOf(
  argument: ts.Expression | undefined,
): { english: Record<string, string>; isPlural: boolean } | undefined {
  const single = literalOf(argument);

  if (single !== undefined) {
    return { english: { '': single }, isPlural: false };
  }

  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) {
    return undefined;
  }

  const english: Record<string, string> = {};
  for (const property of argument.properties) {
    const name = propertyName(property);

    if (name === undefined || !ts.isPropertyAssignment(property)) {
      continue;
    }

    const value = literalOf(property.initializer);

    if (value === undefined) {
      continue;
    }

    if (name === 'defaultValue') {
      english[''] = value;
    } else if (name.startsWith('defaultValue_')) {
      english[name.slice('defaultValue_'.length)] = value;
    }
  }

  const forms = Object.keys(english).filter((form) => form !== '');

  if (forms.length > 0) {
    return { english, isPlural: true };
  }

  // A count with one English form is a sentence that only fills the number in, not a plural.
  return '' in english ? { english, isPlural: false } : undefined;
}

/**
 * Says whether a call is one that says a string.
 *
 * @param call - The call.
 * @returns True for `t`, `translate`, `defineMessage` and `i18n.t`.
 */
function isSayer(call: ts.CallExpression): boolean {
  const callee = call.expression;

  if (ts.isIdentifier(callee)) {
    return SAYERS.has(callee.text);
  }

  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 't' &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'i18n'
  );
}

/**
 * Reads every string a source file says.
 *
 * @param fileName - The file, for the report and for the parser's dialect.
 * @param sourceText - Its text.
 * @returns What it says, and what is wrong with how it says it.
 */
export function extractUses(
  fileName: string,
  sourceText: string,
): { uses: TranslationUse[]; problems: TranslationProblem[] } {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const uses: TranslationUse[] = [];
  const problems: TranslationProblem[] = [];

  /**
   * Says where a node is.
   *
   * @param node - The node.
   * @returns `file:line`.
   */
  const whereOf = (node: ts.Node): string =>
    `${fileName}:${String(source.getLineAndCharacterOfPosition(node.getStart()).line + 1)}`;

  /**
   * Visits one node and everything under it.
   *
   * @param node - The node.
   */
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isSayer(node)) {
      const key = literalOf(node.arguments[0]);
      const said = englishOf(node.arguments[1]);

      if (key === undefined) {
        problems.push({ where: whereOf(node), message: 'The key must be written out in full' });
      } else if (said === undefined) {
        problems.push({
          where: whereOf(node),
          message: `"${key}" has no English written beside it`,
        });
      } else {
        uses.push({ key, english: said.english, isPlural: said.isPlural, where: whereOf(node) });
      }
    }

    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText() === 'Trans'
    ) {
      let key: string | undefined;
      let english: string | undefined;

      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.initializer === undefined) {
          continue;
        }

        const name = attribute.name.getText();
        const value = ts.isStringLiteral(attribute.initializer)
          ? attribute.initializer.text
          : ts.isJsxExpression(attribute.initializer)
            ? literalOf(attribute.initializer.expression)
            : undefined;

        if (name === 'i18nKey') {
          key = value;
        } else if (name === 'defaults') {
          english = value;
        }
      }

      if (key === undefined || english === undefined) {
        problems.push({
          where: whereOf(node),
          message: '<Trans> needs i18nKey and defaults, both written out',
        });
      } else {
        uses.push({ key, english: { '': english }, isPlural: false, where: whereOf(node) });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return { uses, problems };
}

/**
 * Flattens a catalogue into its keys.
 *
 * @param tree - The catalogue, as parsed.
 * @param prefix - The key so far.
 * @param into - Where the keys go.
 * @param problems - Where a leaf that is not a string is reported.
 * @returns The keys and what each says.
 */
export function flattenCatalogue(
  tree: unknown,
  prefix = '',
  into = new Map<string, string>(),
  problems: TranslationProblem[] = [],
): Map<string, string> {
  if (typeof tree !== 'object' || tree === null || Array.isArray(tree)) {
    problems.push({
      where: prefix || '(root)',
      message: 'A catalogue is an object of objects and strings',
    });

    return into;
  }

  for (const [name, value] of Object.entries(tree)) {
    const key = prefix === '' ? name : `${prefix}.${name}`;

    if (typeof value === 'string') {
      into.set(key, value);
    } else {
      flattenCatalogue(value, key, into, problems);
    }
  }

  return into;
}

/**
 * The placeholders a string fills.
 *
 * @param value - The string.
 * @returns Their names.
 */
function placeholdersOf(value: string): Set<string> {
  return new Set([...value.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ''));
}

/**
 * Holds a catalogue to what the source says.
 *
 * @param uses - Every string the source says.
 * @param catalogue - The catalogue, as parsed.
 * @param locale - Its language, whose plural categories a plural must cover.
 * @returns What is wrong.
 */
export function checkCatalogue(
  uses: readonly TranslationUse[],
  catalogue: unknown,
  locale: string,
): TranslationProblem[] {
  const problems: TranslationProblem[] = [];
  const entries = flattenCatalogue(catalogue, '', new Map(), problems);
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  const byKey = new Map<string, TranslationUse>();
  const expected = new Set<string>();

  for (const use of uses) {
    const earlier = byKey.get(use.key);

    if (earlier !== undefined && JSON.stringify(earlier.english) !== JSON.stringify(use.english)) {
      problems.push({
        where: use.where,
        message: `"${use.key}" says something else in English at ${earlier.where}`,
      });
      continue;
    }

    byKey.set(use.key, use);
  }

  for (const use of byKey.values()) {
    const allowed = new Set(
      Object.values(use.english).flatMap((value) => [...placeholdersOf(value)]),
    );
    const keys = use.isPlural ? categories.map((category) => `${use.key}_${category}`) : [use.key];

    for (const key of keys) {
      expected.add(key);

      const translated = entries.get(key);

      if (translated === undefined) {
        problems.push({ where: use.where, message: `${locale}.json has no "${key}"` });
        continue;
      }

      for (const name of placeholdersOf(translated)) {
        if (!allowed.has(name)) {
          problems.push({
            where: use.where,
            message: `${locale}.json "${key}" fills {{${name}}}, which the English does not have`,
          });
        }
      }
    }
  }

  for (const key of entries.keys()) {
    if (!expected.has(key)) {
      problems.push({ where: `${locale}.json`, message: `"${key}" is not said anywhere` });
    }
  }

  for (const key of expected) {
    if ([...expected].some((other) => other.startsWith(`${key}.`))) {
      problems.push({
        where: `${locale}.json`,
        message: `"${key}" is both a string and the start of other keys`,
      });
    }
  }

  return problems;
}

/**
 * Finds letters outside ASCII in a source file: words in a language other than English.
 *
 * @param fileName - The file, for the report.
 * @param sourceText - Its text.
 * @returns One problem per line with one.
 */
export function findForeignLetters(fileName: string, sourceText: string): TranslationProblem[] {
  return sourceText.split('\n').flatMap((line, index) =>
    FOREIGN_LETTER.test(line)
      ? [
          {
            where: `${fileName}:${String(index + 1)}`,
            message: 'Only English is written outside the catalogues',
          },
        ]
      : [],
  );
}
