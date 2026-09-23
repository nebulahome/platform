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
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import type { IntegrationState } from '@nebula-home/contracts';
import { Badge, Button, IconButton, Panel, type BadgeTone } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { ExternalLinkIcon, WrenchIcon } from '@/components/icons';
import { absoluteTime, relativeTime } from '@/lib/format-time';
import { fetchDevices, fetchVendor, LIBRARY_QUERY_KEYS } from '@/library/api';
import { DeviceDialog, type DeviceDialogTarget } from '@/routes/library/device-dialog';
import { DeviceIcon, useDeviceIcons } from '@/routes/library/device-icon';
import { LibraryPage } from '@/routes/library/library-page';
import { Marks, VendorLogo } from '@/routes/library/vendor-card';
import { VendorSetupDialog } from '@/routes/library/vendor-setup-dialog';

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

  const found = vendor.data;
  const devices = (all.data ?? []).filter((each) => each.vendorId === vendorId);
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
        hasTabs={false}
        noun="device"
        action={
          canConfigure && found !== undefined ? (
            <>
              {hasSetupFields ? (
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
              <Button variant="ghost" size="compact" disabled title="Not here yet">
                Remove
              </Button>
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

            <Panel
              title={`Devices · ${String(devices.length)}`}
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
              ) : (
                <ul>
                  {devices.map((device) => (
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
                            to={`/devices?device=${device.id}`}
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
