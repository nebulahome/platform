/**
 * The platform's brokers, as the Brokers page lists them: the house's Matter fabric, its MQTT
 * broker and its Modbus client, all run by the hub.
 *
 * A broker reaches every device of one protocol, whoever makes it. Each has a page of its own -
 * `matter.ts`, `mqtt.ts` and `modbus.ts` say what it holds - and a card here, which says how it stands and how
 * many devices the house has through it.
 */
import { z } from 'zod';

/** How a broker stands: coming up, running, stopped by a failure, or turned off. */
export const BROKER_STATES = ['starting', 'running', 'failed', 'disabled'] as const;

/** How a broker stands. */
export type BrokerState = (typeof BROKER_STATES)[number];

/** The brokers the platform runs, as the Brokers page lists them: by the vendor each is. */
export const BROKER_IDS = ['matter', 'mqtt', 'modbus'] as const;

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
