/**
 * Reading an uploaded SVG down to the elements an icon is drawn with.
 *
 * Not an SVG renderer and not a sanitiser of one: a parser for the one dialect an icon needs -
 * a root, groups, and the seven shapes - that refuses everything else by name. What comes out
 * is the flat node the built-in set ships in, so an uploaded icon is drawn by exactly the same
 * code as a shipped one, inside the interface's own `<svg>`, in the colour of the text beside
 * it. Nothing in the file's own styling survives except the shapes and whether each is painted.
 *
 * Pure, so the browser can read a file the same way before it is uploaded and show what the
 * server will keep; the server reads the file again itself and trusts nothing it was sent.
 */
import {
  ICON_ELEMENTS,
  ICON_ID_PATTERN,
  ICON_MAXIMUM_ELEMENTS,
  type IconElement,
  type IconFrame,
  type IconNode,
} from '@nebula-home/contracts';

/** What reading a file produced. */
export type ParsedIconSvg = {
  /** The shapes, in drawing order, every group folded into them. */
  readonly node: IconNode;

  /** The square the file said it was drawn in, or null when it said nothing. */
  readonly viewBox: IconFrame | null;
};

/** Why a file could not be read as an icon, in a sentence the owner can act on. */
export class IconSvgError extends Error {
  /**
   * Names the refusal.
   *
   * @param message - What was wrong with the file.
   */
  public constructor(message: string) {
    super(message);
    this.name = 'IconSvgError';
  }
}

/** The attributes each shape is drawn from. */
const SHAPE_ATTRIBUTES: Record<IconElement, readonly string[]> = {
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
};

/** The attributes any shape may carry beside its own. */
const SHARED_ATTRIBUTES = [
  'transform',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'fill-rule',
  'clip-rule',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
] as const;

/** Elements whose whole subtree is left unread: words about the drawing, not the drawing. */
const SKIPPED_ELEMENTS = new Set(['title', 'desc', 'metadata', 'defs', 'style']);

/** Matches one tag: opening, closing or self-closing. */
const TAG =
  /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;

/** Matches one attribute inside a tag. */
const ATTRIBUTE = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** What an entity in an attribute value stands for. */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Decodes the entities an attribute value may carry.
 *
 * @param value - As it appears in the file.
 * @returns The value.
 */
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }

    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }

    return ENTITIES[entity] ?? whole;
  });
}

/**
 * Reads the attributes of one tag.
 *
 * @param text - The tag's attribute text.
 * @returns The attributes, decoded, in order.
 */
function attributesOf(text: string): Map<string, string> {
  const attributes = new Map<string, string>();

  for (const match of text.matchAll(ATTRIBUTE)) {
    const [, name = '', double, single, bare] = match;
    attributes.set(name, decode(double ?? single ?? bare ?? ''));
  }

  return attributes;
}

/**
 * Refuses an attribute that reaches out of the drawing.
 *
 * @param name - The attribute's name.
 * @param element - The element carrying it.
 * @throws {IconSvgError} For an event handler or a reference.
 */
function refuseReaching(name: string, element: string): void {
  const lower = name.toLowerCase();

  if (lower.startsWith('on') || lower === 'href' || lower === 'xlink:href') {
    throw new IconSvgError(`A ${element} carries ${name}, which an icon cannot`);
  }
}

/**
 * Turns a colour into the current one.
 *
 * @param value - As the file painted it.
 * @returns `none` for no paint, `currentColor` for any paint.
 */
function paintOf(value: string): string {
  const paint = value.trim().toLowerCase();

  return paint === 'none' || paint === 'transparent' ? 'none' : 'currentColor';
}

/** What an open element passes down to what it holds. */
type Inherited = {
  readonly transform: string | undefined;
  readonly fill: string | undefined;
  readonly stroke: string | undefined;
};

/**
 * Composes what a group passes down over what it inherited.
 *
 * @param parent - What the group inherited.
 * @param attributes - The group's own attributes.
 * @returns What its children inherit.
 */
function inherit(parent: Inherited, attributes: Map<string, string>): Inherited {
  const own = attributes.get('transform');
  const transform =
    own === undefined ? parent.transform : [parent.transform, own].filter(Boolean).join(' ');
  const fill = attributes.get('fill');
  const stroke = attributes.get('stroke');

  return {
    transform: transform === '' ? undefined : transform,
    fill: fill === undefined ? parent.fill : paintOf(fill),
    stroke: stroke === undefined ? parent.stroke : paintOf(stroke),
  };
}

/**
 * Reads the frame a file says it was drawn in.
 *
 * @param attributes - The root's attributes.
 * @returns A square frame, or null when the root gives no size.
 */
function frameOf(attributes: Map<string, string>): IconFrame | null {
  const viewBox = attributes.get('viewBox');

  if (viewBox !== undefined) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part));
    const [x, y, width, height] = parts;

    if (parts.length === 4 && parts.every(Number.isFinite) && width > 0 && height > 0) {
      const size = Math.max(width, height);

      return { x: x - (size - width) / 2, y: y - (size - height) / 2, size };
    }
  }

  const width = Number.parseFloat(attributes.get('width') ?? '');
  const height = Number.parseFloat(attributes.get('height') ?? '');

  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { x: 0, y: 0, size: Math.max(width, height) };
  }

  return null;
}

/**
 * Narrows a tag name to a shape.
 *
 * @param name - The tag name.
 * @returns The shape, or undefined for anything else.
 */
