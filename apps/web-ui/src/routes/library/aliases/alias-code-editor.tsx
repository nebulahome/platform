/**
 * The alias's code editor: CodeMirror with Python, four-space indents and bracket matching, in
 * the design system's colours. It completes entity ids, `part.` keys, the builtins (with their
 * signature) and keywords; hovering an entity id says its name and value now, a builtin its line
 * of docs; the checker's problems are underlined; a play button sits beside every `def` and runs
 * it, as Ctrl+Enter runs the function the caret is in; Ctrl+S saves.
 *
 * After a run, its trace is drawn in the code: the lines that ran marked, the rest dimmed, the
 * failing line red, and each line's values as chips at its end. Typing clears it.
 *
 * Loaded only when the Code tab opens; the default export is what `React.lazy` loads.
 */
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  EditorView,
  gutter,
  GutterMarker,
  highlightActiveLine,
  hoverTooltip,
  keymap,
  lineNumbers,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { CODE_BUILTINS, type CodeProblem, type Trace } from '@nebulahome/contracts';

/** What the editor needs. */
export type AliasCodeEditorProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly isReadOnly: boolean;
  readonly label: string;

  /** The checker's problems, underlined. */
  readonly problems: readonly CodeProblem[];

  /** The entity ids to complete, with their names. */
  readonly entities: readonly { readonly id: string; readonly name: string }[];

  /** The alias's part keys, completed after `part.`. */
  readonly parts: readonly string[];

  /** What hovering a word says: an entity's name and value now; null for nothing. */
  readonly describe: (word: string) => { readonly title: string; readonly body: string } | null;

  /** The last run's trace, drawn until the code is typed in. */
  readonly trace: Trace | null;

  /** Runs a function. */
  readonly onRun: (name: string) => void;

  /** Saves the alias. */
  readonly onSave: () => void;

  /** Where the caret is, 1-based. */
  readonly onCursor: (line: number, column: number) => void;

  /** The function to bring into view, once. */
  readonly focus: string | null;
};

/** Python's keywords, as the subset has them. */
const KEYWORDS = [
  'def',
  'return',
  'if',
  'elif',
  'else',
  'for',
  'in',
  'while',
  'break',
  'continue',
  'pass',
  'and',
  'or',
  'not',
  'is',
  'None',
  'True',
  'False',
  'mem',
  'part',
];

/** The colours of the syntax: the design system's. */
const HIGHLIGHT = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.operatorKeyword],
    color: 'var(--color-tag-pink)',
  },
  { tag: [tags.function(tags.definition(tags.variableName))], color: 'var(--color-primary-hover)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-tag-green)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--color-tag-amber)' },
  {
    tag: [tags.comment, tags.lineComment, tags.docString],
    color: 'var(--color-foreground-subtle)',
    fontStyle: 'italic',
  },
  { tag: [tags.propertyName], color: 'var(--color-cyan)' },
  {
    tag: [tags.punctuation, tags.paren, tags.squareBracket, tags.brace],
    color: 'var(--color-foreground-muted)',
  },
]);

/** The frame: the code card's dark ground, mono type, the trace's marks. */
const THEME = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--color-foreground)',
    fontSize: '13px',
    minHeight: '320px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '22px' },
  '.cm-content': { caretColor: 'var(--color-primary)', padding: '12px 0' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'color-mix(in srgb, var(--color-foreground-subtle) 70%, transparent)',
    border: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--color-foreground) 5%, transparent)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--color-primary) 25%, transparent) !important',
  },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--color-danger)',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--color-warning)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-foreground)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-tile)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--color-surface-raised)',
    color: 'var(--color-foreground)',
  },
  '.cm-trace-dim': { opacity: '0.35' },
  '.cm-trace-error': { backgroundColor: 'color-mix(in srgb, var(--color-danger) 8%, transparent)' },
  '.cm-trace-chip': {
    marginLeft: '16px',
    padding: '1px 6px',
    borderRadius: '5px',
    fontFamily: 'var(--font-sans)',
    fontSize: '11.5px',
    backgroundColor: 'color-mix(in srgb, var(--color-foreground) 6%, transparent)',
    color: 'var(--color-foreground-subtle)',
  },
  '.cm-trace-chip-taken': { color: 'var(--color-success)' },
  '.cm-trace-chip-error': { color: 'var(--color-danger)' },
  '.cm-run-gutter': { width: '22px' },
  '.cm-run': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    marginTop: '2px',
    borderRadius: '5px',
    cursor: 'pointer',
    color: 'var(--color-success)',
    backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
    fontSize: '9px',
  },
  '.cm-ran': {
    width: '6px',
    height: '6px',
    marginTop: '8px',
    marginLeft: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--color-success)',
  },
  '.cm-ran-error': { backgroundColor: 'var(--color-danger)' },
  '.cm-hover': { padding: '10px 12px', maxWidth: '320px', fontFamily: 'var(--font-sans)' },
  '.cm-hover-title': {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--color-cyan)',
  },
  '.cm-hover-body': {
    marginTop: '4px',
    fontSize: '12.5px',
    color: 'var(--color-foreground-muted)',
    whiteSpace: 'pre-wrap',
  },
});

