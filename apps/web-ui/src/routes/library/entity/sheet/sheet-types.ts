/**
 * What the entity dialog and each kind of thing's body inside it are given.
 *
 * The dialog draws the platform's own shapes - the entity, its state, its commander, its history
 * as the history endpoints return it - so that whatever opens it only has to fetch and pass them.
 */
import type { ComponentType } from 'react';

import type { StateHistoryPoint, TelemetryPoint } from '@nebulahome/contracts';
import type { UiIconId } from '@nebulahome/ui';

import type { TimeWindow } from '@/library/history-series';
import type { ControlProps } from '@/routes/library/entity/controls/control-block';
import type { SheetTone } from '@/routes/library/entity/sheet/tones';

/** The windows a history is read over: the last hours or days. */
export const SHEET_RANGES = ['6h', '24h', '7d'] as const;

/** The windows a running total is added up over: today, this week, this month. */
export const TOTAL_RANGES = ['day', 'week', 'month'] as const;

/** A window the dialog reads history over. */
export type SheetRange = (typeof SHEET_RANGES)[number] | (typeof TOTAL_RANGES)[number];

/** An entity's history over one window, as the history endpoints return it. */
export type SheetHistory = {
  /** The window chosen. */
  readonly range: SheetRange;

  /** Called when another window is chosen; the history then follows for it. */
  readonly onRange: (range: SheetRange) => void;

  /** The window, in milliseconds since the epoch. */
  readonly window: TimeWindow;

  /** The state changes inside it, oldest first. */
  readonly states: readonly StateHistoryPoint[];

  /** A numeric reading's points inside it, oldest first: buckets for a long window. */
  readonly telemetry: readonly TelemetryPoint[];
};

/** What a kind of thing's body is given. */
export type SheetBodyProps = ControlProps & {
  /** The history, for a body that is its chart. */
  readonly history: SheetHistory;

  /** The battery of the device the entity is on, from its battery sensor; null when it has none. */
  readonly battery: number | null;

  /** The time now, in milliseconds since the epoch: "since", "for 3 h". */
  readonly now: number;
};

/** How an entity is drawn in the dialog, by its kind. */
export type SheetKind = {
  /** Its colour. */
  readonly tone: SheetTone;

  /** Its glyph, when the entity has no icon of its own. */
  readonly icon: UiIconId;

  /** What it is, in the line under the name: "Light · dimmable". */
  readonly words: string;

  /** Whether its tile is lit: a lamp that is on, a sensor that reads. */
  readonly isLit: boolean;

  /**
   * Where its history goes: in a drawer the History button opens under the controls, in the body
   * itself (a sensor, whose chart is what it is), or nowhere (a button, a firmware update).
   */
  readonly history: 'drawer' | 'body' | 'none';

  /** The body. */
  readonly Body: ComponentType<SheetBodyProps>;
};
