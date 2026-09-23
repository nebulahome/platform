/**
 * The formula field: a real text input with coloured variable tags drawn underneath.
 *
 * The caret and selection stay on the transparent input. A monospace backdrop behind it paints
 * each source variable as a coloured tag the moment the word matches; the saved value is still
 * plain text such as `(t1 + t2) / 3`.
 */
import type { TagColor } from '@nebula-home/contracts';
import { FieldShell, cn, controlFace } from '@nebula-home/ui';

/** Colour classes for a source variable, spelled out so Tailwind can see every one. */
export const SOURCE_COLOR_CLASSES: Record<TagColor, string> = {
  red: 'border-tag-red/30 bg-tag-red/13 text-tag-red',
  orange: 'border-tag-orange/30 bg-tag-orange/13 text-tag-orange',
  amber: 'border-tag-amber/30 bg-tag-amber/13 text-tag-amber',
  yellow: 'border-tag-yellow/30 bg-tag-yellow/13 text-tag-yellow',
  lime: 'border-tag-lime/30 bg-tag-lime/13 text-tag-lime',
  green: 'border-tag-green/30 bg-tag-green/13 text-tag-green',
  teal: 'border-tag-teal/30 bg-tag-teal/13 text-tag-teal',
  cyan: 'border-tag-cyan/30 bg-tag-cyan/13 text-tag-cyan',
  blue: 'border-tag-blue/30 bg-tag-blue/13 text-tag-blue',
  indigo: 'border-tag-indigo/30 bg-tag-indigo/13 text-tag-indigo',
  violet: 'border-tag-violet/30 bg-tag-violet/13 text-tag-violet',
  pink: 'border-tag-pink/30 bg-tag-pink/13 text-tag-pink',
};

/** Text colour alone, for tokens in the formula backdrop (no padding, so the caret stays true). */
const SOURCE_TEXT_CLASSES: Record<TagColor, string> = {
  red: 'rounded-sm bg-tag-red/13 text-tag-red',
  orange: 'rounded-sm bg-tag-orange/13 text-tag-orange',
  amber: 'rounded-sm bg-tag-amber/13 text-tag-amber',
  yellow: 'rounded-sm bg-tag-yellow/13 text-tag-yellow',
  lime: 'rounded-sm bg-tag-lime/13 text-tag-lime',
  green: 'rounded-sm bg-tag-green/13 text-tag-green',
  teal: 'rounded-sm bg-tag-teal/13 text-tag-teal',
  cyan: 'rounded-sm bg-tag-cyan/13 text-tag-cyan',
  blue: 'rounded-sm bg-tag-blue/13 text-tag-blue',
  indigo: 'rounded-sm bg-tag-indigo/13 text-tag-indigo',
  violet: 'rounded-sm bg-tag-violet/13 text-tag-violet',
  pink: 'rounded-sm bg-tag-pink/13 text-tag-pink',
};

/** One source colour the formula can paint. */
export type FormulaSourceColor = {
  readonly variableName: string;
  readonly color: TagColor;
};

/** What the field needs. */
export type AliasFormulaFieldProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly sources: readonly FormulaSourceColor[];
  readonly required?: boolean;
};

/**
 * Splits the formula into plain runs and coloured variable tokens.
 *
 * @param value - The formula text.
 * @param colors - Variable names to their palette colour.
 * @returns Segments for the backdrop.
 */
export function formulaSegments(
  value: string,
  colors: ReadonlyMap<string, TagColor>,
): readonly { readonly text: string; readonly color: TagColor | null }[] {
  if (colors.size === 0 || value === '') {
    return [{ text: value === '' ? ' ' : value, color: null }];
  }

  const names = [...colors.keys()]
    .filter((name) => name !== '')
    .sort((left, right) => right.length - left.length);

  if (names.length === 0) {
    return [{ text: value, color: null }];
  }

  const pattern = new RegExp(`\\b(${names.map(escapeRegex).join('|')})\\b`, 'gu');
  const segments: { text: string; color: TagColor | null }[] = [];
  let last = 0;

  for (const match of value.matchAll(pattern)) {
    const at = match.index;
    const word = match[1] ?? '';

    if (at > last) {
      segments.push({ text: value.slice(last, at), color: null });
    }

    segments.push({ text: word, color: colors.get(word) ?? null });
    last = at + word.length;
  }

  if (last < value.length) {
    segments.push({ text: value.slice(last), color: null });
  }

  if (segments.length === 0) {
    segments.push({ text: value, color: null });
  }

  return segments;
}

/**
 * Escapes a string for use inside a RegExp.
 *
 * @param value - The literal.
 * @returns The escaped form.
 */
function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Renders the formula field.
 *
 * @param props - See {@link AliasFormulaFieldProps}.
 * @returns The field.
 */
export function AliasFormulaField(props: AliasFormulaFieldProps) {
  const { value, onChange, sources, required = false } = props;
  const colors = new Map(
    sources
      .filter((source) => source.variableName.trim() !== '')
      .map((source) => [source.variableName.trim(), source.color]),
  );
  const segments = formulaSegments(value, colors);

  // Where each segment starts in the text: unique, and what React keys the painted spans by.
  const starts = segments.map((segment, index) =>
    segments.slice(0, index).reduce((sum, earlier) => sum + earlier.text.length, 0),
  );

  return (
    <FieldShell label="Formula" hint="Variables are the source names below, e.g. (t1 + t2) / 2.">
      {(ids) => (
        <div className="relative">
          <div
            aria-hidden="true"
            className={cn(
              controlFace({ size: 'medium', isInvalid: ids.isInvalid }),
              'pointer-events-none absolute inset-0 overflow-hidden font-mono whitespace-pre text-foreground',
            )}
          >
            {segments.map((segment, index) =>
              segment.color === null ? (
                <span key={starts[index]}>{segment.text}</span>
              ) : (
                <span key={starts[index]} className={SOURCE_TEXT_CLASSES[segment.color]}>
                  {segment.text}
                </span>
              ),
            )}
          </div>
          <input
            id={ids.id}
            aria-invalid={ids.isInvalid}
            aria-describedby={ids.describedBy}
            required={required}
            autoComplete="off"
            spellCheck={false}
            value={value}
            className={cn(
              controlFace({ size: 'medium', isInvalid: ids.isInvalid }),
              'relative bg-transparent font-mono text-transparent caret-foreground',
            )}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        </div>
      )}
    </FieldShell>
  );
}
