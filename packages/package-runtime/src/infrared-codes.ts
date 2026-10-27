/**
 * Infrared and radio codes in the formats people bring them in, and the protocols they carry: pure.
 *
 * The platform keeps a code as timings - {@link InfraredCode}: microseconds, a mark then a space in
 * turn, starting with a mark - with the protocol beside them when one is recognised. Everything
 * else is a way of writing those timings down: the base64 packets a Broadlink learns and sends, the
 * Pronto hex that remote databases list, plain lists of microseconds, and the `.ir` files a Flipper
 * Zero saves. The hub reads an import and writes "Copy as" through this module, and a blaster's
 * integration converts to and from its own format through the SDK, which re-exports it - so a
 * remote learned on one blaster sends through another brand's without being learned again.
 *
 * The protocols - NEC and its extended form, Samsung32, Sony SIRC in its three lengths, RC5 - are
 * read off timings with the slack receivers allow, and written back as timings, which is what turns
 * a Flipper file's `type: parsed` entry into something a blaster can send.
 */
import {
  INFRARED_MAXIMUM_PULSES,
  infraredCodeSchema,
  ValidationError,
  type InfraredCode,
  type InfraredProtocol,
  type InfraredProtocolName,
} from '@nebulahome/contracts';

/** One Broadlink tick: 269/8192 ms, about 32.84 µs. */
export const BROADLINK_TICK_US = (269 / 8192) * 1000;

/** The carrier an infrared code is on when its format does not say: 38 kHz, as most remotes. */
export const DEFAULT_IR_CARRIER_HZ = 38_000;

/** The type byte of a Broadlink infrared packet. */
const BROADLINK_IR = 0x26;

/** The type byte of a Broadlink packet sent on 433 MHz. */
const BROADLINK_RF433 = 0xb2;

/** The type byte of a Broadlink packet sent on 315 MHz. */
const BROADLINK_RF315 = 0xd7;

/** The frequencies the two radio type bytes stand for. */
const RF433_HZ = 433_920_000;
const RF315_HZ = 315_000_000;

/** Pronto's reference clock: one period of its frequency word is that many of these, in µs. */
const PRONTO_CLOCK_US = 0.241_246;

/** The pause given to a code that ends on a mark where a format needs it to end on a space. */
const LEAD_OUT_US = 50_000;

/** The shortest pause a protocol's frame is padded with, however long the frame. */
const MINIMUM_PAUSE_US = 10_000;

/** How far a timing may be from the protocol's and still be read as it: a quarter, as receivers allow. */
const TOLERANCE = 0.25;

/**
 * A code that does not hold, as the import lists it.
 *
 * @param message - Why, in a sentence.
 * @returns The error.
 */
function invalid(message: string): ValidationError {
  return new ValidationError(message, { details: { reason: message } });
}

/**
 * A code checked against what the platform keeps: its pulses' number and lengths.
 *
 * @param code - The code.
 * @returns The same code.
 * @throws {ValidationError} When it does not hold.
 */
function checked(code: InfraredCode): InfraredCode {
  if (code.pulses.length === 0) {
    throw invalid('It holds no pulses');
  }

  const parsed = infraredCodeSchema.safeParse(code);

  if (!parsed.success) {
    const [issue] = parsed.error.issues;

    throw invalid(
      code.pulses.length > INFRARED_MAXIMUM_PULSES
        ? `It holds ${String(code.pulses.length)} pulses, and a code ${String(INFRARED_MAXIMUM_PULSES)} at most`
        : (issue?.message ?? 'It is not a code'),
    );
  }

  return parsed.data;
}

/**
 * A train of pulses sent several times, as a packet's repeat byte asks: as many times as fit.
 *
 * @param once - The train.
 * @param times - How many times in all.
 * @returns The pulses.
 */
function repeated(once: readonly number[], times: number): number[] {
  // A train that ends on a mark cannot follow itself: two marks would run together.
  const copies =
    once.length % 2 === 1
      ? 1
      : Math.max(1, Math.min(times, Math.floor(INFRARED_MAXIMUM_PULSES / once.length)));

  return Array.from({ length: copies }, () => once).flat();
}

