/**
 * One device's own page: what it is, how it is doing, and every entity it exposes.
 *
 * The page the devices list leads to, and every link to a device - from an entity's page, a tag,
 * a vendor, the system monitor - lands here. As the board draws a detail page: the way back, the
 * device's glyph, its name with its model and room, how it stands as a Pill with its room and
 * tags, its actions - its own web page, for a device whose driver serves one, and Settings - then
 * the tabs. Overview opens with the health strip (Connection, Signal, Firmware, Integration), then
 * its controls and its sensors, each the row the rest of the library draws, with its reading live
 * and its switch at hand, then the facts about it. Activity is what changed on it, newest first.
 *
 * Changing the device is a dialog behind Settings, the one a vendor's page opens for the same
 * device: its name, icon, tags and room, the model and the connection, and a Remove.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { MATTER_VENDOR, type EntityView } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  DetailHero,
  FactGrid,
  HealthCard,
  HealthStrip,
  HeroFact,
  HeroMark,
  Pill,
  Section,
  TabPanel,
  Tabs,
  TagChip,
  type Fact,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { translate } from '@/i18n/messages';
import { deviceWebPageOf } from '@/lib/device-web-page';
import { useTab } from '@/lib/use-tab';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  deviceConnectionHealth,
  deviceFirmwareHealth,
  deviceIntegrationHealth,
  deviceSignalHealth,
} from '@/library/device-health';
import { deviceStatusOf } from '@/library/device-status';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { ActivityPanel } from '@/routes/library/device/activity-panel';
import { DeviceProblem } from '@/routes/library/device/device-problem';
import { entityGroupsOf } from '@/routes/library/device/entity-groups';
import { useDevicePage, type DevicePageView } from '@/routes/library/device/use-device-page';
import { DeviceDialog } from '@/routes/library/device-dialog';
import { DeviceIcon } from '@/routes/library/device-icon';
import { entityPath } from '@/routes/library/entity/entity-path';
import { EntitySettingsDialog } from '@/routes/library/entity/entity-settings-dialog';
import { EntityRow } from '@/routes/library/entity-row';

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'activity'] as const;

/** One tab. */
type DeviceTab = (typeof TABS)[number];

/**
 * The device's entities, the controls apart from the sensors, each group a section.
 *
 * @param props - The view, and what the spanner on a row opens.
 * @param props.view - See {@link DevicePageView}.
 * @param props.onConfigure - Opens an entity's settings; absent for somebody who may not edit.
 * @returns The sections.
 */
function EntityGroups(props: {
  readonly view: DevicePageView;
  readonly onConfigure: ((entity: EntityView) => void) | undefined;
}) {
  const { view, onConfigure } = props;

  return (
    <>
      {entityGroupsOf(view.lines).map((group) => (
        <Section key={group.title} title={group.title}>
          <ul className="flex flex-col gap-1.5 rounded-card border border-border bg-surface p-2">
            {group.lines.map((line) => (
              <EntityRow
                key={line.entity.entityId}
                line={line}
                deviceAreaKey={view.device.areaKey}
                onConfigure={onConfigure}
              />
            ))}
          </ul>
        </Section>
      ))}
    </>
  );
}

/**
 * The facts about the device, for its Details.
 *
 * @param view - See {@link DevicePageView}.
 * @param webPage - The device's own web page, when its driver says it serves one.
 * @returns The facts.
 */
