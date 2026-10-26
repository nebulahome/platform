/**
 * One entity of a template, as a block: its name and id, its domain, and each capability's read
 * and write side by side - the read alone, across, when the capability is only read.
 *
 * Each capability has a Test that opens right under its header: the read it makes, the bytes the
 * device answered and the value they mean; and, for a capability that is written, the command
 * sent and what the device echoed. A value outside min and max is refused before anything is
 * sent. A problem shows under the field it is about, in the contract's words; an address written
 * the way a manual numbers registers says which register it means.
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  modbusEntitySchema,
  modbusReadSchema,
  modbusRegistersOf,
  modbusWordOf,
  type ModbusCapability,
  type ModbusTarget,
  type ModbusValueType,
} from '@nebulahome/contracts';
import { AppIcon, Button, cn, IconButton, SelectField, TextField } from '@nebulahome/ui';

import { text } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { testModbusRead, testModbusWrite } from '@/library/modbus-api';

import { capabilityLine, domainLooks, fcText, FUNCTION_LINES } from './template-meta';
import {
  capabilityDefaults,
  documentOf,
  emptyTemplate,
  idOfEntity,
  manualNumberingOf,
  type CapabilityDraft,
  type EntityDraft,
  type Problems,
  type ReadDraft,
  type WriteDraft,
} from './template-model';

/** A value read by Read all, or why it was not. */
export type LiveValue = {
  readonly value: number | string | boolean | null;
  readonly error: string | null;
};

/** What a block needs. */
export type EntityBlockProps = {
  readonly entity: EntityDraft;
  readonly index: number;
  readonly problems: Problems;
  readonly wordOrder: 'high' | 'low';

  /** The device tests read from; null until one is picked. */
  readonly target: ModbusTarget | null;

  /** What Read all read, by `<entity key>:<capability>`. */
  readonly live: ReadonlyMap<string, LiveValue>;
  readonly onChange: (entity: EntityDraft) => void;
  readonly onRemove: () => void;
};

/** The value types a register read may be, with the registers each takes. */
const VALUE_TYPES: readonly ModbusValueType[] = ['u16', 's16', 'u32', 's32', 'f32', 'string'];

/** The capabilities whose value is on or off. */
const BOOLEAN: ReadonlySet<ModbusCapability> = new Set(['sensor_binary', 'on_off']);

/**
 * A value as a pill or a test shows it.
 *
 * @param value - The value.
 * @param unit - Its unit, when it has one.
 * @param t - Translates.
 * @returns The words.
 */
function shown(
  value: number | string | boolean | null,
  unit: string,
  t: (key: string, fallback: string) => string,
): string {
  if (value === null) {
    return '—';
  }

  if (typeof value === 'boolean') {
    return value ? t('brokers.modbus.on', 'On') : t('brokers.modbus.off', 'Off');
  }

  return unit === '' ? String(value) : `${String(value)} ${unit}`;
}

/**
 * Renders a block.
 *
 * @param props - See {@link EntityBlockProps}.
 * @returns The block.
 */
