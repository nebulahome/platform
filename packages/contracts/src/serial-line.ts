/**
 * How a serial port is spoken: the baud rate and the framing.
 *
 * A module of its own, apart from the Serial broker's `serial.ts`, because the integration
 * catalogue carries a `serial` driver's line too, and `serial.ts` reads the catalogue's ids:
 * either importing the other would be a cycle.
 */
import { z } from 'zod';

/** The parities a line may use. */
export const SERIAL_PARITIES = ['none', 'even', 'odd', 'mark', 'space'] as const;

/** The flow controls a line may use: none, hardware (RTS/CTS), or software (XON/XOFF). */
export const SERIAL_FLOW_CONTROLS = ['none', 'rtscts', 'xonxoff'] as const;

/**
 * How a port is spoken: the baud rate, and the framing - `9600 8N1` unless said. A driver of kind
 * `serial` gives its defaults in this shape; the owner may change them when adding a device.
 */
export const serialLineSchema = z.strictObject({
  baudRate: z.int().min(50).max(4_000_000),
  dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]).default(8),
  parity: z.enum(SERIAL_PARITIES).default('none'),
  stopBits: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).default(1),
  flowControl: z.enum(SERIAL_FLOW_CONTROLS).default('none'),
});

/** How a port is spoken, as written. */
export type SerialLineInput = z.input<typeof serialLineSchema>;

/** How a port is spoken. */
export type SerialLine = z.output<typeof serialLineSchema>;

/**
 * A line as the pages write it: `9600 8N1`, `115200 7E2`.
 *
 * @param line - The line.
 * @returns The baud rate, then data bits, parity's letter and stop bits.
 */
export function serialLineText(line: SerialLine): string {
  return `${String(line.baudRate)} ${String(line.dataBits)}${line.parity.charAt(0).toUpperCase()}${String(line.stopBits)}`;
}
