/**
 * The MQTT broker's Mappings tab: devices mapped by hand - one that does not announce itself, read
 * from the topic it publishes on - with **Map a topic**, which adds one.
 *
 * A mapping is a device of its own, added to the house at once like an announced one; removing
 * the mapping removes that device.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MqttMapping, MqttMappingInput } from '@nebulahome/contracts';
import { Button, Modal, Panel, PanelNote, PanelRow, SelectField, TextField } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { saveMqttMapping } from '@/library/brokers-api';

/** A mapping being written. */
type Draft = Required<Omit<MqttMappingInput, 'id' | 'commandTopic'>> & { commandTopic: string };

/** A new mapping. */
const EMPTY: Draft = {
  name: '',
  component: 'sensor',
  stateTopic: '',
  valuePath: '',
  unit: '',
  deviceClass: '',
  commandTopic: '',
  payloadOn: 'ON',
  payloadOff: 'OFF',
};

/** What the dialog needs. */
type MapTopicDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
};

/**
 * Maps a topic into a device of the house.
 *
 * @param props - See {@link MapTopicDialogProps}.
 * @returns The dialog.
 */
export function MapTopicDialog(props: MapTopicDialogProps) {
  const { isOpen, onClose, onSaved } = props;
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const save = useMutation({
    /**
     * Saves the mapping.
     *
     * @returns It, with its id.
     */
    mutationFn: async () =>
      saveMqttMapping({
        name: draft.name,
        component: draft.component,
        stateTopic: draft.stateTopic,
        valuePath: draft.valuePath,
        unit: draft.component === 'sensor' ? draft.unit : '',
        deviceClass: draft.deviceClass,
        payloadOn: draft.payloadOn,
        payloadOff: draft.payloadOff,
        ...(draft.component === 'switch' && draft.commandTopic !== ''
          ? { commandTopic: draft.commandTopic }
          : {}),
      }),

    /** Closes, and reads the mappings again. */
    onSuccess: () => {
      close();
      onSaved();
    },
  });

  /**
   * Changes one field of the draft.
   *
   * @param key - Which.
   * @returns What sets it.
   */
  const set =
    (key: keyof Draft) =>
    (value: string): void => {
      setDraft((current) => ({ ...current, [key]: value }));
    };

  /** Shuts the dialog and starts it afresh next time. */
  function close(): void {
    setDraft(EMPTY);
    save.reset();
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={t('brokers.mqtt.mapTopic', 'Map a topic')}
      description={t(
        'brokers.mqtt.mapTopicLine',
        'What a device publishes, read into a device of the house.',
      )}
      footer={
        <>
          <Button variant="bare" onClick={close}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            isBusy={save.isPending}
            disabled={draft.name === '' || draft.stateTopic === '' || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {t('common.save', 'Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label={t('brokers.mqtt.name', 'Name')}
          value={draft.name}
          placeholder={t('brokers.mqtt.nameHint', 'Garden temperature')}
          onChange={(event) => {
            set('name')(event.target.value);
          }}
        />
        <SelectField
          label={t('brokers.mqtt.isA', 'Is a')}
          options={[
            { value: 'sensor', label: t('brokers.mqtt.sensor', 'Sensor') },
            { value: 'binary_sensor', label: t('brokers.mqtt.binarySensor', 'Binary sensor') },
            { value: 'switch', label: t('brokers.mqtt.switch', 'Switch') },
          ]}
          value={draft.component}
          onChange={set('component')}
        />
        <TextField
          label={t('brokers.mqtt.stateTopic', 'State topic')}
          value={draft.stateTopic}
          placeholder={t('brokers.mqtt.stateTopicExample', 'tele/garden/SENSOR')}
          onChange={(event) => {
            set('stateTopic')(event.target.value);
          }}
        />
        <TextField
          label={t('brokers.mqtt.valuePath', 'Value in the JSON')}
          value={draft.valuePath}
          placeholder={t('brokers.mqtt.valuePathExample', 'AM2301.Temperature')}
          hint={t(
            'brokers.mqtt.valuePathHint',
            'Keys separated by dots; empty when the payload is the value itself.',
          )}
          onChange={(event) => {
            set('valuePath')(event.target.value);
          }}
        />
        {draft.component === 'sensor' ? (
          <TextField
            label={t('brokers.mqtt.unit', 'Unit')}
            value={draft.unit}
            placeholder={t('brokers.mqtt.unitExample', '°C')}
            onChange={(event) => {
              set('unit')(event.target.value);
            }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t('brokers.mqtt.payloadOn', 'On is')}
              value={draft.payloadOn}
              onChange={(event) => {
                set('payloadOn')(event.target.value);
              }}
            />
            <TextField
              label={t('brokers.mqtt.payloadOff', 'Off is')}
              value={draft.payloadOff}
              onChange={(event) => {
                set('payloadOff')(event.target.value);
              }}
            />
          </div>
        )}
        {draft.component === 'switch' ? (
          <TextField
            label={t('brokers.mqtt.commandTopic', 'Command topic')}
            value={draft.commandTopic}
            placeholder={t('brokers.mqtt.commandTopicExample', 'cmnd/pump/POWER')}
            hint={t(
              'brokers.mqtt.commandTopicHint',
              'Where on and off are published; empty for a switch that is only read.',
            )}
            onChange={(event) => {
              set('commandTopic')(event.target.value);
            }}
          />
        ) : null}
        {save.error === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {toMessage(save.error)}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** What the tab needs. */
export type MqttMappingsProps = {
  readonly mappings: readonly MqttMapping[];

  /** Removes a mapping and its device; absent when the viewer may not remove devices. */
  readonly onRemove?: (id: string) => void;
  readonly error: unknown;
};

/**
 * Renders the tab.
 *
 * @param props - See {@link MqttMappingsProps}.
 * @returns The tab's content.
 */
export function MqttMappings(props: MqttMappingsProps) {
  const { t } = useTranslation();
  const { mappings, onRemove, error } = props;

  return (
    <Panel title={t('brokers.mqtt.mappedByHand', 'Mapped by hand')}>
      {mappings.map((mapping) => (
        <PanelRow
          key={mapping.id}
          title={mapping.name}
          note={
            <span className="font-mono">
              {mapping.stateTopic}
              {mapping.valuePath === '' ? '' : ` → ${mapping.valuePath}`}
              {mapping.commandTopic === undefined ? '' : ` · ${mapping.commandTopic}`}
            </span>
          }
          control={
            onRemove === undefined ? undefined : (
              <Button
                variant="danger"
                size="compact"
                onClick={() => {
                  onRemove(mapping.id);
                }}
              >
                {t('common.remove', 'Remove')}
              </Button>
            )
          }
        />
      ))}
      {mappings.length === 0 ? (
        <PanelNote>
          {t(
            'brokers.mqtt.noMappings',
            'A device that does not announce itself is mapped here from the topic it publishes on.',
          )}
        </PanelNote>
      ) : null}
      {error === null ? null : <PanelNote>{toMessage(error)}</PanelNote>}
    </Panel>
  );
}
