/**
 * Matter's Settings: the networks a new device is given when the server pairs it over Bluetooth.
 *
 * **Wi-Fi** - the network's name and password, entered once and then shown as dots with Change,
 * or Forget; the password never comes back from the server. **Thread** - read-only: the house's
 * Thread network while it is handed to Matter, and the way to its page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { AppIcon, Button, Modal, Note, TextField } from '@nebulahome/ui';

import { ThreadLogo } from '@/components/brand-logos';
import { toMessage } from '@/lib/error-message';
import { BROKER_QUERY_KEYS, fetchMatterNetworks, saveMatterNetworks } from '@/library/brokers-api';
import { BrokerMark } from '@/routes/library/brokers-page';

/** What the dialog needs. */
export type MatterSettingsDialogProps = {
  readonly onClose: () => void;
};

/**
 * Renders the dialog.
 *
 * @param props - See {@link MatterSettingsDialogProps}.
 * @returns The dialog.
 */
export function MatterSettingsDialog(props: MatterSettingsDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const networks = useQuery({
    queryKey: BROKER_QUERY_KEYS.matterNetworks,

    /**
     * Reads the networks new devices are given.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns Them.
     */
    queryFn: async ({ signal }) => fetchMatterNetworks(signal),
  });
  const wifi = networks.data?.wifi;
  const thread = networks.data?.thread ?? null;
  const [isEditing, setEditing] = useState(false);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const isSaved = wifi?.ssid != null;
  const isOpen = isEditing || !isSaved;

  const save = useMutation({
    /**
     * Saves the Wi-Fi, or forgets it.
     *
     * @param isForgotten - Whether to forget it.
     * @returns The networks.
     */
    mutationFn: async (isForgotten: boolean) =>
      saveMatterNetworks({
        wifi: isForgotten
          ? null
          : {
              ssid: (ssid.trim() === '' ? (wifi?.ssid ?? '') : ssid).trim(),
              ...(password === '' ? {} : { password }),
            },
      }),

    /**
     * Keeps what was saved.
     *
     * @param saved - The networks.
     */
    onSuccess: (saved) => {
      queryClient.setQueryData(BROKER_QUERY_KEYS.matterNetworks, saved);
      setEditing(false);
      setPassword('');
    },
  });

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      size="form"
      layout="card"
      lead={<BrokerMark size={44} isLit />}
      title={t('brokers.matter.settings.title', 'Matter settings')}
      description={t('brokers.matter.settings.line', 'Networks for new devices')}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={props.onClose}>
              {t('common.close', 'Close')}
            </Button>
            {isOpen ? (
              <Button
                disabled={ssid.trim() === '' && !isSaved}
                isBusy={save.isPending}
                onClick={() => {
                  save.mutate(false);
                }}
              >
                {t('brokers.matter.settings.save', 'Save')}
              </Button>
            ) : null}
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-ui-sm leading-normal text-foreground-muted">
          {t(
            'brokers.matter.settings.explain',
            'A new device paired over this server’s Bluetooth joins one of these. A device already in another app keeps its own.',
          )}
        </p>
        <div className="flex flex-col gap-3 rounded-card border border-border px-4 py-4">
          <span className="flex items-center gap-2 text-ui font-medium text-foreground">
            <AppIcon id="wifi" size={15} className="text-cyan" />
            {t('brokers.matter.settings.wifi', 'Wi-Fi')}
          </span>
          {isOpen ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label={t('brokers.matter.new.ssid', 'Network name')}
                value={ssid}
                placeholder={wifi?.ssid ?? ''}
                autoComplete="off"
                onChange={(event) => {
                  setSsid(event.target.value);
                }}
              />
              <TextField
                label={t('brokers.matter.new.password', 'Password')}
                type="password"
                value={password}
                autoComplete="new-password"
                hint={
                  wifi?.hasPassword === true
                    ? t('brokers.matter.settings.keep', 'Left empty, the saved one stays.')
                    : undefined
                }
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="grow text-ui text-foreground">{wifi.ssid}</span>
              <span className="font-mono text-mono-ui tracking-wider text-foreground-muted">
                {wifi.hasPassword ? '••••••••••' : ''}
              </span>
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  setSsid(wifi.ssid ?? '');
                  setEditing(true);
                }}
              >
                {t('brokers.matter.settings.change', 'Change')}
              </Button>
              <Button
                variant="bare"
                size="compact"
                isBusy={save.isPending && save.variables}
                onClick={() => {
                  save.mutate(true);
                }}
              >
                {t('brokers.matter.settings.forget', 'Forget')}
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 rounded-card border border-border px-4 py-4">
          <span className="flex items-center gap-2 text-ui font-medium text-foreground">
            <ThreadLogo width={15} height={15} />
            {t('brokers.matter.settings.thread', 'Thread')}
          </span>
          <span className="flex flex-wrap items-center gap-3 text-ui-sm">
            <span className="grow text-foreground-muted">
              {thread === null
                ? t(
                    'brokers.matter.settings.noThread',
                    'Not set up, or not handed to Matter: devices that need Thread cannot be added yet.',
                  )
                : t('brokers.matter.settings.threadOn', '{{name}} · channel {{channel}}', {
                    name: thread.networkName,
                    channel: thread.channel,
                  })}
            </span>
            <Link
              to="/brokers/thread"
              className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-hover"
            >
              {t('brokers.matter.settings.openThread', 'Open Thread')}
              <AppIcon id="chevron-right" size={13} />
            </Link>
          </span>
        </div>
        {[networks.error, save.error].map((error) =>
          error === null ? null : (
            <Note key={toMessage(error)} tone="danger">
              {toMessage(error)}
            </Note>
          ),
        )}
      </div>
    </Modal>
  );
}
