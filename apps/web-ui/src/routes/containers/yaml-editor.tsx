/**
 * A YAML editor: a compose file written in the page, with line numbers, indentation that follows
 * the line above, Tab that indents, and the problems `docker compose` found marked on their lines.
 *
 * CodeMirror, loaded only when a dialog that writes a file opens - its weight is not paid by the
 * pages that never do - and drawn in the design system's colours rather than CodeMirror's own, so
 * it reads as one of the page's fields. The default export is what `React.lazy` loads.
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

import type { ComposeProblem } from '@nebula-home/contracts';

/** What the editor needs. */
export type YamlEditorProps = {
  /** What it holds. */
  readonly value: string;

  /** Called with what it holds after each change. */
  readonly onChange?: (value: string) => void;

  /** What is wrong, marked on the lines named. */
  readonly problems?: readonly ComposeProblem[];

  /** Whether it can only be read. */
  readonly isReadOnly?: boolean;

  /** What it is, to a screen reader. */
  readonly label: string;

  /** What it shows while empty. */
  readonly placeholder?: string;

  /** How tall it is at least, as CSS. */
  readonly minHeight?: string;

  /** How tall it grows before it scrolls, as CSS. */
  readonly maxHeight?: string;
};

/** The colours of the syntax: the design system's, not CodeMirror's. */
const HIGHLIGHT = HighlightStyle.define([
  {
    tag: [tags.propertyName, tags.definition(tags.propertyName)],
    color: 'var(--color-primary-lit)',
  },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-tag-green)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--color-tag-amber)' },
  {
    tag: [tags.comment, tags.lineComment],
    color: 'var(--color-foreground-subtle)',
    fontStyle: 'italic',
  },
  {
    tag: [tags.punctuation, tags.separator, tags.squareBracket, tags.brace],
    color: 'var(--color-foreground-muted)',
  },
  { tag: [tags.keyword, tags.typeName, tags.labelName], color: 'var(--color-tag-violet)' },
]);

/**
 * The frame: the page's surface, its mono type, its focus ring.
 *
 * @param minHeight - How tall it is at least.
 * @param maxHeight - How tall it grows before it scrolls.
 * @returns The theme.
 */
function frame(minHeight: string, maxHeight: string) {
  return EditorView.theme({
    '&': {
      backgroundColor: 'var(--color-sunk)',
      color: 'var(--color-foreground)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-field)',
      fontSize: '12.5px',
    },
    '&.cm-focused': {
      outline: 'none',
      borderColor: 'var(--color-primary)',
      boxShadow: '0 0 0 3px color-mix(in srgb, var(--color-primary) 25%, transparent)',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.6',
      minHeight,
      maxHeight,
      overflow: 'auto',
    },
    '.cm-content': { caretColor: 'var(--color-primary)', padding: '8px 0' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--color-foreground-subtle)',
      border: 'none',
      borderRight: '1px solid var(--color-border-soft)',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--color-surface-lit) 55%, transparent)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--color-foreground-muted)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--color-primary) 25%, transparent) !important',
    },
    '.cm-placeholder': { color: 'var(--color-foreground-subtle)' },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--color-danger)',
    },
    '.cm-lint-marker-error': { content: 'none' },
    '.cm-tooltip': {
      backgroundColor: 'var(--color-surface-raised)',
      color: 'var(--color-foreground)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 'var(--radius-chip)',
    },
  });
}

/**
 * The problems, as diagnostics on their lines; one without a line marks the first.
 *
 * @param state - The editor's state, for where each line is.
 * @param problems - What is wrong.
 * @returns The diagnostics.
 */
function diagnosticsOf(state: EditorState, problems: readonly ComposeProblem[]): Diagnostic[] {
  return problems
    .filter((problem) => problem.line !== null)
    .map((problem) => {
      const line = state.doc.line(Math.min(Math.max(problem.line ?? 1, 1), state.doc.lines));

      return { from: line.from, to: line.to, severity: 'error', message: problem.message };
    });
}

/**
 * Renders the editor.
 *
 * @param props - See {@link YamlEditorProps}.
 * @returns The editor's host.
 */
export default function YamlEditor(props: YamlEditorProps) {
  const {
    value,
    onChange,
    problems = [],
    isReadOnly = false,
    label,
    minHeight = '16rem',
    maxHeight = '28rem',
  } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const listener = useRef(onChange);

  useEffect(() => {
    listener.current = onChange;
  }, [onChange]);

  // Made once; what changes afterwards is handed in below rather than making it again, which
  // would lose the cursor and the undo history.
  useEffect(() => {
    if (host.current === null) {
      return undefined;
    }

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          yaml(),
          syntaxHighlighting(HIGHLIGHT),
          lintGutter(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorState.tabSize.of(2),
          EditorState.readOnly.of(isReadOnly),
          EditorView.editable.of(!isReadOnly),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          ...(props.placeholder === undefined ? [] : [placeholder(props.placeholder)]),
          frame(minHeight, maxHeight),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              listener.current?.(update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    view.current = editor;

    return (): void => {
      editor.destroy();
      view.current = null;
    };
    // Made once, on purpose: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A file uploaded, or read from the server, replaces what is written.
  useEffect(() => {
    const editor = view.current;

    if (editor !== null && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const editor = view.current;

    if (editor !== null) {
      editor.dispatch(setDiagnostics(editor.state, diagnosticsOf(editor.state, problems)));
    }
  }, [problems]);

  return <div ref={host} className="min-w-0" />;
}
