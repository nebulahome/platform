/**
 * The MQTT broker's Overview: the health strip, how a device connects, and the announcements the
 * broker did not take.
 *
 * The strip says how the broker stands and since when, who is connected, how many messages a
 * second pass through it, and how many devices it hears. Connecting is the address a device is
 * given - the one this page was opened on, the house's own - with a line to try it. The settings
 * are a dialog of their own, opened from the page's header (`mqtt-settings-dialog.tsx`).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MqttStatus } from '@nebulahome/contracts';
import {
  Button,
  FactGrid,
  HealthCard,
  HealthStrip,
  Panel,
  PanelRow,
  Section,
} from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { copyText } from '@/lib/clipboard';
import { relativeTime } from '@/lib/format-time';
import { brokerStateOf } from '@/routes/library/brokers-page';

/** What the tab needs. */
export type MqttOverviewProps = {
  readonly status: MqttStatus;

  /** Opens the Devices tab. */
  readonly onSeeDevices: () => void;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link MqttOverviewProps}.
 * @returns The tab's content.
 */
export function MqttOverview(props: MqttOverviewProps) {
  const { t } = useTranslation();
  const { status, onSeeDevices } = props;
  const [isCopied, setCopied] = useState(false);
  const state = brokerStateOf(status.state);
  const host = globalThis.location.hostname;
  const example = `mosquitto_pub -h ${host} -p ${String(status.port)} -u <username> -P <password> -t <username>/hello -m hi`;
  const rate = numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <div className="flex flex-col gap-8">
      <HealthStrip>
        <HealthCard
          label={t('brokers.mqtt.broker', 'Broker')}
          tone={
            status.state === 'running'
              ? 'success'
              : status.state === 'failed'
                ? 'danger'
                : 'neutral'
          }
          value={state.label}
          detail={
            status.state === 'running' && status.startedAt !== null
              ? t('brokers.mqtt.since', 'Since {{when}}', {
                  when: relativeTime(status.startedAt),
                })
              : undefined
          }
        />
        <HealthCard
          label={t('brokers.mqtt.clients', 'Clients')}
          tone={status.clientsOnline === 0 ? 'neutral' : 'success'}
          value={t('brokers.mqtt.online', '{{count}} online', { count: status.clientsOnline })}
        />
        <HealthCard
          label={t('brokers.mqtt.messages', 'Messages')}
          tone="neutral"
          value={t('brokers.mqtt.perSecond', '{{rate}} a second', {
            rate: rate.format(status.messagesPerSecond),
          })}
        />
        <HealthCard
          label={t('brokers.mqtt.devices', 'Devices')}
          tone={status.discovery.devices === 0 ? 'neutral' : 'success'}
          value={t('brokers.mqtt.deviceCount', {
            count: status.discovery.devices,
            defaultValue_one: '{{count}} device',
            defaultValue_other: '{{count}} devices',
          })}
          detail={t('brokers.mqtt.entityCount', '{{announced}} announced · {{mapped}} mapped', {
            announced: status.discovery.announced,
            mapped: status.discovery.mapped,
          })}
          action={
            status.discovery.devices === 0
              ? undefined
              : {
                  icon: 'arrow-right',
                  verb: t('brokers.mqtt.seeThem', 'See them'),
                  onSelect: onSeeDevices,
                }
          }
        />
      </HealthStrip>

      <Section title={t('brokers.mqtt.connecting', 'Connecting')}>
        <div className="flex flex-col gap-3">
          <FactGrid
            facts={[
              { label: t('brokers.mqtt.host', 'Host'), value: host, isMono: true },
              {
                label: t('brokers.mqtt.port', 'Port'),
                value: `TCP ${String(status.port)}`,
                isMono: true,
              },
              {
                label: t('brokers.mqtt.withoutUsername', 'Without a username'),
                value: status.settings.allowAnonymous
                  ? t('brokers.mqtt.allowed', 'Allowed')
                  : t('brokers.mqtt.refused', 'Refused'),
              },
              {
                label: t('brokers.mqtt.engine', 'Engine'),
                value: 'aedes',
                isMono: true,
              },
            ]}
          />
          <div className="flex items-center gap-3 rounded-inner border border-border px-3.5 py-2.5">
            <code className="min-w-0 grow truncate font-mono text-caption text-foreground-muted">
              {example}
            </code>
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                void copyText(example).then(setCopied);
              }}
            >
              {isCopied ? t('brokers.mqtt.copied', 'Copied') : t('brokers.mqtt.copy', 'Copy')}
            </Button>
          </div>
        </div>
      </Section>

      {status.discovery.skipped.length === 0 ? null : (
        <Panel title={t('brokers.mqtt.skipped', 'Announcements not taken')}>
          {status.discovery.skipped.map((skipped) => (
            <PanelRow
              key={skipped.topic}
              title={<span className="font-mono text-ui">{skipped.topic}</span>}
              note={skipped.reason}
            />
          ))}
        </Panel>
      )}
    </div>
  );
}
