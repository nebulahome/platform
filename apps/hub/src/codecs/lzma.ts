/**
 * An LZMA decoder: the "alone" format of LZMA Utils, `.lzma` - a 13-byte header, then the stream.
 *
 * ECOVACS's robots send their maps and the paths they took compressed this way, so a vendor bundle
 * that draws them needs it, and a bundle carries no dependencies of its own: the SDK hands it this
 * (`sdk.codecs.lzma`). A decoder only, written after Igor Pavlov's reference description of the
 * format (LzmaSpec.cpp, public domain) - the range coder, the literal and length coders, the
 * distance slots - for streams of a few hundred kilobytes, decoded whole into memory.
 *
 * The header is five bytes of properties (lc, lp, pb, and the dictionary's size) and the size of
 * what it unpacks to as eight bytes, all ones when unknown - the stream then ends at its end
 * marker. A stream that is corrupt, or claims a distance before the start of what was unpacked,
 * is refused rather than guessed at.
 */

/** A probability's scale: eleven bits. */
const BIT_MODEL_TOTAL = 1 << 11;

/** How far a probability moves at each bit. */
const MOVE_BITS = 5;

/** The range is renormalised whenever it falls below this. */
const TOP = 1 << 24;

/** How many states the literal and match history has. */
const STATES = 12;

/** The shortest match. */
const MATCH_MIN_LENGTH = 2;

/** The distance slots below this have their low bits coded with probabilities. */
const END_POS_MODEL_INDEX = 14;

/** How many distances the probability-coded slots cover. */
const FULL_DISTANCES = 1 << (END_POS_MODEL_INDEX >>> 1);

/** How many of a large distance's lowest bits have probabilities of their own. */
const ALIGN_BITS = 4;

/** How many length classes pick a distance slot's probabilities. */
const LENGTH_TO_POSITION_STATES = 4;

/** The largest pb there is. */
const POSITION_BITS_MAXIMUM = 4;

/** Refuses a stream, saying why. */
class LzmaError extends Error {
  /**
   * Makes the error.
   *
   * @param message - What is wrong with the stream.
   */
  public constructor(message: string) {
    super(`The LZMA stream is corrupt: ${message}`);
    this.name = 'LzmaError';
  }
}

/** Reads bits out of the range coder. */
class RangeDecoder {
  readonly #input: Uint8Array;
  #offset: number;
  #range = 0xff_ff_ff_ff;
  #code = 0;

  /**
   * Starts at the stream, after the header.
   *
   * @param input - The whole input.
   * @param offset - Where the stream starts.
   * @throws {LzmaError} When the range coder does not start as one does.
   */
  public constructor(input: Uint8Array, offset: number) {
    this.#input = input;
    this.#offset = offset;

    if (this.#next() !== 0) {
      throw new LzmaError('the range coder does not start with 0');
    }

    for (let index = 0; index < 4; index += 1) {
      this.#code = ((this.#code << 8) | this.#next()) >>> 0;
    }

    if (this.#code === this.#range) {
      throw new LzmaError('the range coder starts at its range');
    }
  }

  /**
   * Whether the stream ended where a stream must: the code at zero.
   *
   * @returns True then.
   */
  public get isFinishedOk(): boolean {
    return this.#code === 0;
  }

  /**
   * Decodes bits taken as they are, with no probability.
   *
   * @param count - How many.
   * @returns Them, as a number.
   * @throws {LzmaError} When a bit runs past the range.
   */
  public directBits(count: number): number {
    let result = 0;

    for (let index = 0; index < count; index += 1) {
      this.#range >>>= 1;
      this.#code = (this.#code - this.#range) >>> 0;

      let bit = 1;

      if (this.#code >>> 31 === 1) {
        this.#code = (this.#code + this.#range) >>> 0;
        bit = 0;
      }

      if (this.#code === this.#range) {
        throw new LzmaError('a direct bit ran past the range');
      }

      result = ((result << 1) | bit) >>> 0;
      this.#normalize();
    }

    return result;
  }

