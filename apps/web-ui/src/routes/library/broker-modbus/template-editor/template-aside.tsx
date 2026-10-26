/**
 * The cards at the editor's side, in both views: the template's own fields, the device the tests
 * read from, and what each function code reads or writes.
 *
 * The test device is picked from a list of its own: the devices that use this template, then the
 * servers the network search found, then another address typed. Read all reads every entity once
 * from it, and the blocks show what came back.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MODBUS_PORT,
  type ModbusDevice,
  type ModbusFound,
  type ModbusTarget,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  cn,
  Popover,
  Segmented,
  SelectField,
  StatusDot,
  TextField,
} from '@nebulahome/ui';

import { text } from '@/i18n/messages';

import { fcText, FUNCTION_NAMES } from './template-meta';
import type { Problems, TemplateDraft } from './template-model';

/** A device the tests may read from, as the picker lists it. */
export type TestChoice = {
  readonly key: string;
  readonly name: string;
  readonly target: ModbusTarget;
  readonly group: 'uses' | 'found';
  readonly isOnline: boolean | null;
};

/**
 * The devices the tests may read from: those using the template, then the servers found.
 *
 * @param templateId - The template, when it is saved.
 * @param devices - Every Modbus device.
 * @param found - The servers found.
 * @param unknown - What a server nobody named is called.
 * @returns The choices.
 */
export function testChoicesOf(
  templateId: string | undefined,
  devices: readonly ModbusDevice[],
  found: readonly ModbusFound[],
  unknown: string,
): TestChoice[] {
  return [
    ...devices
      .filter((device) => device.template === templateId)
      .map((device): TestChoice => ({
        key: device.id,
        name: device.name,
        target: {
          host: device.host,
          port: device.port,
          unitId: device.unitId,
          framing: device.framing,
        },
        group: 'uses',
        isOnline: device.state === 'waiting' ? null : device.state === 'online',
      })),
    ...found.map((server): TestChoice => ({
      key: `${server.host}:${String(server.port)}`,
      name: server.claims[0]?.model ?? server.claims[0]?.vendorName ?? unknown,
      target: { host: server.host, port: server.port, unitId: 1, framing: 'tcp' },
      group: 'found',
      isOnline: null,
    })),
  ];
}

/** What the side cards need. */
export type TemplateAsideProps = {
  readonly draft: TemplateDraft;
  readonly problems: Problems;

  /** Whether the template's fields may be changed: not while the file does not parse. */
  readonly isLocked: boolean;
  readonly onChange: (draft: TemplateDraft) => void;
  readonly choices: readonly TestChoice[];
  readonly target: ModbusTarget | null;
  readonly onTarget: (target: ModbusTarget) => void;

  /** When Read all last read, or null. */
  readonly readAt: Date | null;
  readonly isReading: boolean;
  readonly onReadAll: () => void;
};

/**
 * Renders the side cards.
 *
 * @param props - See {@link TemplateAsideProps}.
 * @returns The cards.
 */