/** Sets the trace drawn. */
const setTrace = StateEffect.define<Trace | null>();

/** Chips at a line's end. */
class ChipsWidget extends WidgetType {
  /**
   * @param chips - The labels.
   * @param tone - Taken, failing, or plain.
   */
  public constructor(
    private readonly chips: readonly string[],
    private readonly tone: 'taken' | 'error' | 'plain',
  ) {
    super();
  }

  /**
   * Whether another widget draws the same.
   *
   * @param other - The other widget.
   * @returns True when it does.
   */
  public override eq(other: ChipsWidget): boolean {
    return other.chips.join('\u0000') === this.chips.join('\u0000') && other.tone === this.tone;
  }

  /**
   * Draws the chips.
   *
   * @returns The element.
   */
  public toDOM(): HTMLElement {
    const span = document.createElement('span');

    for (const chip of this.chips) {
      const each = document.createElement('span');
      each.className = `cm-trace-chip${this.tone === 'plain' ? '' : ` cm-trace-chip-${this.tone}`}`;
      each.textContent = chip;
      span.append(each);
    }

    return span;
  }
}

/**
 * The trace's decorations.
 *
 * @param state - The editor's state.
 * @param trace - The trace, or null.
 * @returns The decorations.
 */
function traceDecorations(state: EditorState, trace: Trace | null): DecorationSet {
  if (trace === null) {
    return Decoration.none;
  }

  const ran = new Map(trace.lines.map((line) => [line.line, line]));
  const ranges: Range<Decoration>[] = [];

  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const traced = ran.get(number);
    const isError = trace.errorLine === number;

    if (isError) {
      ranges.push(Decoration.line({ class: 'cm-trace-error' }).range(line.from));
    } else if (traced === undefined && line.text.trim() !== '' && !line.text.startsWith('def ')) {
      ranges.push(Decoration.line({ class: 'cm-trace-dim' }).range(line.from));
    }

    if (traced !== undefined && traced.chips.length > 0) {
      ranges.push(
        Decoration.widget({
          widget: new ChipsWidget(
            traced.chips,
            isError
              ? 'error'
              : traced.taken && /^\s*(if|elif|return)\b/u.test(line.text)
                ? 'taken'
                : 'plain',
          ),
          side: 1,
        }).range(line.to),
      );
    }
  }

  return Decoration.set(ranges, true);
}

/** The trace, as a field: replaced by `setTrace`, dropped when the code is typed in. */
const traceField = StateField.define<{
  readonly trace: Trace | null;
  readonly decorations: DecorationSet;
}>({
  /**
   * Starts with no trace.
   *
   * @returns No trace.
   */
  create: () => ({ trace: null, decorations: Decoration.none }),

  /**
   * Follows the effects and the edits.
   *
   * @param value - The trace as it was.
   * @param transaction - What happened.
   * @returns The trace as it is.
   */
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setTrace)) {
        return {
          trace: effect.value,
          decorations: traceDecorations(transaction.state, effect.value),
        };
      }
    }

    return transaction.docChanged ? { trace: null, decorations: Decoration.none } : value;
  },

  /**
   * Gives the decorations to the view.
   *
   * @param field - The field.
   * @returns The decorations provider.
   */
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** The play button beside a def, or a line's run dot. */
class RunMarker extends GutterMarker {
  /**
   * @param kind - Play, ran, or failed.
   */
  public constructor(private readonly kind: 'play' | 'ran' | 'error') {
    super();
  }