  /**
   * Decodes one bit with a probability, and moves the probability towards it.
   *
   * @param probabilities - Where the probability is.
   * @param index - Which one.
   * @returns The bit.
   */
  public bit(probabilities: Uint16Array, index: number): number {
    const probability = probabilities[index] ?? 0;
    const bound = ((this.#range >>> 11) * probability) >>> 0;
    let bit: number;

    if (this.#code < bound) {
      probabilities[index] = probability + ((BIT_MODEL_TOTAL - probability) >>> MOVE_BITS);
      this.#range = bound;
      bit = 0;
    } else {
      probabilities[index] = probability - (probability >>> MOVE_BITS);
      this.#code = (this.#code - bound) >>> 0;
      this.#range = (this.#range - bound) >>> 0;
      bit = 1;
    }

    this.#normalize();

    return bit;
  }

  /**
   * Decodes a number most significant bit first, through a tree of probabilities.
   *
   * @param probabilities - The tree's probabilities.
   * @param offset - Where the tree starts among them.
   * @param bits - How many bits.
   * @returns The number.
   */
  public tree(probabilities: Uint16Array, offset: number, bits: number): number {
    let node = 1;

    for (let index = 0; index < bits; index += 1) {
      node = (node << 1) + this.bit(probabilities, offset + node);
    }

    return node - (1 << bits);
  }

  /**
   * Decodes a number least significant bit first, through a tree of probabilities.
   *
   * @param probabilities - The tree's probabilities.
   * @param offset - Where the tree starts among them.
   * @param bits - How many bits.
   * @returns The number.
   */
  public reverseTree(probabilities: Uint16Array, offset: number, bits: number): number {
    let node = 1;
    let symbol = 0;

    for (let index = 0; index < bits; index += 1) {
      const bit = this.bit(probabilities, offset + node);

      node = (node << 1) + bit;
      symbol |= bit << index;
    }

    return symbol;
  }

  /** Takes one more byte in when the range has fallen low. */
  #normalize(): void {
    if (this.#range < TOP) {
      this.#range = (this.#range << 8) >>> 0;
      this.#code = ((this.#code << 8) | this.#next()) >>> 0;
    }
  }

  /**
   * The next byte of the stream.
   *
   * @returns It.
   * @throws {LzmaError} When the stream ended early.
   */
  #next(): number {
    const byte = this.#input[this.#offset];

    if (byte === undefined) {
      throw new LzmaError('it ends before it says it does');
    }

    this.#offset += 1;

    return byte;
  }
}

/**
 * A fresh set of probabilities, each at one half.
 *
 * @param count - How many.
 * @returns The probabilities.
 */
const probabilitiesOf = (count: number): Uint16Array =>
  new Uint16Array(count).fill(BIT_MODEL_TOTAL >>> 1);

/** Decodes a match's length. */
class LengthDecoder {
  readonly #choice = probabilitiesOf(2);
  readonly #low = probabilitiesOf(1 << (POSITION_BITS_MAXIMUM + 3));
  readonly #middle = probabilitiesOf(1 << (POSITION_BITS_MAXIMUM + 3));
  readonly #high = probabilitiesOf(1 << 8);