/**
 * Reads a Broadlink packet, as its app and similar open-source implementations write one: base64
 * of a type byte, a repeat count, the length of what follows, and each pulse in ticks - one byte,
 * or 0x00 and two bytes big-endian for a longer one - closed by 0x0d 0x05.
 *
 * @param text - The base64.
 * @returns The code, its protocol recognised where it can be.
 * @throws {ValidationError} When it is not a packet, or its pulses do not hold.
 */
export function decodeBroadlink(text: string): InfraredCode {
  const compact = text.replaceAll(/\s+/gu, '');

  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(compact)) {
    throw invalid('It is not base64');
  }

  const bytes = Buffer.from(compact, 'base64');
  const type = bytes[0];
  const signal =
    type === BROADLINK_IR
      ? 'ir'
      : type === BROADLINK_RF433 || type === BROADLINK_RF315
        ? 'rf'
        : undefined;

  if (bytes.length < 4 || signal === undefined) {
    throw invalid(
      'It is not a Broadlink packet: those start 0x26 (infrared) or 0xb2, 0xd7 (radio)',
    );
  }

  const end = Math.min(4 + ((bytes[2] ?? 0) | ((bytes[3] ?? 0) << 8)), bytes.length);
  const ticks: number[] = [];
  let index = 4;

  while (index < end) {
    // The two bytes a learned packet closes with are not a pulse.
    if (index === end - 2 && bytes[index] === 0x0d && bytes[index + 1] === 0x05) {
      break;
    }

    let value = bytes[index] ?? 0;

    index += 1;

    if (value === 0) {
      if (index + 2 > end) {
        throw invalid('It is cut short: a long pulse lacks its two bytes');
      }

      value = ((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0);
      index += 2;
    }

    // Zeros are the padding a packet is filled out with to whole blocks.
    if (value === 0) {
      break;
    }

    ticks.push(value);
  }

  const pulses = repeated(
    ticks.map((tick) => Math.round(tick * BROADLINK_TICK_US)),
    (bytes[1] ?? 0) + 1,
  );

  return signal === 'ir'
    ? withInfraredProtocol(checked({ signal, carrierHz: DEFAULT_IR_CARRIER_HZ, pulses }))
    : checked({
        signal,
        carrierHz: 0,
        frequencyHz: type === BROADLINK_RF315 ? RF315_HZ : RF433_HZ,
        pulses,
      });
}

/**
 * Writes a code as a Broadlink packet: sent once, closed by 0x0d 0x05 and filled out to whole
 * 16-byte blocks, as a Broadlink learns one. Radio goes on 315 MHz for a code nearer that than
 * 433.
 *
 * @param code - The code.
 * @returns The base64.
 */
export function encodeBroadlink(code: InfraredCode): string {
  const type =
    code.signal === 'ir'
      ? BROADLINK_IR
      : (code.frequencyHz ?? RF433_HZ) < (RF315_HZ + RF433_HZ) / 2
        ? BROADLINK_RF315
        : BROADLINK_RF433;
  const data: number[] = [];

  for (const pulse of code.pulses) {
    const ticks = Math.min(0xff_ff, Math.max(1, Math.round(pulse / BROADLINK_TICK_US)));

    data.push(...(ticks < 0x1_00 ? [ticks] : [0, ticks >> 8, ticks & 0xff]));
  }

  data.push(0x0d, 0x05);

  const packet = [type, 0, data.length & 0xff, data.length >> 8, ...data];
  const padding = (16 - (packet.length % 16)) % 16;

  return Buffer.from([...packet, ...Array.from({ length: padding }, () => 0)]).toString('base64');
}

/**
 * Reads Pronto hex in its learned form: `0000`, the frequency word, the number of pairs sent once
 * and of those repeated, then each pair's mark and space in periods of the carrier. What is sent
 * once comes first, then the repeated part once.
 *
 * @param text - The words, four hex digits each.
 * @returns The code, its protocol recognised where it can be.
 * @throws {ValidationError} When it is not learned Pronto, or its pulses do not hold.
 */
