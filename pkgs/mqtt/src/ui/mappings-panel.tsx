/**
 * Devices mapped by hand: a sensor, a binary sensor or a switch read from the topic a device
 * publishes on, for one that does not announce itself.
 */
import { useState } from 'react';

import { usePackageCall, usePackageRpc } from '@nebula-home/package-ui';
import { Button, Modal, Panel, PanelNote, PanelRow, SelectField, TextField } from '@nebula-home/ui';

import type { Mapping } from './types.js';

/** What each component is called. */
const COMPONENTS: readonly { value: Mapping['component']; label: string }[] = [
  { value: 'sensor', label: 'Sensor' },
  { value: 'binary_sensor', label: 'Binary sensor' },
  { value: 'switch', label: 'Switch' },
];

/** What the form holds. */
type Draft = {
  name: string;
  component: Mapping['component'];
  stateTopic: string;
  valuePath: string;
  unit: string;
  deviceClass: string;
  commandTopic: string;
  payloadOn: string;
  payloadOff: string;
};

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

/**
 * Renders the mappings.
 *
 * @returns The panel.
 */
export function MappingsPanel() {
  const mappings = usePackageRpc<Mapping[]>('mappings');
  const call = usePackageCall();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);
  const list = mappings.data ?? [];

  /**
   * Changes one field of the draft.
   *
   * @param key - Which.
   * @returns The handler.
   */
  const set =
    (key: keyof Draft) =>
    (value: string): void => {
      setDraft((current) => (current === null ? current : { ...current, [key]: value }));
    };

  /** Saves the draft. */
  const save = (): void => {
    if (draft === null) {
      return;
    }

    setBusy(true);
    setProblem(null);
    call('saveMapping', {
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
    })
      .then(() => {
        setDraft(null);
        mappings.refetch();
      })
      .catch((error: unknown) => {
        setProblem(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  /**
   * Removes a mapping.
   *
   * @param id - Which.
   */
  const remove = (id: string): void => {
    call('removeMapping', { id })
      .then(() => {
        mappings.refetch();
      })
      .catch((error: unknown) => {
        setProblem(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <Panel
      title={`Mapped by hand · ${String(list.length)}`}
      action={
        <Button
          variant="ghost"
          size="compact"
          onClick={() => {
            setProblem(null);
            setDraft(EMPTY);
          }}
        >
          Map a topic
        </Button>
      }
    >
      {list.map((mapping) => (
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
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                remove(mapping.id);
              }}
            >
              Remove
            </Button>
          }
        />
      ))}

      {list.length === 0 ? (
        <PanelNote>
          A device that does not announce itself is mapped here from the topic it publishes on.
        </PanelNote>
      ) : null}
      {problem === null || draft !== null ? null : <PanelNote>{problem}</PanelNote>}

      <Modal
        isOpen={draft !== null}
        onClose={() => {
          setDraft(null);
        }}
        title="Map a topic"
        description="What the device publishes, read into an entity of the house."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
              }}
            >
              Cancel
            </Button>
            <Button
              isBusy={isBusy}
              disabled={draft === null || draft.name === '' || draft.stateTopic === '' || isBusy}
              onClick={save}
            >
              Save
            </Button>
          </>
        }
      >
        {draft === null ? null : (
          <div className="flex flex-col gap-4">
            <TextField
              label="Name"
              value={draft.name}
              placeholder="Garden temperature"
              onChange={(event) => {
                set('name')(event.target.value);
              }}
            />
            <SelectField
              label="Is a"
              options={COMPONENTS}
              value={draft.component}
              onChange={(value) => {
                set('component')(value);
              }}
            />
            <TextField
              label="State topic"
              value={draft.stateTopic}
              placeholder="tele/garden/SENSOR"
              onChange={(event) => {
                set('stateTopic')(event.target.value);
              }}
            />
            <TextField
              label="Value in the JSON"
              value={draft.valuePath}
              placeholder="AM2301.Temperature"
              hint="Keys separated by dots; empty when the payload is the value itself."
              onChange={(event) => {
                set('valuePath')(event.target.value);
              }}
            />
            {draft.component === 'sensor' ? (
              <TextField
                label="Unit"
                value={draft.unit}
                placeholder="°C"
                onChange={(event) => {
                  set('unit')(event.target.value);
                }}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="On is"
                  value={draft.payloadOn}
                  onChange={(event) => {
                    set('payloadOn')(event.target.value);
                  }}
                />
                <TextField
                  label="Off is"
                  value={draft.payloadOff}
                  onChange={(event) => {
                    set('payloadOff')(event.target.value);
                  }}
                />
              </div>
            )}
            {draft.component === 'switch' ? (
              <TextField
                label="Command topic"
                value={draft.commandTopic}
                placeholder="cmnd/pump/POWER"
                hint="Where on and off are published; empty for a switch that is only read."
                onChange={(event) => {
                  set('commandTopic')(event.target.value);
                }}
              />
            ) : null}
            {problem === null ? null : (
              <p role="alert" className="text-ui text-danger">
                {problem}
              </p>
            )}
          </div>
        )}
      </Modal>
    </Panel>
  );
}
