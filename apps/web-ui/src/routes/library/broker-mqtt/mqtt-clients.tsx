/**
 * The MQTT broker's Clients tab: who may connect, and who is connected - the hub, the containers
 * the platform runs, each device the owner added, and anyone without a username - with **Add
 * client**, which makes a username and a password for a device.
 *
 * The password is shown once, when it is made, with a way to copy it: the broker keeps only its
 * hash, and a device that lost it is given a new client.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MqttPrincipal, MqttSession } from '@nebulahome/contracts';
import {
  Badge,
  Button,
  Modal,
  Panel,
  PanelNote,
  PanelRow,
  Segmented,
  TextField,
  type BadgeTone,
} from '@nebulahome/ui';

import { copyText } from '@/lib/clipboard';
import { toMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/format-time';
import { addMqttClient } from '@/library/brokers-api';

/** The tone of each kind of username's badge. */
const KIND_TONES: Readonly<Record<MqttPrincipal['kind'], BadgeTone>> = {
  hub: 'neutral',
  container: 'neutral',
  client: 'accent',
};

/** What a new client may reach. */
type AccessChoice = 'prefix' | 'all';

/** What the dialog needs. */
type AddClientDialogProps = {
  readonly isOpen: boolean;
  readonly port: number;
  readonly onClose: () => void;
  readonly onAdded: () => void;
};

/**
 * Makes a client for a device, and shows its password once.
 *
 * @param props - See {@link AddClientDialogProps}.
 * @returns The dialog.
 */
