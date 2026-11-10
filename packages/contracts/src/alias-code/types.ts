/**
 * What alias code reaches outside itself, as one interface the server and the browser each fill.
 *
 * Entity values, other parts of the alias, the clock, the house's position, history and HTTP
 * all come through a {@link CodeHost}; the interpreter itself touches nothing else, so a trial in
 * the editor and a run in the engine behave the same given the same host.
 */
import type { GeoPosition } from '../sun.js';

/** The scalar an entity reads as. */
export type EntityScalar = number | boolean | string;

/** Which summary of an entity's history to read. */
export type HistoryKind = 'avg' | 'min' | 'max' | 'change';

/** An HTTP method code may use. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** One HTTP request, after the library's checks. */
export type HttpRequest = {
  readonly method: HttpMethod;

  /** The full URL, query string included. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly timeoutMs: number;
};

/** What the host answers for a request. */
export type HttpReply = {
  readonly status: number;

  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
};

/** Everything outside the code, as the host gives it. */
export type CodeHost = {
  /** The entity's scalar value; null when it is unavailable, unknown or not there. */
  readonly entity: (entityId: string) => EntityScalar | null;

  /** One field of an entity's state or attributes, as JSON; null or undefined when missing. */
  readonly field: (entityId: string, field: string) => unknown;

  /** The current value of another part of this alias, as JSON. */
  readonly part: (key: string) => unknown;
  readonly available: (entityId: string) => boolean;

  /** When the entity's state last changed, in Unix milliseconds. */
  readonly lastChanged: (entityId: string) => number | null;
  readonly nameOf: (entityId: string) => string | null;
  readonly unitOf: (entityId: string) => string | null;

  /** The current instant, in Unix milliseconds. */
  readonly now: () => number;

  /** The house's IANA time zone, such as `Europe/Rome`. */
  readonly timeZone: string;

  /** Where the house is; null when it has not said. */
  readonly position: () => GeoPosition | null;

  /** A summary of an entity's history over the last minutes; null when there is none. */
  readonly history: (
    kind: HistoryKind,
    entityId: string,
    minutes: number,
  ) => Promise<number | null>;

  /** Sends a request; the host enforces the timeout. A rejection reads as status 0. */
  readonly http: (request: HttpRequest) => Promise<HttpReply>;
};

/** How far a run may go. */
export type RunLimits = {
  /** Statements and expressions evaluated. */
  readonly steps: number;

  /** Time spent computing, not waiting for the host. */
  readonly cpuMs: number;

  /** Wall-clock time for the whole run, waits included. */
  readonly deadlineMs: number;

  /** Nested calls of the code's own functions. */
  readonly callDepth: number;
  readonly listLength: number;
  readonly stringLength: number;
};

/** The limits a run has unless told otherwise. */
export const DEFAULT_RUN_LIMITS: RunLimits = {
  steps: 10_000,
  cpuMs: 50,
  deadlineMs: 15_000,
  callDepth: 32,
  listLength: 1000,
  stringLength: 4096,
};
