/**
 * The formula field: a real text area, with the formula drawn underneath it in colour.
 *
 * The caret, the selection and the typing all belong to a transparent `<textarea>`; behind it a
 * copy of the text is painted - each source variable in its source's colour, numbers, strings
 * and operators in quieter tones, anything the evaluator would refuse underlined in red. The
 * saved value is still plain text such as `(t1 + t2) / 2`.
 *
 * **The two layers are the same box.** Same border width, same padding, same face and size of
 * type, the same wrapping, and the painted copy scrolls with the text area - a copy that is a
 * few pixels off draws every coloured word beside the letters the caret is actually on. Nothing
 * that marks a word takes room: a variable's chip is a tint and a shadow ({@link token-halo}),
 * never padding, and no mark changes the weight of the type.
 *
 * Several lines are allowed - the evaluator reads a newline as a space - and the field grows
 * with what is written.
 *
 * The box can carry a footer inside its border, as the board draws it: what the formula reads
 * now on the left, what may be written on the right. The border and the focus ring belong to the
 * box around both, so the footer is part of the field rather than a line under it.
 */
import { useRef, type ReactNode } from 'react';

import { scanAliasExpression, type AliasSpanKind, type TagColor } from '@nebulahome/contracts';
import { FieldShell, cn } from '@nebulahome/ui';

/** Colour classes for a source variable's chip, spelled out so Tailwind can see every one. */
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

/** The text colour of each variable, for its chip inside the formula. */
const VARIABLE_TEXT: Record<TagColor, string> = {
  red: 'text-tag-red',
  orange: 'text-tag-orange',
  amber: 'text-tag-amber',
  yellow: 'text-tag-yellow',
  lime: 'text-tag-lime',
  green: 'text-tag-green',
  teal: 'text-tag-teal',
  cyan: 'text-tag-cyan',
  blue: 'text-tag-blue',
  indigo: 'text-tag-indigo',
  violet: 'text-tag-violet',
  pink: 'text-tag-pink',
};

/** How each other kind of stretch is drawn. None of them changes the width of a letter. */
const KIND_CLASSES: Readonly<Record<Exclude<AliasSpanKind, 'ident'>, string>> = {
  space: '',
  number: 'text-foreground',
  string: 'text-tag-green',
  boolean: 'text-tag-violet',
  op: 'text-foreground-subtle',
  invalid: 'text-danger underline decoration-danger decoration-wavy underline-offset-4',
};

/**
 * The box both layers share, so the painted copy lies exactly under the typed text. Both keep a
 * transparent border of the same width; the visible one is the frame's.
 */
const LAYER =
  'block w-full border border-transparent px-3.5 py-2.5 font-mono text-ui whitespace-pre-wrap break-words';

/** One source colour the formula can paint. */
export type FormulaSourceColor = {
  readonly variableName: string;
  readonly color: TagColor;
};

/** One painted stretch of the formula. */
export type FormulaSegment = {
  readonly text: string;

  /** The class it is drawn with; empty for plain text. */
  readonly className: string;

  /** Whether it names a variable no source has, which the field reports. */
  readonly isUnknown: boolean;
};

/** What the field needs. */
export type AliasFormulaFieldProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly sources: readonly FormulaSourceColor[];
  readonly required?: boolean;

  /** What the formula works out to now, or how to write one, under the field. */
  readonly hint?: string | undefined;

  /** Why the formula cannot be worked out, when it cannot. */
  readonly error?: string | undefined;

  /** Hides the label, for a field under a heading that already says Formula. */
  readonly isLabelHidden?: boolean;

  /** A line inside the frame, under the text: what it reads now, what may be written. */
  readonly footer?: ReactNode;
};

/**
 * Cuts the formula into the stretches the backdrop paints.
 *
 * @param value - The formula text.
 * @param colors - Variable names to their palette colour.
 * @returns The segments, covering the text exactly.
 */
export function formulaSegments(
  value: string,
  colors: ReadonlyMap<string, TagColor>,
): readonly FormulaSegment[] {
  return scanAliasExpression(value).map((span) => {
    const text = value.slice(span.start, span.end);

    if (span.kind !== 'ident') {
      return { text, className: KIND_CLASSES[span.kind], isUnknown: false };
    }

    const color = colors.get(text);

    return color === undefined
      ? {
          text,
          className: 'text-danger underline decoration-danger decoration-wavy underline-offset-4',
          isUnknown: true,
        }
      : { text, className: cn('token-halo', VARIABLE_TEXT[color]), isUnknown: false };
  });
}

/**
 * Renders the formula field.
 *
 * @param props - See {@link AliasFormulaFieldProps}.
 * @returns The field.
 */
export function AliasFormulaField(props: AliasFormulaFieldProps) {
  const {
    value,
    onChange,
    sources,
    required = false,
    hint,
    error,
    isLabelHidden = false,
    footer,
  } = props;
  const backdrop = useRef<HTMLDivElement>(null);
  const colors = new Map(
    sources
      .filter((source) => source.variableName.trim() !== '')
      .map((source) => [source.variableName.trim(), source.color]),
  );
  const segments = formulaSegments(value, colors);
  const lines = value.split('\n').length;

  // Where each segment starts in the text: unique, and what React keys the painted spans by.
  const starts = segments.map((segment, index) =>
    segments.slice(0, index).reduce((sum, earlier) => sum + earlier.text.length, 0),
  );

  return (
    <FieldShell
      label="Formula"
      isLabelHidden={isLabelHidden}
      // One line under the field: what is wrong, when something is; otherwise what it reads. A
      // field with a footer says what it reads there, and its heading says how to write it.
      hint={
        error === undefined
          ? (hint ??
            (footer === undefined
              ? 'Write it with the variables of the sources, e.g. (t1 + t2) / 2.'
              : undefined))
          : undefined
      }
      error={error}
    >
      {(ids) => (
        <div
          className={cn(
            'overflow-hidden rounded-field border bg-surface-raised transition-[border-color,box-shadow]',
            'focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/25',
            ids.isInvalid ? 'border-danger' : 'border-border',
          )}
        >
          <div className="relative">
            <div
              ref={backdrop}
              aria-hidden="true"
              className={cn(
                LAYER,
                'pointer-events-none absolute inset-0 overflow-hidden text-foreground',
              )}
            >
              {segments.map((segment, index) => (
                <span key={starts[index]} className={segment.className}>
                  {segment.text}
                </span>
              ))}
              {/* A text area ending in a newline shows the empty line under it; so must the copy. */}{' '}
            </div>
            <textarea
              id={ids.id}
              aria-invalid={ids.isInvalid}
              aria-describedby={ids.describedBy}
              required={required}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              rows={Math.max(3, lines)}
              placeholder="(t1 + t2) / 2"
              value={value}
              className={cn(
                LAYER,
                'relative min-h-24 resize-none overflow-y-auto bg-transparent',
                'text-transparent caret-foreground placeholder:text-foreground-disabled',
                'field-sizing-content selection:bg-primary/30 selection:text-transparent',
                'focus-visible:outline-none',
              )}
              onChange={(event) => {
                onChange(event.target.value);
              }}
              onScroll={(event) => {
                if (backdrop.current !== null) {
                  backdrop.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
            />
          </div>
          {footer === undefined ? null : (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-3.5 py-2.5">
              {footer}
            </div>
          )}
        </div>
      )}
    </FieldShell>
  );
}
