/**
 * Asking the hub to look for devices now, and saying so while it does.
 *
 * The hub answers as soon as it has asked the network, and the devices come in over the next
 * seconds, each one a `discovery` event the live channel turns into a fresh list. So "looking" is
 * a few seconds the button holds after the answer, long enough for a Shelly or a Govee lamp that
 * heard the question to have answered it; the list is read once more at the end, for a page whose
 * live channel was not connected.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { toMessage } from '@/lib/error-message';
import { LIBRARY_QUERY_KEYS, scanNetwork } from '@/library/api';

/** How long the button says it is looking after the hub has asked. */
export const SCAN_SETTLE_MS = 6000;

/** What a page gets to look with. */
export type NetworkScan = {
  /**
   * Asks the hub to look.
   *
   * @param vendorId - Only this vendor; every vendor when absent.
   */
  readonly scan: (vendorId?: string) => void;

  /** Whether it is asking, or waiting for the answers. */
  readonly isScanning: boolean;

  /** Why the hub could not be asked, when it could not. */
  readonly problem: string | null;
};

/**
 * Looks for devices on the network on demand.
 *
 * @returns See {@link NetworkScan}.
 */
export function useNetworkScan(): NetworkScan {
  const queryClient = useQueryClient();
  const [isSettling, setSettling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => (): void => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const scanning = useMutation({
    /**
     * Asks the hub.
     *
     * @param vendorId - Only this vendor, when given.
     * @returns The vendors it is looking for.
     */
    mutationFn: async (vendorId: string | undefined) => scanNetwork(vendorId),

    /** Holds the button for the answers to come in, then reads the list once more. */
    onSuccess: () => {
      setSettling(true);

      if (timer.current !== null) {
        clearTimeout(timer.current);
      }

      timer.current = setTimeout(() => {
        timer.current = null;
        setSettling(false);
        void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.discovered });
      }, SCAN_SETTLE_MS);
    },
  });

  return {
    /**
     * Asks the hub to look.
     *
     * @param vendorId - Only this vendor, when given.
     */
    scan: (vendorId?: string): void => {
      scanning.mutate(vendorId);
    },
    isScanning: scanning.isPending || isSettling,
    problem: scanning.error === null ? null : toMessage(scanning.error),
  };
}