export function TemplateAside(props: TemplateAsideProps) {
  const { t } = useTranslation();
  const { draft, problems, isLocked, onChange } = props;

  /**
   * Changes one field of the template.
   *
   * @param field - Which.
   * @param value - What it holds now.
   */
  const set = (field: keyof TemplateDraft, value: string): void => {
    onChange({ ...draft, [field]: value });
  };

  return (
    <aside className="flex flex-col gap-3.5 lg:sticky lg:top-6 lg:self-start">
      <Card title={t('brokers.modbus.templateCard', 'Template')}>
        <fieldset disabled={isLocked} className="flex flex-col gap-3">
          <TextField
            label={t('brokers.modbus.templateName', 'Name')}
            value={draft.name}
            error={problems.get('name')}
            onChange={(event) => {
              set('name', event.target.value);
            }}
          />
          <TextField
            label={t('brokers.modbus.device', 'Device')}
            placeholder={t('brokers.modbus.devicePlaceholder', 'Maker and model')}
            value={draft.device}
            error={problems.get('device')}
            onChange={(event) => {
              set('device', event.target.value);
            }}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t('brokers.modbus.port', 'Port')}
              inputMode="numeric"
              value={draft.port}
              error={problems.get('port')}
              onChange={(event) => {
                set('port', event.target.value.trim());
              }}
            />
            <TextField
              label={t('brokers.modbus.unitId', 'Unit ID')}
              inputMode="numeric"
              value={draft.unitId}
              error={problems.get('unitId')}
              onChange={(event) => {
                set('unitId', event.target.value.trim());
              }}
            />
          </div>
          <TextField
            label={t('brokers.modbus.polling', 'Polling')}
            inputMode="numeric"
            value={draft.pollSeconds}
            trail={t('brokers.modbus.seconds', 'seconds')}
            error={problems.get('pollSeconds')}
            onChange={(event) => {
              set('pollSeconds', event.target.value.trim());
            }}
          />
          <SelectField
            label={t('brokers.modbus.words', '32-bit values')}
            value={draft.wordOrder}
            options={[
              { value: 'high', label: t('brokers.modbus.highFirst', 'High word first') },
              { value: 'low', label: t('brokers.modbus.lowFirst', 'Low word first') },
            ]}
            onChange={(value) => {
              set('wordOrder', value);
            }}
          />
        </fieldset>
      </Card>

      <TestDeviceCard {...props} />

      <Card title={t('brokers.modbus.functionCodes', 'Function codes')}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          {([1, 2, 3, 4, 5, 6, 15, 16] as const).map((fn) => (
            <div key={fn} className="contents">
              <dt className="font-mono text-mono-caption text-cyan">{fcText(fn)}</dt>
              <dd className="text-ui-sm text-foreground-muted">{text(FUNCTION_NAMES[fn])}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </aside>
  );
}

/**
 * One card at the side: its title, then what is in it.
 *
 * @param props - The title and the content.
 * @param props.title - The title.
 * @param props.children - The content.
 * @returns The card.
 */
function Card(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface px-4 py-3.5">
      <h2 className="font-mono text-label text-foreground-subtle uppercase">{props.title}</h2>
      {props.children}
    </section>
  );
}

/**
 * The device the tests read from: a picker of its own, and Read all.
 *
 * @param props - The side cards' props.
 * @returns The card.
 */
function TestDeviceCard(props: TemplateAsideProps) {
  const { t } = useTranslation();
  const { choices, target, onTarget } = props;
  const anchor = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [isTyping, setTyping] = useState(false);
  const [host, setHost] = useState(target?.host ?? '');
  const [port, setPort] = useState(String(target?.port ?? MODBUS_PORT));
  const [unit, setUnit] = useState(String(target?.unitId ?? 1));
  const [framing, setFraming] = useState<'tcp' | 'rtu'>(target?.framing ?? 'tcp');
  const picked = choices.find(
    (choice) =>
      target !== null &&
      choice.target.host === target.host &&
      choice.target.port === target.port &&
      choice.target.unitId === target.unitId,
  );
  const groups = [
    { id: 'uses', label: t('brokers.modbus.usesTemplate', 'Uses this template') },
    { id: 'found', label: t('brokers.modbus.foundTitle', 'Found on the network') },
  ] as const;

  return (
    <Card title={t('brokers.modbus.testDevice', 'Test device')}>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2.5 rounded-field border border-border-strong bg-surface-raised px-3 py-2 text-left hover:border-primary"
        onClick={() => {
          setOpen(!isOpen);
        }}
      >
        <StatusDot
          tone={
            picked?.isOnline === true
              ? 'success'
              : picked?.isOnline === false
                ? 'danger'
                : 'neutral'
          }
          title={
            picked?.isOnline === true
              ? t('brokers.modbus.online', 'Online')
              : picked?.isOnline === false
                ? t('brokers.modbus.noAnswer', 'No answer')
                : t('brokers.modbus.notKnown', 'Not known yet')
          }
        />
        <span className="flex min-w-0 grow flex-col">
          <span className="truncate text-ui font-medium text-foreground">
            {target === null
              ? t('brokers.modbus.pickTestDevice', 'Pick a device')
              : (picked?.name ?? t('brokers.modbus.anotherAddress', 'Another address'))}
          </span>
          {target === null ? null : (
            <span className="truncate font-mono text-mono-caption text-foreground-muted">
              {target.host} · {t('brokers.modbus.unit', 'unit {{unit}}', { unit: target.unitId })}
            </span>
          )}
        </span>
        <AppIcon id="chevron-down" size={15} className="text-foreground-subtle" />
      </button>
      <Popover
        anchor={anchor}
        isOpen={isOpen}
        onClose={() => {
          setOpen(false);
        }}
        label={t('brokers.modbus.testDevice', 'Test device')}
      >
        <div role="listbox" className="flex flex-col py-1.5">
          {groups.map((group) => {
            const inGroup = choices.filter((choice) => choice.group === group.id);

            return inGroup.length === 0 ? null : (
              <div key={group.id} className="flex flex-col">
                <span className="px-3 pt-2 pb-1 font-mono text-label text-foreground-subtle uppercase">
                  {group.label}
                </span>
                {inGroup.map((choice) => (
                  <button
                    key={choice.key}
                    type="button"
                    role="option"
                    aria-selected={choice === picked}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-high',
                      choice === picked && 'bg-surface-high',
                    )}
                    onClick={() => {
                      onTarget(choice.target);
                      setTyping(false);
                      setOpen(false);
                    }}
                  >
                    <span className="flex min-w-0 grow flex-col">
                      <span className="truncate text-ui text-foreground">{choice.name}</span>
                      <span className="truncate font-mono text-mono-caption text-foreground-muted">
                        {choice.target.host} ·{' '}
                        {t('brokers.modbus.unit', 'unit {{unit}}', { unit: choice.target.unitId })}
                        {choice.group === 'found'
                          ? ` · ${t('brokers.modbus.notAdded', 'not added')}`
                          : ''}
                      </span>
                    </span>
                    {choice === picked ? (
                      <AppIcon id="check" size={14} className="text-primary" />
                    ) : null}
                  </button>
                ))}
              </div>
            );
          })}
          <button
            type="button"
            className="mt-1 flex items-center gap-2 border-t border-border px-3 py-2.5 text-left text-ui text-foreground-muted hover:bg-surface-high"
            onClick={() => {
              setTyping(true);
              setOpen(false);
            }}
          >
            <AppIcon id="plus" size={14} />
            {t('brokers.modbus.anotherAddressDots', 'Another address…')}
          </button>
        </div>
      </Popover>

      {isTyping ? (
        <div className="flex flex-col gap-2.5">
          <TextField
            label={t('brokers.modbus.address', 'Address')}
            className="font-mono"
            value={host}
            onChange={(event) => {
              setHost(event.target.value.trim());
            }}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <TextField
              label={t('brokers.modbus.port', 'Port')}
              inputMode="numeric"
              value={port}
              onChange={(event) => {
                setPort(event.target.value.trim());
              }}
            />
            <TextField
              label={t('brokers.modbus.unitId', 'Unit ID')}
              inputMode="numeric"
              value={unit}
              onChange={(event) => {
                setUnit(event.target.value.trim());
              }}
            />
          </div>
          <Segmented
            label={t('brokers.modbus.framing', 'Framing')}
            value={framing}
            onChange={setFraming}
            options={[
              { value: 'tcp', label: 'TCP' },
              { value: 'rtu', label: t('brokers.modbus.rtuOverTcp', 'RTU over TCP') },
            ]}
          />
          <Button
            variant="ghost"
            disabled={
              host === '' ||
              !(Number(port) >= 1 && Number(port) <= 65_535) ||
              !(Number(unit) >= 1 && Number(unit) <= 247)
            }
            onClick={() => {
              onTarget({ host, port: Number(port), unitId: Number(unit), framing });
              setTyping(false);
            }}
          >
            {t('brokers.modbus.useAddress', 'Use this address')}
          </Button>
        </div>
      ) : null}

      <div className="flex items-center gap-3 border-t border-border pt-3">
        <span className="flex min-w-0 grow flex-col">
          <span className="text-ui-sm text-foreground">
            {t('brokers.modbus.valuesOnBlocks', 'Values on the blocks')}
          </span>
          <span className="text-caption text-foreground-subtle">
            {props.readAt === null
              ? t('brokers.modbus.notReadYet', 'Not read yet')
              : t('brokers.modbus.readAt', 'Read at {{time}}', {
                  time: props.readAt.toLocaleTimeString(),
                })}
          </span>
        </span>
        <Button
          variant="ghost"
          size="compact"
          isBusy={props.isReading}
          disabled={target === null || props.isReading}
          onClick={props.onReadAll}
        >
          {t('brokers.modbus.readAll', 'Read all')}
        </Button>
      </div>
    </Card>
  );
}
