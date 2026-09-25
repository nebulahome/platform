/**
 * One device's own page: what it is, how it is doing, and every entity it exposes.
 *
 * The page the devices list leads to, and every link to a device - from an entity's page, a tag,
 * a vendor, the system monitor - lands here. At the top the device at a glance; beside the list
 * of its entities, the facts about it: where it comes from, how it is reached, what it runs. Each
 * entity is the same row the rest of the library draws, with its reading live and its switch at
 * hand, and a press opens the entity's own page.
 *
 * Changing the device is a dialog behind the settings button, the one a vendor's page opens for
 * the same device: its name, icon, tags and room, the model and the connection, and a Remove.
 * Beside it, for a device whose driver says it serves one, the way to the device's own web page.
 *
 * Under the facts, the device's activity: what changed on it, newest first, each change opening
 * into everything known about it.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import type { EntityView } from '@nebula-home/contracts';
import { AppIcon, Badge, IconButton, Panel, TagChip } from '@nebula-home/ui';

import { ExternalLinkIcon } from '@/components/icons';
import { deviceWebPageOf } from '@/lib/device-web-page';
import { toMessage } from '@/lib/error-message';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { useLive } from '@/live/live-store';
import { DetailHeader, DetailPlaceholder } from '@/routes/library/detail-page';
import { ActivityPanel } from '@/routes/library/device/activity-panel';
import { useDevicePage, type DevicePageView } from '@/routes/library/device/use-device-page';
import { DeviceDialog } from '@/routes/library/device-dialog';
import { DeviceIcon } from '@/routes/library/device-icon';
import { Fact, When } from '@/routes/library/entity/details-panel';
import { EntitySettingsDialog } from '@/routes/library/entity/entity-settings-dialog';
import { EntityRow } from '@/routes/library/entity-row';

/** What the summary needs. */
type DeviceSummaryProps = {
  readonly view: DevicePageView;
};

/**
 * The device at a glance: its icon, its name, what it is and where, whether it is reporting, and
 * whether it has a firmware update waiting.
 *
 * @param props - See {@link DeviceSummaryProps}.
 * @returns The summary.
 */
