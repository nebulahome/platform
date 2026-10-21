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
 *
 * A device reached two ways - a Shelly over RPC and over Matter - is one page: the linked tag in
 * the hero, a health card per way (which answers, and which is read first), its firmware as both
 * say it, its readings with their linked tag or the one way they come through, a way to link two
 * readings that read the same thing by dragging one onto the other, a line per way in Details,
 * and "Unlink devices…" in the ⋮ menu. `?link=<device>` opens the question of linking this
 * device with that one: the Matter broker sends a twin it found here.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import {
  MATTER_TRANSPORT,
  MATTER_VENDOR,
  MQTT_VENDOR,
  type DeviceWay,
  type EntityView,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  DetailHero,
  FactGrid,
  HealthCard,
  HealthStrip,
  HeroFact,
  HeroMark,
  OverflowMenu,
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
import { entityKindOf } from '@/library/entity-kind';
import { BackLink, DetailFrame } from '@/routes/library/detail-page';
import { ActivityPanel } from '@/routes/library/device/activity-panel';
import { DeviceProblem } from '@/routes/library/device/device-problem';
import { entityGroupsOf } from '@/routes/library/device/entity-groups';
import { LinkDialog, type LinkRequest } from '@/routes/library/device/link-dialog';
import { useLinkDrag } from '@/routes/library/device/link-drag';
import { useDevicePage, type DevicePageView } from '@/routes/library/device/use-device-page';
import { DeviceDialog } from '@/routes/library/device-dialog';
import { DeviceIcon } from '@/routes/library/device-icon';
import { entityPath } from '@/routes/library/entity/entity-path';
import { EntitySettingsDialog } from '@/routes/library/entity/entity-settings-dialog';
import { EntityRow, type EntityLine } from '@/routes/library/entity-row';
import {
  TransportMark,
  useVendorsById,
  wayName,
  waysOfDevice,
  waysOfEntity,
  WaysTag,
} from '@/routes/library/transport-marks';

/** The tabs of the page; the first is the page itself. */
const TABS = ['overview', 'activity'] as const;

/** One tab. */
type DeviceTab = (typeof TABS)[number];

/**
 * What a way into a device is, in a word or two: "Node 0x1F" through Matter, else its transport:
 * "RPC".
 *
 * @param way - The way.
 * @returns The words.
 */
function wayDetailOf(way: DeviceWay): string {
  return way.transport === MATTER_TRANSPORT
    ? translate('device.device.node', 'Node {{node}}', { node: way.nodeId ?? '' })
    : (way.transport.split('/').at(-1) ?? way.transport).toUpperCase();
}

/**
 * The device's entities, the controls apart from the sensors, each group a section.
 *
 * On a device reached two ways, a reading read one way can be dragged onto one of the same kind
 * read the other way to link them, and a pair that read alike is suggested under the list.
 *
 * @param props - The view, and what the rows open.
 * @param props.view - See {@link DevicePageView}.
 * @param props.onConfigure - Opens an entity's settings; absent for somebody who may not edit.
 * @param props.onLink - Asks to link or unlink readings; absent for somebody who may not.
 * @returns The sections.
 */
function EntityGroups(props: {
  readonly view: DevicePageView;
  readonly onConfigure: ((entity: EntityView) => void) | undefined;
  readonly onLink: ((request: LinkRequest) => void) | undefined;
}) {
  const { t } = useTranslation();
  const { view, onConfigure, onLink } = props;
  const vendors = useVendorsById();
  const matter = t('library.matterTag', 'Matter');
  const ways = view.device.linked?.ways ?? [];
  const wayOfSource = new Map(ways.map((way) => [way.deviceId, way]));
  const isLinked = ways.length > 1;

  /**
   * Whether one reading can be dragged onto another: both read one way, each a different way,
   * and the same kind of reading.
   *
   * @param source - The one taken up.
   * @param target - The one under it.
   * @returns True when they can be linked.
   */
  const canJoin = (source: EntityLine, target: EntityLine): boolean =>
    isLinked &&
    onLink !== undefined &&
    source.entity.linked == null &&
    target.entity.linked == null &&
    source.entity.source !== target.entity.source &&
    entityKindOf(source.entity).label === entityKindOf(target.entity).label;

  /**
   * One row, as it stands or as it is held.
   *
   * @param line - The reading.
   * @param look - How it takes part in a drag.
   * @returns The row.
   */
  const rowOf = (line: EntityLine, look: 'rest' | 'target' | 'dimmed' | 'lifted' = 'rest') => {
    const entityWays = waysOfEntity(line.entity);
    const way = wayOfSource.get(line.entity.source);

    return (
      <EntityRow
        key={line.entity.entityId}
        line={line}
        deviceAreaKey={view.device.areaKey}
        onConfigure={look === 'rest' ? onConfigure : undefined}
        look={look}
        titleAfter={
          entityWays.length > 1 ? (
            <WaysTag
              ways={entityWays}
              {...(onLink === undefined || look !== 'rest'
                ? {}
                : {
                    /** Asks to unlink the reading. */
                    onUnlink: () => {
                      onLink({
                        action: 'unlink',
                        target: { scope: 'entity', id: line.entity.entityId },
                      });
                    },
                  })}
            />
          ) : undefined
        }
        kindAfter={
          isLinked && entityWays.length < 2 && way !== undefined ? (
            <span className="inline-flex items-center gap-1.25">
              <TransportMark way={way} vendors={vendors} size={14} />
              {wayName(way, vendors, matter)}
            </span>
          ) : undefined
        }
        {...(look === 'rest' ? { handle: drag.handleOf(line) } : {})}
      />
    );
  };

  const drag = useLinkDrag({
    lines: view.lines,
    canJoin,
    /**
     * Draws a reading as it is held.
     *
     * @param line - The reading.
     * @returns Its row, lifted.
     */
    renderHeld: (line) => rowOf(line, 'lifted'),

    /**
     * Asks to link the reading dropped with the one it was dropped on.
     *
     * @param source - The one dropped.
     * @param target - The one it was dropped on.
     */
    onDrop: (source, target) => {
      onLink?.({
        action: 'link',
        target: { scope: 'entity', id: source.entity.entityId },
        withId: target.entity.entityId,
      });
    },
  });
  const names = new Map(view.lines.map((line) => [line.entity.entityId, line.entity.name]));

  return (
    <>
      {entityGroupsOf(view.lines).map((group) => {
        const ids = new Set(group.lines.map((line) => line.entity.entityId));
        const suggested = view.device.suggestedLinks.filter((pair) =>
          pair.entityIds.every((id) => ids.has(id)),
        );

        return (
          <Section key={group.title} title={group.title}>
            <div className="flex flex-col rounded-card border border-border bg-surface px-5 py-0.5">
              <ul className="flex flex-col">
                {group.lines.map((line) =>
                  drag.isHeld(line.entity.entityId) ? (
                    <li
                      key={line.entity.entityId}
                      aria-hidden="true"
                      className="-mx-2 my-px h-16.25 rounded-tile border border-dashed border-border-strong"
                    />
                  ) : (
                    rowOf(line, drag.lookOf(line.entity.entityId))
                  ),
                )}
              </ul>
              {suggested.map((pair) => (
                <p
                  key={pair.entityIds.join(':')}
                  className="flex items-center gap-2.5 border-t border-border pt-3 pb-3.5 text-ui-sm text-primary"
                >
                  <AppIcon id="sparkles" size={14} className="shrink-0" />
                  {t(
                    'device.device.readTheSame',
                    '{{first}} and {{second}} read the same thing. Drag one onto the other to link them.',
                    {
                      first: names.get(pair.entityIds[0]) ?? pair.entityIds[0],
                      second: names.get(pair.entityIds[1]) ?? pair.entityIds[1],
                    },
                  )}
                </p>
              ))}
            </div>
          </Section>
        );
      })}
      {drag.ghost}
      <span aria-live="polite" className="sr-only">
        {drag.announcement}
      </span>
    </>
  );
}

/**
 * The facts about the device, for its Details.
 *
 * @param view - See {@link DevicePageView}.
 * @param webPage - The device's own web page, when its driver says it serves one.
 * @param wayNameOf - What a way into the device is called.
 * @returns The facts.
 */
function factsOf(
  view: DevicePageView,
  webPage: string | null,
  wayNameOf: (way: DeviceWay) => string,
): Fact[] {
  const { device, vendorName } = view;
  const ways = device.linked?.ways ?? [];
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
              device.vendorId === MATTER_VENDOR || device.vendorId === MQTT_VENDOR
                ? `/brokers/${device.vendorId}`
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
    ...(ways.length > 1
      ? ways.map((way) => ({
          label: wayNameOf(way),
          value:
            way.transport === MATTER_TRANSPORT ? (
              <>
                {translate('device.device.nodeWord', 'Node')}{' '}
                <span className="font-mono text-mono-ui">{way.nodeId}</span>
                {' · '}
                <Link to="/brokers/matter" className={link}>
                  {translate('device.device.matterBroker', 'Matter broker')}
                  <AppIcon id="external-link" size={13} className="ml-1 inline align-middle" />
                </Link>
              </>
            ) : (
              <>
                {wayDetailOf(way)}
                {way.address === null ? null : (
                  <>
                    {' · '}
                    <span className="font-mono text-mono-ui">{way.address}</span>
                  </>
                )}
              </>
            ),
        }))
      : [
          ...(device.origin === 'integration'
            ? [
                {
                  label: translate('device.device.transport', 'Transport'),
                  value: device.transport,
                },
              ]
            : []),
          ...(address === null
            ? []
            : [
                {
                  label: translate('device.device.address', 'Address'),
                  value: address,
                  isMono: true,
                },
              ]),
        ]),
    ...(ways.length > 1 && device.mac !== null
      ? [
          {
            label: translate('device.device.mac', 'MAC'),
            value: device.mac.toUpperCase(),
            isMono: true,
          },
        ]
      : []),
    ...(device.externalId === null || ways.length > 1
      ? []
      : [
          {
            label: translate('device.device.serial', 'Serial'),
            value: device.externalId,
            isMono: true,
          },
        ]),
    ...(device.hwVersion === null || ways.length > 1
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
    ...(ways.length > 1
      ? []
      : [{ label: translate('device.device.id', 'Id'), value: device.id, isMono: true }]),
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
  const [linking, setLinking] = useState<LinkRequest | null>(null);
  const [search, setSearch] = useSearchParams();
  const vendors = useVendorsById();
  const matter = t('library.matterTag', 'Matter');
  const linkWith = search.get('link');
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

  // The Matter broker sends a twin it found here: the question of linking it is asked at once.
  const shownId = view?.device.id;
  const asked: LinkRequest | null =
    linking ??
    (linkWith === null || shownId === undefined
      ? null
      : { action: 'link', target: { scope: 'device', id: shownId }, withId: linkWith });

  /** Puts the question away, and the twin's address with it. */
  const closeLinking = (): void => {
    setLinking(null);

    if (linkWith !== null) {
      setSearch(
        (before) => {
          const after = new URLSearchParams(before);

          after.delete('link');

          return after;
        },
        { replace: true },
      );
    }
  };

  const ways = view?.device.linked?.ways ?? [];
  const isLinked = ways.length > 1;

  /**
   * What a way into the device is called.
   *
   * @param way - The way.
   * @returns Its name.
   */
  const wayNameOf = (way: DeviceWay): string => wayName(way, vendors, matter);
  const versions = new Set(ways.map((way) => way.swVersion));

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
                  <DeviceIcon
                    icon={view.icons.get(view.device.icon ?? '')}
                    device={view.device}
                    size={26}
                  />
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
                  {isLinked ? <WaysTag ways={waysOfDevice(view.device)} isLabelled /> : null}
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
                  {isLinked && view.canWrite ? (
                    <OverflowMenu
                      label={t('device.device.moreFor', 'More for {{name}}', {
                        name: view.device.name,
                      })}
                      items={[
                        {
                          label: t('device.device.unlinkDevices', 'Unlink devices…'),
                          icon: 'unlink-2',
                          tone: 'danger',
                          /** Asks to unlink the two devices. */
                          onSelect: () => {
                            setLinking({
                              action: 'unlink',
                              target: { scope: 'device', id: view.device.id },
                            });
                          },
                        },
                      ]}
                    />
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
              {isLinked ? (
                ways.map((way) => (
                  <HealthCard
                    key={way.deviceId}
                    label={wayNameOf(way)}
                    tone={way.isAvailable ? 'success' : 'warning'}
                    value={
                      way.isAvailable
                        ? t('device.device.reporting', 'Reporting')
                        : t('device.device.silent', 'Silent')
                    }
                    detail={[
                      wayDetailOf(way),
                      way.isPreferred
                        ? t('device.device.preferred', 'preferred')
                        : t('device.device.fallback', 'fallback'),
                    ].join(' · ')}
                  />
                ))
              ) : (
                <>
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
                </>
              )}
              <HealthCard
                label={t('device.device.firmware', 'Firmware')}
                tone={firmware.tone}
                value={firmware.value}
                detail={
                  isLinked && versions.size === 1 && !versions.has(null)
                    ? t('device.device.bothWays', '{{detail}} · both ways', {
                        detail: firmware.detail,
                      })
                    : firmware.detail
                }
                action={
                  firmware.updateEntityId === null
                    ? undefined
                    : {
                        icon: 'download',
                        verb: t('device.device.install', 'Install'),
                        isPrimary: true,
                        /** Does what the corner says. */
                        onSelect: () => {
                          void navigate(entityPath(firmware.updateEntityId ?? ''));
                        },
                      }
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
                onLink={view.canWrite ? setLinking : undefined}
              />
            )}

            <Section title={t('device.device.details', 'Details')}>
              <FactGrid facts={factsOf(view, webPage, wayNameOf)} />
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

      {view === undefined ? null : (
        <LinkDialog
          request={asked}
          lines={view.lines}
          deviceMark={
            <span className="flex size-7.5 shrink-0 items-center justify-center rounded-field bg-surface-raised text-foreground-muted">
              <DeviceIcon
                icon={view.icons.get(view.device.icon ?? '')}
                device={view.device}
                size={15}
              />
            </span>
          }
          onClose={closeLinking}
          onDone={() => {
            closeLinking();
            refresh();
          }}
        />
      )}

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
