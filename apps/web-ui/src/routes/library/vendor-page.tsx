/**
 * One vendor: who they are, what they need, and every device added under them.
 *
 * The header reads `Integrations / Shelly`, the way a repository names itself, so where you
 * are and the way back are the same three words. Under it, the vendor's own panel - logo,
 * marks, what the bundle says about itself - and the devices.
 *
 * A device here is an instance: something the owner added by its address, which the hub then
 * tries to connect to. The row is what that attempt came to - `running`, or `failed` with the
 * transport's own sentence - because a device that does not answer is the one somebody came
 * here to read about. Finding devices on the network, and adopting what answers, is not here
 * yet; the Devices page still does that for what is already running.
 *
 * A vendor whose bundle asks for something - a key, an account - is set up once from Configure,
 * and Add device waits until it has been: the address may be right, but without the key no
 * device of theirs can connect, and a row that failed for that reason would send the owner to
 * the wrong form.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';

import type { IntegrationState } from '@nebula-home/contracts';
import { Badge, Button, Panel, PanelNote, type BadgeTone } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { ExternalLinkIcon } from '@/components/icons';
import { absoluteTime, relativeTime } from '@/lib/format-time';
import { fetchIntegrations, fetchVendor, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  IntegrationDialog,
  type IntegrationDialogTarget,
} from '@/routes/library/integration-dialog';
import { LibraryPage } from '@/routes/library/library-page';
import { Marks, VendorLogo } from '@/routes/library/vendor-card';
import { VendorSetupDialog } from '@/routes/library/vendor-setup-dialog';

/** How long after a save the list is read again, for an instance the hub reported `starting`. */
const SETTLE_MS = 3000;

/** What each runtime state means to somebody reading the page. */
const TONES: Readonly<Record<IntegrationState, BadgeTone>> = {
  stopped: 'neutral',
  starting: 'accent',
  running: 'success',
  failed: 'danger',
  disabled: 'neutral',
};

/**
 * The columns of the devices table: what, which model, how much, how it is doing, since when.
 *
 * The full table needs the width a wide window has beside the rail; at a tablet's width the
 * model rides under the id and the counts and the clock wait for a wider screen, so the panel
 * never grows past the page and pushes its own button out of reach.
 */
const COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 ' +
  'md:grid-cols-[minmax(0,1fr)_minmax(96px,auto)_auto] ' +
  'lg:grid-cols-[minmax(0,1fr)_130px_72px_minmax(100px,auto)_104px_auto]';

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
 * Renders one vendor's page.
 *
 * @returns The page.
 */
export function VendorPage() {
  const { vendorId = '' } = useParams();
  const queryClient = useQueryClient();
  const canConfigure = useSession((state) => state.can)('integration:configure');
  const [open, setOpen] = useState<IntegrationDialogTarget | null>(null);
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

  const integrations = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.integrations,

    /**
     * Reads every instance; the page keeps this vendor's.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The instances.
     */
    queryFn: async ({ signal }) => fetchIntegrations(signal),
  });

  const found = vendor.data;
  const devices = (integrations.data ?? []).filter((each) => each.vendorId === vendorId);
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
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.integrations });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });

    if (state === 'starting') {
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.integrations });
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
        isPending={vendor.isPending || integrations.isPending}
        error={vendor.error ?? integrations.error}
        isEmpty={false}
      >
        {found === undefined ? null : (
          <>
            <section className="flex flex-wrap items-start gap-x-[18px] gap-y-4 rounded-panel border border-border face-card p-5 md:flex-nowrap">
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

                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-caption text-foreground-subtle">
                  <span className="font-mono">{found.id}</span>
                  <span className="tabular">v{found.version}</span>
                  {found.configuredAt === null ? null : (
                    <span>Set up {absoluteTime(found.configuredAt)}</span>
                  )}
                  {found.url === undefined ? null : (
                    <a
                      href={found.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary transition-colors hover:text-primary-hover"
                    >
                      {hostOf(found.url)}
                      <ExternalLinkIcon width="12" height="12" />
                    </a>
                  )}
                </div>
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
                canConfigure ? (
                  <Button
                    size="compact"
                    disabled={found.needsSetup}
                    title={found.needsSetup ? `Set up ${found.name} first` : undefined}
                    onClick={() => {
                      setOpen({
                        mode: 'create',
                        vendor: found,
                        existingIds: (integrations.data ?? []).map((each) => each.id),
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
                <span className="hidden lg:block">Entities</span>
                <span className="hidden md:block">Status</span>
                <span className="hidden lg:block">Last started</span>
                <span />
              </div>

              {devices.length === 0 ? (
                <p className="px-4 py-3.5 text-ui text-foreground-muted">
                  Nothing added yet. Add a device by its address and the hub connects to it at once.
                </p>
              ) : (
                <ul>
                  {devices.map((device) => (
                    <li
                      key={device.id}
                      className={`${COLUMNS} border-b border-border-soft px-4 py-3 last:border-b-0`}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-mono text-ui text-foreground">
                          {device.id}
                        </span>
                        <span className="text-caption text-foreground-subtle lg:hidden">
                          {device.model ?? device.driverName}
                        </span>
                        {device.lastError === null ? null : (
                          <span className="text-caption text-danger">{device.lastError}</span>
                        )}
                      </span>
                      <span className="hidden truncate text-ui text-foreground-muted lg:block">
                        {device.model ?? device.driverName}
                      </span>
                      <span className="hidden font-mono text-ui text-foreground-muted tabular lg:block">
                        {device.entityCount}
                      </span>
                      <span className="hidden items-center gap-2 md:flex">
                        <Badge tone={TONES[device.state]} size="small">
                          {device.state}
                        </Badge>
                        {device.isEnabled ? null : (
                          <Badge tone="neutral" size="small">
                            Off
                          </Badge>
                        )}
                      </span>
                      <span className="hidden text-caption text-foreground-subtle tabular lg:block">
                        {device.lastStartedAt === null ? '—' : relativeTime(device.lastStartedAt)}
                      </span>
                      <span className="flex justify-end">
                        {canConfigure ? (
                          <Button
                            variant="ghost"
                            size="compact"
                            onClick={() => {
                              setOpen({ mode: 'edit', vendor: found, integration: device });
                            }}
                          >
                            Configure
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <PanelNote>
                Add device connects to one device by its address and starts talking to it at once;
                Test tries the address first. Finding devices on the network is coming later.
              </PanelNote>
            </Panel>
          </>
        )}
      </LibraryPage>

      <IntegrationDialog
        // Keyed on the target, so the dialog is a fresh one each time it opens and its fields
        // start from what the row holds rather than from what the last one held.
        key={open === null ? 'shut' : open.mode === 'create' ? 'create' : open.integration.id}
        target={open}
        onClose={() => {
          setOpen(null);
        }}
        onSaved={(integration) => {
          settle(integration.state);
        }}
      />

      <VendorSetupDialog
        key={isSettingUp ? 'open' : 'shut'}
        vendor={isSettingUp && found !== undefined ? found : null}
        onClose={() => {
          setSettingUp(false);
        }}
        onSaved={() => {
          setSettingUp(false);
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
          void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.integrations });
        }}
      />
    </>
  );
}