export function decodePronto(text: string): InfraredCode {
  const words = text.trim().split(/\s+/u);

  if (!words.every((word) => /^[0-9A-Fa-f]{4}$/u.test(word))) {
    throw invalid('Pronto is words of four hex digits');
  }

  const [form = 0, frequency = 0, once = 0, repeat = 0] = words.map((word) => parseInt(word, 16));

  if (form !== 0) {
    throw invalid('Only learned Pronto, starting 0000, is read');
  }

  if (frequency === 0) {
    throw invalid('Its frequency word is 0');
  }

  const end = 4 + 2 * (once + repeat);

  if (words.length < end) {
    throw invalid(
      `It says ${String(once + repeat)} pairs and holds ${String(Math.floor((words.length - 4) / 2))}`,
    );
  }

  const period = frequency * PRONTO_CLOCK_US;
  const pulses = words
    .slice(4, end)
    .map((word) => Math.max(1, Math.round(parseInt(word, 16) * period)));

  return withInfraredProtocol(
    checked({ signal: 'ir', carrierHz: Math.round(1_000_000 / period), pulses }),
  );
}

/**
 * Writes a code as learned Pronto hex, every pair sent once; a code ending on a mark gets a pause
 * after it, since Pronto counts pairs.
 *
 * @param code - The code.
 * @returns The words, upper case; null for a radio code, which Pronto cannot carry.
 */
export function encodePronto(code: InfraredCode): string | null {
  if (code.signal !== 'ir') {
    return null;
  }

  const frequency = Math.min(
    0xff_ff,
    Math.max(1, Math.round(1_000_000 / (code.carrierHz * PRONTO_CLOCK_US))),
  );
  const period = frequency * PRONTO_CLOCK_US;
  const pulses = code.pulses.length % 2 === 0 ? code.pulses : [...code.pulses, LEAD_OUT_US];
  const words = [
    0,
    frequency,
    pulses.length / 2,
    0,
    ...pulses.map((pulse) => Math.min(0xff_ff, Math.max(1, Math.round(pulse / period)))),
  ];

  return words.map((word) => word.toString(16).toUpperCase().padStart(4, '0')).join(' ');
}

/**
 * Reads a list of microseconds: unsigned, a mark and a space in turn - `9000 4500 560 …` - or
 * signed, a mark positive and a space negative - `[9000, -4500, 560, …]` - where two of a kind in
 * a row are one pulse and a leading space is dropped. Spaces, commas, semicolons and brackets all
 * separate.
 *
 * @param text - The list.
 * @param carrierHz - The carrier, which a list does not say.
 * @returns The infrared code, its protocol recognised where it can be.
 * @throws {ValidationError} When a value is not a whole number of microseconds above 0.
 */
export function decodeRawTimings(
  text: string,
  carrierHz: number = DEFAULT_IR_CARRIER_HZ,
): InfraredCode {
  const tokens = text
    .replaceAll(/[[\]]/gu, ' ')
    .split(/[\s,;]+/u)
    .filter((token) => token !== '');
  const wrong = tokens.find((token) => !/^[+-]?\d{1,8}$/u.test(token) || Number(token) === 0);

  if (wrong !== undefined) {
    throw invalid(`${wrong.slice(0, 16)} is not a pulse: a whole number of microseconds above 0`);
  }

  const values = tokens.map(Number);
  const pulses: number[] = [];

  if (tokens.some((token) => token.startsWith('-'))) {
    let isLastMark = false;

    for (const value of values) {
      const isMark = value > 0;

      if (pulses.length > 0 && isMark === isLastMark) {
        pulses[pulses.length - 1] = (pulses.at(-1) ?? 0) + Math.abs(value);
      } else if (pulses.length > 0 || isMark) {
        pulses.push(Math.abs(value));
      }

      isLastMark = isMark;
    }
  } else {
    pulses.push(...values);
  }

  return withInfraredProtocol(checked({ signal: 'ir', carrierHz, pulses }));
}

/**
 * Writes a code as a signed list: a mark positive, a space negative.
 *
 * @param code - The code.
 * @returns `9000, -4500, 560, …`.
 */
export function encodeRawTimings(code: InfraredCode): string {
  return code.pulses.map((pulse, index) => String(index % 2 === 0 ? pulse : -pulse)).join(', ');
}

