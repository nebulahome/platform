/**
 * Code and ids in the alias pages' colours: an entity id with its domain quiet and its object id
 * in cyan (red and underlined when the house does not have it), and a line of the alias's Python
 * as the editor colours it - for the Docs fold, the problem panel and the file review, where a
 * whole editor would be too much.
 */
import type { ReactNode } from 'react';

import { AppIcon, CatalogueIcon } from '@nebulahome/ui';

import { PART_PREFIX, uiIcon } from '@/library/alias-model';
import { useCatalogueIcons } from '@/routes/library/device-icon';

/**
 * An entity id.
 *
 * @param props - The id, and whether it is missing.
 * @param props.id - The id.
 * @param props.isMissing - Whether the house does not have it.
 * @returns The id, coloured.
 */
export function Ent(props: { readonly id: string; readonly isMissing?: boolean }) {
  const dot = props.id.indexOf('.');

  if (props.isMissing === true) {
    return (
      <span className="text-danger underline decoration-danger decoration-wavy underline-offset-4">
        {props.id}
      </span>
    );
  }

  return (
    <span>
      <span className="text-foreground-subtle">{props.id.slice(0, dot + 1)}</span>
      <span className="text-cyan">{props.id.slice(dot + 1)}</span>
    </span>
  );
}

/**
 * An alias's icon: one of the interface's own, or one of the catalogue's, which the owner may
 * have picked; a plain circle while the catalogue's is read.
 *
 * @param props - The icon and its size.
 * @param props.id - The icon's id.
 * @param props.size - Its size in pixels.
 * @returns The icon.
 */
export function AliasIcon(props: { readonly id: string; readonly size: number }) {
  const isOwn = uiIcon(props.id, 'x') === props.id;
  const icons = useCatalogueIcons(isOwn ? [] : [props.id]);
  const icon = icons.get(props.id);

  if (isOwn || icon === undefined) {
    return <AppIcon id={uiIcon(props.id)} size={props.size} />;
  }

  return <CatalogueIcon node={icon.node} frame={icon.frame} size={props.size} />;
}

/** Python's keywords, as the subset has them. */
const KEYWORDS = new Set([
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
]);

/** One stretch of a line: its text and its colour. */
const TOKEN =
  /(#.*$)|("""[^]*?"""|'''[^]*?'''|f?"(?:\\.|[^"\\])*"|f?'(?:\\.|[^'\\])*')|(\bpart\.[a-z_][a-z0-9_]*)|(\b[a-z_][a-z0-9_]*\.[a-z0-9_]+(?:\.[a-z0-9_]+)?)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(\s+)|(.)/gu;

/**
 * A line of the alias's Python, coloured.
 *
 * @param props - The line.
 * @param props.text - The line.
 * @returns The line.
 */
export function PyLine(props: { readonly text: string }) {
  const out: ReactNode[] = [];
  let afterDef = false;

  for (const match of props.text.matchAll(TOKEN)) {
    const [whole, comment, string, part, entity, number, name] = match;
    const key = match.index;

    if (comment !== undefined || string?.startsWith('"""') === true) {
      out.push(
        <span key={key} className="text-foreground-subtle">
          {whole}
        </span>,
      );
    } else if (string !== undefined) {
      out.push(
        <span key={key} className="text-tag-green">
          {whole}
        </span>,
      );
    } else if (part !== undefined) {
      out.push(
        <span key={key}>
          <span className="text-foreground-muted">{PART_PREFIX}</span>
          <span className="text-violet">{part.slice(5)}</span>
        </span>,
      );
    } else if (entity !== undefined && !entity.startsWith('mem.') && !entity.startsWith('http.')) {
      out.push(<Ent key={key} id={entity} />);
    } else if (number !== undefined) {
      out.push(
        <span key={key} className="text-tag-amber">
          {whole}
        </span>,
      );
    } else if (name !== undefined && KEYWORDS.has(name)) {
      out.push(
        <span key={key} className="text-tag-pink">
          {whole}
        </span>,
      );
      afterDef = name === 'def';
      continue;
    } else if (name !== undefined && afterDef) {
      out.push(
        <span key={key} className="text-primary-hover">
          {whole}
        </span>,
      );
    } else {
      out.push(<span key={key}>{whole}</span>);
    }

    if (whole.trim() !== '') {
      afterDef = false;
    }
  }

  return out;
}
