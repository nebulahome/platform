/**
 * Asking the browser where it is, for "Use this device" on the Home step.
 *
 * A browser shares its location only in a secure context - over HTTPS, or on this machine - and a
 * hub opened at `http://192.168.1.20` is not one. Rather than a button that fails when pressed,
 * the button is off and says why. The answer is rounded to four decimals, about ten metres: enough
 * for the sun, and no finer than a house needs.
 */
import { useState } from 'react';

import { translate } from '@/i18n/messages';
import type { HousePosition } from '@/lib/house-position';

/** How many decimals a position is kept to. */
const DECIMALS = 4;

/** What asking looks like. */
export type DevicePosition = {
  /** Why it cannot be asked here, or undefined when it can. */
  readonly unavailableReason: string | undefined;

  /** Whether the browser is being asked now. */
  readonly isAsking: boolean;

  /** Why the last ask came back empty, if it did. */
  readonly error: string | undefined;

  /** Asks; calls back with the position when the browser gives one. */
  readonly ask: (onPosition: (position: HousePosition) => void) => void;
};

/**
 * Why a browser cannot be asked for its position here.
 *
 * @returns The reason, or undefined when it can.
 */
function unavailableReasonHere(): string | undefined {
  if (!globalThis.isSecureContext) {
    return translate(
      'home.device.insecure',
      'Your browser shares its location only over HTTPS or on this machine.',
    );
  }

  return 'geolocation' in globalThis.navigator
    ? undefined
    : translate('home.device.unsupported', 'This browser cannot share its location.');
}

/**
 * A number kept to a few decimals.
 *
 * @param value - The number.
 * @returns It, rounded.
 */
function rounded(value: number): number {
  const scale = 10 ** DECIMALS;

  return Math.round(value * scale) / scale;
}

/**
 * Asking the browser where it is.
 *
 * @returns See {@link DevicePosition}.
 */
export function useDevicePosition(): DevicePosition {
  const [isAsking, setAsking] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const unavailableReason = unavailableReasonHere();

  return {
    unavailableReason,
    isAsking,
    error,
    /**
     * Asks the browser where it is.
     *
     * @param onPosition - Called with the position, rounded, when the browser gives one.
     */
    ask: (onPosition) => {
      if (unavailableReason !== undefined) {
        return;
      }

      setAsking(true);
      setError(undefined);
      globalThis.navigator.geolocation.getCurrentPosition(
        (answer) => {
          setAsking(false);
          onPosition({
            latitude: rounded(answer.coords.latitude),
            longitude: rounded(answer.coords.longitude),
          });
        },
        (failure) => {
          setAsking(false);
          setError(
            failure.code === failure.PERMISSION_DENIED
              ? translate(
                  'home.device.denied',
                  'The location was not shared. Type the position instead.',
                )
              : translate(
                  'home.device.failed',
                  'The browser could not tell where it is. Type the position instead.',
                ),
          );
        },
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 },
      );
    },
  };
}
