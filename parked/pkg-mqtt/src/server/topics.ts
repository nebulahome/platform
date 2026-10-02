/**
 * What the broker has carried: the last message of every topic, for the page's topic explorer,
 * and how many messages a second pass through it.
 *
 * Held in memory, and held to a size: the latest two thousand topics, each with its last payload
 * cut to two kilobytes of text. A binary payload is said to be one, by its size. The retained
 * messages are the broker's persistence's to keep; this is what the owner looks at.
 */

/** The most topics held. */
const MAXIMUM_TOPICS = 2000;

/** The longest payload kept, in characters. */
const MAXIMUM_PAYLOAD = 2048;

/** How many seconds the rate is averaged over. */
const RATE_WINDOW_SECONDS = 10;

/** One topic, as the explorer lists it. */
export type TopicEntry = {
  readonly topic: string;

  /** Its last payload as text, cut; or `<n bytes>` for one that is not text. */
  readonly payload: string;
  readonly size: number;
  readonly isRetained: boolean;
  readonly updatedAt: string;

  /** How many messages it carried since the broker started. */
  readonly count: number;
};

/**
 * A payload as text, when it is text.
 *
 * @param payload - The bytes.
 * @returns The text, or undefined for bytes that are not UTF-8 text.
 */
export function textOfPayload(payload: Buffer): string | undefined {
  const text = payload.toString('utf8');

  // A replacement character or a control byte other than whitespace: not text.
  // eslint-disable-next-line no-control-regex -- control characters are what is looked for
  return /[�\u0000-\u0008\u000E-\u001F]/u.test(text) ? undefined : text;
}

/** The last message of every topic, and the rate. */
export class TopicLog {
  readonly #topics = new Map<string, TopicEntry>();
  readonly #text = new Map<string, string>();
  readonly #seconds: number[] = [];
  #second = 0;

  /**
   * Notes one message.
   *
   * @param topic - Where.
   * @param payload - What.
   * @param isRetained - Whether it is kept for the next subscriber.
   * @param now - When, in milliseconds.
   */
  public record(
    topic: string,
    payload: Buffer,
    isRetained: boolean,
    now: number = Date.now(),
  ): void {
    const text = textOfPayload(payload);
    const before = this.#topics.get(topic);

    this.#topics.delete(topic);
    this.#topics.set(topic, {
      topic,
      payload:
        text === undefined ? `<${String(payload.length)} bytes>` : text.slice(0, MAXIMUM_PAYLOAD),
      size: payload.length,
      isRetained,
      updatedAt: new Date(now).toISOString(),
      count: (before?.count ?? 0) + 1,
    });

    if (text === undefined) {
      this.#text.delete(topic);
    } else {
      this.#text.set(topic, text);
    }

    if (this.#topics.size > MAXIMUM_TOPICS) {
      const [oldest] = this.#topics.keys();

      if (oldest !== undefined) {
        this.#topics.delete(oldest);
        this.#text.delete(oldest);
      }
    }

    this.#count(now);
  }

  /**
   * The last payload a topic carried, whole, as text.
   *
   * @param topic - The topic.
   * @returns It, if the topic carried text.
   */
  public lastText(topic: string): string | undefined {
    return this.#text.get(topic);
  }

  /**
   * The topics, the most recent first.
   *
   * @param prefix - Only those under it.
   * @param limit - At most this many.
   * @returns Them, and how many there are under the prefix.
   */
  public list(prefix = '', limit = 500): { items: TopicEntry[]; total: number } {
    const matching = [...this.#topics.values()]
      .filter((entry) => entry.topic.startsWith(prefix))
      .reverse();

    return { items: matching.slice(0, limit), total: matching.length };
  }

  /**
   * Messages a second, over the last ten.
   *
   * @param now - When, in milliseconds.
   * @returns The rate.
   */
  public rate(now: number = Date.now()): number {
    this.#count(now, 0);

    const total = this.#seconds.reduce((sum, count) => sum + count, 0);

    return Math.round((total / RATE_WINDOW_SECONDS) * 10) / 10;
  }

  /**
   * Counts messages into the second they came in.
   *
   * @param now - When, in milliseconds.
   * @param add - How many.
   */
  #count(now: number, add = 1): void {
    const second = Math.floor(now / 1000);

    if (this.#second === 0) {
      this.#second = second;
    }

    while (this.#second < second) {
      this.#seconds.push(0);
      this.#second += 1;

      if (this.#seconds.length > RATE_WINDOW_SECONDS) {
        this.#seconds.shift();
      }
    }

    if (this.#seconds.length === 0) {
      this.#seconds.push(0);
    }

    this.#seconds[this.#seconds.length - 1] = (this.#seconds.at(-1) ?? 0) + add;
  }
}