/** What a protocol's frames are made of, as its encoder writes them and its decoder reads them. */
type PulseDistance = {
  readonly leaderMark: number;
  readonly leaderSpace: number;
};

/** NEC: a 9 ms mark, a 4.5 ms space, 32 bits, a stop mark; a frame every 108 ms. */
const NEC: PulseDistance = { leaderMark: 9000, leaderSpace: 4500 };

/** Samsung32: NEC's bits after a 4.5 ms mark and a 4.5 ms space. */
const SAMSUNG: PulseDistance = { leaderMark: 4500, leaderSpace: 4500 };

/** The mark of a NEC or Samsung bit, and the spaces of a 0 and a 1. */
const BIT_MARK = 560;
const ZERO_SPACE = 560;
const ONE_SPACE = 1690;

/** How often NEC and Samsung frames start. */
const NEC_FRAME_US = 108_000;

/** Sony SIRC: a 2.4 ms mark, then each bit a 1.2 ms (1) or 0.6 ms (0) mark and a 0.6 ms space. */
const SIRC_LEADER = 2400;
const SIRC_ONE = 1200;
const SIRC_UNIT = 600;

/** How often SIRC frames start, and how many a press sends: Sony sets want three. */
const SIRC_FRAME_US = 45_000;
const SIRC_FRAMES = 3;

/** RC5: half a bit, Manchester-coded; a frame every 64 bits. */
const RC5_HALF = 889;
const RC5_FRAME_US = 113_778;

/** The carrier each protocol is sent on. */
const CARRIERS: Readonly<Record<InfraredProtocolName, number>> = {
  nec: 38_000,
  'nec-ext': 38_000,
  samsung32: 38_000,
  sirc: 40_000,
  sirc15: 40_000,
  sirc20: 40_000,
  rc5: 36_000,
};

/** The largest address and command each protocol carries. */
const LIMITS: Readonly<Record<InfraredProtocolName, readonly [number, number]>> = {
  nec: [0xff, 0xff],
  'nec-ext': [0xff_ff, 0xff_ff],
  samsung32: [0xff, 0xff],
  sirc: [0x1f, 0x7f],
  sirc15: [0xff, 0x7f],
  sirc20: [0x1f_ff, 0x7f],
  rc5: [0x1f, 0x7f],
};

/**
 * Whether a timing reads as the protocol's.
 *
 * @param value - The timing, if there is one.
 * @param expected - The protocol's.
 * @returns True within the tolerance.
 */
function near(value: number | undefined, expected: number): boolean {
  return value !== undefined && Math.abs(value - expected) <= expected * TOLERANCE;
}

/**
 * Reads the 32 bits of a NEC or Samsung frame, the lowest first, and its stop mark.
 *
 * @param pulses - The pulses.
 * @param leader - The frame's leader.
 * @returns Its four bytes, or undefined when the pulses are not such a frame.
 */
function readPulseDistance(
  pulses: readonly number[],
  leader: PulseDistance,
): [number, number, number, number] | undefined {
  if (!near(pulses[0], leader.leaderMark) || !near(pulses[1], leader.leaderSpace)) {
    return undefined;
  }

  let bits = 0;

  for (let bit = 0; bit < 32; bit += 1) {
    const mark = pulses[2 + bit * 2];
    const space = pulses[3 + bit * 2];

    if (!near(mark, BIT_MARK)) {
      return undefined;
    }

    if (near(space, ONE_SPACE)) {
      bits += 2 ** bit;
    } else if (!near(space, ZERO_SPACE)) {
      return undefined;
    }
  }

  if (!near(pulses[66], BIT_MARK)) {
    return undefined;
  }

  return [bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, bits >>> 24];
}

/**
 * Writes a NEC or Samsung frame, the lowest bit first, padded to its frame time.
 *
 * @param leader - The frame's leader.
 * @param bytes - The four bytes.
 * @returns The pulses, ending on the pause.
 */