function DeviceSummary(props: DeviceSummaryProps) {
  const { view } = props;
  const liveStatus = useLive((state) => state.status);
  const { device, room, floor, standing, icons } = view;
  const make = [device.manufacturer, device.model].filter(Boolean).join(' ');
  const place = [floor?.name, room?.name ?? device.areaName].filter(Boolean).join(' › ');
  const isDisabled = device.state === 'disabled';
  const hasUpdate = view.lines.some(
    (line) => line.entity.deviceClass === 'update' && line.state.sensor_binary?.isOn === true,
  );

  return (
    <section className="flex flex-wrap items-center gap-4">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-panel border border-border face-card text-foreground-muted">
        <DeviceIcon icon={icons.get(device.icon ?? '')} size={28} />
      </span>
      <div className="flex min-w-0 grow flex-col gap-1">
        <h2 className="truncate text-headline font-semibold tracking-tight">{device.name}</h2>
        <p className="text-ui text-foreground-muted">
          {make === '' ? device.driverName : make}
          {place === '' ? null : <span className="text-foreground-subtle"> · {place}</span>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {hasUpdate ? <Badge tone="accent">Update available</Badge> : null}
        <Badge tone={isDisabled ? 'neutral' : standing.isReporting ? 'success' : 'warning'}>
          {isDisabled ? 'Disabled' : standing.isReporting ? 'Reporting' : 'Silent'}
        </Badge>
        <Badge tone="neutral">
          {liveStatus === 'live' ? 'Live' : liveStatus === 'connecting' ? 'Connecting' : 'Not live'}
        </Badge>
      </div>
    </section>
  );
}

/**
 * The facts about the device.
 *
 * @param props - The view.
 * @param props.view - See {@link DevicePageView}.
 * @returns The panel.
 */
function DeviceDetails(props: { readonly view: DevicePageView }) {
  const { view } = props;
  const { device, vendorName, tags, icons, standing } = view;

  return (
    <Panel title="Details">
      <dl>
        <Fact term="Id">
          <span className="font-mono text-caption break-all">{device.id}</span>
        </Fact>
        <Fact term="Integration">
          {device.origin === 'system' ? (
            vendorName
          ) : (
            <Link
              to={`/integrations/${encodeURIComponent(device.vendorId)}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {vendorName}
            </Link>
          )}
          <span className="text-foreground-subtle"> · {device.driverName}</span>
        </Fact>
        {device.model === null ? null : <Fact term="Model">{device.model}</Fact>}
        {device.origin === 'system' ? null : <Fact term="Transport">{device.transport}</Fact>}
        {device.externalId === null ? null : (
          <Fact term="Serial">
            <span className="font-mono text-caption break-all">{device.externalId}</span>
          </Fact>
        )}
        {device.swVersion === null ? null : <Fact term="Firmware">{device.swVersion}</Fact>}
        {device.hwVersion === null ? null : <Fact term="Hardware">{device.hwVersion}</Fact>}
        <Fact term="State">
          {device.state}
          {device.lastError === null ? null : (
            <span className="block text-caption text-danger">{device.lastError}</span>
          )}
        </Fact>
        <Fact term="Tags">
          {tags.length === 0 ? (
            <span className="text-foreground-subtle">None</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <TagChip
                  key={tag.id}
                  color={tag.color}
                  icon={tag.icon === null ? undefined : icons.get(tag.icon)}
                >
                  {tag.name}
                </TagChip>
              ))}
            </span>
          )}
        </Fact>
        <Fact term="Last seen">
          <When when={standing.lastSeenAt} />
        </Fact>
      </dl>
    </Panel>
  );
}

/**
 * Renders a device's page.
 *
 * @returns The page.
 */
export function DevicePage() {
  const { deviceId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { view, isPending, error, isMissing } = useDevicePage(deviceId);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [configuring, setConfiguring] = useState<EntityView | null>(null);

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
    (view.vendor !== undefined || view.device.origin === 'system');
  const webPage =
    view === undefined
      ? null
      : deviceWebPageOf(
          view.device,
          view.vendor?.drivers.find((driver) => driver.id === view.device.kind),
        );

  return (
    <div className="flex min-h-0 grow flex-col">
      <DetailHeader
        crumbs={[{ to: '/devices', label: 'Devices' }]}
        title={view?.device.name ?? deviceId}
        actions={
          webPage === null && !canConfigure ? undefined : (
            <>
              {webPage === null ? null : (
                <a
                  href={webPage}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${webPage}`}
                  className="press inline-flex h-control-sm items-center gap-2 rounded-field border border-border-strong face-raised px-3 text-ui font-medium text-foreground"
                >
                  Web page
                  <ExternalLinkIcon width="13" height="13" />
                </a>
              )}
              {canConfigure ? (
                <IconButton
                  variant="raised"
                  label={`Configure ${view.device.name}`}
                  onClick={() => {
                    setSettingsOpen(true);
                  }}
                >
                  <AppIcon id="settings" size={15} />
                </IconButton>
              ) : null}
            </>
          )
        }
      />

      <div className="min-h-0 grow overflow-y-auto p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          {view === undefined ? (
            isPending ? (
              <DetailPlaceholder>Reading…</DetailPlaceholder>
            ) : (
              <DetailPlaceholder isProblem>
                {isMissing ? `There is no device with the id ${deviceId}.` : toMessage(error)}
              </DetailPlaceholder>
            )
          ) : (
            <>
              <DeviceSummary view={view} />
              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
                <Panel title={`Entities · ${String(view.lines.length)}`}>
                  {view.lines.length === 0 ? (
                    <p className="px-4 py-3.5 text-ui text-foreground-muted">
                      No entities yet. They appear as soon as the hub hears from the device.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1.5 p-3">
                      {view.lines.map((line) => (
                        <EntityRow
                          key={line.entity.entityId}
                          line={line}
                          deviceAreaKey={view.device.areaKey}
                          onConfigure={view.canEditEntities ? setConfiguring : undefined}
                        />
                      ))}
                    </ul>
                  )}
                </Panel>
                <div className="flex min-w-0 flex-col gap-5">
                  <DeviceDetails view={view} />
                  <ActivityPanel
                    deviceId={view.device.id}
                    deviceName={view.device.name}
                    entities={view.lines.map((line) => line.entity)}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

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
    </div>
  );
}
