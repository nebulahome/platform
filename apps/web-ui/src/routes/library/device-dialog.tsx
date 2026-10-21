/**
 * Adding a device, or changing one: what to call it and its icon, the tags on it, which model,
 * the form its driver asks for, a Test, a Save, and - for one that exists - a Remove.
 *
 * The vendor's drivers - served by the hub through the vendors list - say what may be picked
 * and which fields each pick brings; nothing here knows what an MQTT broker or a printer wants.
 * A vendor with one model to offer is not asked which: the choice is made silently and the form
 * is the driver's. The name starts as the model and the id follows the name until it is typed
 * by hand; the icon starts as the driver's default and is picked from the catalogue. The name
 * and the tags come before the model because they are what a row is recognised by, and they are
 * the same two fields an entity has, drawn by the same two components. What is typed is checked
 * against the same schema the API runs, so a wrong value is underlined before a round trip and
 * the message is the one the server would have sent.
 *
 * **Test** opens the transport once with what is typed and reports the verdict in a sentence:
 * "Connected to mqtts://… as bblp", or "did not answer: ECONNREFUSED". It saves nothing. A secret
 * left blank while editing is filled from the one kept, so testing a changed address does not
 * mean typing the password again. When the vendor's discovery can tell which model answered, a
 * device being added takes that model - and its driver, keeping what was typed into the fields
 * the two drivers share - so the owner who picked a relay for what turns out to be a plug does
 * not have to find that out from a device that never reports.
 *
 * **Save** writes the row and the hub is asked to match it at once; the row comes back with the
 * state the hub reported, and the page shows it. What takes effect takes effect now.
 *
 * **Remove** is a second press away, in the footer where Save was, and says what goes with the
 * device: its entities, and whatever the hub was listening for. A refusal - a derived entity
 * still reading one of the entities - is shown where the person is, and the dialog stays.
 *
 * The System device - the machine the platform runs on - has no vendor, no driver and no
 * connection to set: its dialog is the name, the icon, the tags and the room, and nothing else.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  integrationIdSchema,
  MATTER_TRANSPORT,
  MQTT_HOUSE_TRANSPORT,
  modelChoicesOf,
  suggestDeviceId,
  type DeviceProbeReply,
  type DeviceView,
  type IntegrationVendorView,
  type JsonObject,
  type ModelChoice,
} from '@nebulahome/contracts';
import { AppIcon, Button, Modal, Segmented, SelectField, TextField } from '@nebulahome/ui';

import { CheckIcon, WarningIcon } from '@/components/icons';
import { listFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';
import { roomChoices } from '@/lib/area-tree';
import { toMessage } from '@/lib/error-message';
import { createDevice, deleteDevice, probeDevice, updateDevice } from '@/library/api';
import {
  errorsByField,
  initialDraft,
  keptSecrets,
  serverIssuesOf,
  toValues,
  type DraftValue,
  type SetupDraft,
} from '@/library/setup-values';
import { ConfirmRemoval } from '@/routes/library/confirm-removal';
import { DeviceIcon, useCatalogueIcons } from '@/routes/library/device-icon';
import { ModelList } from '@/routes/library/model-list';
import { NameIconField } from '@/routes/library/name-icon-field';
import { SetupForm } from '@/routes/library/setup-form';
import { TagField } from '@/routes/library/tag-field';
import { useVendorsById, wayName } from '@/routes/library/transport-marks';
import { useAreas } from '@/routes/library/use-areas';
import { useTags } from '@/routes/library/use-tags';

/** What the dialog is for: a new device of a vendor, or one that exists. */
export type DeviceDialogTarget =
  | {
      readonly mode: 'create';
      readonly vendor: IntegrationVendorView;

      /** The ids already taken, so the one suggested is free. */
      readonly existingIds: readonly string[];
    }
  | {
      readonly mode: 'edit';

      /** The device's vendor; none for the System device, which no integration reaches. */
      readonly vendor: IntegrationVendorView | undefined;
      readonly device: DeviceView;
    };

