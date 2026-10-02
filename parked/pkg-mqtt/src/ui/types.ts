/**
 * What the broker's methods answer, as its page reads them (`src/server/index.ts`).
 */

/** `status`. */
export type BrokerStatus = {
  readonly port: number;
  readonly allowAnonymous: boolean;
  readonly clientsOnline: number;
  readonly messagesPerSecond: number;
  readonly startedAt: string;
  readonly discovery: {
    readonly isEnabled: boolean;
    readonly prefix: string;
    readonly discovered: number;
    readonly mapped: number;
    readonly devices: number;
    readonly skipped: readonly { readonly topic: string; readonly reason: string }[];
  };
};

/** One connection. */
export type Session = {
  readonly clientId: string;
  readonly username: string | null;
  readonly address: string | null;
  readonly connectedAt: string;
};

/** One principal. */
export type ClientPrincipal = {
  readonly username: string;
  readonly kind: 'hub' | 'container' | 'client';
  readonly label: string;
  readonly publish: readonly string[];
  readonly subscribe: readonly string[];
  readonly createdAt: string;
  readonly sessions: readonly Session[];
};

/** `clients`. */
export type ClientsReply = {
  readonly principals: readonly ClientPrincipal[];
  readonly anonymous: readonly Session[];
};

/** One topic. */
export type TopicEntry = {
  readonly topic: string;
  readonly payload: string;
  readonly size: number;
  readonly isRetained: boolean;
  readonly updatedAt: string;
  readonly count: number;
};

/** `topics`. */
export type TopicsReply = { readonly items: readonly TopicEntry[]; readonly total: number };

/** One mapping. */
export type Mapping = {
  readonly id: string;
  readonly name: string;
  readonly component: 'sensor' | 'binary_sensor' | 'switch';
  readonly stateTopic: string;
  readonly valuePath: string;
  readonly unit: string;
  readonly deviceClass: string;
  readonly commandTopic?: string;
  readonly payloadOn: string;
  readonly payloadOff: string;
};

/**
 * How long ago something was, in a few words.
 *
 * @param when - When, as an ISO timestamp.
 * @param now - Now.
 * @returns `just now`, `4 min ago`, `2 h ago`, `3 days ago`.
 */
export function ago(when: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(when).getTime()) / 1000));

  if (seconds < 10) {
    return 'just now';
  }

  if (seconds < 60) {
    return `${String(seconds)} s ago`;
  }

  if (seconds < 3600) {
    return `${String(Math.round(seconds / 60))} min ago`;
  }

  if (seconds < 86_400) {
    return `${String(Math.round(seconds / 3600))} h ago`;
  }

  return `${String(Math.round(seconds / 86_400))} days ago`;
}

/**
 * Puts text on the clipboard.
 *
 * @param text - The text.
 * @returns Whether it went.
 */
export async function copy(text: string): Promise<boolean> {
  try {
    await globalThis.navigator.clipboard.writeText(text);

    return true;
  } catch {
    return false;
  }
}