export function EntityBlock(props: EntityBlockProps) {
  const { t } = useTranslation();
  const { entity, index, problems, onChange, onRemove } = props;
  const look = domainLooks()[entity.domain];
  const base = `entities.${String(index)}`;
  const capabilities = Object.entries(entity.capabilities) as [ModbusCapability, CapabilityDraft][];
  const [first] = capabilities;
  const primary = first === undefined ? undefined : props.live.get(`${entity.key}:${first[0]}`);
  const blockProblem =
    problems.get(`${base}.capabilities`) ?? problems.get(base) ?? problems.get(`${base}.id`);

  /**
   * Replaces one capability.
   *
   * @param capability - Which.
   * @param map - Its read and write, or null to take it away.
   * @param renamed - The capability it becomes, for a sensor turned from a number to a text.
   */
  const setCapability = (
    capability: ModbusCapability,
    map: CapabilityDraft | null,
    renamed?: ModbusCapability,
  ): void => {
    const next = Object.fromEntries(
      Object.entries(entity.capabilities).flatMap(([each, value]) =>
        each !== capability ? [[each, value]] : map === null ? [] : [[renamed ?? each, map]],
      ),
    );

    onChange({ ...entity, capabilities: next });
  };

  return (
    <section
      aria-label={entity.name === '' ? look.label : entity.name}
      className="overflow-hidden rounded-card border border-border bg-surface"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4.5 py-3">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-field',
            look.tint,
          )}
        >
          <AppIcon id={look.icon} size={16} />
        </span>
        <div className="min-w-36 flex-1 basis-40">
          <TextField
            label={t('brokers.modbus.entityName', 'Name')}
            isLabelHidden
            size="compact"
            value={entity.name}
            placeholder={look.label}
            error={problems.get(`${base}.name`)}
            onChange={(event) => {
              onChange({ ...entity, name: event.target.value });
            }}
          />
        </div>
        <span className="min-w-0 truncate font-mono text-mono-caption text-foreground-subtle">
          {entity.domain}.{idOfEntity(entity)}
        </span>
        <span className={cn('shrink-0 rounded-pill px-2 py-0.5 text-caption', look.tint)}>
          {look.label}
        </span>
        {primary === undefined ? null : (
          <span
            title={primary.error ?? undefined}
            className={cn(
              'rounded-pill border border-border-strong px-2.5 py-0.5 font-mono text-mono-caption',
              primary.error === null ? 'text-foreground' : 'text-danger',
            )}
          >
            {primary.error === null
              ? shown(primary.value, first?.[1].read?.unit ?? '', t)
              : t('brokers.modbus.noValue', 'No value')}
          </span>
        )}
        <IconButton
          className="ml-auto"
          label={t('brokers.modbus.removeEntity', 'Remove {{name}}', {
            name: entity.name === '' ? look.label : entity.name,
          })}
          onClick={onRemove}
        >
          <AppIcon id="trash-2" size={15} />
        </IconButton>
      </header>

      {capabilities.map(([capability, map]) => (
        <CapabilitySection
          key={capability}
          entity={entity}
          capability={capability}
          map={map}
          path={`${base}.capabilities.${capability}`}
          problems={problems}
          wordOrder={props.wordOrder}
          target={props.target}
          live={props.live.get(`${entity.key}:${capability}`)}
          onChange={(next, renamed) => {
            setCapability(capability, next, renamed);
          }}
          {...(entity.domain === 'light' && capability === 'level'
            ? {
                /** Takes the level away: the light only switches. */
                onRemove: () => {
                  setCapability(capability, null);
                },
              }
            : {})}
        />
      ))}

      {entity.domain === 'light' && entity.capabilities.level === undefined ? (
        <div className="border-t border-border px-4.5 py-2.5">
          <Button
            variant="bare"
            size="compact"
            onClick={() => {
              onChange({
                ...entity,
                capabilities: { ...entity.capabilities, level: capabilityDefaults('level') },
              });
            }}
          >
            <AppIcon id="plus" size={14} />
            {t('brokers.modbus.addLevel', 'Add level')}
          </Button>
        </div>
      ) : null}

      {blockProblem === undefined ? null : (
        <p role="alert" className="border-t border-border px-4.5 py-2.5 text-ui-sm text-danger">
          {blockProblem}
        </p>
      )}
    </section>
  );
}

/** What a capability's section needs. */
type CapabilitySectionProps = {
  readonly entity: EntityDraft;
  readonly capability: ModbusCapability;
  readonly map: CapabilityDraft;
  readonly path: string;
  readonly problems: Problems;
  readonly wordOrder: 'high' | 'low';
  readonly target: ModbusTarget | null;
  readonly live: LiveValue | undefined;
  readonly onChange: (map: CapabilityDraft, renamed?: ModbusCapability) => void;
  readonly onRemove?: () => void;
};

/**
 * One capability: its header with the test, the test when open, then its read and its write.
 *
 * @param props - See {@link CapabilitySectionProps}.
 * @returns The section.
 */
