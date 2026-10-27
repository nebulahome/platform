/**
 * The platform's brokers, as the Brokers page lists them: the house's Matter fabric, its Thread
 * network, its Bluetooth, its MQTT broker, its Modbus client, its serial ports and its infrared
 * remotes, all run by the hub.
 *
 * A broker reaches every device of one protocol, whoever makes it. Each has a page of its own -
 * `matter.ts`, `thread.ts`, `bluetooth.ts`, `mqtt.ts`, `modbus.ts`, `serial.ts` and `infrared.ts`
 * say what it holds - and a card here, which says how it stands and how many devices the house
 * has through it.
 */
import { z } from 'zod';

import { timestampSchema } from './timestamp.js';

/**
 * How a broker stands: coming up, running, stopped by a failure, turned off, or without the
 * hardware it needs - no adapter, no radio, no port, no blaster - which is not a failure.
 */
export const BROKER_STATES = ['starting', 'running', 'failed', 'disabled', 'unavailable'] as const;

/** How a broker stands. */
export type BrokerState = (typeof BROKER_STATES)[number];

/**
 * The brokers the platform runs, as the Brokers page lists them: by the vendor each is, related
 * ones side by side (Thread carries Matter, Bluetooth pairs it; Serial holds Thread's radio).
 */
export const BROKER_IDS = [
  'matter',
  'thread',
  'bluetooth',
  'mqtt',
  'modbus',
  'serial',
  'infrared',
] as const;

/** One broker of the platform. */
export type BrokerId = (typeof BROKER_IDS)[number];

/** One broker, for its card. */
export const brokerSummarySchema = z.object({
  id: z.enum(BROKER_IDS),
  state: z.enum(BROKER_STATES),

  /**
   * The devices the house has through it, how many of them answer, and how many are also
   * reached another way.
   */
  devices: z.object({
    total: z.int().min(0),
    online: z.int().min(0),
    linked: z.int().min(0).default(0),
  }),
});

/** One broker, for its card. */
export type BrokerSummary = z.output<typeof brokerSummarySchema>;

/** Every broker of the platform. */
export const brokersReplySchema = z.object({ items: z.array(brokerSummarySchema) });

/**
 * How a broker's job goes: one that changes hardware - a proxy installed, Thread set up - and
 * takes longer than one request may wait, so the page reads it until it ends.
 */
export const BROKER_JOB_STATES = ['running', 'succeeded', 'failed', 'cancelled'] as const;

/** How one step of a job stands. */
export const BROKER_STEP_STATES = ['pending', 'running', 'done', 'failed'] as const;

/**
 * A job's shape, with its own steps: each in order with how it stands, and the line it ended on.
 *
 * @param steps - The job's step ids, in order.
 * @returns The job's schema.
 */
export function brokerJobSchemaOf<const TSteps extends readonly [string, ...string[]]>(
  steps: TSteps,
) {
  return z.object({
    id: z.string().min(1).max(64),
    state: z.enum(BROKER_JOB_STATES),
    startedAt: timestampSchema,
    finishedAt: timestampSchema.nullable(),

    /** Why it failed, in a sentence; null unless it did. */
    error: z.string().max(2048).nullable(),
    steps: z
      .array(
        z.object({
          id: z.enum(steps),
          state: z.enum(BROKER_STEP_STATES),

          /** What the step found, or the line it failed on - the integration's, the log's. */
          message: z.string().max(2048).nullable(),
        }),
      )
      .max(steps.length),
  });
}