function writePulseDistance(leader: PulseDistance, bytes: readonly number[]): number[] {
  const pulses = [leader.leaderMark, leader.leaderSpace];

  for (const byte of bytes) {
    for (let bit = 0; bit < 8; bit += 1) {
      pulses.push(BIT_MARK, ((byte >> bit) & 1) === 1 ? ONE_SPACE : ZERO_SPACE);
    }
  }

  pulses.push(BIT_MARK);

  return withPause(pulses, NEC_FRAME_US);
}

/**
 * A frame's pulses followed by the pause that fills it out to its frame time.
 *
 * @param pulses - The frame, ending on a mark.
 * @param frameUs - How often frames start.
 * @returns The pulses, ending on the pause.
 */
function withPause(pulses: readonly number[], frameUs: number): number[] {
  const used = pulses.reduce((sum, pulse) => sum + pulse, 0);

  return [...pulses, Math.max(MINIMUM_PAUSE_US, frameUs - used)];
}

/**
 * Reads a NEC frame: NEC when the address and the command each come with their inverse, extended
 * NEC - a 16-bit address and command, as a Flipper Zero reads them - otherwise.
 *
 * @param pulses - The pulses.
 * @returns The protocol, or undefined.
 */
function decodeNec(pulses: readonly number[]): InfraredProtocol | undefined {
  const bytes = readPulseDistance(pulses, NEC);

  if (bytes === undefined) {
    return undefined;
  }

  const [address, addressInverse, command, commandInverse] = bytes;

  return address === (~addressInverse & 0xff) && command === (~commandInverse & 0xff)
    ? { name: 'nec', address, command }
    : {
        name: 'nec-ext',
        address: address | (addressInverse << 8),
        command: command | (commandInverse << 8),
      };
}

/**
 * Reads a Samsung32 frame: the address twice, the command and its inverse.
 *
 * @param pulses - The pulses.
 * @returns The protocol, or undefined.
 */
function decodeSamsung(pulses: readonly number[]): InfraredProtocol | undefined {
  const bytes = readPulseDistance(pulses, SAMSUNG);

  if (bytes === undefined) {
    return undefined;
  }

  const [address, again, command, inverse] = bytes;

  return address === again && command === (~inverse & 0xff)
    ? { name: 'samsung32', address, command }
    : undefined;
}

/**
 * Reads a Sony SIRC frame - 12, 15 or 20 bits, the lowest first: a 7-bit command, then a 5-bit
 * address, an 8-bit one, or a 5-bit one and 8 extended bits, read as one 13-bit address.
 *
 * @param pulses - The pulses.
 * @returns The protocol, or undefined.
 */
function decodeSirc(pulses: readonly number[]): InfraredProtocol | undefined {
  if (!near(pulses[0], SIRC_LEADER) || !near(pulses[1], SIRC_UNIT)) {
    return undefined;
  }

  let bits = 0;
  let count = 0;

  for (let index = 2; count <= 20; index += 2) {
    if (near(pulses[index], SIRC_ONE)) {
      bits += 2 ** count;
    } else if (!near(pulses[index], SIRC_UNIT)) {
      return undefined;
    }

    count += 1;

    // The last bit is followed by the pause, or by nothing.
    if (!near(pulses[index + 1], SIRC_UNIT)) {
      break;
    }
  }

  const command = bits & 0x7f;
  const address = bits >>> 7;

  switch (count) {
    case 12:
      return { name: 'sirc', address, command };
    case 15:
      return { name: 'sirc15', address, command };
    case 20:
      return { name: 'sirc20', address, command };
    default:
      return undefined;
  }
}

/**
 * Reads an RC5 frame: 14 Manchester bits, the highest first - two start bits, a toggle, a 5-bit
 * address and a 6-bit command. A second start bit of 0 is RC5's extended form, the command's
 * seventh bit set.
 *
 * @param pulses - The pulses.
 * @returns The protocol, or undefined.
 */