  /**
   * Draws the marker.
   *
   * @returns The element.
   */
  public override toDOM(): Node {
    const element = document.createElement('span');

    if (this.kind === 'play') {
      element.className = 'cm-run';
      element.title = 'Run this function';
      element.textContent = '▶';
    } else {
      element.className = `cm-ran${this.kind === 'error' ? ' cm-ran-error' : ''}`;
    }

    return element;
  }
}

/** The def a line starts, if it starts one. */
const DEF = /^def\s+([a-z_][a-z0-9_]*)\s*\(/u;

/**
 * The function the caret is in: the nearest def above it.
 *
 * @param state - The editor's state.
 * @returns The function's name, or null.
 */
function functionAtCaret(state: EditorState): string | null {
  let number = state.doc.lineAt(state.selection.main.head).number;

  for (; number >= 1; number -= 1) {
    const name = DEF.exec(state.doc.line(number).text)?.[1];

    if (name !== undefined) {
      return name;
    }
  }

  return null;
}

/**
 * The editor.
 *
 * @param props - See {@link AliasCodeEditorProps}.
 * @returns The editor.
 */
export default function AliasCodeEditor(props: AliasCodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The latest props, for the extensions made once.
  const latest = useRef(props);

  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    if (host.current === null) {
      return undefined;
    }

    /**
     * Completes what is being typed.
     *
     * @param context - Where.
     * @returns The completions, or null.
     */
    const complete = (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[a-z_][a-z0-9_]*(?:\.[a-z0-9_]*)?/u);

      if (word === null || (word.from === word.to && !context.explicit)) {
        return null;
      }

      if (word.text.startsWith('part.')) {
        return {
          from: word.from + 5,
          options: latest.current.parts.map((key) => ({ label: key, type: 'property' })),
        };
      }

      if (word.text.includes('.')) {
        return {
          from: word.from,
          options: latest.current.entities.map((entity) => ({
            label: entity.id,
            detail: entity.name,
            type: 'variable',
          })),
        };
      }

      return {
        from: word.from,
        options: [
          ...CODE_BUILTINS.filter((entry) => !entry.name.includes('.')).map((entry) => ({
            label: entry.name,
            detail: entry.signature.slice(entry.name.length),
            info: entry.summary,
            type: entry.kind === 'constant' ? 'constant' : 'function',
          })),
          ...KEYWORDS.map((keyword) => ({ label: keyword, type: 'keyword' })),
          ...latest.current.entities.map((entity) => ({
            label: entity.id,
            detail: entity.name,
            type: 'variable',
          })),
        ],
      };
    };

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          lineNumbers(),
          gutter({
            class: 'cm-run-gutter',
            /**
             * The marker of a line: play beside a def, a dot on a line that ran.
             *
             * @param gutterView - The view.
             * @param block - The line.
             * @returns The marker, or null.
             */
            lineMarker: (gutterView, block) => {
              const line = gutterView.state.doc.lineAt(block.from);

              if (DEF.test(line.text)) {
                return new RunMarker('play');
              }

              const { trace } = gutterView.state.field(traceField);

              if (trace?.errorLine === line.number) {
                return new RunMarker('error');
              }

              return trace?.executedLines.includes(line.number) === true
                ? new RunMarker('ran')
                : null;
            },
            /**
             * Re-draws the markers when the trace changes.
             *
             * @param update - What changed.
             * @returns Whether to re-draw.
             */
            lineMarkerChange: (update) =>
              update.startState.field(traceField) !== update.state.field(traceField),
            domEventHandlers: {
              /**
               * Runs the def beside the button pressed.
               *
               * @param gutterView - The view.
               * @param block - The line.
               * @returns Whether it was handled.
               */
              mousedown: (gutterView, block) => {
                const name = DEF.exec(gutterView.state.doc.lineAt(block.from).text)?.[1];

                if (name === undefined) {
                  return false;
                }

                latest.current.onRun(name);
                return true;
              },
            },
          }),
          history(),
          drawSelection(),
          highlightActiveLine(),
          indentOnInput(),
          indentUnit.of('    '),
          bracketMatching(),
          python(),
          syntaxHighlighting(HIGHLIGHT),
          traceField,
          autocompletion({ override: [complete] }),
          hoverTooltip((hoverView, pos) => {
            const line = hoverView.state.doc.lineAt(pos);
            const at = pos - line.from;
            const before = /[a-z0-9_.]*$/u.exec(line.text.slice(0, at))?.[0] ?? '';
            const after = /^[a-z0-9_.]*/u.exec(line.text.slice(at))?.[0] ?? '';
            const word = `${before}${after}`.replace(/^\.+|\.+$/gu, '');
            const said = word === '' ? null : latest.current.describe(word);

            if (said === null) {
              return null;
            }

            return {
              pos: pos - before.length,
              end: pos + after.length,
              /**
               * Draws the tooltip.
               *
               * @returns Its element.
               */
              create: () => {
                const dom = document.createElement('div');
                dom.className = 'cm-hover';
                const title = document.createElement('div');
                title.className = 'cm-hover-title';
                title.textContent = said.title;
                const body = document.createElement('div');
                body.className = 'cm-hover-body';
                body.textContent = said.body;
                dom.append(title, body);

                return { dom };
              },
            };
          }),
          keymap.of([
            {
              key: 'Mod-Enter',
              /**
               * Runs the function the caret is in.
               *
               * @param keyView - The view.
               * @returns Whether it was handled.
               */
              run: (keyView) => {
                const name = functionAtCaret(keyView.state);

                if (name !== null) {
                  latest.current.onRun(name);
                }

                return true;
              },
            },
            {
              key: 'Mod-s',
              /**
               * Saves.
               *
               * @returns True: the browser's own Save is not wanted.
               */
              run: () => {
                latest.current.onSave();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorState.readOnly.of(props.isReadOnly),
          EditorView.contentAttributes.of({ 'aria-label': props.label }),
          THEME,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              latest.current.onChange(update.state.doc.toString());
            }

            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              latest.current.onCursor(line.number, head - line.from + 1);
            }
          }),
        ],
      }),
    });

    view.current = editor;

    return () => {
      editor.destroy();
      view.current = null;
    };
    // Made once: the props are read through `latest`, the value and the read-only state below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [props.isReadOnly]);

  // The value from outside (Format, Discard, a function added) replaces what is shown.
  useEffect(() => {
    const editor = view.current;

    if (editor !== null && editor.state.doc.toString() !== props.value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.value } });
    }
  }, [props.value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setTrace.of(props.trace) });
  }, [props.trace]);

  useEffect(() => {
    const editor = view.current;

    if (editor === null) {
      return;
    }

    const diagnostics: Diagnostic[] = props.problems.flatMap((problem) => {
      if (problem.line > editor.state.doc.lines) {
        return [];
      }

      const line = editor.state.doc.line(problem.line);
      const from = Math.min(line.to, line.from + Math.max(0, problem.column - 1));
      const endLine = editor.state.doc.line(
        Math.min(editor.state.doc.lines, Math.max(problem.line, problem.endLine)),
      );
      const to = Math.max(
        from + 1,
        Math.min(endLine.to, endLine.from + Math.max(0, problem.endColumn - 1)),
      );

      return [
        {
          from,
          to: Math.min(to, editor.state.doc.length),
          severity: problem.severity,
          message: problem.message,
        },
      ];
    });

    editor.dispatch(setDiagnostics(editor.state, diagnostics));
  }, [props.problems, props.value]);

  useEffect(() => {
    const editor = view.current;

    if (editor === null || props.focus === null) {
      return;
    }

    for (let number = 1; number <= editor.state.doc.lines; number += 1) {
      const line = editor.state.doc.line(number);

      if (DEF.exec(line.text)?.[1] === props.focus) {
        editor.dispatch({ selection: { anchor: line.to }, scrollIntoView: true });
        editor.focus();
        break;
      }
    }
  }, [props.focus]);

  return <div ref={host} className="min-w-0 grow" />;
}