export function AddClientDialog(props: AddClientDialogProps) {
  const { isOpen, port, onClose, onAdded } = props;
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [label, setLabel] = useState('');
  const [access, setAccess] = useState<AccessChoice>('prefix');
  const [isCopied, setCopied] = useState(false);
  const host = globalThis.location.hostname;
  const add = useMutation({
    /**
     * Makes the client.
     *
     * @returns Its username and password.
     */
    mutationFn: async () => addMqttClient({ username, label, access }),
    onSuccess: onAdded,
  });
  const made = add.data;

  /** Shuts the dialog and starts it afresh next time. */
  const close = (): void => {
    setUsername('');
    setLabel('');
    setAccess('prefix');
    setCopied(false);
    add.reset();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      closesOnBackdrop={made === undefined}
      title={
        made === undefined
          ? t('brokers.mqtt.addClient', 'Add a client')
          : t('brokers.mqtt.canConnect', '{{username}} can connect', { username: made.username })
      }
      description={
        made === undefined
          ? t(
              'brokers.mqtt.addClientLine',
              'A username and a password for one device. Each device gets its own.',
            )
          : t(
              'brokers.mqtt.passwordOnce',
              'Put these in the device. The password is shown this once.',
            )
      }
      footer={
        made === undefined ? (
          <>
            <Button variant="bare" onClick={close}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              isBusy={add.isPending}
              disabled={username === '' || add.isPending}
              onClick={() => {
                add.mutate();
              }}
            >
              {t('brokers.mqtt.add', 'Add')}
            </Button>
          </>
        ) : (
          <Button onClick={close}>{t('brokers.mqtt.done', 'Done')}</Button>
        )
      }
    >
      {made === undefined ? (
        <div className="flex flex-col gap-4">
          <TextField
            label={t('brokers.mqtt.username', 'Username')}
            value={username}
            placeholder={t('brokers.mqtt.usernameExample', 'garden-sensor')}
            hint={
              access === 'prefix'
                ? t(
                    'brokers.mqtt.prefixAccess',
                    'It publishes under {{username}}/ and announces itself for discovery.',
                    { username: username === '' ? '<username>' : username },
                  )
                : t('brokers.mqtt.allAccess', 'It reads and writes every topic.')
            }
            onChange={(event) => {
              setUsername(event.target.value.toLowerCase());
            }}
          />
          <TextField
            label={t('brokers.mqtt.label', 'What it is')}
            value={label}
            placeholder={t('brokers.mqtt.labelHint', 'The plug in the garden')}
            onChange={(event) => {
              setLabel(event.target.value);
            }}
          />
          <Segmented
            label={t('brokers.mqtt.reaches', 'Reaches')}
            className="self-start"
            options={[
              { value: 'prefix', label: t('brokers.mqtt.ownTopics', 'Its own topics') },
              { value: 'all', label: t('brokers.mqtt.everyTopic', 'Every topic') },
            ]}
            value={access}
            onChange={setAccess}
          />
          {add.error === null ? null : (
            <p role="alert" className="text-ui text-danger">
              {toMessage(add.error)}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-ui">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
            <dt className="text-foreground-subtle">{t('brokers.mqtt.host', 'Host')}</dt>
            <dd className="font-mono break-all">{host}</dd>
            <dt className="text-foreground-subtle">{t('brokers.mqtt.port', 'Port')}</dt>
            <dd className="font-mono">{port}</dd>
            <dt className="text-foreground-subtle">{t('brokers.mqtt.username', 'Username')}</dt>
            <dd className="font-mono break-all">{made.username}</dd>
            <dt className="text-foreground-subtle">{t('brokers.mqtt.password', 'Password')}</dt>
            <dd className="font-mono break-all">{made.password}</dd>
          </dl>
          <Button
            variant="ghost"
            size="compact"
            className="self-start"
            onClick={() => {
              void copyText(made.password).then(setCopied);
            }}
          >
            {isCopied
              ? t('brokers.mqtt.copied', 'Copied')
              : t('brokers.mqtt.copyPassword', 'Copy the password')}
          </Button>
        </div>
      )}
    </Modal>
  );
}

/** What the tab needs. */
export type MqttClientsProps = {
  readonly items: readonly MqttPrincipal[];
  readonly anonymous: readonly MqttSession[];

  /** Removes a device's client; absent when the viewer may not. */
  readonly onRemove?: (username: string) => void;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link MqttClientsProps}.
 * @returns The tab's content.
 */
export function MqttClients(props: MqttClientsProps) {
  const { t } = useTranslation();
  const { items, anonymous, onRemove } = props;

  /**
   * What a kind of username reads as.
   *
   * @param kind - The kind.
   * @returns Its name.
   */
  const kindLabel = (kind: MqttPrincipal['kind']): string =>
    kind === 'hub'
      ? t('brokers.mqtt.kindHub', 'Platform')
      : kind === 'container'
        ? t('brokers.mqtt.kindContainer', 'Container')
        : t('brokers.mqtt.kindClient', 'Device');

  /**
   * Where a connection comes from: its client id, and its address when known.
   *
   * @param session - The connection.
   * @returns The line.
   */
  const originOf = (session: MqttSession): string =>
    session.address === null
      ? session.clientId
      : t('brokers.mqtt.from', '{{client}} from {{address}}', {
          client: session.clientId,
          address: session.address,
        });

  return (
    <Panel title={t('brokers.mqtt.whoConnects', 'Who may connect')}>
      {items.map((principal) => {
        const online = principal.sessions.length;

        return (
          <PanelRow
            key={principal.username}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{principal.username}</span>
                <Badge tone={KIND_TONES[principal.kind]}>{kindLabel(principal.kind)}</Badge>
                <Badge tone={online > 0 ? 'success' : 'neutral'}>
                  {online > 0
                    ? t('brokers.mqtt.connected', 'Connected')
                    : t('brokers.mqtt.notConnected', 'Not connected')}
                </Badge>
              </span>
            }
            note={
              <span className="flex flex-col gap-0.5">
                <span>
                  {t('brokers.mqtt.reachesLine', '{{label}} · reaches {{reach}}', {
                    label: principal.label,
                    reach: principal.publish.includes('#')
                      ? t('brokers.mqtt.everyTopicLower', 'every topic')
                      : principal.publish.join(', '),
                  })}
                </span>
                {principal.sessions.map((session) => (
                  <span key={session.clientId} className="text-foreground-subtle">
                    {originOf(session)} · {relativeTime(session.connectedAt)}
                  </span>
                ))}
              </span>
            }
            control={
              principal.kind === 'client' && onRemove !== undefined ? (
                <Button
                  variant="danger"
                  size="compact"
                  onClick={() => {
                    onRemove(principal.username);
                  }}
                >
                  {t('common.remove', 'Remove')}
                </Button>
              ) : undefined
            }
          />
        );
      })}

      {anonymous.length === 0 ? null : (
        <PanelRow
          title={t('brokers.mqtt.withoutUsername', 'Without a username')}
          note={anonymous.map(originOf).join(', ')}
        />
      )}
      {items.every((principal) => principal.kind !== 'client') ? (
        <PanelNote>
          {t('brokers.mqtt.noClients', 'No device may connect yet. Add a client for each device.')}
        </PanelNote>
      ) : null}
    </Panel>
  );
}
