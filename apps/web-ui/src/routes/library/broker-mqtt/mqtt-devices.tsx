/**
 * The MQTT broker's Devices tab: every device it hears - announced, mapped by hand, its own - with
 * the device each is in the house.
 *
 * A device is added the moment it is heard, to the integration whose rules recognise it or to the
 * platform's own MQTT vendor; its row opens its page, which is where it is removed from. One the
 * owner removed is still heard - its announcement is retained - and is offered back here.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { MqttDevice } from '@nebulahome/contracts';
import { Badge, Button, Panel, PanelNote, PanelRow } from '@nebulahome/ui';

/** What the tab needs. */
export type MqttDevicesProps = {
  readonly devices: readonly MqttDevice[];

  /** What each vendor is called, by id. */
  readonly vendorNames: ReadonlyMap<string, string>;

  /** Brings back a device removed from the house; absent when the viewer may not add devices. */
  readonly onRestore?: (deviceKey: string) => void;
  readonly isRestoring: boolean;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link MqttDevicesProps}.
 * @returns The tab's content.
 */
export function MqttDevices(props: MqttDevicesProps) {
  const { t } = useTranslation();
  const { devices, vendorNames, onRestore, isRestoring } = props;

  return (
    <Panel title={t('brokers.mqtt.heard', 'Heard on the broker')}>
      {devices.map((device) => {
        const { identity } = device;
        const said = [identity.manufacturer, identity.model, identity.originName].filter(
          (each): each is string => each !== null,
        );
        const others = device.claimedBy.map((id) => vendorNames.get(id) ?? id);

        return (
          <PanelRow
            key={identity.deviceKey}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {device.deviceId === null ? (
                  <span>{identity.name}</span>
                ) : (
                  <Link
                    to={`/devices/${encodeURIComponent(device.deviceId)}`}
                    className="text-primary transition-colors hover:text-primary-hover"
                  >
                    {identity.name}
                  </Link>
                )}
                {identity.source === 'mapped' ? (
                  <Badge>{t('brokers.mqtt.mapped', 'Mapped')}</Badge>
                ) : null}
                {device.isRemoved ? (
                  <Badge>{t('brokers.mqtt.removed', 'Removed from the house')}</Badge>
                ) : null}
              </span>
            }
            note={[
              ...said,
              t('brokers.mqtt.entities', {
                count: device.entityCount,
                defaultValue_one: '{{count}} entity',
                defaultValue_other: '{{count}} entities',
              }),
              ...(others.length > 1
                ? [t('brokers.mqtt.wantedBy', 'Wanted by {{names}}', { names: others.join(', ') })]
                : []),
            ].join(' · ')}
            control={
              device.isRemoved && onRestore !== undefined ? (
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={isRestoring}
                  onClick={() => {
                    onRestore(identity.deviceKey);
                  }}
                >
                  {t('brokers.mqtt.addBack', 'Add back')}
                </Button>
              ) : undefined
            }
          />
        );
      })}
      {devices.length === 0 ? (
        <PanelNote>
          {t(
            'brokers.mqtt.noDevices',
            'No device yet. One that announces itself on the broker is added at once; one that does not is mapped by hand.',
          )}
        </PanelNote>
      ) : null}
    </Panel>
  );
}
