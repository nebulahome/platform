/**
 * What the live channel has said so far: the latest reading of every entity it has mentioned,
 * and whether it is currently saying anything at all.
 *
 * A store of its own rather than writes into the query cache. The cache holds what the API
 * answered, and a page reads an entity from it as it was; the channel holds what has happened
 * since, and a page lays the newer of the two over the older. Keeping them apart means a refetch
 * cannot roll a value back to before a change the socket already delivered, and a socket that
 * drops leaves the cache exactly as it was.
 */
import { create } from 'zustand';

import type { JsonObject, WsServerMessage } from '@nebulahome/contracts';

import type { LiveStatus } from '@/live/live-client';

/** The latest state the channel delivered for one entity. */
export type LiveReading = {
  /** One entry per capability, as the entity reports it. */
  readonly state: JsonObject;

  /** Extras the adapter reports that no capability covers. */
  readonly attributes: JsonObject;

  /** Whether the adapter could reach the device when it reported. */
  readonly isAvailable: boolean;

  /** Whether its package or integration is being updated: the value is the last one known. */
  readonly isUpdating?: boolean;

  /** When the state last differed from what it was, as the server timestamps it. */
  readonly changedAt: Date;

  /** When this browser heard it, in milliseconds since the epoch. */
  readonly receivedAt: number;
};

/** What the store holds. */
export type LiveState = {
  /** Where the channel stands. */
  readonly status: LiveStatus;

  /** The latest reading of every entity heard from, by identifier. */
  readonly readings: Readonly<Record<string, LiveReading>>;

  /** Records where the channel stands. */
  readonly setStatus: (status: LiveStatus) => void;

  /**
   * Applies one message. Anything that is not a state change is not this store's business. A
   * state change lands with the others of the same frame, so a burst re-renders once.
   */
  readonly apply: (message: WsServerMessage, receivedAt?: number) => void;

  /** Lands at once the state changes still waiting for their frame. */
  readonly flush: () => void;

  /** Forgets everything, for when the person it was heard on behalf of signs out. */
  readonly reset: () => void;

  /**
   * Forgets the readings and keeps the standing, for a channel that has just come back: what it
   * said before the drop may no longer be so, and nothing replays what changed while it was down.
   */
  readonly forgetReadings: () => void;
};

/** State changes heard and not yet in the store, by entity: the last of each wins. */
let waiting: Record<string, LiveReading> = {};

/** The frame that lands them, while one is asked for. */
let frame: number | undefined;

/** Forgets the state changes still waiting, and their frame. */
function dropWaiting(): void {
  if (frame !== undefined) {
    cancelAnimationFrame(frame);
    frame = undefined;
  }

  waiting = {};
}

/** The live channel's store. */
export const useLive = create<LiveState>((set, get) => ({
  status: 'offline',
  readings: {},

  /**
   * Records where the channel stands.
   *
   * @param status - The standing.
   */
  setStatus: (status: LiveStatus): void => {
    set({ status });
  },

  /**
   * Applies one message.
   *
   * @param message - What the server sent.
   * @param receivedAt - When it arrived. Now, unless a test says otherwise.
   */
  apply: (message: WsServerMessage, receivedAt: number = Date.now()): void => {
    if (message.type !== 'state_changed') {
      return;
    }

    waiting[message.entityId] = {
      state: message.state,
      attributes: message.attributes,
      isAvailable: message.isAvailable,
      isUpdating: message.isUpdating === true,
      changedAt: message.changedAt,
      receivedAt,
    };

    // A hidden tab draws no frames, and what listens there must still hear each change.
    if (typeof requestAnimationFrame !== 'function' || document.hidden) {
      get().flush();

      return;
    }

    frame ??= requestAnimationFrame(() => {
      frame = undefined;
      get().flush();
    });
  },

  /** Lands the waiting state changes, in one update. */
  flush: (): void => {
    const landing = waiting;

    dropWaiting();

    if (Object.keys(landing).length > 0) {
      set((current) => ({ readings: { ...current.readings, ...landing } }));
    }
  },

  /** Forgets everything. */
  reset: (): void => {
    dropWaiting();
    set({ status: 'offline', readings: {} });
  },

  /** Forgets the readings, keeping the standing. */
  forgetReadings: (): void => {
    dropWaiting();
    set({ readings: {} });
  },
}));