function shapeOf(name: string): IconElement | undefined {
  return (ICON_ELEMENTS as readonly string[]).includes(name) ? (name as IconElement) : undefined;
}

/**
 * Builds one shape from its tag.
 *
 * @param shape - Which shape.
 * @param attributes - Its attributes.
 * @param inherited - What the elements above it passed down.
 * @param isPainted - Whether anything in the file says how it is painted.
 * @returns The element, with only the attributes a drawing has a use for.
 */
function shapeElement(
  shape: IconElement,
  attributes: Map<string, string>,
  inherited: Inherited,
  isPainted: boolean,
): IconNode[number] {
  const kept: Record<string, string> = {};

  for (const [name, value] of attributes) {
    refuseReaching(name, shape);

    if (SHAPE_ATTRIBUTES[shape].includes(name)) {
      kept[name] = value;
    } else if (name === 'fill' || name === 'stroke') {
      kept[name] = paintOf(value);
    } else if ((SHARED_ATTRIBUTES as readonly string[]).includes(name) && name !== 'transform') {
      kept[name] = value;
    }
  }

  const transform = [inherited.transform, attributes.get('transform')].filter(Boolean).join(' ');

  if (transform !== '') {
    kept['transform'] = transform;
  }

  if (kept['fill'] === undefined && inherited.fill !== undefined) {
    kept['fill'] = inherited.fill;
  }

  if (kept['stroke'] === undefined && inherited.stroke !== undefined) {
    kept['stroke'] = inherited.stroke;
  }

  // A file that says nothing about paint is drawn filled, black, by every browser. Kept as a
  // filled icon in the current colour, rather than turned into an outline by the interface's
  // own stroke.
  if (!isPainted) {
    kept['fill'] = 'currentColor';
  }

  return [shape, kept];
}

/**
 * Strips what surrounds the drawing: the xml declaration, a doctype, comments.
 *
 * @param markup - The file.
 * @returns The markup with only elements left.
 */
function bare(markup: string): string {
  return markup
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Reads a file down to the shapes an icon is drawn with.
 *
 * @param markup - The file's text.
 * @returns The shapes and the frame the file named.
 * @throws {IconSvgError} When the file is not an SVG, holds an element that is not a shape or
 * a group, carries an attribute that reaches out of the drawing, draws nothing, or draws more
 * than an icon has room for.
 */
export function parseIconSvg(markup: string): ParsedIconSvg {
  const text = bare(markup);
  const tags = [...text.matchAll(TAG)];
  const first = tags[0];

  if (first === undefined || first[1] === '/' || first[2].toLowerCase() !== 'svg') {
    throw new IconSvgError('Not an SVG file: it does not start with an svg element');
  }

  const isPainted = tags.some(([, , , attributes = '']) =>
    /\b(?:fill|stroke)\s*=/.test(attributes),
  );
  const stack: Inherited[] = [];
  const node: IconNode[number][] = [];
  let viewBox: IconFrame | null = null;
  let skipping: { name: string; depth: number } | null = null;
  let count = 0;

  for (const [, closing, rawName = '', attributeText = '', selfClosing] of tags) {
    const name = rawName.toLowerCase();

    if (skipping !== null) {
      if (name === skipping.name) {
        if (closing === '/') {
          skipping.depth -= 1;
        } else if (selfClosing !== '/') {
          skipping.depth += 1;
        }

        if (skipping.depth === 0) {
          skipping = null;
        }
      }

      continue;
    }

    if (closing === '/') {
      if (name === 'g' || name === 'svg') {
        stack.pop();
      }

      continue;
    }

    const attributes = attributesOf(attributeText);
    const inherited = stack.at(-1) ?? { transform: undefined, fill: undefined, stroke: undefined };

    if (name === 'svg') {
      if (stack.length > 0) {
        throw new IconSvgError('An svg inside the svg: an icon is one drawing');
      }

      for (const attribute of attributes.keys()) {
        refuseReaching(attribute, 'svg');
      }

      viewBox = frameOf(attributes);
      stack.push(inherit(inherited, attributes));

      continue;
    }

    if (name === 'g') {
      for (const attribute of attributes.keys()) {
        refuseReaching(attribute, 'g');
      }

      if (selfClosing !== '/') {
        stack.push(inherit(inherited, attributes));
      }

      continue;
    }

    if (SKIPPED_ELEMENTS.has(name)) {
      if (selfClosing !== '/') {
        skipping = { name, depth: 1 };
      }

      continue;
    }

    const shape = shapeOf(name);

    if (shape === undefined) {
      throw new IconSvgError(`An icon cannot hold a ${rawName} element, only shapes`);
    }

    count += 1;

    if (count > ICON_MAXIMUM_ELEMENTS) {
      throw new IconSvgError(
        `${String(count)} elements or more: an icon has at most ${String(ICON_MAXIMUM_ELEMENTS)}`,
      );
    }

    node.push(shapeElement(shape, attributes, inherited, isPainted));
  }

  if (node.length === 0) {
    throw new IconSvgError('The file draws nothing an icon can be made of');
  }

  return { node, viewBox };
}

/**
 * Suggests an id from a name, the way the settings form does while somebody types.
 *
 * @param name - What the owner called the icon.
 * @returns An id in the catalogue's shape, or an empty string when the name has nothing to use.
 */
export function suggestIconId(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');

  return ICON_ID_PATTERN.test(id) ? id : '';
}
