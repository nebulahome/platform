/**
 * Pairing, for a vendor whose devices are paired through one of its own: the Zigbee2MQTT bridge.
 *
 * Such a vendor is not looked for - its devices come by being paired, and once paired they are
 * added on their own - so its page offers **Pair devices** where another has Discover devices. The
 * button is the bridge's own pairing switch (`pairing` in the vendor's `discovery.json`), read
 * live: pairing opened from Zigbee2MQTT's own page shows here as open too, and closes from here.
 * While it is open a line under the header says what to do; Zigbee2MQTT closes it by itself after
 * about four minutes.
 */
import { useMutation, useQuery } from '@tanstack/react-query';

import {
  composeEntityId,
  type DeviceView,
  type EntityId,
  type IntegrationVendorView,
} from '@nebula-home/contracts';
import { Button } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { commandEntity, fetchEntity, LIBRARY_QUERY_KEYS } from '@/library/api';
import { useLive } from '@/live/live-store';

/** Where pairing stands, as the vendor's page shows it. */
export type PairingState = {
  /** The switch, once the device that has it is added; null before. */
  readonly entityId: EntityId | null;

  /** Whether pairing is open now. */
  readonly isOpen: boolean;

  /** Whether the switch can be pressed: its device is added, reachable, and the owner may. */
  readonly canPress: boolean;

  /** Why it cannot, when it cannot. */
  readonly reason: string | null;

  /** Opens pairing when it is shut, shuts it when it is open. */
  readonly toggle: () => void;

  /** Whether a press is on its way. */
  readonly isBusy: boolean;

  /** What went wrong with the last press. */
  readonly problem: string | null;
};

/**
 * Where a vendor's pairing stands.
 *
 * @param vendor - The vendor; one without `pairing` has none, and is answered as shut.
 * @param devices - The vendor's devices, among which the one with the switch.
 * @returns Where it stands, and how to press it.
 */
export function usePairing(
  vendor: IntegrationVendorView | undefined,
  devices: readonly DeviceView[],
): PairingState {
  const can = useSession((state) => state.can);
  const pairing = vendor?.pairing ?? null;
  const device =
    pairing === null || vendor === undefined
      ? undefined
      : devices.find((each) => each.kind === `${vendor.id}/${pairing.driverId}`);
  const entityId =
    pairing === null || device === undefined
      ? null
      : composeEntityId('switch', device.id, pairing.objectId);

  const entity = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.entities, entityId],
    enabled: entityId !== null,

    /**
     * Reads the switch as it was last reported, until the live channel says more.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The entity.
     */
    queryFn: async ({ signal }) => fetchEntity(entityId ?? '', signal),
  });
  const live = useLive((state) => (entityId === null ? undefined : state.readings[entityId]));
  const state = live?.state ?? entity.data?.state ?? null;
  const onOff = state?.['on_off'];
  const isOpen =
    typeof onOff === 'object' && onOff !== null && !Array.isArray(onOff) && onOff['isOn'] === true;
  const isAvailable = live?.isAvailable ?? entity.data?.isAvailable ?? false;

  const press = useMutation({
    /**
     * Turns the switch the other way.
     *
     * @param open - Whether to open pairing.
     * @returns The acknowledgement.
     */
    mutationFn: async (open: boolean) =>
      commandEntity(entityId ?? '', 'on_off', { command: open ? 'turn_on' : 'turn_off' }),
  });

  const reason =
    pairing === null
      ? null
      : device === undefined
        ? `${vendor?.name ?? 'The bridge'} has not been added yet: it is, as soon as it runs`
        : !isAvailable
          ? `${device.name} cannot be reached now`
          : !can('entity:control')
            ? 'You may not control devices'
            : null;

  return {
    entityId,
    isOpen,
    canPress: entityId !== null && reason === null,
    reason,
    isBusy: press.isPending,
    problem: press.error === null ? null : toMessage(press.error),

    /** Turns the switch the other way. */
    toggle: () => {
      press.mutate(!isOpen);
    },
  };
}

/**
 * The header's button.
 *
 * @param props - Where pairing stands.
 * @param props.pairing - It.
 * @returns The button.
 */
export function PairingButton(props: { readonly pairing: PairingState }) {
  const { pairing } = props;

  return (
    <Button
      variant={pairing.isOpen ? 'primary' : 'ghost'}
      size="compact"
      isBusy={pairing.isBusy}
      disabled={!pairing.canPress}
      title={
        pairing.reason ??
        (pairing.isOpen ? 'Close pairing now' : 'Let new devices join for about four minutes')
      }
      onClick={pairing.toggle}
    >
      {pairing.isOpen ? 'Stop pairing' : 'Pair devices'}
    </Button>
  );
}
