/**
 * Adding a Modbus device: where it is - the server, its port, the unit behind it and how frames
 * travel - and what it is read with.
 *
 * The dialog asks the device first: whether it answers, how fast, and which integrations recognise
 * its server, whose template it then offers. The owner picks a template - theirs or an
 * integration's - and a test read says how many of its entities answered; or starts a new template,
 * which opens the editor reading from this address. Nothing is written to the device until one of
 * its entities is commanded.
 */
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  MODBUS_PORT,
  type ModbusFound,
  type ModbusTarget,
  type ModbusTemplateRecord,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  Modal,
  RadioGroup,
  Segmented,
  SelectField,
  TextField,
  toast,
} from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { identifyModbus, saveModbusDevice, testModbusTemplate } from '@/library/modbus-api';

/** What the dialog needs. */
export type ModbusAddDialogProps = {
  readonly isOpen: boolean;

  /** The server found it is opened at; none for an address typed. */
  readonly found: ModbusFound | null;
  readonly templates: readonly ModbusTemplateRecord[];
  readonly onClose: () => void;
  readonly onAdded: () => void;
};

/** How the device is read: a template there is, or one to start. */
type Way = 'template' | 'new';

/**
 * The template an integration that recognised the server reads it with.
 *
 * @param found - The server found.
 * @param templates - Every template.
 * @returns Its id, or the first of the owner's, or nothing.
 */
function firstTemplateOf(
  found: ModbusFound | null,
  templates: readonly ModbusTemplateRecord[],
): string {
  const [claim, other] = found?.claims ?? [];
  const claimed =
    other === undefined && claim?.kind != null
      ? templates.find((template) => template.id === claim.kind)
      : undefined;

  return claimed?.id ?? templates.find((template) => template.vendorId === null)?.id ?? '';
}

/**
 * Renders the dialog. Keyed by its opening, so each opening starts afresh.
 *
 * @param props - See {@link ModbusAddDialogProps}.
 * @returns The dialog.
 */
