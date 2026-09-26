/**
 * Moving a device already added to the address it was found answering at.
 *
 * A device whose lease changed answers at an address its row does not name, and discovery
 * proposes it as moved rather than following it: a device on the network claiming another's id
 * is not proof that it is that device. The owner who recognises it moves it here, which is an
 * ordinary edit of the device's address - the rest of its settings, secrets included, merge
 * back as they were - and the hub reconnects it at the new one.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { DiscoveredDevice } from '@nebula-home/contracts';

import { toMessage } from '@/lib/error-message';
import { LIBRARY_QUERY_KEYS, updateDevice } from '@/library/api';

/** What a page gets to move devices with. */
export type MoveDevice = {
  /**
   * Moves the device a found one says it is to the found one's address.
   *
   * @param found - The found device, whose `movedFrom` names the device to move.
   */
  readonly move: (found: DiscoveredDevice) => void;

  /** The found device being moved now; null when none is. */
  readonly movingId: string | null;

  /** Why the last move failed, when it did. */
  readonly problem: string | null;
};

/**
 * Builds the move.
 *
 * @returns The move, and how it is going.
 */
export function useMoveDevice(): MoveDevice {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    /**
     * Writes the found address over the device's own.
     *
     * @param found - The found device.
     * @returns The device as it now stands.
     */
    mutationFn: async (found: DiscoveredDevice) => {
      if (found.movedFrom === null) {
        throw new Error('This device is not one already added');
      }

      return updateDevice(found.movedFrom.deviceId, { transportConfig: found.transportConfig });
    },

    /** Reads the lists again: the device moved, and it is no longer found elsewhere. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.discovered });
    },
  });

  return {
    /**
     * Moves a device to where it was found.
     *
     * @param found - Where it was found.
     */
    move: (found) => {
      mutation.mutate(found);
    },
    movingId: mutation.isPending ? mutation.variables.id : null,
    problem: mutation.error === null ? null : toMessage(mutation.error),
  };
}
