/**
 * Asking the hub to look for one vendor's devices now, and saying what came of it.
 *
 * The hub answers as soon as it has asked the network, with how long it will keep asking; the
 * devices come in over those seconds, each one a `discovery` event the live channel turns into a
 * fresh list. So "looking" lasts as long as the hub said, and at the end the list is read once
 * more - for a page whose live channel was not connected - and compared with the one there was
 * before: what is new is what the search found.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { DiscoveredDevice } from '@nebulahome/contracts';

import { toMessage } from '@/lib/error-message';
import { LIBRARY_QUERY_KEYS, scanNetwork } from '@/library/api';

/** What a search came to. */
export type ScanOutcome =
  /** The hub is not looking: discovery is switched off on it, or it cannot find this vendor. */
  | { readonly kind: 'off' }

  /** It looked, and this many devices are proposed now that were not before. */
  | { readonly kind: 'found'; readonly count: number }

  /** It looked, and found nothing it was not already proposing. */
  | { readonly kind: 'nothing' };

/** What a page gets to look with. */
export type NetworkScan = {
  /**
   * Asks the hub to look for one vendor's devices.
   *
   * @param vendorId - The vendor.
   */
  readonly scan: (vendorId: string) => void;

  /** Whether it is asking, or waiting for the answers. */
  readonly isScanning: boolean;

  /** How long the search lasts, in milliseconds, while it does; 0 otherwise. */
  readonly lookingForMs: number;

  /** What the last search came to; null before the first, and while one runs. */
  readonly outcome: ScanOutcome | null;

  /** Why the hub could not be asked, when it could not. */
  readonly problem: string | null;
};

/**
 * The ids of a vendor's devices proposed in a list.
 *
 * @param list - The list, when there is one.
 * @param vendorId - The vendor.
 * @returns The ids.
 */
function proposedIds(list: readonly DiscoveredDevice[] | undefined, vendorId: string): Set<string> {
  return new Set(
    (list ?? []).filter((device) => device.vendorId === vendorId).map((device) => device.id),
  );
}

/**
 * Looks for devices on the network on demand.
 *
 * @returns See {@link NetworkScan}.
 */
export function useNetworkScan(): NetworkScan {
  const queryClient = useQueryClient();
  const [lookingForMs, setLookingForMs] = useState(0);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => (): void => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  /**
   * Reads the list again and says what is new in it.
   *
   * @param vendorId - The vendor looked for.
   * @param before - Its devices proposed when the search started.
   */
  const conclude = async (vendorId: string, before: ReadonlySet<string>): Promise<void> => {
    await queryClient.refetchQueries({ queryKey: LIBRARY_QUERY_KEYS.discovered });

    const after = proposedIds(
      queryClient.getQueryData<DiscoveredDevice[]>(LIBRARY_QUERY_KEYS.discovered),
      vendorId,
    );
    const count = [...after].filter((id) => !before.has(id)).length;

    setLookingForMs(0);
    setOutcome(count > 0 ? { kind: 'found', count } : { kind: 'nothing' });
  };

  const scanning = useMutation({
    /**
     * Asks the hub.
     *
     * @param vendorId - The vendor.
     * @returns How long it will look, and what was proposed before it started.
     */
    mutationFn: async (vendorId: string) => {
      const before = proposedIds(
        queryClient.getQueryData<DiscoveredDevice[]>(LIBRARY_QUERY_KEYS.discovered),
        vendorId,
      );
      const reply = await scanNetwork(vendorId);

      return { vendorId, before, reply };
    },

    /**
     * Holds the button for as long as the hub looks, then says what it found.
     *
     * @param result - What the hub answered, and the list before.
     * @param result.vendorId - The vendor.
     * @param result.before - Its devices proposed before.
     * @param result.reply - The hub's answer.
     */
    onSuccess: ({ vendorId, before, reply }) => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }

      if (reply.vendors.length === 0 || reply.lookingForMs === 0) {
        setLookingForMs(0);
        setOutcome({ kind: 'off' });

        return;
      }

      setLookingForMs(reply.lookingForMs);
      timer.current = setTimeout(() => {
        timer.current = null;
        void conclude(vendorId, before);
      }, reply.lookingForMs);
    },
  });

  return {
    /**
     * Asks the hub to look.
     *
     * @param vendorId - The vendor.
     */
    scan: (vendorId: string): void => {
      setOutcome(null);
      scanning.mutate(vendorId);
    },
    isScanning: scanning.isPending || lookingForMs > 0,
    lookingForMs,
    outcome,
    problem: scanning.error === null ? null : toMessage(scanning.error),
  };
}
