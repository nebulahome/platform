/**
 * One vendor: who they are, what they need, and every device added under them.
 *
 * The header reads `Integrations / Shelly`, the way a repository names itself, so where you
 * are and the way back are the same three words. Under it, the vendor's own panel - logo,
 * marks, what the bundle says about itself - and the devices.
 *
 * A device here is the same device the Devices page lists, seen from the vendor's side: what
 * the owner added by its address, which the hub then connects to and listens for. The row is
 * what that came to - `identifying` while the hardware has not answered, `running`, or `failed`
 * with the transport's own sentence - because a device that does not answer is the one
 * somebody came here to read about. Its name is the way to the registry, narrowed to it.
 *
 * A vendor whose bundle asks for something - a key, an account - is set up once from Configure,
 * and Add device waits until it has been: the address may be right, but without the key no
 * device of theirs can connect, and a row that failed for that reason would send the owner to
 * the wrong form.
 *
 * Between the vendor and its devices, the devices of theirs the hub found on the network and
 * nobody has added, each with an Adopt - set apart from the list, and there only when something
 * was found. A vendor whose devices can be found has **Discover devices** in the header, which
 * asks the hub to look now rather than at its next pass - for as long as the hub says it looks -
 * and then says what came of it: how many were found, nothing new, or that the hub is not
 * looking at all.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import type { DiscoveredDevice, IntegrationState } from '@nebula-home/contracts';
import { Badge, Button, IconButton, Panel, Segmented, type BadgeTone } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { ExternalLinkIcon, WrenchIcon } from '@/components/icons';
import { absoluteTime, relativeTime } from '@/lib/format-time';
import { matchesQuery } from '@/lib/search-text';
import { useListState } from '@/lib/use-list-state';
import { fetchDevices, fetchDiscovered, fetchVendor, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  OPEN_VENDOR_DEVICE_FILTER,
  VENDOR_DEVICE_FILTER_CODEC,
  type DeviceStandingChoice,
} from '@/library/list-filters';
import { AdoptDialog } from '@/routes/library/adopt-dialog';
import { devicePath } from '@/routes/library/device/device-path';
import { DeviceDialog, type DeviceDialogTarget } from '@/routes/library/device-dialog';
import { DeviceIcon, useDeviceIcons } from '@/routes/library/device-icon';
import { DiscoveredStrip } from '@/routes/library/discovered-strip';
import { Facet, FilterSheet } from '@/routes/library/filter-sheet';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { useNetworkScan, type ScanOutcome } from '@/routes/library/use-network-scan';
import { Marks, VendorLogo } from '@/routes/library/vendor-card';
import { VendorSetupDialog } from '@/routes/library/vendor-setup-dialog';

/**
 * What a search for a vendor's devices came to, in a sentence.
 *
 * @param outcome - What it came to.
 * @param vendorName - The vendor, as the page names it.
 * @returns The sentence.
 */
function outcomeText(outcome: ScanOutcome, vendorName: string): string {
  switch (outcome.kind) {
    case 'off':
      return 'The hub is not looking for devices: discovery is switched off on it.';
    case 'found':
      return outcome.count === 1
        ? `Found 1 new ${vendorName} device.`
        : `Found ${String(outcome.count)} new ${vendorName} devices.`;
    case 'nothing':
      return `Nothing new found. A ${vendorName} device on another network, or one that does not announce itself, is added by its address.`;
  }
}

/** How long after a save the list is read again, for a device the hub was still starting. */
const SETTLE_MS = 3000;

/** What each runtime state means to somebody reading the page. */
const TONES: Readonly<Record<IntegrationState, BadgeTone>> = {
  stopped: 'neutral',
  starting: 'accent',
  identifying: 'accent',
  running: 'success',
  failed: 'danger',
  disabled: 'neutral',
};

/**
 * The columns of the devices table: which device, its model, how it is doing, when it last
 * reported, and the spanner.
 *
 * Every track but the first is a fixed width. The header and each row are separate grids, and
 * a track sized `auto` resolves to a different width in each of them - which is how the cells
 * once drifted from their headings. The full table needs the width a wide window has beside
 * the rail; at a tablet's width the model rides under the name and the clock waits for a wider
 * screen, so the panel never grows past the page.
 */
const COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_40px] items-center gap-3 ' +
  'md:grid-cols-[minmax(0,1fr)_120px_40px] ' +
  'lg:grid-cols-[minmax(0,1fr)_140px_120px_128px_40px]';

/**
 * The host of a site, for the link that names it.
 *
 * @param url - The vendor's site.
 * @returns `shelly.com` for `https://shelly.com/`, or the whole thing when it is not a URL.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
}

/**
 * A figure with its noun under it.
 *
 * @param props - The figure and the noun.
 * @param props.value - The figure.
 * @param props.noun - What is being counted, pluralised by the caller.
 * @returns The stat.
 */
