/**
 * A catalogue icon, drawn.
 *
 * The one place a node becomes pixels. Every icon in the interface - a device's, an area's, the
 * chrome's own - goes through here, which is what makes an uploaded drawing look like a shipped
 * one: the same box, the same line, the colour of the text beside it.
 *
 * The line is 1.75 units of a 24 box, the weight the interface has always drawn at. A drawing
 * framed in 512 units gets a stroke 512/24 times wider in its own units, so it lands on screen
 * at the same 1.75 - the frame changes the coordinates, never the look.
 */
import { createElement, type SVGProps } from 'react';

import type { IconFrame, IconNode } from '@nebulahome/contracts';

import { cn } from '../lib/cn.js';

/** The line weight, in units of the 24 box every built-in icon is drawn in. */
const STROKE_WIDTH = 1.75;

/** The box the line weight is defined against. */
const REFERENCE_SIZE = 24;

/**
 * Turns an element's attributes into React's names for them.
 *
 * A node carries SVG's own attribute names - `stroke-width`, `fill-rule` - as an uploaded file
 * spells them. React spells the same attributes in camel case and warns about every other
 * spelling, so the hyphenated ones are turned before they are handed over.
 *
 * @param attrs - As the catalogue serves them.
 * @returns The same, spelt for React.
 */
function propsOf(attrs: Readonly<Record<string, string>>): Record<string, string> {
  const props: Record<string, string> = {};

  for (const [name, value] of Object.entries(attrs)) {
    props[name.replaceAll(/-([a-z])/gu, (match: string) => match.slice(1).toUpperCase())] = value;
  }

  return props;
}

/** What drawing an icon needs. */
export type CatalogueIconProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'width' | 'height'> & {
  /** The elements, as the catalogue serves them. */
  readonly node: IconNode;

  /** The square of the drawing's coordinates to show. */
  readonly frame: IconFrame;

  /** Width and height, in pixels. */
  readonly size?: number;
};

/**
 * Draws a catalogue icon.
 *
 * @param props - See {@link CatalogueIconProps}.
 * @returns The svg.
 */
export function CatalogueIcon(props: CatalogueIconProps) {
  const { node, frame, size = 19, className, ...rest } = props;

  return (
    <svg
      viewBox={`${String(frame.x)} ${String(frame.y)} ${String(frame.size)} ${String(frame.size)}`}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={(STROKE_WIDTH * frame.size) / REFERENCE_SIZE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0', className)}
      {...rest}
    >
      {node.map(([tag, attrs], index) =>
        // The elements are a drawing: never reordered, and identified by nothing but where
        // they fall in it.
        // eslint-disable-next-line react/no-array-index-key
        createElement(tag, { ...propsOf(attrs), key: index }),
      )}
    </svg>
  );
}