/** What the dialog needs. */
export type DeviceDialogProps = {
  /** What is being set up. Null when the dialog is shut. */
  readonly target: DeviceDialogTarget | null;

  /** Whether the person may remove the device; false hides the button altogether. */
  readonly canRemove?: boolean;

  /** Whether the person may make a tag from the tag field. */
  readonly canCreateTags?: boolean;

  /** Called to shut it. */
  readonly onClose: () => void;

  /** Called once the rows are written, with the device as it now stands. */
  readonly onSaved: (device: DeviceView) => void;

  /** Called once the device is gone, with the id it had. */
  readonly onRemoved?: ((deviceId: string) => void) | undefined;
};

/** What the form holds, for both groups. */
type Drafts = {
  readonly transport: SetupDraft;
  readonly options: SetupDraft;
};

/** What is wrong, per group and field, plus anything that names no field. */
type Errors = {
  readonly transport: Readonly<Record<string, string>>;
  readonly options: Readonly<Record<string, string>>;
  readonly general: string | undefined;
};

/** Nothing wrong. */
const NO_ERRORS: Errors = { transport: {}, options: {}, general: undefined };

/** The two documents a form produces, as the API takes them. */
type Values = {
  readonly transportConfig: JsonObject;
  readonly options: JsonObject;
};

/**
 * The choice an existing device was made with, or the first the vendor offers.
 *
 * @param choices - What the vendor offers.
 * @param existing - The device being edited, when there is one.
 * @returns The choice, or undefined for a vendor that offers nothing.
 */
function initialChoice(
  choices: readonly ModelChoice[],
  existing: DeviceView | undefined,
): ModelChoice | undefined {
  if (existing === undefined) {
    return choices[0];
  }

  return (
    choices.find((choice) => choice.kind === existing.kind && choice.model === existing.model) ??
    choices.find((choice) => choice.kind === existing.kind) ??
    choices[0]
  );
}

/**
 * The drafts a dialog starts from.
 *
 * @param vendor - The vendor whose driver's form is shown.
 * @param choice - Which driver, through the model picked.
 * @param stored - The row being edited, when there is one.
 * @returns One draft per group.
 */
function draftsFor(
  vendor: IntegrationVendorView,
  choice: ModelChoice | undefined,
  stored: DeviceView | undefined,
): Drafts {
  const driver = vendor.drivers.find((each) => each.id === choice?.kind);

  if (driver === undefined) {
    return { transport: {}, options: {} };
  }

  return {
    transport: initialDraft(driver.setup.transport, stored?.transportConfig),
    options: initialDraft(driver.setup.options, stored?.options),
  };
}

/**
 * A draft of another form, with what was typed wherever the two share a field.
 *
 * @param from - What was typed.
 * @param into - The draft the other form starts from.
 * @returns `into`, with what was typed carried over.
 */
function carriedOver(from: SetupDraft, into: SetupDraft): SetupDraft {
  const carried: SetupDraft = { ...into };

  for (const key of Object.keys(into)) {
    const typed = from[key];

    if (typed !== undefined) {
      carried[key] = typed;
    }
  }

  return carried;
}

/**
 * Renders the dialog.
 *
 * Mounted fresh each time it opens - the page gives it a key - so every piece of state below
 * starts from the target and the fields are the person's from then on.
 *
 * @param props - See {@link DeviceDialogProps}.
 * @returns The dialog.
 */