function factsOf(view: DevicePageView, webPage: string | null): Fact[] {
  const { device, vendorName } = view;
  const address =
    typeof device.transportConfig['host'] === 'string'
      ? device.transportConfig['host']
      : typeof device.transportConfig['address'] === 'string'
        ? device.transportConfig['address']
        : null;
  const link = 'text-primary transition-colors hover:text-primary-hover';

  return [
    {
      label:
        device.origin === 'container'
          ? translate('device.device.container', 'Container')
          : device.origin === 'package'
            ? translate('device.device.package', 'Package')
            : translate('device.device.integration', 'Integration'),
      value:
        device.origin === 'system' ? (
          vendorName
        ) : device.origin === 'package' ? (
          <Link to={`/packages/${encodeURIComponent(device.vendorId)}`} className={link}>
            {device.driverName}
          </Link>
        ) : device.origin === 'container' ? (
          <Link
            to={`/containers/${encodeURIComponent(device.externalId ?? device.name)}`}
            className={link}
          >
            {device.externalId ?? device.name}
          </Link>
        ) : (
          <Link
            to={
              device.vendorId === MATTER_VENDOR
                ? '/brokers/matter'
                : `/integrations/${encodeURIComponent(device.vendorId)}`
            }
            className={link}
          >
            {vendorName}
          </Link>
        ),
    },
    {
      label: translate('device.device.model', 'Model'),
      value: [device.model, device.series ?? device.driverName].filter(Boolean).join(' · '),
    },
    ...(device.swVersion === null
      ? []
      : [
          {
            label: translate('device.device.firmware', 'Firmware'),
            value: device.swVersion,
            isMono: true,
          },
        ]),
    ...(device.origin === 'integration'
      ? [{ label: translate('device.device.transport', 'Transport'), value: device.transport }]
      : []),
    ...(address === null
      ? []
      : [{ label: translate('device.device.address', 'Address'), value: address, isMono: true }]),
    ...(device.externalId === null
      ? []
      : [
          {
            label: translate('device.device.serial', 'Serial'),
            value: device.externalId,
            isMono: true,
          },
        ]),
    ...(device.hwVersion === null
      ? []
      : [{ label: translate('device.device.hardware', 'Hardware'), value: device.hwVersion }]),
    ...(webPage === null
      ? []
      : [
          {
            label: translate('device.device.webPage', 'Web page'),
            value: (
              <a href={webPage} target="_blank" rel="noreferrer" className={link}>
                {webPage.replace(/^https?:\/\//u, '').replace(/\/$/u, '')}
              </a>
            ),
          },
        ]),
    { label: translate('device.device.id', 'Id'), value: device.id, isMono: true },
  ];
}

/**
 * Renders a device's page.
 *
 * @returns The page.
 */
export function DevicePage() {
  const { t } = useTranslation();

  const { deviceId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { view, isPending, error, isMissing } = useDevicePage(deviceId);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [configuring, setConfiguring] = useState<EntityView | null>(null);
  const [tab, setTab] = useTab<DeviceTab>(TABS);
  // What changed on a device is its history: the tab is there for who may read the past.
  const canReadHistory = useSession((state) => state.can('history:read'));

  /** Reads again everything a change to the device shows up in. */
  const refresh = (): void => {
    for (const key of [
      LIBRARY_QUERY_KEYS.devices,
      LIBRARY_QUERY_KEYS.entities,
      LIBRARY_QUERY_KEYS.vendors,
      LIBRARY_QUERY_KEYS.tags,
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const canConfigure =
    view !== undefined &&
    view.canWrite &&
    (view.vendor !== undefined || view.device.origin !== 'integration');
  const webPage =
    view === undefined
      ? null
      : deviceWebPageOf(
          view.device,
          view.vendor?.drivers.find((driver) => driver.id === view.device.kind),
        );
  const firmware =
    view === undefined ? null : deviceFirmwareHealth(view.lines, view.device.swVersion);
  const status =
    view === undefined
      ? null
      : deviceStatusOf(view.device, view.standing, firmware?.updateEntityId !== null);
  const connection = view === undefined ? null : deviceConnectionHealth(view.device, view.standing);
  const signal =
    view === undefined ? null : deviceSignalHealth(view.lines, view.device.transport.toUpperCase());
  const integration =
    view === undefined ? null : deviceIntegrationHealth(view.device, view.vendor, view.vendorName);

  return (
    <>
      <DetailFrame
        isPending={isPending}
        error={view === undefined ? error : undefined}
        problem={
          view === undefined && !isPending && isMissing
            ? `There is no device with the id ${deviceId}.`
            : undefined
        }
        hero={
          <DetailHero
            back={<BackLink to="/devices">{t('device.device.devices', 'Devices')}</BackLink>}
            mark={
              view === undefined ? undefined : (
                <HeroMark>
                  <DeviceIcon icon={view.icons.get(view.device.icon ?? '')} size={26} />
                </HeroMark>
              )
            }
            title={view?.device.name ?? deviceId}
            description={
              view === undefined
                ? undefined
                : [
                    [view.device.manufacturer, view.device.model].filter(Boolean).join(' ') ||
                      (view.device.series ?? view.device.driverName),
                    view.room?.name ?? view.device.areaName,
                  ]
                    .filter(Boolean)
                    .join(' · ')
            }
            facts={
              view === undefined || status === null ? undefined : (
                <>
                  <Pill tone={status.tone}>{status.label}</Pill>
                  {view.room === undefined && view.device.areaName === null ? null : (
                    <HeroFact icon="house">{view.room?.name ?? view.device.areaName}</HeroFact>
                  )}
                  {view.tags.map((tag) => (
                    <TagChip
                      key={tag.id}
                      color={tag.color}
                      icon={tag.icon === null ? undefined : view.icons.get(tag.icon)}
                    >
                      {tag.name}
                    </TagChip>
                  ))}
                </>
              )
            }
            actions={
              view === undefined ? undefined : (
                <>
                  {webPage === null ? null : (
                    <a
                      href={webPage}
                      target="_blank"
                      rel="noreferrer"
                      className="press inline-flex h-control items-center gap-2 rounded-pill border border-border-strong bg-surface-raised px-3.5 text-ui font-medium text-foreground transition-colors hover:bg-surface-high"
                    >
                      <AppIcon id="external-link" size={15} />
                      {t('device.device.openItsWebPage', 'Open its web page')}
                    </a>
                  )}
                  {canConfigure ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSettingsOpen(true);
                      }}
                    >
                      <AppIcon id="settings" size={15} />
                      {t('device.device.settings', 'Settings')}
                    </Button>
                  ) : null}
                </>
              )
            }
            tabs={
              view === undefined ? undefined : (
                <Tabs
                  label={view.device.name}
                  idPrefix="device"
                  value={tab}
                  onChange={setTab}
                  items={[
                    { id: 'overview', label: t('device.device.overview', 'Overview') },
                    ...(canReadHistory
                      ? [
                          {
                            id: 'activity' as const,
                            label: t('device.device.activity', 'Activity'),
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
        {view === undefined ||
        firmware === null ||
        connection === null ||
        signal === null ||
        integration === null ? null : tab === 'overview' || !canReadHistory ? (
          <TabPanel idPrefix="device" id="overview" className="flex flex-col gap-8">
            <HealthStrip>
              <HealthCard
                label={t('device.device.connection', 'Connection')}
                tone={connection.tone}
                value={connection.value}
                detail={connection.detail}
              />
              <HealthCard
                label={t('device.device.signal', 'Signal')}
                tone={signal.tone}
                value={signal.value}
                detail={signal.detail}
              />
              <HealthCard
                label={t('device.device.firmware', 'Firmware')}
                tone={firmware.tone}
                value={firmware.value}
                detail={firmware.detail}
                action={
                  firmware.updateEntityId === null ? undefined : (
                    <Link
                      to={entityPath(firmware.updateEntityId)}
                      className="inline-flex h-control-sm items-center gap-1.5 rounded-pill bg-primary px-3 text-ui-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
                    >
                      <AppIcon id="download" size={13} />
                      {t('device.device.install', 'Install')}
                    </Link>
                  )
                }
              />
              <HealthCard
                label={t('device.device.integration', 'Integration')}
                tone={integration.tone}
                value={integration.value}
                detail={integration.detail}
              />
            </HealthStrip>

            <DeviceProblem device={view.device} />

            {/* A device with nothing to show but its problem shows only that: the problem
                    is why there are no entities. */}
            {view.lines.length === 0 ? (
              view.device.lastError !== null ? null : (
                <p className="rounded-card border border-dashed border-border-strong px-5.5 py-4 text-ui text-foreground-muted">
                  {t(
                    'device.device.noEntitiesYetThey',
                    'No entities yet. They appear as soon as the hub hears from the device.',
                  )}
                </p>
              )
            ) : (
              <EntityGroups
                view={view}
                onConfigure={view.canEditEntities ? setConfiguring : undefined}
              />
            )}

            <Section title={t('device.device.details', 'Details')}>
              <FactGrid facts={factsOf(view, webPage)} />
            </Section>
          </TabPanel>
        ) : (
          <TabPanel idPrefix="device" id="activity">
            <ActivityPanel
              deviceId={view.device.id}
              deviceName={view.device.name}
              entities={view.lines.map((line) => line.entity)}
            />
          </TabPanel>
        )}
      </DetailFrame>

      {view === undefined || configuring === null ? null : (
        <EntitySettingsDialog
          // Keyed on the entity, so each opening starts from the entity as it now is.
          key={configuring.entityId}
          entity={configuring}
          isOpen
          canEdit={view.canEditEntities}
          canCreateTags={view.canCreateTags}
          onClose={() => {
            setConfiguring(null);
          }}
        />
      )}

      {view === undefined ? null : (
        <DeviceDialog
          // Keyed on the device and on whether it is open, so every opening starts from the device
          // as it now is.
          key={isSettingsOpen ? `device-${view.device.id}` : 'device-shut'}
          target={
            isSettingsOpen ? { mode: 'edit', vendor: view.vendor, device: view.device } : null
          }
          canRemove={view.canRemove}
          canCreateTags={view.canCreateTags}
          onClose={() => {
            setSettingsOpen(false);
          }}
          onSaved={() => {
            setSettingsOpen(false);
            refresh();
          }}
          onRemoved={() => {
            setSettingsOpen(false);
            refresh();
            void navigate('/devices', { replace: true });
          }}
        />
      )}
    </>
  );
}