function Stat(props: { readonly value: number; readonly noun: string }) {
  const { value, noun } = props;

  return (
    <span className="flex flex-col items-end gap-0.5 pl-5">
      <span className="text-headline font-semibold tracking-tight text-foreground tabular">
        {value}
      </span>
      <span className="text-caption text-foreground-subtle">{noun}</span>
    </span>
  );
}

/**
 * The line under the vendor's name - id, version, when it was set up, its site - with a dot
 * between each pair, and nothing after the last.
 *
 * @param props - The parts, in order; a part that is not there is left out.
 * @param props.parts - What to show.
 * @returns The line.
 */
function MetaLine(props: { readonly parts: readonly (ReactNode | null)[] }) {
  const present = props.parts.filter((part) => part !== null);

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-foreground-subtle">
      {present.map((part, index) => (
        // Position is identity here: the parts are a fixed, ordered handful.
        // eslint-disable-next-line react/no-array-index-key
        <span key={index} className="flex items-center gap-x-2.5">
          {index === 0 ? null : (
            <span aria-hidden="true" className="text-foreground-subtle">
              ·
            </span>
          )}
          {part}
        </span>
      ))}
    </div>
  );
}

/** The standings the device table is narrowed by. */
const STANDING_OPTIONS: readonly {
  readonly value: DeviceStandingChoice;
  readonly label: string;
}[] = [
  { value: 'any', label: 'Any' },
  { value: 'running', label: 'Running' },
  { value: 'failing', label: 'Failed' },
  { value: 'disabled', label: 'Disabled' },
];

/**
 * Whether a device's state is the standing asked for.
 *
 * @param state - The device's lifecycle state.
 * @param standing - What the filter asks for.
 * @returns True when it matches, or when any standing will do.
 */
function standingMatches(state: IntegrationState, standing: DeviceStandingChoice): boolean {
  switch (standing) {
    case 'any':
      return true;
    case 'running':
      return state === 'running';
    case 'failing':
      return state === 'failed';
    case 'disabled':
      return state === 'disabled';
  }
}

/**
 * Renders one vendor's page.
 *
 * @returns The page.
 */