function decodeRc5(pulses: readonly number[]): InfraredProtocol | undefined {
  // The first bit is a 1: a space half nobody sees, then the first mark.
  const halves: boolean[] = [false];

  for (const [index, pulse] of pulses.entries()) {
    const isMark = index % 2 === 0;
    const count = near(pulse, RC5_HALF) ? 1 : near(pulse, RC5_HALF * 2) ? 2 : 0;

    if (count === 0) {
      if (isMark) {
        return undefined;
      }

      break;
    }

    halves.push(...Array.from({ length: count }, () => isMark));

    if (halves.length >= 28) {
      break;
    }
  }

  // A frame ending in a 0 ends on its mark half; the space after it is the pause.
  if (halves.length === 27) {
    halves.push(false);
  }

  if (halves.length < 28) {
    return undefined;
  }

  let bits = 0;

  for (let bit = 0; bit < 14; bit += 1) {
    const first = halves[bit * 2];
    const second = halves[bit * 2 + 1];

    if (first === second) {
      return undefined;
    }

    bits = bits * 2 + (second === true ? 1 : 0);
  }

  if (bits >> 13 !== 1) {
    return undefined;
  }

  const isExtended = ((bits >> 12) & 1) === 0;

  return {
    name: 'rc5',
    address: (bits >> 6) & 0x1f,
    command: (bits & 0x3f) | (isExtended ? 0x40 : 0),
  };
}

/**
 * Recognises the protocol a train of pulses was sent in.
 *
 * @param pulses - The pulses, a mark first.
 * @returns The protocol with its address and command, or undefined for one not recognised.
 */
export function decodeInfraredProtocol(pulses: readonly number[]): InfraredProtocol | undefined {
  return decodeNec(pulses) ?? decodeSamsung(pulses) ?? decodeSirc(pulses) ?? decodeRc5(pulses);
}

/**
 * A code with its protocol, when its pulses are one the codec recognises.
 *
 * @param code - The code.
 * @returns The code, with `protocol` when an infrared code's pulses are recognised.
 */
export function withInfraredProtocol(code: InfraredCode): InfraredCode {
  const protocol = code.signal === 'ir' ? decodeInfraredProtocol(code.pulses) : undefined;

  return protocol === undefined ? code : { ...code, protocol };
}

/**
 * Writes a Sony SIRC press: three frames, each padded to 45 ms.
 *
 * @param protocol - The protocol.
 * @returns The pulses.
 */
function writeSirc(protocol: InfraredProtocol): number[] {
  const count = protocol.name === 'sirc' ? 12 : protocol.name === 'sirc15' ? 15 : 20;
  const bits = protocol.command + protocol.address * 0x80;
  const frame = [SIRC_LEADER, SIRC_UNIT];

  for (let bit = 0; bit < count; bit += 1) {
    frame.push(Math.floor(bits / 2 ** bit) % 2 === 1 ? SIRC_ONE : SIRC_UNIT, SIRC_UNIT);
  }

  frame.pop();

  return Array.from({ length: SIRC_FRAMES }, () => withPause(frame, SIRC_FRAME_US)).flat();
}

/**
 * Writes an RC5 frame, the toggle bit 0, padded to its frame time.
 *
 * @param protocol - The protocol.
 * @returns The pulses.
 */
function writeRc5(protocol: InfraredProtocol): number[] {
  const bits = [1, protocol.command < 0x40 ? 1 : 0, 0];

  for (let bit = 4; bit >= 0; bit -= 1) {
    bits.push((protocol.address >> bit) & 1);
  }

  for (let bit = 5; bit >= 0; bit -= 1) {
    bits.push((protocol.command >> bit) & 1);
  }

  // A 1 is a space half then a mark half; a 0 the other way round.
  const halves = bits.flatMap((bit) => (bit === 1 ? [false, true] : [true, false]));
  const pulses: number[] = [];
  let isMark = true;

  for (const half of halves.slice(halves.indexOf(true))) {
    if (pulses.length > 0 && half === isMark) {
      pulses[pulses.length - 1] = (pulses.at(-1) ?? 0) + RC5_HALF;
    } else {
      pulses.push(RC5_HALF);
      isMark = half;
    }
  }

  if (!isMark) {
    pulses.pop();
  }

  return withPause(pulses, RC5_FRAME_US);
}

/**
 * Writes a protocol's address and command as a code to send: what a Flipper Zero's `parsed` entry
 * becomes.
 *
 * @param protocol - The protocol, its address and its command.
 * @returns The code, on the protocol's carrier, the protocol beside it.
 * @throws {ValidationError} When the address or the command does not fit the protocol.
 */