export function ModbusAddDialog(props: ModbusAddDialogProps) {
  const { isOpen, found, templates, onClose, onAdded } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [host, setHost] = useState(found?.host ?? '');
  const [port, setPort] = useState(String(found?.port ?? MODBUS_PORT));
  const [unit, setUnit] = useState(String(found?.claims[0]?.unitId ?? 1));
  const [framing, setFraming] = useState<'tcp' | 'rtu'>('tcp');
  const [name, setName] = useState('');
  const [way, setWay] = useState<Way>(templates.length === 0 ? 'new' : 'template');
  const [template, setTemplate] = useState(() => firstTemplateOf(found, templates));
  const portNumber = Number(port);
  const unitNumber = Number(unit);
  const isPortValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65_535;
  const isUnitValid = Number.isInteger(unitNumber) && unitNumber >= 1 && unitNumber <= 247;
  const target: ModbusTarget | null =
    host.trim() === '' || !isPortValid || !isUnitValid
      ? null
      : { host: host.trim(), port: portNumber, unitId: unitNumber, framing };
  const chosen = templates.find((each) => each.id === template);

  const identify = useMutation({ mutationFn: identifyModbus });
  const test = useMutation({ mutationFn: testModbusTemplate });
  const add = useMutation({
    /**
     * Adds the device.
     *
     * @returns It, as the page lists it.
     */
    mutationFn: async () =>
      saveModbusDevice({
        name: name.trim(),
        host: host.trim(),
        port: portNumber,
        unitId: unitNumber,
        framing,
        template,
        pollSeconds: null,
      }),

    /** Says so, and closes. */
    onSuccess: () => {
      toast.success({
        title: t('brokers.modbus.added', '{{name}} added', { name: name.trim() }),
        message: t('brokers.modbus.addedLine', 'Its entities appear as soon as it is read.'),
      });
      onAdded();
      onClose();
    },
  });

  // A server found is asked at once; an address typed when the owner says.
  useEffect(() => {
    if (isOpen && found !== null && target !== null) {
      identify.mutate(target);
    }
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The template picked is read once from the address, so the owner sees it fits.
  const testKey = `${template}|${JSON.stringify(target)}`;

  useEffect(() => {
    if (
      isOpen &&
      way === 'template' &&
      chosen !== undefined &&
      target !== null &&
      identify.data?.isAnswering === true
    ) {
      test.mutate({ target, document: chosen.document });
    }
    // Asked again when the template or the address changes, and once the device answered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testKey, way, identify.data?.isAnswering]);

  const answered = test.data?.values.filter((value) => value.error === null).length ?? 0;
  const reply = identify.data;
  const askFailure = identify.error === null ? null : toMessage(identify.error);
  const answer =
    askFailure ??
    (reply === undefined
      ? null
      : !reply.isAnswering
        ? t('brokers.modbus.noAnswerAt', 'No answer: {{error}}', { error: reply.error ?? '' })
        : reply.claims.length === 0
          ? t(
              'brokers.modbus.answeredNobody',
              'Answered on unit {{unit}} in {{ms}} ms. No integration recognises it.',
              { unit: unitNumber, ms: reply.ms ?? 0 },
            )
          : t(
              'brokers.modbus.answeredBy',
              'Answered on unit {{unit}} in {{ms}} ms. Recognised by {{vendors}}.',
              {
                unit: unitNumber,
                ms: reply.ms ?? 0,
                vendors: reply.claims.map((each) => each.vendorName).join(', '),
              },
            ));
  const ownOptions = templates
    .filter((each) => each.vendorId === null)
    .map((each) => ({
      value: each.id,
      label: each.document.name,
      group: t('brokers.modbus.yours', 'Yours'),
    }));
  const shippedOptions = templates
    .filter((each) => each.vendorId !== null)
    .map((each) => ({
      value: each.id,
      label: each.document.name,
      group: each.vendorName ?? each.vendorId ?? '',
    }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="large"
      title={t('brokers.modbus.addTitle', 'Add a Modbus device')}
      description={t(
        'brokers.modbus.addLine',
        'Where it is, and the template that says what its registers mean.',
      )}
      footer={
        <>
          <span className="mr-auto text-ui-sm text-foreground-subtle">
            {t('brokers.modbus.readsOnly', 'Reads only until an entity writes')}
          </span>
          <Button variant="bare" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          {way === 'new' ? (
            <Button
              disabled={target === null}
              onClick={() => {
                if (target === null) {
                  return;
                }

                const query = new URLSearchParams({
                  host: target.host,
                  port: String(target.port),
                  unit: String(target.unitId),
                  framing: target.framing,
                  ...(name.trim() === '' ? {} : { device: name.trim() }),
                });

                onClose();
                void navigate(`/brokers/modbus/templates/new?${query.toString()}`);
              }}
            >
              {t('brokers.modbus.startTemplate', 'Start the template')}
            </Button>
          ) : (
            <Button
              isBusy={add.isPending}
              disabled={target === null || name.trim() === '' || template === '' || add.isPending}
              onClick={() => {
                add.mutate();
              }}
            >
              {t('brokers.modbus.addDevice', 'Add device')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4.5">
        <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_7rem_6rem]">
          <TextField
            label={t('brokers.modbus.address', 'Address')}
            placeholder="192.168.1.60"
            value={host}
            className="font-mono"
            onChange={(event) => {
              setHost(event.target.value);
              identify.reset();
            }}
          />
          <TextField
            label={t('brokers.modbus.port', 'Port')}
            inputMode="numeric"
            value={port}
            error={isPortValid ? undefined : '1–65535'}
            onChange={(event) => {
              setPort(event.target.value.trim());
              identify.reset();
            }}
          />
          <TextField
            label={t('brokers.modbus.unitId', 'Unit ID')}
            inputMode="numeric"
            value={unit}
            error={isUnitValid ? undefined : '1–247'}
            onChange={(event) => {
              setUnit(event.target.value.trim());
              identify.reset();
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label={t('brokers.modbus.framing', 'Framing')}
            value={framing}
            onChange={(value) => {
              setFraming(value);
              identify.reset();
            }}
            options={[
              { value: 'tcp', label: 'Modbus TCP' },
              { value: 'rtu', label: t('brokers.modbus.rtuOverTcp', 'RTU over TCP') },
            ]}
          />
          <Button
            variant="ghost"
            isBusy={identify.isPending}
            disabled={target === null || identify.isPending}
            onClick={() => {
              if (target !== null) {
                identify.mutate(target);
              }
            }}
          >
            <AppIcon id="radio" size={15} />
            {t('brokers.modbus.ask', 'Ask the device')}
          </Button>
        </div>

        {reply === undefined && askFailure === null ? null : (
          <div className="flex items-start gap-3 rounded-inner border border-border bg-surface-raised px-3.5 py-3">
            <AppIcon
              id={reply?.isAnswering === true ? 'circle-check' : 'circle-x'}
              size={16}
              className={reply?.isAnswering === true ? 'text-success' : 'text-danger'}
            />
            <span className="flex flex-col gap-0.5 text-ui-sm">
              <span className="text-foreground">{answer}</span>
              {reply?.isAnswering === true && reply.error !== null ? (
                <span className="text-foreground-muted">{reply.error}</span>
              ) : null}
            </span>
          </div>
        )}

        <TextField
          label={t('brokers.modbus.name', 'Name')}
          placeholder={t('brokers.modbus.namePlaceholder', 'Garage relays')}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />

        <RadioGroup<Way>
          label={t('brokers.modbus.readWith', 'Read with')}
          value={way}
          onChange={setWay}
          options={[
            {
              value: 'template',
              label: t('brokers.modbus.useTemplate', 'Use a template'),
            },
            {
              value: 'new',
              label: t('brokers.modbus.newTemplateWay', 'Start a new template'),
              note: t(
                'brokers.modbus.newTemplateLine',
                'Opens the editor, reading from this device as you map it.',
              ),
            },
          ]}
        />

        {way === 'template' ? (
          <div className="flex flex-col gap-2">
            <SelectField
              label={t('brokers.modbus.templateLabel', 'Template')}
              value={template}
              options={[...ownOptions, ...shippedOptions]}
              onChange={setTemplate}
            />
            {test.data === undefined ? null : (
              <span className="text-ui-sm text-foreground-muted">
                {t(
                  'brokers.modbus.testRead',
                  'Test read: {{answered}} of {{total}} entities answered',
                  {
                    answered,
                    total: test.data.values.length,
                  },
                )}
              </span>
            )}
          </div>
        ) : null}

        {add.error === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {toMessage(add.error)}
          </p>
        )}
      </div>
    </Modal>
  );
}
