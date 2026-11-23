/**
 * A QR code of a short text - a link to subscribe to - drawn as dark squares on a white card so
 * every phone camera reads it, in either theme.
 */
import qrcode from 'qrcode-generator';

import { cn } from '../lib/cn.js';

/** What a code needs. */
export type QrCodeProps = {
  /** What the code says: a link, at most a few hundred characters. */
  readonly value: string;

  /** What it is, to a screen reader. */
  readonly label: string;

  readonly className?: string;
};

/** The quiet zone round the code, in modules: the standard's four. */
const MARGIN = 4;

/**
 * Builds the code's dark modules as one path, a square per module.
 *
 * @param value - What the code says.
 * @returns The side in modules, quiet zone included, and the path.
 */
export function qrPath(value: string): { readonly size: number; readonly path: string } {
  // Type 0 picks the smallest version that holds the text; M survives a smudged screen.
  const code = qrcode(0, 'M');
  code.addData(value);
  code.make();

  const count = code.getModuleCount();
  const squares: string[] = [];

  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (code.isDark(row, column)) {
        squares.push(`M${String(column + MARGIN)} ${String(row + MARGIN)}h1v1h-1z`);
      }
    }
  }

  return { size: count + MARGIN * 2, path: squares.join('') };
}

/**
 * Renders the code.
 *
 * @param props - See {@link QrCodeProps}.
 * @returns The code.
 */
export function QrCode(props: QrCodeProps) {
  const { value, label, className } = props;
  const { size, path } = qrPath(value);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
      className={cn('block size-54 rounded-card bg-white text-black', className)}
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