export function VendorPage() {
  const { vendorId = '' } = useParams();
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const canConfigure = can('integration:configure');
  const canWrite = can('device:write');
  const canRemove = can('device:delete');
  const canCreateTags = can('tag:write');
  const [open, setOpen] = useState<DeviceDialogTarget | null>(null);
  const [isSettingUp, setSettingUp] = useState(false);
  const [adopting, setAdopting] = useState<DiscoveredDevice | null>(null);
  const network = useNetworkScan();

  const vendor = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.vendors, vendorId],

    /**
     * Reads the vendor.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The vendor.
     */
    queryFn: async ({ signal }) => fetchVendor(vendorId, signal),
  });

  const all = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,

    /**
     * Reads every device; the page keeps this vendor's.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchDevices(signal),
  });

  const discovered = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.discovered,
    enabled: can('device:read'),

    /**
     * Reads what the hub found on the network and nobody has added; the page keeps this vendor's.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The devices found.
     */
    queryFn: async ({ signal }) => fetchDiscovered(signal),
  });

  const found = vendor.data;
  const foundDevices = (discovered.data ?? []).filter((each) => each.vendorId === vendorId);
  const canDiscover = canWrite && (found?.discoverySources.length ?? 0) > 0;
  const devices = (all.data ?? []).filter((each) => each.vendorId === vendorId);
  const [filter, setFilter] = useListState(VENDOR_DEVICE_FILTER_CODEC);
  const shownDevices = devices.filter(
    (device) =>
      standingMatches(device.state, filter.standing) &&
      matchesQuery(
        [
          device.name,
          device.model,
          device.driverName,
          device.areaName,
          device.externalId,
          device.id,
        ],
        filter.search,
      ),
  );
  const icons = useDeviceIcons(devices);
  const hasSetupFields =
    found !== undefined &&
    found.setup.transport.fields.length + found.setup.options.fields.length > 0;

  /**
   * Reads everything again once a row is written, and once more when the hub was still
   * starting the instance.
   *
   * @param state - The state the row came back with.
   */
  const settle = (state: IntegrationState): void => {
    setOpen(null);
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
    // A save can change the tags on the device, and the tags page counts what carries each.
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.tags });

    if (state === 'starting' || state === 'identifying') {
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
      }, SETTLE_MS);
    }
  };

  return (
    <>
      <LibraryPage
        title={found?.name ?? vendorId}
        parent={{ to: '/integrations', label: 'Integrations' }}
        noun="device"
        tools={
          devices.length === 0 ? undefined : (
            <>
              <SearchField
                placeholder="Search this vendor's devices…"
                value={filter.search}
                onChange={(search) => {
                  setFilter({ ...filter, search });
                }}
              />
              <FilterSheet
                label="Narrow the devices"
                count={Number(filter.standing !== 'any')}
                onClear={() => {
                  setFilter({ ...filter, standing: 'any' });
                }}
              >
                <Facet title="Status">
                  <Segmented
                    label="Status"
                    size="compact"
                    className="self-start"
                    options={STANDING_OPTIONS}
                    value={filter.standing}
                    onChange={(standing) => {
                      setFilter({ ...filter, standing });
                    }}
                  />
                </Facet>
              </FilterSheet>
            </>
          )
        }
        action={
          found !== undefined && (canConfigure || canDiscover) ? (
            <>
              {canDiscover ? (
                <Button
                  variant="ghost"
                  size="compact"
                  isBusy={network.isScanning}
                  title={
                    network.problem ?? `Ask every ${found.name} device on the network who it is`
                  }
                  onClick={() => {
                    network.scan(found.id);
                  }}
                >
                  {network.isScanning ? 'Looking…' : 'Discover devices'}
                </Button>
              ) : null}
              {canConfigure && hasSetupFields ? (
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => {
                    setSettingUp(true);
                  }}
                >
                  Configure
                </Button>
              ) : null}
              {canConfigure ? (
                <Button variant="ghost" size="compact" disabled title="Not here yet">
                  Remove
                </Button>
              ) : null}
            </>
          ) : undefined
        }
        isPending={vendor.isPending || all.isPending}
        error={vendor.error ?? all.error}
        isEmpty={false}
      >
        {found === undefined ? null : (
          <>
            <section className="flex flex-wrap items-start gap-x-4.5 gap-y-4 rounded-panel border border-border face-card p-5 md:flex-nowrap">
              <VendorLogo vendor={found} size={56} />

              <div className="flex min-w-0 grow flex-col gap-2">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-head font-semibold tracking-tight text-foreground">
                    {found.name}
                  </h2>
                  <Marks vendor={found} size="small" />
                </div>

                {found.description === undefined ? null : (
                  <p className="max-w-2xl text-ui leading-relaxed text-foreground-muted">
                    {found.description}
                  </p>
                )}

                <MetaLine
                  parts={[
                    <span key="id" className="font-mono">
                      {found.id}
                    </span>,
                    <span key="version" className="tabular">
                      v{found.version}
                    </span>,
                    found.configuredAt === null ? null : (
                      <span key="configured">Set up {absoluteTime(found.configuredAt)}</span>
                    ),
                    found.url === undefined ? null : (
                      <a
                        key="site"
                        href={found.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary transition-colors hover:text-primary-hover"
                      >
                        {hostOf(found.url)}
                        <ExternalLinkIcon width="12" height="12" />
                      </a>
                    ),
                  ]}
                />
              </div>

              <div className="flex items-start pl-14 md:pl-0">
                <Stat value={devices.length} noun={devices.length === 1 ? 'device' : 'devices'} />
                <Stat
                  value={found.entityCount}
                  noun={found.entityCount === 1 ? 'entity' : 'entities'}
                />
              </div>
            </section>

            {found.needsSetup ? (
              <Panel title="Before anything else" elevation="flat">
                <div className="flex items-center gap-4 px-4 py-3.5">
                  <p role="status" className="grow text-ui text-foreground-muted">
                    {found.name} needs setting up before a device of theirs can connect: the bundle
                    asks for something every device shares.
                  </p>
                  {canConfigure ? (
                    <Button
                      size="compact"
                      onClick={() => {
                        setSettingUp(true);
                      }}
                    >
                      Set up
                    </Button>
                  ) : null}
                </div>
              </Panel>
            ) : null}

            {network.problem === null ? null : (
              <p role="alert" className="text-ui text-danger">
                {network.problem}
              </p>
            )}

            {network.isScanning ? (
              <p role="status" className="text-ui text-foreground-muted">
                Asking every {found.name} device on the network who it is
                {network.lookingForMs > 0
                  ? `, for the next ${String(Math.round(network.lookingForMs / 1000))} seconds…`
                  : '…'}
              </p>
            ) : network.outcome === null ? null : (
              <p role="status" className="text-ui text-foreground-muted">
                {outcomeText(network.outcome, found.name)}
              </p>
            )}

            <DiscoveredStrip
              devices={foundDevices}
              vendors={[found]}
              canAdopt={canWrite && !found.needsSetup}
              onAdopt={setAdopting}
            />

            <Panel
              title={
                shownDevices.length === devices.length
                  ? `Devices · ${String(devices.length)}`
                  : `Devices · ${String(shownDevices.length)} of ${String(devices.length)}`
              }
              action={
                canWrite ? (
                  <Button
                    size="compact"
                    disabled={found.needsSetup}
                    title={found.needsSetup ? `Set up ${found.name} first` : undefined}
                    onClick={() => {
                      setOpen({
                        mode: 'create',
                        vendor: found,
                        existingIds: (all.data ?? []).map((each) => each.id),
                      });
                    }}
                  >
                    Add device
                  </Button>
                ) : undefined
              }
            >
              <div
                className={`${COLUMNS} border-b border-border-soft px-4 py-2.5 text-label text-foreground-subtle uppercase`}
                aria-hidden="true"
              >
                <span>Device</span>
                <span className="hidden lg:block">Model</span>
                <span className="hidden md:block">Status</span>
                <span className="hidden lg:block">Last updated</span>
                <span />
              </div>

              {devices.length === 0 ? (
                <p className="px-4 py-3.5 text-ui text-foreground-muted">
                  Nothing added yet. Add a device by its address and the hub listens for it at once.
                </p>
              ) : shownDevices.length === 0 ? (
                <div className="p-4">
                  <NoMatches
                    query={filter.search}
                    onClear={() => {
                      setFilter(OPEN_VENDOR_DEVICE_FILTER);
                    }}
                  />
                </div>
              ) : (
                <ul>
                  {shownDevices.map((device) => (
                    <li
                      key={device.id}
                      className={`${COLUMNS} border-b border-border-soft px-4 py-3 last:border-b-0`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <DeviceIcon
                          icon={icons.get(device.icon ?? '')}
                          className="text-foreground-muted"
                        />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <Link
                            to={devicePath(device.id)}
                            className="truncate text-ui font-medium text-foreground transition-colors hover:text-primary"
                          >
                            {device.name}
                          </Link>
                          <span className="text-caption text-foreground-subtle lg:hidden">
                            {device.model ?? device.driverName}
                          </span>
                          {device.state === 'identifying' ? (
                            <span className="text-caption text-foreground-subtle">
                              Listening for the device…
                            </span>
                          ) : null}
                          {device.lastError === null ? null : (
                            <span className="text-caption text-danger">{device.lastError}</span>
                          )}
                        </span>
                      </span>
                      <span className="hidden truncate text-ui text-foreground-muted lg:block">
                        {device.model ?? device.driverName}
                      </span>
                      <span className="hidden items-center md:flex">
                        <Badge tone={TONES[device.state]} size="small">
                          {device.state}
                        </Badge>
                      </span>
                      <span className="hidden text-caption text-foreground-subtle tabular lg:block">
                        {device.lastUpdatedAt === null ? '—' : relativeTime(device.lastUpdatedAt)}
                      </span>
                      <span className="flex justify-end">
                        {canWrite ? (
                          <IconButton
                            variant="bare"
                            size="small"
                            label={`Configure ${device.name}`}
                            onClick={() => {
                              setOpen({ mode: 'edit', vendor: found, device });
                            }}
                          >
                            <WrenchIcon width="16" height="16" />
                          </IconButton>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}
      </LibraryPage>

      <DeviceDialog
        // Keyed on the target, so the dialog is a fresh one each time it opens and its fields
        // start from what the row holds rather than from what the last one held.
        key={
          open === null
            ? 'device-shut'
            : open.mode === 'create'
              ? 'device-create'
              : `device-${open.device.id}`
        }
        target={open}
        canRemove={canRemove}
        canCreateTags={canCreateTags}
        onClose={() => {
          setOpen(null);
        }}
        onSaved={(device) => {
          settle(device.state);
        }}
        onRemoved={() => {
          // The device, its entities and the tags on them are gone: every list that showed
          // them reads again.
          setOpen(null);
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.tags });
        }}
      />

      <AdoptDialog
        key={adopting?.id ?? 'adopt-shut'}
        target={
          adopting === null || found === undefined
            ? null
            : {
                device: adopting,
                vendor: found,
                existingIds: (all.data ?? []).map((each) => each.id),
              }
        }
        canCreateTags={canCreateTags}
        onClose={() => {
          setAdopting(null);
        }}
        onAdopted={() => {
          setAdopting(null);
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.discovered });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.tags });
        }}
      />

      <VendorSetupDialog
        key={isSettingUp ? 'setup-open' : 'setup-shut'}
        vendor={isSettingUp && found !== undefined ? found : null}
        onClose={() => {
          setSettingUp(false);
        }}
        onSaved={() => {
          setSettingUp(false);
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
        }}
      />
    </>
  );
}
