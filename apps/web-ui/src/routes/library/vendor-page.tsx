/**
 * One integration: who they are, how they stand, and every device added under them.
 *
 * As the board draws a detail page: the way back, the vendor's logo, name and line, its state as a
 * Pill with its version and how it connects, its actions on the right - then the tabs. Overview
 * opens with the health strip (Runtime, Connection, Devices, Updates), then what the vendor needs,
 * its devices in compact rows and About; Devices is the whole table to search and narrow;
 * Configuration is the settings every device shares, for a vendor whose bundle asks for some.
 *
 * A device here is the same device the Devices page lists, seen from the vendor's side. A vendor
 * whose bundle asks for something - a key, an account - is set up once, and Add device waits until
 * it has been: without the key no device of theirs can connect, and a row that failed for that
 * reason would send the owner to the wrong form.
 *
 * A vendor whose devices can be found has **Discover devices** in the header, which asks the hub
 * to look now rather than at its next pass - for as long as the hub says it looks - and then says
 * what came of it. A vendor whose devices are chosen somewhere else - paired with Zigbee2MQTT -
 * adds them on its own: no Add device and nothing to adopt, and **Pair devices** in the header.
 * While a package the vendor needs is not running, the way to that package is the header's
 * primary: it is what the page is for until it runs.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import type { DiscoveredDevice, IntegrationState } from '@nebulahome/contracts';
import { AppIcon, Button, DetailHero, HeroFact, Pill, TabPanel, Tabs } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { translate } from '@/i18n/messages';
import { useTab } from '@/lib/use-tab';
import { fetchDevices, fetchDiscovered, fetchVendor, LIBRARY_QUERY_KEYS } from '@/library/api';
import { LINK_QUERY_KEYS } from '@/library/links-api';
import { vendorStatusOf } from '@/library/vendor-status';
import { useInstalledPackages } from '@/packages/use-packages';
import { AdoptDialog } from '@/routes/library/adopt-dialog';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { DeviceDialog, type DeviceDialogTarget } from '@/routes/library/device-dialog';
import { useNetworkScan, type ScanOutcome } from '@/routes/library/use-network-scan';
import { VendorLogo } from '@/routes/library/vendor-card';
import { VendorConfiguration } from '@/routes/library/vendor-configuration';
import { VendorDevicesTab } from '@/routes/library/vendor-devices-tab';
import { VendorFound } from '@/routes/library/vendor-found';
import { VendorInstallMenu } from '@/routes/library/vendor-install-actions';
import { VendorOverview } from '@/routes/library/vendor-overview';
import { PairingButton, usePairing } from '@/routes/library/vendor-pairing';
import { VendorSetupDialog } from '@/routes/library/vendor-setup-dialog';

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'devices', 'found', 'configuration'] as const;

/** One tab. */
type VendorTab = (typeof TABS)[number];

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
      return translate(
        'library.vendor.hubIsNotLooking',
        'The hub is not looking for devices: discovery is switched off on it.',
      );
    case 'found':
      return outcome.count === 1
        ? `Found 1 new ${vendorName} device.`
        : `Found ${String(outcome.count)} new ${vendorName} devices.`;
    case 'nothing':
      return translate(
        'library.vendor.nothingNewFoundA',
        'Nothing new found. A {{vendorName}} device on another network, or one that does not announce itself, is added by its address.',
        { vendorName },
      );
  }
}

/** How long after a save the list is read again, for a device the hub was still starting. */
const SETTLE_MS = 3000;

/**
 * Renders one vendor's page.
 *
 * @returns The page.
 */
