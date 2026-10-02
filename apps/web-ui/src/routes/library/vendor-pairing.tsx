/**
 * Pairing, for a vendor whose devices are paired through one of its own: the Zigbee2MQTT bridge.
 *
 * Such a vendor is not looked for - its devices come by being paired, and once paired they are
 * added on their own - so its page offers **Pair devices** where another has Discover devices. The
 * page runs pairing through the bridge's own entities (`pairing` in the vendor's `discovery.json`):
 * a button that opens it, one that closes it, and a sensor saying whether it is open, read live -
 * pairing opened from Zigbee2MQTT's own page shows here as open too, and closes from here. Each
 * button does one thing, whatever the page last saw: a press on a page that missed a change never
 * closes what it meant to open.
 *
 * While it is open the button counts down the time left and a panel says what to do and lists the
 * devices added since - those that were not there when the page saw it open. The time is the
 * bridge's own: when Zigbee2MQTT closes pairing by itself, which the sensor carries in its
 * `endsAt` attribute - a pairing reopened elsewhere starts the count again, and one whose end the
 * bridge did not say is shown open, without a count.
 *
 * When it cannot be pressed the reason is said in the page, not only in a tooltip: a disabled
 * button with no word beside it is a button that looks broken.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  composeEntityId,
  type DeviceView,
  type EntityId,
  type IntegrationVendorView,
  type JsonObject,
} from '@nebulahome/contracts';
import { AppIcon, Button, Panel } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { toMessage } from '@/lib/error-message';
import { commandEntity, fetchEntity, LIBRARY_QUERY_KEYS } from '@/library/api';
import { useLive } from '@/live/live-store';

/** What the pairing sensor says while pairing is open. */
export const PAIRING_OPEN = 'enabled';

/** Where pairing stands, as the vendor's page shows it. */
export type PairingState = {
  /** The sensor saying whether pairing is open, once the device that has it is added; null before. */
  readonly entityId: EntityId | null;

  /** Whether pairing is open now. */
  readonly isOpen: boolean;

  /** When it closes by itself, in milliseconds since the epoch; null while shut or unsaid. */
  readonly closesAt: number | null;

  /** Whether the buttons can be pressed: their device is added, reachable, and the owner may. */
  readonly canPress: boolean;

  /** Why they cannot, when they cannot. */
  readonly reason: string | null;

  /** Opens pairing. */
  readonly open: () => void;

  /** Closes pairing. */
  readonly close: () => void;

  /** Whether a press is on its way. */
  readonly isBusy: boolean;

  /** What went wrong with the last press. */
  readonly problem: string | null;
};

/**
 * Whether pairing is open, and until when, out of what the pairing sensor last reported.
 *
 * @param state - The sensor's state.
 * @param attributes - Its attributes, `endsAt` among them while pairing is open.
 * @returns Whether it is open, and when it closes - null when shut, or when the bridge did not say.
 */
export function pairingOf(
  state: JsonObject | null,
  attributes: JsonObject | null,
): { readonly isOpen: boolean; readonly closesAt: number | null } {
  const text = state?.['sensor_text'];
  const isOpen =
    typeof text === 'object' &&
    text !== null &&
    !Array.isArray(text) &&
    text['value'] === PAIRING_OPEN;
  const endsAt = attributes?.['endsAt'];
  const closesAt = isOpen && typeof endsAt === 'string' ? Date.parse(endsAt) : Number.NaN;

  return { isOpen, closesAt: Number.isFinite(closesAt) ? closesAt : null };
}

/**
 * Where a vendor's pairing stands.
 *
 * @param vendor - The vendor; one without `pairing` has none, and is answered as shut.
 * @param devices - The vendor's devices, among which the one with the pairing entities.
 * @returns Where it stands, and how to open and close it.
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
      : composeEntityId('sensor', device.id, pairing.stateObjectId);

  const entity = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.entities, entityId],
    enabled: entityId !== null,

    /**
     * Reads the sensor as it was last reported, until the live channel says more.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The entity.
     */
    queryFn: async ({ signal }) => fetchEntity(entityId ?? '', signal),
  });
  const live = useLive((state) => (entityId === null ? undefined : state.readings[entityId]));
  const { isOpen, closesAt } = pairingOf(
    live?.state ?? entity.data?.state ?? null,
    live?.attributes ?? entity.data?.attributes ?? null,
  );
  const isAvailable = live?.isAvailable ?? entity.data?.isAvailable ?? false;

  const press = useMutation({
    /**
     * Presses the button that opens pairing, or the one that closes it.
     *
     * @param open - Whether to open pairing.
     * @returns The acknowledgement.
     */
    mutationFn: async (open: boolean) => {
      if (pairing === null || device === undefined) {
        throw new Error('Pairing is not available yet');
      }

      return commandEntity(
        composeEntityId('button', device.id, open ? pairing.openObjectId : pairing.closeObjectId),
        'button',
        { command: 'press' },
      );
    },
  });

  const reason =
    pairing === null
      ? null
      : device === undefined
        ? `${vendor?.name ?? 'The bridge'} has not been added yet: it is, as soon as NebulaHome hears it`
        : !isAvailable
          ? `${device.name} cannot be reached now`
          : !can('entity:control')
            ? 'You may not control devices'
            : null;

  return {
    entityId,
    isOpen,
    closesAt,
    canPress: entityId !== null && reason === null,
    reason,
    isBusy: press.isPending,
    problem: press.error === null ? null : toMessage(press.error),

    /** Presses the button that opens pairing. */
    open: () => {
      press.mutate(true);
    },

    /** Presses the button that closes it. */
    close: () => {
      press.mutate(false);
    },
  };
}

