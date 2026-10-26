/**
 * The template file's editor: the compose files' YAML editor - a JSON file is YAML - with marks of
 * the template's own laid over it. Loaded only when the file view is first shown, so CodeMirror's
 * weight is not paid by the pages that never show it. The default export is what `React.lazy`
 * loads.
 */
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

import { MODBUS_CAPABILITIES } from '@nebulahome/contracts';

import YamlEditor, { type YamlEditorProps } from '@/routes/containers/yaml-editor';

/** Each mark: what it matches, the part of the match it covers, and its class. */
const MARKS: readonly {
  readonly pattern: RegExp;
  readonly group: number;
  readonly className: (match: RegExpExecArray) => string;
}[] = [
  {
    pattern: new RegExp(`"(?:${MODBUS_CAPABILITIES.join('|')})"(?=\\s*:)`, 'gu'),
    group: 0,
    /**
     * The class of what it matched.
     *
     * @returns The class.
     */
    className: () => 'cm-modbus-capability',
  },
  {
    pattern: /"read"(?=\s*:)/gu,
    group: 0,

    /**
     * The class of what it matched.
     *
     * @returns The class.
     */
    className: () => 'cm-modbus-read',
  },
  {
    pattern: /"write"(?=\s*:)/gu,
    group: 0,

    /**
     * The class of what it matched.
     *
     * @returns The class.
     */
    className: () => 'cm-modbus-write',
  },
  {
    pattern: /"domain"\s*:\s*("([a-z_]+)")/gu,
    group: 1,
    /**
     * The class of the domain matched.
     *
     * @param match - The match.
     * @returns The classes.
     */
    className: (match) => `cm-modbus-domain cm-modbus-domain-${match[2] ?? ''}`,
  },
  {
    pattern: /"type"\s*:\s*("[a-z0-9]+")/gu,
    group: 1,

    /**
     * The class of what it matched.
     *
     * @returns The class.
     */
    className: () => 'cm-modbus-type',
  },
  {
    pattern: /"function"\s*:\s*(\d+)/gu,
    group: 1,

    /**
     * The class of what it matched.
     *
     * @returns The class.
     */
    className: () => 'cm-modbus-function',
  },
  {
    pattern: /"(?:address|on|off|value)"\s*:\s*("0x[0-9A-Fa-f]+"|\d+)/gu,
    group: 1,

    /**
     * The class of what it matched.
     *
     * @returns The class.
     */
    className: () => 'cm-modbus-word',
  },
];

/** The marks, laid over the visible lines as they change. */
const decorator = new MatchDecorator({
  regexp: new RegExp(MARKS.map((mark) => `(?:${mark.pattern.source})`).join('|'), 'gu'),

  /**
   * Marks one match with the class of the pattern it is.
   *
   * @param add - Adds a decoration.
   * @param from - Where the match starts.
   * @param to - Where it ends.
   * @param match - The match.
   */
  decorate: (add, from, to, match) => {
    for (const mark of MARKS) {
      mark.pattern.lastIndex = 0;

      const own = mark.pattern.exec(match[0]);

      if (own?.index === 0) {
        const part = own[mark.group] ?? own[0];
        const start = from + own[0].indexOf(part);

        add(start, start + part.length, Decoration.mark({ class: mark.className(own) }));

        return;
      }
    }
  },
});

/** The plugin that keeps the marks. */
const marks = ViewPlugin.fromClass(
  /** Keeps the marks of what is visible. */
  class {
    decorations: DecorationSet;

    /**
     * Marks what is visible.
     *
     * @param view - The editor.
     */
    constructor(view: EditorView) {
      this.decorations = decorator.createDeco(view);
    }

    /**
     * Marks what changed.
     *
     * @param update - The change.
     */
    update(update: ViewUpdate): void {
      this.decorations = decorator.updateDeco(update, this.decorations);
    }
  },
  {
    /**
     * The marks to draw.
     *
     * @param plugin - The plugin.
     * @returns Its marks.
     */
    decorations: (plugin) => plugin.decorations,
  },
);

/**
 * A tint: the colour as the text, on a faint ground of it, with no padding so the text does not
 * move.
 *
 * @param color - The colour, a CSS variable.
 * @param alpha - How strong the ground is, in per cent.
 * @returns The style.
 */
function tint(color: string, alpha: number) {
  return {
    color,
    backgroundColor: `color-mix(in srgb, ${color} ${String(alpha)}%, transparent)`,
    borderRadius: '3px',
    boxShadow: `0 0 0 1px color-mix(in srgb, ${color} ${String(alpha)}%, transparent)`,
  };
}

/** The marks' colours: the design system's. */
const theme = EditorView.theme({
  '.cm-modbus-capability': tint('var(--color-primary-hover)', 16),
  '.cm-modbus-read': { color: 'var(--color-success)' },
  '.cm-modbus-write': { color: 'var(--color-warning)' },
  '.cm-modbus-type': tint('var(--color-violet)', 16),
  '.cm-modbus-function': tint('var(--color-cyan)', 18),
  '.cm-modbus-word': { color: 'var(--color-tag-amber)' },
  '.cm-modbus-domain': tint('var(--color-foreground-muted)', 18),
  '.cm-modbus-domain-sensor': tint('var(--color-cyan)', 18),
  '.cm-modbus-domain-binary_sensor': tint('var(--color-violet)', 18),
  '.cm-modbus-domain-switch': tint('var(--color-success)', 18),
  '.cm-modbus-domain-light': tint('var(--color-lamp)', 18),
  '.cm-modbus-domain-number': tint('var(--color-tag-blue)', 18),
  '.cm-modbus-domain-select': tint('var(--color-tag-pink)', 18),
  '.cm-modbus-domain-button': tint('var(--color-tag-orange)', 18),
});

/**
 * Renders the editor with the template's marks.
 *
 * @param props - The YAML editor's.
 * @returns The editor.
 */
export default function TemplateFileEditor(props: Omit<YamlEditorProps, 'extensions'>) {
  return <YamlEditor {...props} extensions={[marks, theme]} />;
}