export function encodeInfraredProtocol(protocol: InfraredProtocol): InfraredCode {
  const [maximumAddress, maximumCommand] = LIMITS[protocol.name];

  if (protocol.address > maximumAddress || protocol.command > maximumCommand) {
    throw invalid(
      `${protocol.name} carries an address up to 0x${maximumAddress.toString(16)} and a command up to 0x${maximumCommand.toString(16)}`,
    );
  }

  const { address, command } = protocol;
  let pulses: number[];

  switch (protocol.name) {
    case 'nec':
      pulses = writePulseDistance(NEC, [address, ~address & 0xff, command, ~command & 0xff]);
      break;
    case 'nec-ext':
      pulses = writePulseDistance(NEC, [
        address & 0xff,
        address >> 8,
        command & 0xff,
        command >> 8,
      ]);
      break;
    case 'samsung32':
      pulses = writePulseDistance(SAMSUNG, [address, address, command, ~command & 0xff]);
      break;
    case 'rc5':
      pulses = writeRc5(protocol);
      break;
    default:
      pulses = writeSirc(protocol);
  }

  return { signal: 'ir', carrierHz: CARRIERS[protocol.name], pulses, protocol };
}

/** A line of an imported text not understood, and why. */
export type InfraredImportProblem = {
  /** The line, counted from 1; null for a problem of the whole text. */
  readonly line: number | null;
  readonly text: string;
  readonly reason: string;
};

/** A code a Flipper Zero file names: its button's name, and the line its entry starts on. */
export type FlipperIrCode = {
  readonly name: string;
  readonly line: number;
  readonly code: InfraredCode;
};

/** What reading a Flipper Zero file found: its codes, and the lines it could not use. */
export type FlipperIrFile = {
  readonly codes: FlipperIrCode[];
  readonly problems: InfraredImportProblem[];
};

/** The protocols a Flipper Zero names that the codec writes, by the platform's names. */
const FLIPPER_PROTOCOLS: Readonly<Record<string, InfraredProtocolName>> = {
  NEC: 'nec',
  NECext: 'nec-ext',
  Samsung32: 'samsung32',
  SIRC: 'sirc',
  SIRC15: 'sirc15',
  SIRC20: 'sirc20',
  RC5: 'rc5',
  RC5X: 'rc5',
};

/** The file types a Flipper Zero saves infrared signals as: one remote's, or a library's. */
const FLIPPER_FILE_TYPES = ['IR signals file', 'IR library file'];

/** One entry of a Flipper Zero file, as read so far. */
type FlipperEntry = {
  readonly name: string;
  readonly line: number;
  readonly text: string;

  /** Each field and the line it is on; `data` collects every line of it. */
  readonly fields: Map<string, { readonly value: string; readonly line: number }>;
};

/**
 * A number a Flipper Zero writes as its bytes, the lowest first: `07 00 00 00`.
 *
 * @param value - The bytes, in hex.
 * @returns The number, or undefined when they are not one to four bytes.
 */
function flipperNumberOf(value: string): number | undefined {
  if (!/^[0-9A-Fa-f]{2}(?: [0-9A-Fa-f]{2}){0,3}$/u.test(value.trim())) {
    return undefined;
  }

  return value
    .trim()
    .split(' ')
    .reduceRight((number, byte) => number * 0x1_00 + parseInt(byte, 16), 0);
}

/**
 * Turns one entry of a Flipper Zero file into a code.
 *
 * @param entry - The entry.
 * @returns The code, or the problem with it.
 */