  /**
   * Decodes one length.
   *
   * @param range - The range coder.
   * @param positionState - The position's low bits.
   * @returns The length, less the shortest match.
   */
  public decode(range: RangeDecoder, positionState: number): number {
    if (range.bit(this.#choice, 0) === 0) {
      return range.tree(this.#low, positionState << 3, 3);
    }

    if (range.bit(this.#choice, 1) === 0) {
      return 8 + range.tree(this.#middle, positionState << 3, 3);
    }

    return 16 + range.tree(this.#high, 0, 8);
  }
}

/**
 * Decodes an LZMA stream in the alone format.
 *
 * @param input - The header and the stream.
 * @returns What it unpacks to.
 * @throws {Error} When the stream is corrupt, or its properties are not LZMA's.
 */
export function decodeLzma(input: Uint8Array): Buffer {
  if (input.length < 13) {
    throw new LzmaError('it is shorter than its header');
  }

  let properties = input[0] ?? 0;

  if (properties >= 9 * 5 * 5) {
    throw new LzmaError('its properties are not LZMA properties');
  }

  const lc = properties % 9;

  properties = Math.floor(properties / 9);

  const lp = properties % 5;
  const pb = Math.floor(properties / 5);
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const low = view.getUint32(5, true);
  const high = view.getUint32(9, true);
  const isSizeKnown = !(low === 0xff_ff_ff_ff && high === 0xff_ff_ff_ff);
  const size = isSizeKnown ? high * 2 ** 32 + low : Number.POSITIVE_INFINITY;

  if (isSizeKnown && size > 256 * 1024 * 1024) {
    throw new LzmaError('it unpacks to more than 256 MB');
  }

  const range = new RangeDecoder(input, 13);
  const output: number[] = [];
  const literals = probabilitiesOf(0x300 << (lc + lp));
  const isMatch = probabilitiesOf(STATES << POSITION_BITS_MAXIMUM);
  const isRep = probabilitiesOf(STATES);
  const isRepG0 = probabilitiesOf(STATES);
  const isRepG1 = probabilitiesOf(STATES);
  const isRepG2 = probabilitiesOf(STATES);
  const isRep0Long = probabilitiesOf(STATES << POSITION_BITS_MAXIMUM);
  const positionSlots = probabilitiesOf(LENGTH_TO_POSITION_STATES << 6);
  const positions = probabilitiesOf(1 + FULL_DISTANCES - END_POS_MODEL_INDEX);
  const align = probabilitiesOf(1 << ALIGN_BITS);
  const lengths = new LengthDecoder();
  const repeatLengths = new LengthDecoder();
  const positionMask = (1 << pb) - 1;
  const literalMask = (1 << lp) - 1;
  let state = 0;
  let rep0 = 0;
  let rep1 = 0;
  let rep2 = 0;
  let rep3 = 0;

  /**
   * A byte already unpacked, counted back from the end.
   *
   * @param distance - How far back: 1 is the last.
   * @returns The byte.
   */
  const back = (distance: number): number => output[output.length - distance] ?? 0;

  /**
   * Decodes a match's distance.
   *
   * @param length - The match's length, less the shortest.
   * @returns The distance, less one.
   */
  const distanceOf = (length: number): number => {
    const lengthState = Math.min(length, LENGTH_TO_POSITION_STATES - 1);
    const slot = range.tree(positionSlots, lengthState << 6, 6);

    if (slot < 4) {
      return slot;
    }

    const directBits = (slot >>> 1) - 1;
    let distance = ((2 | (slot & 1)) << directBits) >>> 0;

    if (slot < END_POS_MODEL_INDEX) {
      distance += range.reverseTree(positions, distance - slot, directBits);
    } else {
      distance =
        (distance + ((range.directBits(directBits - ALIGN_BITS) << ALIGN_BITS) >>> 0)) >>> 0;
      distance = (distance + range.reverseTree(align, 0, ALIGN_BITS)) >>> 0;
    }

    return distance;
  };

  for (;;) {
    if (output.length >= size) {
      break;
    }

    const positionState = output.length & positionMask;

    if (range.bit(isMatch, (state << POSITION_BITS_MAXIMUM) + positionState) === 0) {
      const previous = output.length === 0 ? 0 : back(1);
      const literalState = ((output.length & literalMask) << lc) + (previous >>> (8 - lc));
      const offset = 0x300 * literalState;
      let symbol = 1;

      if (state >= 7) {
        let matchByte = back(rep0 + 1);

        do {
          const matchBit = (matchByte >>> 7) & 1;

          matchByte <<= 1;

          const bit = range.bit(literals, offset + ((1 + matchBit) << 8) + symbol);

          symbol = (symbol << 1) | bit;

          if (matchBit !== bit) {
            break;
          }
        } while (symbol < 0x100);
      }

      while (symbol < 0x100) {
        symbol = (symbol << 1) | range.bit(literals, offset + symbol);
      }

      output.push(symbol - 0x100);
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }

    let length: number;

    if (range.bit(isRep, state) === 1) {
      if (output.length === 0) {
        throw new LzmaError('it repeats before anything was unpacked');
      }

      if (range.bit(isRepG0, state) === 0) {
        if (range.bit(isRep0Long, (state << POSITION_BITS_MAXIMUM) + positionState) === 0) {
          state = state < 7 ? 9 : 11;
          output.push(back(rep0 + 1));
          continue;
        }
      } else {
        let distance: number;

        if (range.bit(isRepG1, state) === 0) {
          distance = rep1;
        } else {
          if (range.bit(isRepG2, state) === 0) {
            distance = rep2;
          } else {
            distance = rep3;
            rep3 = rep2;
          }

          rep2 = rep1;
        }

        rep1 = rep0;
        rep0 = distance;
      }

      length = repeatLengths.decode(range, positionState);
      state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2;
      rep2 = rep1;
      rep1 = rep0;
      length = lengths.decode(range, positionState);
      state = state < 7 ? 7 : 10;
      rep0 = distanceOf(length);

      if (rep0 === 0xff_ff_ff_ff) {
        // The end marker.
        if (!range.isFinishedOk) {
          throw new LzmaError('its end marker is not where the stream ends');
        }

        break;
      }

      if (rep0 >= output.length) {
        throw new LzmaError('a match reaches before the start');
      }
    }

    const copied = Math.min(length + MATCH_MIN_LENGTH, size - output.length);

    for (let index = 0; index < copied; index += 1) {
      output.push(back(rep0 + 1));
    }
  }

  return Buffer.from(output);
}