/**
 * The time now, moved on every second while asked to.
 *
 * @param isTicking - Whether to keep it moving; off, it is left where it was.
 * @returns Milliseconds since the epoch.
 */
function useSecondClock(isTicking: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  // A timer is something outside React to synchronise with (RULES.md 15.2).
  useEffect(() => {
    if (!isTicking) {
      return undefined;
    }

    // The first tick at once, from a timer like the rest: a clock that last moved when the page
    // opened would count from then.
    const first = setTimeout(() => {
      setNow(Date.now());
    }, 0);
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return (): void => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [isTicking]);

  return now;
}

/**
 * The time left, as a clock reads it.
 *
 * @param ms - Milliseconds left.
 * @returns `3:42`; `0:00` once it is up.
 */
export function timeLeft(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));

  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The header's button: **Pair devices**, or while pairing is open the time left and a way to
 * stop it.
 *
 * @param props - Where pairing stands.
 * @param props.pairing - It.
 * @returns The button.
 */
export function PairingButton(props: { readonly pairing: PairingState }) {
  const { pairing } = props;
  const now = useSecondClock(pairing.isOpen);
  const left = pairing.closesAt === null ? null : pairing.closesAt - now;

  if (pairing.isOpen) {
    return (
      <Button
        variant="primary"
        size="compact"
        isBusy={pairing.isBusy}
        disabled={!pairing.canPress}
        title={pairing.reason ?? 'Close pairing now'}
        onClick={pairing.close}
      >
        <span
          aria-hidden="true"
          className="size-2 shrink-0 animate-pulse rounded-full bg-current"
        />
        <span className="tabular">Pairing{left === null ? '' : ` · ${timeLeft(left)}`}</span>
        <span className="opacity-80">Stop</span>
      </Button>
    );
  }

  return (
    <Button
      variant="primary"
      size="compact"
      isBusy={pairing.isBusy}
      disabled={!pairing.canPress}
      title={pairing.reason ?? 'Let new devices join for about four minutes'}
      onClick={pairing.open}
    >
      <AppIcon id="plus" size={15} />
      Pair devices
    </Button>
  );
}

/** What the pairing panel shows. */
export type PairingPanelProps = {
  readonly vendor: IntegrationVendorView;
  readonly pairing: PairingState;

  /** The vendor's devices, among which the ones added since pairing opened. */
  readonly devices: readonly DeviceView[];
};

/**
 * The panel under the header while pairing is open: what to do, how long is left, and the
 * devices added since it opened, as they come.
 *
 * @param props - See {@link PairingPanelProps}.
 * @returns The panel, or nothing while pairing is shut.
 */
export function PairingPanel(props: PairingPanelProps) {
  const { vendor, pairing, devices } = props;
  const now = useSecondClock(pairing.isOpen);

  // The devices there when the page saw pairing open: the ones after them joined since. Set while
  // rendering, the way React has state follow a prop, rather than a render late in an effect.
  const [before, setBefore] = useState<ReadonlySet<string> | null>(null);

  if (pairing.isOpen && before === null) {
    setBefore(new Set(devices.map((device) => device.id)));
  } else if (!pairing.isOpen && before !== null) {
    setBefore(null);
  }

  if (!pairing.isOpen) {
    return null;
  }

  const joined = devices.filter((device) => before !== null && !before.has(device.id));
  const left = pairing.closesAt === null ? null : pairing.closesAt - now;

  return (
    <Panel
      title="Pairing"
      action={
        <span className="text-caption text-foreground-muted tabular">
          {left === null ? 'Open' : `Closes in ${timeLeft(left)}`}
        </span>
      }
    >
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <p role="status" className="flex items-start gap-2.5 text-ui text-foreground-muted">
          <span
            aria-hidden="true"
            className="mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-primary"
          />
          <span>
            Put the device in pairing mode now - usually by holding its button, or switching it off
            and on a few times; its manual says how. It is added here once {vendor.name} has
            interviewed it, which can take a minute. Pairing closes by itself.
          </span>
        </p>

        {joined.length === 0 ? (
          <p className="text-caption text-foreground-subtle">No device has joined yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-field border border-border">
            {joined.map((device) => (
              <li key={device.id} className="flex items-center gap-2.5 px-3 py-2 text-ui">
                <AppIcon id="check" size={15} className="text-success" />
                <span className="font-medium text-foreground">{device.name}</span>
                {device.model === null ? null : (
                  <span className="text-caption text-foreground-subtle">{device.model}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