export function VendorPage() {
  const { t } = useTranslation();

  const { vendorId = '' } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const canConfigure = can('integration:configure');
  const canInstall = can('integration:install');
  const canWrite = can('device:write');
  const canRemove = can('device:delete');
  const canCreateTags = can('tag:write');
  const [open, setOpen] = useState<DeviceDialogTarget | null>(null);
  const [adopting, setAdopting] = useState<DiscoveredDevice | null>(null);
  const [isSettingUp, setSettingUp] = useState(false);
  const [tab, setTab] = useTab<VendorTab>(TABS);
  const network = useNetworkScan();
  const { packages } = useInstalledPackages();

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
  // A vendor that adds its own devices has nothing to propose, and nothing to look for.
  const isAutomatic = found?.adoption === 'automatic';
  const foundDevices = (discovered.data ?? []).filter(
    (each) => each.vendorId === vendorId && !each.isDismissed,
  );
  // Matter devices are commissioned on the Brokers page, not looked for on the network.
  const canDiscover =
    canWrite &&
    !isAutomatic &&
    (found?.discoverySources.some((source) => source !== 'matter') ?? false);
  const devices = (all.data ?? []).filter((each) => each.vendorId === vendorId);
  const pairing = usePairing(found, devices);
  const hasPairing = found?.pairing != null;
  const hasSetupFields =
    found !== undefined &&
    found.setup.transport.fields.length + found.setup.options.fields.length > 0;
  const runsContainers = found !== undefined && found.containers.length > 0;
  const hasConfiguration = hasSetupFields && !runsContainers;
  // A vendor that adds its own devices finds nothing to go through.
  const hasFound = found !== undefined && !isAutomatic;
  const shownTab: VendorTab =
    (tab === 'configuration' && !hasConfiguration) || (tab === 'found' && !hasFound)
      ? 'overview'
      : tab;
  const neededPackage =
    found?.needsPackage === true ? Object.keys(found.requires.packages)[0] : undefined;

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

  /** Reads the vendor and its devices again, once its settings are written. */
  const afterSettings = (): void => {
    setSettingUp(false);
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.vendors });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.devices });
  };

  const addButton =
    found !== undefined && canWrite && !isAutomatic ? (
      <Button
        size="compact"
        disabled={found.needsSetup || found.needsAccount || found.needsPackage}
        title={
          found.needsPackage
            ? (found.packageProblems[0] ??
              t('library.vendor.packageItNeedsIs', 'A package it needs is not running'))
            : found.needsSetup
              ? t('library.vendor.setUpNameFirst', 'Set up {{name}} first', { name: found.name })
              : found.needsAccount
                ? found.account === null
                  ? t('library.vendor.signInFirst', 'Sign in to an account first')
                  : t('library.vendor.signInToFirst', 'Sign in to a {{name}} first', {
                      name: found.account.name,
                    })
                : undefined
        }
        onClick={() => {
          setOpen({
            mode: 'create',
            vendor: found,
            existingIds: (all.data ?? []).map((each) => each.id),
          });
        }}
      >
        <AppIcon id="plus" size={14} />
        {t('library.vendor.addDevice', 'Add device')}
      </Button>
    ) : undefined;

  const status =
    found === undefined ? null : vendorStatusOf({ ...found, deviceCount: devices.length });

  return (
    <>
      <DetailFrame
        isPending={vendor.isPending || all.isPending}
        error={vendor.error ?? all.error}
        hero={
          <DetailHero
            back={
              <BackLink to="/integrations">
                {t('library.vendor.integrations', 'Integrations')}
              </BackLink>
            }
            mark={found === undefined ? undefined : <VendorLogo vendor={found} size={56} />}
            title={found?.name ?? vendorId}
            description={found?.description}
            facts={
              found === undefined || status === null ? undefined : (
                <>
                  <Pill tone={status.tone}>{status.label}</Pill>
                  <HeroFact>
                    {t('library.vendor.vversion', 'v{{version}}', { version: found.version })}
                  </HeroFact>
                  <HeroFact icon={found.internetRequired ? 'globe' : 'network'}>
                    {found.internetRequired
                      ? t('library.vendor.needsTheInternet', 'Needs the internet')
                      : t('library.vendor.localNetwork', 'Local network')}
                  </HeroFact>
                  {found.wires.map((wire) => (
                    <HeroFact key={wire}>
                      {wire === 'ble'
                        ? t('library.vendor.ble', 'BLE')
                        : wire === 'matter'
                          ? t('library.matterTag', 'Matter')
                          : wire.toUpperCase()}
                    </HeroFact>
                  ))}
                  {(found.roles ?? []).map((role) => (
                    <HeroFact key={role} icon={role === 'bluetooth-proxy' ? 'bluetooth' : 'radio'}>
                      {role === 'bluetooth-proxy'
                        ? t('library.vendor.bluetoothProxy', 'Bluetooth proxy')
                        : t('library.vendor.irBlaster', 'IR blaster')}
                    </HeroFact>
                  ))}
                  {found.origin === 'development' ? (
                    <HeroFact icon="lock">
                      {t('library.vendor.inDevelopment', 'In development')}
                    </HeroFact>
                  ) : null}
                </>
              )
            }
            actions={
              found === undefined ? undefined : (
                <>
                  {neededPackage === undefined ? null : (
                    <Button
                      onClick={() => {
                        void navigate(`/packages/${encodeURIComponent(neededPackage)}`);
                      }}
                    >
                      {t('library.vendor.open', 'Open')}{' '}
                      {packages.find((each) => each.id === neededPackage)?.name ?? neededPackage}
                    </Button>
                  )}
                  {hasPairing ? <PairingButton pairing={pairing} /> : null}
                  {canDiscover ? (
                    <Button
                      variant="ghost"
                      isBusy={network.isScanning}
                      title={
                        network.problem ??
                        t(
                          'library.vendor.askEveryNameDevice',
                          'Ask every {{name}} device on the network who it is',
                          { name: found.name },
                        )
                      }
                      onClick={() => {
                        network.scan(found.id);
                      }}
                    >
                      <AppIcon id="radio" size={16} />
                      {network.isScanning
                        ? t('library.vendor.looking', 'Looking…')
                        : t('library.vendor.discoverDevices', 'Discover devices')}
                    </Button>
                  ) : null}
                  {hasConfiguration ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setTab('configuration');
                      }}
                    >
                      <AppIcon id="settings" size={16} />
                      {t('library.vendor.settings', 'Settings')}
                    </Button>
                  ) : null}
                  <VendorInstallMenu vendor={found} deviceCount={devices.length} />
                </>
              )
            }
            tabs={
              found === undefined ? undefined : (
                <Tabs
                  label={found.name}
                  idPrefix="vendor"
                  value={shownTab}
                  onChange={setTab}
                  items={[
                    { id: 'overview', label: t('library.vendor.overview', 'Overview') },
                    {
                      id: 'devices',
                      label: t('library.vendor.devices', 'Devices'),
                      count: devices.length,
                    },
                    ...(hasFound
                      ? [
                          {
                            id: 'found' as const,
                            label: t('library.vendor.found', 'Found'),
                            count: foundDevices.length,
                          },
                        ]
                      : []),
                    ...(hasConfiguration
                      ? [
                          {
                            id: 'configuration' as const,
                            label: t('library.vendor.configuration', 'Configuration'),
                          },
                        ]
                      : []),
                  ]}
                />
              )
            }
          />
        }
      >
        {found === undefined ? null : (
          <>
            {shownTab === 'overview' ? (
              <TabPanel idPrefix="vendor" id="overview">
                <VendorOverview
                  vendor={found}
                  devices={devices}
                  found={foundDevices}
                  pairing={pairing}
                  canConfigure={canConfigure}
                  canInstall={canInstall}
                  canLink={canWrite}
                  hasSetupFields={hasSetupFields}
                  scanStatus={
                    network.problem !== null
                      ? { text: network.problem, isProblem: true }
                      : network.isScanning
                        ? {
                            text:
                              network.lookingForMs > 0
                                ? t(
                                    'library.vendor.askingEveryDeviceFor',
                                    'Asking every {{name}} device on the network who it is, for the next {{seconds}} seconds…',
                                    {
                                      name: found.name,
                                      seconds: Math.round(network.lookingForMs / 1000),
                                    },
                                  )
                                : t(
                                    'library.vendor.askingEveryDevice',
                                    'Asking every {{name}} device on the network who it is…',
                                    { name: found.name },
                                  ),
                            isProblem: false,
                          }
                        : network.outcome === null
                          ? null
                          : { text: outcomeText(network.outcome, found.name), isProblem: false }
                  }
                  addButton={addButton}
                  onConfigure={() => {
                    setTab('configuration');
                  }}
                  {...(canConfigure
                    ? {
                        /** Opens the vendor's settings, for a vendor set up from its container. */
                        onSetUp: () => {
                          setSettingUp(true);
                        },
                      }
                    : {})}
                  onAllDevices={() => {
                    setTab('devices');
                  }}
                  onReviewFound={() => {
                    setTab('found');
                  }}
                />
              </TabPanel>
            ) : null}

            {shownTab === 'found' ? (
              <TabPanel idPrefix="vendor" id="found">
                <VendorFound
                  vendor={found}
                  canAdopt={canWrite && !found.needsSetup}
                  onOpenDevices={() => {
                    setTab('devices');
                  }}
                  onAdopt={setAdopting}
                />
              </TabPanel>
            ) : null}

            {shownTab === 'devices' ? (
              <TabPanel idPrefix="vendor" id="devices">
                <VendorDevicesTab
                  vendor={found}
                  devices={devices}
                  addButton={addButton}
                  {...(canWrite
                    ? {
                        /**
                         * Opens a device's settings.
                         *
                         * @param device - The device.
                         */
                        onConfigure: (device: (typeof devices)[number]) => {
                          setOpen({ mode: 'edit', vendor: found, device });
                        },
                      }
                    : {})}
                />
              </TabPanel>
            ) : null}

            {shownTab === 'configuration' ? (
              <TabPanel idPrefix="vendor" id="configuration">
                <VendorConfiguration
                  // Started afresh from what is stored each time the settings are saved.
                  key={found.configuredAt === null ? 'unset' : String(found.configuredAt)}
                  vendor={found}
                  canConfigure={canConfigure}
                  onSaved={afterSettings}
                />
              </TabPanel>
            ) : null}
          </>
        )}
      </DetailFrame>

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
          void queryClient.invalidateQueries({ queryKey: LINK_QUERY_KEYS.found });
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
        onSaved={afterSettings}
      />
    </>
  );
}