function CapabilitySection(props: CapabilitySectionProps) {
  const { t } = useTranslation();
  const { capability, map, path, problems, onChange } = props;
  const [isTesting, setTesting] = useState(false);
  const isSensor = capability === 'sensor_numeric' || capability === 'sensor_text';
  const isReadOnly = map.write === null;

  return (
    <div className="border-t border-border first-of-type:border-t-0">
      <div className="flex flex-wrap items-center gap-2.5 px-4.5 pt-3.5">
        {isSensor ? (
          <div className="w-44">
            <SelectField
              label={t('brokers.modbus.capability', 'Capability')}
              isLabelHidden
              value={capability}
              options={[
                { value: 'sensor_numeric', label: 'sensor_numeric' },
                { value: 'sensor_text', label: 'sensor_text' },
              ]}
              onChange={(value) => {
                const next = value as ModbusCapability;

                if (next !== capability) {
                  onChange(capabilityDefaults(next), next);
                }
              }}
            />
          </div>
        ) : (
          <span className="rounded-pill bg-primary-soft px-2.5 py-0.5 font-mono text-mono-caption text-primary-hover">
            {capability}
          </span>
        )}
        <span className="text-ui-sm text-foreground-muted">{capabilityLine(capability)}</span>
        {isReadOnly ? (
          <span className="inline-flex items-center gap-1 rounded-pill border border-border-strong px-2 py-0.5 text-caption text-foreground-subtle">
            <AppIcon id="lock" size={11} />
            {t('brokers.modbus.readOnly', 'Read only')}
          </span>
        ) : null}
        <span className="grow" />
        <Button
          variant={isTesting ? 'ghost' : 'bare'}
          size="compact"
          aria-expanded={isTesting}
          onClick={() => {
            setTesting(!isTesting);
          }}
        >
          <AppIcon id="play" size={13} />
          {t('brokers.modbus.test', 'Test')}
        </Button>
        {props.onRemove === undefined ? null : (
          <IconButton
            label={t('brokers.modbus.removeCapability', 'Remove {{capability}}', { capability })}
            size="small"
            onClick={props.onRemove}
          >
            <AppIcon id="x" size={13} />
          </IconButton>
        )}
      </div>

      {isTesting ? <TestPanel {...props} /> : null}

      <div
        className={cn(
          'grid gap-4 px-4.5 pt-3 pb-4',
          map.read !== null && map.write !== null && 'md:grid-cols-2',
        )}
      >
        {map.read === null ? null : (
          <ReadFields
            capability={capability}
            read={map.read}
            path={`${path}.read`}
            problems={problems}
            isWide={map.write === null}
            onChange={(read) => {
              onChange({ ...map, read });
            }}
          />
        )}
        {map.write === null ? null : (
          <WriteFields
            capability={capability}
            write={map.write}
            read={map.read}
            path={`${path}.write`}
            problems={problems}
            onChange={(write) => {
              onChange({ ...map, write });
            }}
          />
        )}
      </div>
      {(problems.get(`${path}.read`) ?? problems.get(`${path}.write`) ?? problems.get(path)) ? (
        <p role="alert" className="px-4.5 pb-3 text-ui-sm text-danger">
          {problems.get(`${path}.read`) ?? problems.get(`${path}.write`) ?? problems.get(path)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The column a side of a capability is: its title, then its fields.
 *
 * @param props - The title and the fields.
 * @param props.title - `Read`, `Write`.
 * @param props.children - The fields.
 * @param props.className - The caller's classes.
 * @returns The column.
 */
function Side(props: {
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-3', props.className)}>
      <legend className="mb-2 font-mono text-label text-foreground-subtle uppercase">
        {props.title}
      </legend>
      {props.children}
    </fieldset>
  );
}

/** What a read's fields need. */
type ReadFieldsProps = {
  readonly capability: ModbusCapability;
  readonly read: ReadDraft;
  readonly path: string;
  readonly problems: Problems;

  /** Across the block: the capability is only read. */
  readonly isWide: boolean;
  readonly onChange: (read: ReadDraft) => void;
};

/**
 * Where a capability's value is read from, and how it is turned into one.
 *
 * @param props - See {@link ReadFieldsProps}.
 * @returns The fields.
 */
function ReadFields(props: ReadFieldsProps) {
  const { t } = useTranslation();
  const { capability, read, path, problems, isWide, onChange } = props;
  const isBits = read.function === 1 || read.function === 2;
  const isBoolean = BOOLEAN.has(capability);
  const manual = manualNumberingOf(read.function, read.address);

  /**
   * Changes one field.
   *
   * @param field - Which.
   * @param value - What it holds now.
   */
  const set = (field: keyof ReadDraft, value: string | number): void => {
    onChange({ ...read, [field]: value });
  };

  return (
    <Side title={t('brokers.modbus.read', 'Read')}>
      <div className={cn('grid gap-3', isWide ? 'sm:grid-cols-4' : 'sm:grid-cols-2')}>
        <div className={isWide ? 'sm:col-span-2' : 'sm:col-span-2'}>
          <SelectField
            label={t('brokers.modbus.function', 'Function')}
            value={String(read.function)}
            options={[1, 2, 3, 4].map((fn) => ({
              value: String(fn),
              label: `${fcText(fn)} · ${text(FUNCTION_LINES[fn as 1]).split(':')[0] ?? ''}`,
            }))}
            hint={text(FUNCTION_LINES[read.function as 1])}
            error={problems.get(`${path}.function`)}
            onChange={(value) => {
              const fn = Number(value);

              onChange({
                ...read,
                function: fn,
                ...(fn === 1 || fn === 2 ? { type: '', bit: '', count: '', scale: '' } : {}),
              });
            }}
          />
        </div>
        <TextField
          label={t('brokers.modbus.address', 'Address')}
          value={read.address}
          className="font-mono"
          error={problems.get(`${path}.address`)}
          hint={
            manual === undefined
              ? undefined
              : t(
                  'brokers.modbus.manualNumbering',
                  'Manual numbering: {{typed}} is register {{register}}. Write {{register}} if that is what you meant.',
                  manual,
                )
          }
          onChange={(event) => {
            set('address', event.target.value);
          }}
        />
        {isBits ? null : (
          <SelectField
            label={t('brokers.modbus.type', 'Type')}
            value={read.type === '' ? 'u16' : read.type}
            options={VALUE_TYPES.map((type) => ({
              value: type,
              label:
                type === 'string'
                  ? t('brokers.modbus.typeString', 'string · text')
                  : t('brokers.modbus.typeRegisters', '{{type}} · {{count}} reg', {
                      type,
                      count: modbusRegistersOf(type),
                    }),
            }))}
            error={problems.get(`${path}.type`)}
            onChange={(value) => {
              onChange({
                ...read,
                type: value === 'u16' ? '' : value,
                count: value === 'string' ? (read.count === '' ? '8' : read.count) : '',
              });
            }}
          />
        )}
        {!isBits && isBoolean ? (
          <TextField
            label={t('brokers.modbus.bit', 'Bit')}
            inputMode="numeric"
            placeholder="0–15"
            value={read.bit}
            error={problems.get(`${path}.bit`)}
            onChange={(event) => {
              set('bit', event.target.value.trim());
            }}
          />
        ) : null}
        {read.type === 'string' ? (
          <TextField
            label={t('brokers.modbus.registers', 'Registers')}
            inputMode="numeric"
            value={read.count}
            error={problems.get(`${path}.count`)}
            onChange={(event) => {
              set('count', event.target.value.trim());
            }}
          />
        ) : null}
        {!isBits && !isBoolean && read.type !== 'string' && capability !== 'select' ? (
          <TextField
            label={t('brokers.modbus.scale', 'Scale')}
            inputMode="decimal"
            placeholder="1"
            value={read.scale}
            error={problems.get(`${path}.scale`)}
            onChange={(event) => {
              set('scale', event.target.value.trim());
            }}
          />
        ) : null}
        {capability === 'sensor_numeric' || capability === 'number' ? (
          <TextField
            label={t('brokers.modbus.unitField', 'Unit')}
            placeholder="W"
            translate="no"
            value={read.unit}
            error={problems.get(`${path}.unit`)}
            onChange={(event) => {
              set('unit', event.target.value);
            }}
          />
        ) : null}
        {capability === 'select' || (capability === 'sensor_text' && read.type !== 'string') ? (
          <div className="sm:col-span-2">
            <TextField
              label={t('brokers.modbus.options', 'Options')}
              placeholder={t('brokers.modbus.optionsPlaceholder', '0=Off, 1=Eco')}
              value={read.options}
              error={problems.get(`${path}.options`)}
              onChange={(event) => {
                set('options', event.target.value);
              }}
            />
          </div>
        ) : null}
      </div>
    </Side>
  );
}

/** What a write's fields need. */
type WriteFieldsProps = {
  readonly capability: ModbusCapability;
  readonly write: WriteDraft;
  readonly read: ReadDraft | null;
  readonly path: string;
  readonly problems: Problems;
  readonly onChange: (write: WriteDraft) => void;
};

/**
 * What a capability's command writes, and within what.
 *
 * @param props - See {@link WriteFieldsProps}.
 * @returns The fields.
 */
function WriteFields(props: WriteFieldsProps) {
  const { t } = useTranslation();
  const { capability, write, read, path, problems, onChange } = props;
  const isAddressNeeded = read === null || read.function === 2 || read.function === 4;
  const hasLimits = capability === 'number' || capability === 'level';

  /**
   * Changes one field.
   *
   * @param field - Which.
   * @param value - What it holds now.
   */
  const set = (field: keyof WriteDraft, value: string | number): void => {
    onChange({ ...write, [field]: value });
  };

  return (
    <Side title={t('brokers.modbus.write', 'Write')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <SelectField
            label={t('brokers.modbus.function', 'Function')}
            value={String(write.function)}
            options={[5, 6, 15, 16].map((fn) => ({
              value: String(fn),
              label: `${fcText(fn)} · ${text(FUNCTION_LINES[fn as 5]).split(':')[0] ?? ''}`,
            }))}
            hint={text(FUNCTION_LINES[write.function as 5])}
            error={problems.get(`${path}.function`)}
            onChange={(value) => {
              set('function', Number(value));
            }}
          />
        </div>
        <div className="sm:col-span-2">
          <TextField
            label={t('brokers.modbus.address', 'Address')}
            value={write.address}
            className="font-mono"
            placeholder={
              isAddressNeeded
                ? t('brokers.modbus.required', 'Required')
                : t('brokers.modbus.sameAsRead', 'Same as read, {{address}}', {
                    address: read.address,
                  })
            }
            error={problems.get(`${path}.address`)}
            onChange={(event) => {
              set('address', event.target.value);
            }}
          />
        </div>
        {capability === 'on_off' ? (
          <>
            <TextField
              label={t('brokers.modbus.onWord', 'On')}
              className="font-mono"
              placeholder={write.function === 5 ? '0xFF00' : '1'}
              translate="no"
              value={write.on}
              error={problems.get(`${path}.on`)}
              onChange={(event) => {
                set('on', event.target.value);
              }}
            />
            <TextField
              label={t('brokers.modbus.offWord', 'Off')}
              className="font-mono"
              placeholder="0x0000"
              translate="no"
              value={write.off}
              error={problems.get(`${path}.off`)}
              onChange={(event) => {
                set('off', event.target.value);
              }}
            />
          </>
        ) : null}
        {capability === 'button' ? (
          <TextField
            label={t('brokers.modbus.value', 'Value')}
            className="font-mono"
            placeholder={write.function === 5 || write.function === 15 ? '0xFF00' : '1'}
            translate="no"
            value={write.value}
            error={problems.get(`${path}.value`)}
            onChange={(event) => {
              set('value', event.target.value);
            }}
          />
        ) : null}
      </div>
      {hasLimits ? (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-3 gap-3">
            <TextField
              label={t('brokers.modbus.min', 'Min')}
              inputMode="decimal"
              value={write.min}
              error={problems.get(`${path}.min`)}
              onChange={(event) => {
                set('min', event.target.value.trim());
              }}
            />
            <TextField
              label={t('brokers.modbus.max', 'Max')}
              inputMode="decimal"
              value={write.max}
              error={problems.get(`${path}.max`)}
              onChange={(event) => {
                set('max', event.target.value.trim());
              }}
            />
            {capability === 'number' ? (
              <TextField
                label={t('brokers.modbus.step', 'Step')}
                inputMode="decimal"
                placeholder="1"
                value={write.step}
                error={problems.get(`${path}.step`)}
                onChange={(event) => {
                  set('step', event.target.value.trim());
                }}
              />
            ) : null}
          </div>
          <span className="text-ui-sm text-foreground-subtle">
            {capability === 'level'
              ? t(
                  'brokers.modbus.levelLimits',
                  '0 % writes min, 100 % writes max, in the read’s units.',
                )
              : t(
                  'brokers.modbus.limitsLine',
                  'Anything outside min and max is refused before it reaches the device.',
                )}
          </span>
        </div>
      ) : null}
    </Side>
  );
}

/**
 * The test of one capability, open right under its header: what a read asks and gets, and for a
 * capability that is written, what a command sends and what comes back.
 *
 * @param props - The capability's section's props.
 * @returns The panel.
 */
function TestPanel(props: CapabilitySectionProps) {
  const { t } = useTranslation();
  const { entity, capability, map, target, wordOrder } = props;
  const [typed, setTyped] = useState('');
  const document = documentOf({ ...emptyTemplate(), name: 'test', entities: [entity] });
  const parsedEntity = modbusEntitySchema.safeParse(document.entities[0]);
  const parsedRead =
    map.read === null
      ? null
      : modbusReadSchema.safeParse(
          (document.entities[0]?.capabilities as Record<string, { read?: unknown }> | undefined)?.[
            capability
          ]?.read,
        );
  const read = useMutation({ mutationFn: testModbusRead });
  const write = useMutation({ mutationFn: testModbusWrite });
  const readData = parsedRead?.success === true ? parsedRead.data : null;
  const count =
    readData === null
      ? 0
      : readData.function <= 2
        ? 1
        : modbusRegistersOf(readData.type ?? 'u16', readData.count);
  const options = Object.entries(readData?.options ?? {});
  const readReply = read.data;
  const readFailure = read.error === null ? (readReply?.error ?? null) : toMessage(read.error);
  const writeReply = write.data;
  const writeFailure = write.error === null ? (writeReply?.error ?? null) : toMessage(write.error);

  /**
   * Sends a command.
   *
   * @param command - The command, as the capability takes it.
   */
  const send = (command: Record<string, unknown>): void => {
    if (target !== null && parsedEntity.success) {
      write.mutate({ target, entity: parsedEntity.data, capability, command, wordOrder });
    }
  };

  if (target === null) {
    return (
      <p className="mx-4.5 mt-3 rounded-inner border border-dashed border-border-strong px-3.5 py-2.5 text-ui-sm text-foreground-muted">
        {t('brokers.modbus.pickDevice', 'Pick a test device in the card at the side first.')}
      </p>
    );
  }

  return (
    <div className="mx-4.5 mt-3 flex flex-col gap-3 rounded-inner border border-border bg-surface-raised px-3.5 py-3">
      {map.read === null ? null : (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-mono-caption text-foreground-muted">
              {readData === null
                ? t('brokers.modbus.readIncomplete', 'The read is not complete yet')
                : [
                    t('brokers.modbus.unit', 'unit {{unit}}', { unit: target.unitId }),
                    `FC ${fcText(readData.function)}`,
                    `0x${modbusWordOf(readData.address).toString(16).toUpperCase().padStart(4, '0')}`,
                    readData.function <= 2
                      ? t('brokers.modbus.bits', {
                          count,
                          defaultValue_one: '{{count}} bit',
                          defaultValue_other: '{{count}} bits',
                        })
                      : t('brokers.modbus.regs', {
                          count,
                          defaultValue_one: '{{count}} register',
                          defaultValue_other: '{{count}} registers',
                        }),
                  ].join(' · ')}
            </span>
            <span className="grow" />
            <Button
              variant="ghost"
              size="compact"
              isBusy={read.isPending}
              disabled={readData === null || read.isPending}
              onClick={() => {
                if (readData !== null) {
                  read.mutate({ target, read: readData, wordOrder });
                }
              }}
            >
              {readReply === undefined
                ? t('brokers.modbus.readNow', 'Read')
                : t('brokers.modbus.readAgain', 'Read again')}
            </Button>
          </div>
          {readReply === undefined && readFailure === null ? null : (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {readReply?.response == null ? null : (
                <code className="font-mono text-mono-caption text-foreground-subtle">
                  {readReply.response}
                </code>
              )}
              {readFailure === null ? (
                <>
                  <span className="text-ui font-medium text-foreground">
                    {shown(readReply?.value ?? null, readData?.unit ?? '', t)}
                  </span>
                  <span className="text-ui-sm text-foreground-subtle">
                    {[
                      readData?.scale === undefined || readReply?.raw == null
                        ? null
                        : t('brokers.modbus.rawTimes', 'raw {{raw}} × {{scale}}', {
                            raw: readReply.raw.join(' '),
                            scale: readData.scale,
                          }),
                      `${String(readReply?.ms ?? 0)} ms`,
                    ]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </span>
                </>
              ) : (
                <span className="text-ui-sm text-danger">{readFailure}</span>
              )}
            </div>
          )}
        </div>
      )}

      {map.write === null ? null : (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
          <div className="flex flex-wrap items-center gap-2">
            {capability === 'on_off' ? (
              <>
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={write.isPending}
                  onClick={() => {
                    send({ command: 'turn_on' });
                  }}
                >
                  {t('brokers.modbus.sendOn', 'Send on')}
                </Button>
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={write.isPending}
                  onClick={() => {
                    send({ command: 'turn_off' });
                  }}
                >
                  {t('brokers.modbus.sendOff', 'Send off')}
                </Button>
              </>
            ) : capability === 'button' ? (
              <Button
                variant="ghost"
                size="compact"
                disabled={write.isPending}
                onClick={() => {
                  send({ command: 'press' });
                }}
              >
                {t('brokers.modbus.press', 'Press')}
              </Button>
            ) : (
              <>
                <div className="w-36">
                  {capability === 'select' ? (
                    <SelectField
                      label={t('brokers.modbus.value', 'Value')}
                      isLabelHidden
                      value={typed === '' ? (options[0]?.[0] ?? '') : typed}
                      options={options.map(([value, label]) => ({ value, label }))}
                      onChange={setTyped}
                    />
                  ) : (
                    <TextField
                      label={t('brokers.modbus.value', 'Value')}
                      isLabelHidden
                      size="compact"
                      inputMode="decimal"
                      placeholder={
                        capability === 'level'
                          ? '0–100'
                          : map.write.min === ''
                            ? '0'
                            : `${map.write.min}–${map.write.max}`
                      }
                      value={typed}
                      onChange={(event) => {
                        setTyped(event.target.value.trim());
                      }}
                    />
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={write.isPending || (capability !== 'select' && typed === '')}
                  onClick={() => {
                    send(
                      capability === 'select'
                        ? {
                            command: 'select_option',
                            option: typed === '' ? (options[0]?.[0] ?? '') : typed,
                          }
                        : capability === 'level'
                          ? { command: 'set_level', level: Number(typed) }
                          : { command: 'set_value', value: Number(typed) },
                    );
                  }}
                >
                  {t('brokers.modbus.send', 'Send')}
                </Button>
              </>
            )}
            <span className="text-ui-sm text-foreground-subtle">
              {t('brokers.modbus.goesTo', 'Goes to {{host}} now.', { host: target.host })}
            </span>
          </div>
          {!parsedEntity.success ? (
            <span className="text-ui-sm text-foreground-muted">
              {t(
                'brokers.modbus.fixFirst',
                'Fix the block first: it is what the command is made from.',
              )}
            </span>
          ) : writeReply === undefined && writeFailure === null ? null : (
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {writeReply === undefined || writeReply.request === '' ? null : (
                <code className="font-mono text-mono-caption text-foreground-subtle">
                  {writeReply.request}
                </code>
              )}
              <span
                className={cn('text-ui-sm', writeFailure === null ? 'text-success' : 'text-danger')}
              >
                {writeFailure ??
                  t('brokers.modbus.echoed', 'Done, the device echoed it in {{ms}} ms', {
                    ms: writeReply?.ms ?? 0,
                  })}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
