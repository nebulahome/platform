/**
 * What a control shows between the person setting a value and the device reporting it.
 *
 * A slider let go at 70% must stay at 70%: the command takes a moment to reach the lamp and the
 * lamp a moment to say so, and a knob that sprang back to 40% in the meantime would read as a
 * refusal. So the value set is held and shown until the device reports again after it was sent,
 * and then the report wins - whatever the lamp actually did is what the page shows. While the
 * knob is still being dragged nothing overrides it at all, and a value that is never confirmed
 * gives way after a few seconds rather than lying for ever.
 */
import { useEffect, useState } from 'react';

/** How long a sent value is shown without a report confirming it. */
const HOLD_MS = 8000;

/** A value the person set, and when it was sent; null while it is still being set. */
type Held<TValue> = {
  readonly value: TValue;
  readonly sentAt: number | null;
};

/** What a control gets. */
export type PendingValue<TValue> = {
  /** What to show: the held value while it stands, the reported one otherwise. */
  readonly shown: TValue;

  /** Holds a value that is still being set, such as a knob mid-drag. */
  readonly hold: (value: TValue) => void;

  /** Holds a value that has just been sent, until a report comes after it. */
  readonly sent: (value: TValue) => void;

  /** Lets go of any held value, such as after a refusal. */
  readonly release: () => void;
};

/**
 * Holds what a control was set to until the device has had its say.
 *
 * @param reported - What the device last reported.
 * @param reportedAt - When that report arrived, in milliseconds since the epoch; null for never.
 * @returns See {@link PendingValue}.
 */
export function usePendingValue<TValue>(
  reported: TValue,
  reportedAt: number | null,
): PendingValue<TValue> {
  const [held, setHeld] = useState<Held<TValue> | null>(null);
  const sentAt = held?.sentAt ?? null;

  // A timer is something outside React to synchronise with (RULES.md 15.2): a value that was
  // sent and never confirmed stops being shown after a while.
  useEffect(() => {
    if (sentAt === null) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setHeld(null);
    }, HOLD_MS);

    return (): void => {
      clearTimeout(timer);
    };
  }, [sentAt]);

  const isConfirmed = sentAt !== null && reportedAt !== null && reportedAt > sentAt;

  return {
    shown: held === null || isConfirmed ? reported : held.value,
    /**
     * Holds a value still being set.
     *
     * @param value - The value.
     */
    hold: (value) => {
      setHeld({ value, sentAt: null });
    },
    /**
     * Holds a value just sent.
     *
     * @param value - The value.
     */
    sent: (value) => {
      setHeld({ value, sentAt: Date.now() });
    },
    /** Lets go of the held value. */
    release: () => {
      setHeld(null);
    },
  };
}
