/**
 * The MQTT broker's Overview: the health strip, how a device connects, the owner's settings, and
 * the announcements the broker did not take.
 *
 * The strip says how the broker stands and since when, who is connected, how many messages a
 * second pass through it, and how many devices it hears. Connecting is the address a device is
 * given - the one this page was opened on, the house's own - with a line to try it. Settings are
 * whether a client may connect without a username, and whether - and under which prefix - devices
 * that announce themselves are added; saving them starts the broker again.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MqttSettings, MqttStatus } from '@nebulahome/contracts';
import {
  Button,
  FactGrid,
  HealthCard,
  HealthStrip,
  Note,
  Panel,
  PanelRow,
  Section,
  Switch,
  TextField,
} from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { copyText } from '@/lib/clipboard';
import { toMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/format-time';
import { saveMqttSettings } from '@/library/brokers-api';
import { brokerStateOf } from '@/routes/library/brokers-page';

/** What the tab needs. */
export type MqttOverviewProps = {
  readonly status: MqttStatus;

  /** Whether the owner may change the settings. */
  readonly canConfigure: boolean;

  /** Opens the Devices tab. */
  readonly onSeeDevices: () => void;
};

/**
 * The owner's settings, editable, saved together.
 *
 * @param props - The settings as saved, and whether they may be changed.
 * @param props.saved - As saved.
 * @param props.canConfigure - Whether they may be changed.
 * @returns The form.
 */
function SettingsPanel(props: { readonly saved: MqttSettings; readonly canConfigure: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<MqttSettings>(props.saved);
  const isChanged = JSON.stringify(draft) !== JSON.stringify(props.saved);
  const save = useMutation({
    /**
     * Saves the settings.
     *
     * @returns Where the broker stands then.
     */
    mutationFn: async () => saveMqttSettings(draft),

    /** Reads the broker again. */
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['brokers'] });
    },
  });
  const disabled = !props.canConfigure || save.isPending;

  return (
    <Panel
      title={t('brokers.mqtt.settings', 'Settings')}
      action={
        props.canConfigure ? (
          <Button
            size="compact"
            isBusy={save.isPending}
            disabled={!isChanged || draft.discoveryPrefix === '' || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {t('brokers.mqtt.saveSettings', 'Save and restart')}
          </Button>
        ) : undefined
      }
    >
      <PanelRow
        title={t('brokers.mqtt.anonymous', 'Clients without a username')}
        note={t(
          'brokers.mqtt.anonymousNote',
          'Off unless a device cannot be given a username: anyone on the network could then publish.',
        )}
        control={
          <Switch
            label={t('brokers.mqtt.anonymous', 'Clients without a username')}
            isOn={draft.allowAnonymous}
            disabled={disabled}
            onChange={(allowAnonymous) => {
              setDraft({ ...draft, allowAnonymous });
            }}
          />
        }
      />
      <PanelRow
        title={t('brokers.mqtt.discovery', 'Devices that announce themselves')}
        note={t(
          'brokers.mqtt.discoveryNote',
          'Added to the house at once, under the prefix their firmware announces on.',
        )}
        control={
          <Switch
            label={t('brokers.mqtt.discovery', 'Devices that announce themselves')}
            isOn={draft.isDiscoveryEnabled}
            disabled={disabled}
            onChange={(isDiscoveryEnabled) => {
              setDraft({ ...draft, isDiscoveryEnabled });
            }}
          />
        }
      >
        <TextField
          label={t('brokers.mqtt.prefix', 'Prefix')}
          value={draft.discoveryPrefix}
          disabled={disabled || !draft.isDiscoveryEnabled}
          hint={t('brokers.mqtt.prefixHint', 'homeassistant unless the firmware says another.')}
          onChange={(event) => {
            setDraft({ ...draft, discoveryPrefix: event.target.value.trim() });
          }}
        />
      </PanelRow>
      {save.error === null ? null : <Note tone="danger">{toMessage(save.error)}</Note>}
    </Panel>
  );
}

/**
 * Renders the tab.
 *
 * @param props - See {@link MqttOverviewProps}.
 * @returns The tab's content.
 */
export function MqttOverview(props: MqttOverviewProps) {
  const { t } = useTranslation();
  const { status, canConfigure, onSeeDevices } = props;
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

      <SettingsPanel
        key={JSON.stringify(status.settings)}
        saved={status.settings}
        canConfigure={canConfigure}
      />

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