export function DeviceDialog(props: DeviceDialogProps) {
  const { t } = useTranslation();

  const { target, canRemove = false, canCreateTags = false, onClose, onSaved, onRemoved } = props;
  const { tags, create: createTagNamed } = useTags();
  const tagIcons = useCatalogueIcons(tags.map((tag) => tag.icon));
  const { tree } = useAreas();
  const rooms = roomChoices(tree);

  const vendor = target?.vendor;
  const existing = target?.mode === 'edit' ? target.device : undefined;
  // The platform's own devices - the machine, a container - have no connection to set: only
  // what they are called, their icon, their tags and their room.
  const isSystem = existing !== undefined && existing.origin !== 'integration';
  const taken = target?.mode === 'create' ? target.existingIds : [];
  // A broker's device is added by its broker, never by hand, and one added stays on its broker.
  /**
   * The broker a transport is, if it is one.
   *
   * @param transport - The transport.
   * @returns It, for a broker's; null for any other.
   */
  const brokerOf = (transport: string | undefined): string | null =>
    transport === MATTER_TRANSPORT || transport === MQTT_HOUSE_TRANSPORT ? transport : null;
  const broker = brokerOf(existing?.transport);
  const choices =
    vendor === undefined
      ? []
      : modelChoicesOf(vendor).filter(
          (each) =>
            brokerOf(vendor.drivers.find((driver) => driver.id === each.kind)?.transport) ===
            broker,
        );

  const [choice, setChoice] = useState<ModelChoice | undefined>(() =>
    initialChoice(choices, existing),
  );
  const driver = vendor?.drivers.find((each) => each.id === choice?.kind);

  const [name, setName] = useState(() => existing?.name ?? choice?.model ?? '');
  const [isNameEdited, setNameEdited] = useState(false);
  const [id, setId] = useState(
    () =>
      existing?.id ??
      (vendor === undefined || choice === undefined
        ? ''
        : suggestDeviceId(vendor.id, choice.model, taken)),
  );
  const [isIdEdited, setIdEdited] = useState(false);
  const [icon, setIcon] = useState<string | null>(
    () => existing?.icon ?? driver?.defaultIcon ?? null,
  );
  const [tagIds, setTagIds] = useState<readonly string[]>(existing?.tagIds ?? []);
  const [areaId, setAreaId] = useState<string | null>(existing?.areaId ?? null);
  const [isEnabled, setEnabled] = useState(existing?.isEnabled ?? true);
  const [isRemoving, setRemoving] = useState(false);
  // A device reached two ways: which is read first. Its connections are each way's own page's.
  const ways = existing?.linked?.ways ?? [];
  const isLinked = ways.length > 1;
  const [preferred, setPreferred] = useState<string | null>(existing?.linked?.preferred ?? null);
  const vendorsById = useVendorsById();
  const deviceIcons = useCatalogueIcons([icon]);
  const [drafts, setDrafts] = useState<Drafts>(() =>
    vendor === undefined ? { transport: {}, options: {} } : draftsFor(vendor, choice, existing),
  );
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [verdict, setVerdict] = useState<DeviceProbeReply | null>(null);

  const mode = existing === undefined ? 'complete' : 'partial';
  const kept = {
    transport: keptSecrets(
      driver?.setup.transport ?? { constants: {}, fields: [] },
      existing?.transportConfig,
    ),
    options: keptSecrets(driver?.setup.options ?? { constants: {}, fields: [] }, existing?.options),
  };

  /**
   * Reads both drafts, remembering what is wrong with them.
   *
   * @returns The values to send, or null when a field stopped them.
   */
  const read = (): Values | null => {
    if (driver === undefined) {
      return null;
    }

    const transport = toValues(driver.setup.transport, drafts.transport, mode);
    const options = toValues(driver.setup.options, drafts.options, mode);
    const isIdValid = existing !== undefined || integrationIdSchema.safeParse(id).success;
    const isNameValid = name.trim() !== '';

    setErrors({
      transport: transport.errors,
      options: options.errors,
      general: !isNameValid
        ? t('library.deviceDialog.deviceNeedsAName', 'The device needs a name.')
        : isIdValid
          ? undefined
          : t(
              'library.deviceDialog.idMustBeLowercase',
              'The id must be lowercase letters, digits and dashes, starting with a letter.',
            ),
    });

    const isClean =
      isIdValid &&
      isNameValid &&
      Object.keys(transport.errors).length === 0 &&
      Object.keys(options.errors).length === 0;

    return isClean ? { transportConfig: transport.values, options: options.values } : null;
  };

  /**
   * Keeps the server's word on what is wrong, field by field where it named one.
   *
   * @param error - What the request threw.
   */
  const remember = (error: unknown): void => {
    const issues = serverIssuesOf(error);

    setErrors({
      transport: errorsByField(issues, 'transportConfig'),
      options: errorsByField(issues, 'options'),
      general:
        issues.length > 0 && issues.every((issue) => issue.path.includes('.'))
          ? undefined
          : toMessage(error),
    });
  };

  const probe = useMutation({
    /**
     * Tries what is typed.
     *
     * @param values - The two documents, as read.
     * @returns The verdict.
     */
    mutationFn: async (values: Values) =>
      probeDevice({
        kind: choice?.kind ?? '',
        transportConfig: values.transportConfig,
        ...(existing === undefined ? {} : { deviceId: existing.id }),
      }),
    /**
     * Shows the verdict.
     *
     * @param reply - What the hub said.
     */
    onSuccess: (reply): void => {
      setVerdict(reply);

      const detected = reply.detected;

      if (existing === undefined && detected !== undefined) {
        const found = choices.find(
          (each) =>
            each.kind === detected.kind &&
            each.model === (detected.model ?? detected.modelChoices[0]),
        );

        if (found !== undefined) {
          choose(found, 'detected');
        }
      }
    },
    onError: remember,
  });

  const save = useMutation({
    /**
     * Writes the rows.
     *
     * @param values - The two documents, as read.
     * @returns The device as it now stands.
     */
    mutationFn: async (values: Values) =>
      isSystem
        ? updateDevice(existing.id, { name: name.trim(), icon, tagIds: [...tagIds], areaId })
        : existing === undefined
          ? createDevice({
              id,
              kind: choice?.kind ?? '',
              model: choice?.model ?? '',
              name: name.trim(),
              ...(icon === null ? {} : { icon }),
              isEnabled,
              tagIds: [...tagIds],
              ...(areaId === null ? {} : { areaId }),
              ...values,
            })
          : updateDevice(existing.id, {
              name: name.trim(),
              icon,
              isEnabled,
              tagIds: [...tagIds],
              areaId,
              ...(choice === undefined ? {} : { model: choice.model }),
              ...(isLinked && preferred !== null && preferred !== existing.linked?.preferred
                ? { preferredTransport: integrationIdSchema.parse(preferred) }
                : {}),
              ...values,
            }),
    /**
     * Hands the written device back to the page.
     *
     * @param device - As it now stands.
     */
    onSuccess: (device): void => {
      onSaved(device);
    },
    onError: remember,
  });

  const removal = useMutation({
    /** Removes the device: the hub lets go, and its rows and entities go with it. */
    mutationFn: async (): Promise<void> => {
      if (existing !== undefined) {
        await deleteDevice(existing.id);
      }
    },

    /** Tells the page the device is gone. */
    onSuccess: (): void => {
      if (existing !== undefined) {
        onRemoved?.(existing.id);
      }
    },

    /**
     * Shows why the removal was refused, back in the ordinary footer.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown): void => {
      setRemoving(false);
      remember(error);
    },
  });

  const isBusy = probe.isPending || save.isPending || removal.isPending;

  /**
   * Changes one field of one group, and forgets the last verdict: it was about other values.
   *
   * @param group - Which group.
   * @returns The change handler the form calls.
   */
  const change =
    (group: 'transport' | 'options') =>
    (key: string, value: DraftValue): void => {
      setDrafts((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
      setVerdict(null);
    };

  /**
   * Takes another model, and with it perhaps another driver and another form.
   *
   * @param next - The model and its driver.
   * @param how - `picked` by the owner, or `detected` by a Test: a pick forgets the verdict, which
   * was about the model before it, and starts the new driver's form afresh; a detection keeps the
   * verdict it came with, and what was typed wherever the two forms share a field - it is the
   * same device at the same address.
   */
  const choose = (next: ModelChoice, how: 'picked' | 'detected'): void => {
    if (vendor === undefined || (next.kind === choice?.kind && next.model === choice.model)) {
      return;
    }

    setChoice(next);

    if (how === 'picked') {
      setVerdict(null);
    }

    if (next.kind !== choice?.kind) {
      // Another driver is another form: what was typed for the old one names fields the new
      // one may not have.
      const fresh = draftsFor(vendor, next, existing);

      setDrafts(
        how === 'picked'
          ? fresh
          : {
              transport: carriedOver(drafts.transport, fresh.transport),
              options: carriedOver(drafts.options, fresh.options),
            },
      );
      setErrors(NO_ERRORS);
    }

    if (existing === undefined && !isNameEdited) {
      // The name still reads as the model, so it follows the pick - and the id follows the name.
      setName(next.model);

      if (!isIdEdited) {
        setId(suggestDeviceId(vendor.id, next.model, taken));
      }
    }

    if (existing === undefined && icon === (driver?.defaultIcon ?? null)) {
      // The icon was the old driver's default, so it becomes the new driver's.
      const nextDriver = vendor.drivers.find((each) => each.id === next.kind);

      setIcon(nextDriver?.defaultIcon ?? null);
    }
  };

  /**
   * Renames the device, and moves the suggested id with it while nobody has typed one.
   *
   * @param value - What was typed.
   */
  const rename = (value: string): void => {
    setName(value);
    setNameEdited(true);

    if (existing === undefined && !isIdEdited && vendor !== undefined) {
      setId(suggestDeviceId(vendor.id, value, taken));
    }
  };

  const title =
    existing === undefined
      ? t('library.deviceDialog.addADevice', 'Add a device')
      : t('library.deviceDialog.configureName', 'Configure {{name}}', { name: existing.name });
  const description = isLinked
    ? t('library.deviceDialog.modelLinked', '{{model}} · linked', {
        model: existing?.model ?? existing?.driverName ?? '',
      })
    : isSystem
      ? existing.origin === 'container'
        ? t(
            'library.deviceDialog.containerOfThisMachine',
            'A container of this machine: what it is called, its tags and its room.',
          )
        : existing.origin === 'package'
          ? t(
              'library.deviceDialog.deviceOfTheDrivername',
              'A device of the {{driverName}} package: what it is called, its tags and its room.',
              { driverName: existing.driverName },
            )
          : t(
              'library.deviceDialog.machineNebulahomeRunsOn',
              'The machine NebulaHome runs on: what it is called, its tags and its room.',
            )
      : driver === undefined
        ? t(
            'library.deviceDialog.whichModelAndWhat',
            'Which model, and what it needs to be reached.',
          )
        : t(
            'library.deviceDialog.overTransport',
            '{{model}}, over {{transport}}. Test tries the address before anything is saved.',
            { model: choice?.series ?? driver.name, transport: driver.transport },
          );

  /** Saves the System device: its name, icon, tags and room, and no connection. */
  const saveSystem = (): void => {
    if (name.trim() === '') {
      setErrors({
        ...NO_ERRORS,
        general: t('library.deviceDialog.deviceNeedsAName', 'The device needs a name.'),
      });

      return;
    }

    setErrors(NO_ERRORS);
    save.mutate({ transportConfig: {}, options: {} });
  };

  // More than one model to pick from puts the models in a card of their own beside the form.
  const hasModelList = choices.length > 1;

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      title={title}
      description={description}
      {...(isLinked
        ? {
            layout: 'card' as const,
            size: 'form' as const,
            lead: (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-inner border border-border-strong bg-surface-raised text-foreground-muted">
                <DeviceIcon
                  icon={deviceIcons.get(icon ?? '')}
                  {...(existing === undefined ? {} : { device: existing })}
                  size={20}
                />
              </span>
            ),
          }
        : {})}
      aside={
        hasModelList ? (
          <ModelList
            choices={choices}
            value={choice}
            vendor={vendor}
            disabled={isBusy}
            onPick={(next) => {
              choose(next, 'picked');
            }}
          />
        ) : undefined
      }
      asideLabel={t('library.deviceDialog.models', 'Models')}
      footer={
        isRemoving && existing !== undefined ? (
          <ConfirmRemoval
            question={
              isLinked
                ? t(
                    'library.deviceDialog.removeLinked',
                    'Remove {{name}}? It goes from {{ways}}: {{entities}}, and the hub stops listening for it both ways.',
                    {
                      name: existing.name,
                      ways: listFormat({ type: 'conjunction' }).format(
                        ways.map((way) =>
                          wayName(way, vendorsById, t('library.matterTag', 'Matter')),
                        ),
                      ),
                      entities: describeEntities(existing).toLocaleLowerCase(),
                    },
                  )
                : `Remove ${existing.name}? ${describeEntities(existing)} and the hub stops listening for it.`
            }
            isBusy={removal.isPending}
            onCancel={() => {
              setRemoving(false);
            }}
            onConfirm={() => {
              removal.mutate();
            }}
          />
        ) : (
          <>
            {existing !== undefined && canRemove && !isSystem ? (
              <Button
                variant="danger"
                disabled={isBusy}
                className="mr-auto"
                onClick={() => {
                  setErrors(NO_ERRORS);
                  setRemoving(true);
                }}
              >
                {isLinked ? <AppIcon id="trash-2" size={15} /> : null}
                {t('common.remove', 'Remove')}
              </Button>
            ) : (
              <span />
            )}
            <span className="flex flex-wrap items-center justify-end gap-2.5">
              {isSystem ? null : (
                <Button
                  variant="ghost"
                  isBusy={probe.isPending}
                  disabled={isBusy || driver === undefined}
                  onClick={() => {
                    const values = read();

                    if (values !== null) {
                      probe.mutate(values);
                    }
                  }}
                >
                  {t('library.deviceDialog.test', 'Test')}
                </Button>
              )}
              <Button variant={isLinked ? 'bare' : 'ghost'} onClick={onClose}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                isBusy={save.isPending}
                disabled={isBusy || (driver === undefined && !isSystem)}
                onClick={() => {
                  if (isSystem) {
                    saveSystem();

                    return;
                  }

                  const values = read();

                  if (values !== null) {
                    save.mutate(values);
                  }
                }}
              >
                {t('common.save', 'Save')}
              </Button>
            </span>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <NameIconField
          value={name}
          onChange={rename}
          icon={icon}
          onIconChange={(view) => {
            setIcon(view.id);
          }}
          hint={
            existing === undefined
              ? t(
                  'library.deviceDialog.iconStartsAsThe',
                  "The icon starts as the driver's; pick another from the catalogue.",
                )
              : undefined
          }
          required
        />

        <TagField
          value={tagIds}
          onChange={setTagIds}
          tags={tags}
          icons={tagIcons}
          canCreate={canCreateTags}
          onCreate={createTagNamed}
          {...(isLinked
            ? {}
            : {
                hint: t(
                  'library.deviceDialog.whatAutomationsAndScenes',
                  'What automations and scenes will pick this device by.',
                ),
              })}
        />

        <SelectField
          label={t('library.deviceDialog.room', 'Room')}
          options={rooms}
          value={areaId ?? ''}
          hint={
            rooms.length === 1
              ? t(
                  'library.deviceDialog.noRoomsYetMake',
                  'No rooms yet: make the house, its floors and their rooms under Areas.',
                )
              : t(
                  'library.deviceDialog.itsEntitiesAreIn',
                  'Its entities are in the same room unless one of them says otherwise.',
                )
          }
          onChange={(value) => {
            setAreaId(value === '' ? null : value);
          }}
        />

        {existing === undefined ? (
          <TextField
            label={t('library.deviceDialog.id', 'Id')}
            size="medium"
            hint={t(
              'library.deviceDialog.lowercaseLettersDigitsAnd',
              'Lowercase letters, digits and dashes. It is what every entity of this device carries as its source.',
            )}
            value={id}
            required
            onChange={(event) => {
              setId(event.target.value);
              setIdEdited(true);
            }}
          />
        ) : driver === undefined && !isSystem && !isLinked ? (
          <p role="alert" className="text-ui text-danger">
            {t(
              'library.deviceDialog.hubNoLongerHas',
              'The hub no longer has the driver {{kind}}, so its fields cannot be shown.',
              { kind: existing.kind },
            )}
          </p>
        ) : null}

        {isLinked ? (
          <div className="flex flex-col gap-2">
            <span aria-hidden="true" className="text-ui-sm font-medium text-foreground-muted">
              {t('library.deviceDialog.preferredTransport', 'Preferred transport')}
            </span>
            <Segmented
              label={t('library.deviceDialog.preferredTransport', 'Preferred transport')}
              options={ways.map((way) => ({
                value: way.deviceId,
                label: wayName(way, vendorsById, t('library.matterTag', 'Matter')),
              }))}
              value={preferred ?? ways[0]?.deviceId ?? ''}
              onChange={setPreferred}
              isFilled
            />
            <span className="text-caption text-foreground-subtle">
              {t('library.deviceDialog.otherTakesOver', 'The other takes over when it is silent.')}
            </span>
          </div>
        ) : null}

        {driver === undefined || isLinked ? null : (
          <>
            <SetupForm
              group={driver.setup.transport}
              draft={drafts.transport}
              errors={errors.transport}
              kept={kept.transport}
              onChange={change('transport')}
            />
            <SetupForm
              group={driver.setup.options}
              draft={drafts.options}
              errors={errors.options}
              kept={kept.options}
              onChange={change('options')}
            />
          </>
        )}

        {existing === undefined || isSystem || isLinked ? null : (
          <Segmented
            label={t('library.deviceDialog.running', 'Running')}
            options={[
              { value: 'on', label: t('library.deviceDialog.enabled', 'Enabled') },
              { value: 'off', label: t('library.deviceDialog.disabled', 'Disabled') },
            ]}
            value={isEnabled ? 'on' : 'off'}
            onChange={(value) => {
              setEnabled(value === 'on');
            }}
          />
        )}

        {verdict === null ? null : verdict.isReachable ? (
          <p role="status" className="flex items-start gap-2 text-ui text-success">
            <CheckIcon width="16" height="16" className="mt-0.5 shrink-0" />
            <span>
              {verdict.detail}
              {verdict.detected === undefined || existing !== undefined
                ? null
                : ` ${t('library.deviceDialog.itSaysItIs', 'It says it is a {{model}}.', {
                    model:
                      verdict.detected.model ??
                      listFormat({ type: 'disjunction' }).format(verdict.detected.modelChoices),
                  })}`}
            </span>
          </p>
        ) : (
          <p role="alert" className="flex items-start gap-2 text-ui text-danger">
            <WarningIcon width="16" height="16" className="mt-0.5 shrink-0" />
            <span>{verdict.detail}</span>
          </p>
        )}

        {errors.general === undefined ? null : (
          <p role="alert" className="text-ui text-danger">
            {errors.general}
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * Says what goes with a device when it is removed.
 *
 * @param device - The device.
 * @returns "Its 6 entities go with it", or a sentence for none.
 */
function describeEntities(device: DeviceView): string {
  const count = device.entityIds.length;

  if (count === 0) {
    return translate('library.deviceDialog.itHasNoEntities', 'It has no entities yet');
  }

  return translate('library.deviceDialog.entitiesGoWithIt', {
    count,
    defaultValue_one: 'Its {{count}} entity goes with it',
    defaultValue_other: 'Its {{count}} entities go with it',
  });
}
