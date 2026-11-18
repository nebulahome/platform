/**
 * Where a card drawn as a sample reads its past and its pictures.
 *
 * A card in the Add card catalogue, or on the development card lab, is the real card drawn with
 * sample values: it must not ask the hub for a sensor's day or a camera's still, which are not
 * there. Under this context the hooks that would ask take the sample's answer instead; everywhere
 * else the context is empty and they read the hub as they always do.
 */
import { createContext, useContext } from 'react';

import type {
  ActivityEntry,
  AutomationView,
  StateHistoryPoint,
  TelemetryPoint,
} from '@nebulahome/contracts';

import type { CardHistory } from '@/routes/dashboard/cards/use-card-history';

/** What a sample card reads in place of the hub. */
export type CardSampleSource = {
  /** A sensor's readings, as `useTelemetry` would return them. */
  readonly telemetry: (entityId: string) => CardHistory<TelemetryPoint> | undefined;

  /** An entity's changes of state, as `useStateChanges` would return them. */
  readonly stateChanges: (entityId: string) => CardHistory<StateHistoryPoint> | undefined;

  /** A camera's still, as an address an `<img>` can show. */
  readonly still: (entityId: string) => string | null;

  /** The automations an automation card reads. */
  readonly automations?: readonly AutomationView[];

  /** The latest changes an activity card lists, newest first. */
  readonly activity?: readonly ActivityEntry[];
};

/** The sample source of the cards under it; null on a real dashboard. */
export const CardSampleContext = createContext<CardSampleSource | null>(null);

/**
 * The sample source of the card being drawn, if it is a sample.
 *
 * @returns The source, or null on a real dashboard.
 */
export function useCardSample(): CardSampleSource | null {
  return useContext(CardSampleContext);
}
