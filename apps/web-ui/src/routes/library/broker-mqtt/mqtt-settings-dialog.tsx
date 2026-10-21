/**
 * The MQTT broker's settings, opened from the button beside **Add client**: whether a client may
 * connect without a username, and whether - and under which prefix - devices that announce
 * themselves are added. Saving them starts the broker again, says so in a toast and closes; a
 * refusal stays in the dialog, beside what was typed.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MqttSettings } from '@nebulahome/contracts';
import { Button, Modal, PanelRow, Switch, TextField, toast } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { saveMqttSettings } from '@/library/brokers-api';

/** What the dialog needs. */
export type MqttSettingsDialogProps = {
  readonly isOpen: boolean;

  /** The settings as saved. */
  readonly saved: MqttSettings;
  readonly onClose: () => void;
};

/**
 * Renders the dialog. Keyed by its opening, so each opening starts from what is saved.
 *
 * @param props - See {@link MqttSettingsDialogProps}.
 * @returns The dialog.
 */
export function MqttSettingsDialog(props: MqttSettingsDialogProps) {
  const { isOpen, saved, onClose } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<MqttSettings>(saved);
  const isChanged = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = useMutation({
    /**
     * Saves the settings.
     *
     * @returns Where the broker stands then.
     */
    mutationFn: async () => saveMqttSettings(draft),

    /** Says so, and closes. */
    onSuccess: () => {
      toast.success({
        title: t('brokers.mqtt.settingsSaved', 'Settings saved'),
        message: t('brokers.mqtt.restarting', 'The MQTT broker is starting again with them.'),
      });
      onClose();
    },

    /** Reads the broker again. */
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['brokers'] });
    },
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('brokers.mqtt.settings', 'Settings')}
      description={t(
        'brokers.mqtt.settingsLine',
        'Who may connect, and which devices are added by themselves. Saving starts the broker again.',
      )}
      footer={
        <>
          <Button variant="bare" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            isBusy={save.isPending}
            disabled={!isChanged || draft.discoveryPrefix === '' || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {t('brokers.mqtt.saveSettings', 'Save and restart')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col">
        <PanelRow
          className="border-t-0 px-0 pt-0"
          title={t('brokers.mqtt.anonymous', 'Clients without a username')}
          note={t(
            'brokers.mqtt.anonymousNote',
            'Off unless a device cannot be given a username: anyone on the network could then publish.',
          )}
          control={
            <Switch
              label={t('brokers.mqtt.anonymous', 'Clients without a username')}
              isOn={draft.allowAnonymous}
              disabled={save.isPending}
              onChange={(allowAnonymous) => {
                setDraft({ ...draft, allowAnonymous });
              }}
            />
          }
        />
        <PanelRow
          className="px-0 pb-0"
          title={t('brokers.mqtt.discovery', 'Devices that announce themselves')}
          note={t(
            'brokers.mqtt.discoveryNote',
            'Added to the house at once, under the prefix their firmware announces on.',
          )}
          control={
            <Switch
              label={t('brokers.mqtt.discovery', 'Devices that announce themselves')}
              isOn={draft.isDiscoveryEnabled}
              disabled={save.isPending}
              onChange={(isDiscoveryEnabled) => {
                setDraft({ ...draft, isDiscoveryEnabled });
              }}
            />
          }
        >
          <TextField
            label={t('brokers.mqtt.prefix', 'Prefix')}
            value={draft.discoveryPrefix}
            disabled={save.isPending || !draft.isDiscoveryEnabled}
            hint={t('brokers.mqtt.prefixHint', 'homeassistant unless the firmware says another.')}
            onChange={(event) => {
              setDraft({ ...draft, discoveryPrefix: event.target.value.trim() });
            }}
          />
        </PanelRow>
        {save.error === null ? null : (
          <p role="alert" className="mt-3.5 text-ui text-danger">
            {toMessage(save.error)}
          </p>
        )}
      </div>
    </Modal>
  );
}