function flipperCodeOf(entry: FlipperEntry): FlipperIrCode | InfraredImportProblem {
  /**
   * One field of the entry.
   *
   * @param key - Its key.
   * @returns Its value and line, or undefined when the entry has none.
   */
  const field = (key: string) => entry.fields.get(key);

  /**
   * A problem of the entry.
   *
   * @param reason - Why, in a sentence.
   * @param at - The field it is on; the entry's first line when none.
   * @param at.line - The field's line.
   * @returns The problem.
   */
  const problem = (reason: string, at?: { readonly line: number }): InfraredImportProblem => ({
    line: at?.line ?? entry.line,
    text: entry.text.slice(0, 256),
    reason,
  });
  const type = field('type');

  try {
    if (type?.value === 'parsed') {
      const protocol = field('protocol');
      const name = protocol === undefined ? undefined : FLIPPER_PROTOCOLS[protocol.value];

      if (protocol === undefined || name === undefined) {
        return problem(
          protocol === undefined
            ? 'A parsed entry names no protocol'
            : `Nebula does not read ${protocol.value.slice(0, 32)} codes yet`,
          protocol,
        );
      }

      const address = flipperNumberOf(field('address')?.value ?? '');
      const command = flipperNumberOf(field('command')?.value ?? '');

      if (address === undefined || command === undefined) {
        return problem(
          'An address and a command are each one to four hex bytes',
          field(address === undefined ? 'address' : 'command'),
        );
      }

      // RC5X is RC5 with the command's seventh bit, however the file writes it.
      const isExtended = protocol.value === 'RC5X';

      return {
        name: entry.name,
        line: entry.line,
        code: encodeInfraredProtocol({
          name,
          address,
          command: isExtended ? command | 0x40 : command,
        }),
      };
    }

    if (type?.value === 'raw') {
      const frequency = Number(field('frequency')?.value);
      const data = field('data');

      if (!Number.isInteger(frequency) || frequency <= 0) {
        return problem('A raw entry needs its frequency in Hz', field('frequency'));
      }

      if (data === undefined) {
        return problem('A raw entry needs its data', type);
      }

      return {
        name: entry.name,
        line: entry.line,
        code: decodeRawTimings(data.value, frequency),
      };
    }

    return problem(
      type === undefined
        ? 'An entry says no type'
        : `An entry is parsed or raw, not ${type.value.slice(0, 32)}`,
      type,
    );
  } catch (error: unknown) {
    return problem(error instanceof Error ? error.message : String(error), field('data'));
  }
}

/**
 * Reads a Flipper Zero `.ir` file - one remote's signals, or a library's - every entry a button:
 * `name`, then `type: parsed` with a `protocol`, an `address` and a `command`, or `type: raw` with
 * a `frequency`, a `duty_cycle` and the `data` in microseconds.
 *
 * @param text - The file.
 * @returns The codes, each named as its entry, and every line that could not be used, with why.
 */
export function parseFlipperIr(text: string): FlipperIrFile {
  const codes: FlipperIrCode[] = [];
  const problems: InfraredImportProblem[] = [];
  let entry: FlipperEntry | undefined;

  /** Ends the entry being read, as a code or a problem. */
  const finish = () => {
    if (entry !== undefined) {
      const found = flipperCodeOf(entry);

      if ('code' in found) {
        codes.push(found);
      } else {
        problems.push(found);
      }
    }
  };

  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = index + 1;
    const trimmed = raw.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const match = /^([A-Za-z_]+):\s*(.*)$/u.exec(trimmed);

    if (match === null) {
      problems.push({ line, text: trimmed.slice(0, 256), reason: 'Not a "key: value" line' });
      continue;
    }

    const [, key = '', value = ''] = match;

    if (key === 'Filetype' && !FLIPPER_FILE_TYPES.includes(value)) {
      return {
        codes: [],
        problems: [
          { line, text: trimmed.slice(0, 256), reason: 'Not a Flipper Zero infrared file' },
        ],
      };
    }

    if (key === 'Filetype' || key === 'Version') {
      continue;
    }

    if (key === 'name') {
      finish();
      entry = { name: value.slice(0, 64), line, text: trimmed, fields: new Map() };
      continue;
    }

    if (entry === undefined) {
      problems.push({
        line,
        text: trimmed.slice(0, 256),
        reason: 'A field before the first name',
      });
      continue;
    }

    const known = entry.fields.get(key);

    // Long raw data may run over several `data:` lines.
    entry.fields.set(
      key,
      key === 'data' && known !== undefined
        ? { ...known, value: `${known.value} ${value}` }
        : {
            value,
            line,
          },
    );
  }

  finish();

  return { codes, problems };
}
