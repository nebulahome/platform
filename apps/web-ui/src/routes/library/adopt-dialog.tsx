/**
 * Adopting a device found on the network: what to call it, its icon, its room and its tags -
 * and nothing the device already said.
 *
 * The driver, the model and the address are discovery's answers, and the dialog does not ask
 * them again. What is left is the owner's: the name - starting as the one the device was given in
 * its own app, or its model - the icon the driver starts devices with, a room, tags. Two things
 * are asked only when they have to be. The model, when the device named its family but not which
 * of it it is. And whatever the driver needs that a device does not announce - a token, an access
 * code - drawn by the same form the add dialog uses, from the driver's own declaration with the
 * fields discovery filled taken out.
 *
 * The id is made from the name, as the add form makes it, and not shown: an adopted device is
 * recognised by the name and the room, and the id follows the name wherever it goes in a log.
 *
 * **Adopt** adds the device the way the add form does, and the hub starts talking to it at once.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isFieldShown,
  suggestDeviceId,
  type DeviceView,
  type DiscoveredDevice,
  type IntegrationVendorView,
  type JsonObject,
  type SetupGroup,
} from '@nebulahome/contracts';
import { Button, Modal, SelectField } from '@nebulahome/ui';

import { roomChoices } from '@/lib/area-tree';
import { toMessage } from '@/lib/error-message';
import { adoptDiscovered } from '@/library/api';
import {
  errorsByField,
  initialDraft,
  serverIssuesOf,
  toValues,
  type DraftValue,
  type SetupDraft,
} from '@/library/setup-values';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { discoveredTitle } from '@/routes/library/discovered-card';
import { NameIconField } from '@/routes/library/name-icon-field';
import { SetupForm } from '@/routes/library/setup-form';
import { TagField } from '@/routes/library/tag-field';
import { useAreas } from '@/routes/library/use-areas';
import { useTags } from '@/routes/library/use-tags';

/** What is being adopted, and what the dialog needs around it. */
export type AdoptDialogTarget = {
  readonly device: DiscoveredDevice;

  /** Its vendor, whose driver says what else the device needs. */
  readonly vendor: IntegrationVendorView;

  /** The ids already taken, so the one made from the name is free. */
  readonly existingIds: readonly string[];
};

/** What the dialog needs. */
export type AdoptDialogProps = {
  /** What is being adopted. Null when the dialog is shut. */
  readonly target: AdoptDialogTarget | null;

  /** Whether the person may make a tag from the tag field. */
  readonly canCreateTags?: boolean;

  /** Called to shut it. */
  readonly onClose: () => void;

  /** Called once the device is added, with the device as it now stands. */
  readonly onAdopted: (device: DeviceView) => void;
};

/** What is wrong, per group and field, plus anything that names no field. */
type Errors = {
  readonly transport: Readonly<Record<string, string>>;
  readonly options: Readonly<Record<string, string>>;
  readonly general: string | undefined;
};

/** Nothing wrong. */
const NO_ERRORS: Errors = { transport: {}, options: {}, general: undefined };

/** A group that asks nothing. */
const EMPTY_GROUP: SetupGroup = { constants: {}, fields: [] };

/**
 * A driver's group, without the fields discovery already filled - nor those its answers rule
 * out: an inverter discovery found on its Modbus port is not asked for its dongle's password.
 *
 * @param group - What the driver declares.
 * @param filled - What discovery found: the address, in the transport's terms.
 * @returns The group, asking only for the rest.
 */
function leftToAsk(group: SetupGroup, filled: JsonObject): SetupGroup {
  return {
    ...group,
    fields: group.fields.filter(
      (field) =>
        !(field.key in filled) &&
        (field.shownWhen === undefined ||
          !(field.shownWhen.key in filled) ||
          isFieldShown(group, field, filled)),
    ),
  };
}

/**
 * Renders the dialog.
 *
 * Mounted fresh each time it opens - the page gives it a key - so every piece of state starts
 * from the device.
 *
 * @param props - See {@link AdoptDialogProps}.
 * @returns The dialog.
 */
export function AdoptDialog(props: AdoptDialogProps) {
  const { t } = useTranslation();

  const { target, canCreateTags = false, onClose, onAdopted } = props;
  const { tags, create: createTagNamed } = useTags();
  const tagIcons = useCatalogueIcons(tags.map((tag) => tag.icon));
  const { tree } = useAreas();
  const rooms = roomChoices(tree);

  const device = target?.device;
  const vendor = target?.vendor;
  const driver = vendor?.drivers.find((each) => each.id === device?.kind);
  const choices = device?.modelChoices ?? [];
  const transportGroup = leftToAsk(
    driver?.setup.transport ?? EMPTY_GROUP,
    device?.transportConfig ?? {},
  );
  const optionsGroup = driver?.setup.options ?? EMPTY_GROUP;

  const [model, setModel] = useState(() => device?.model ?? choices[0] ?? '');
  const [name, setName] = useState(() => device?.name ?? device?.model ?? model);
  const [isNameEdited, setNameEdited] = useState(false);
  const [icon, setIcon] = useState<string | null>(() => driver?.defaultIcon ?? null);
  const [tagIds, setTagIds] = useState<readonly string[]>([]);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [transportDraft, setTransportDraft] = useState<SetupDraft>(() =>
    initialDraft(transportGroup),
  );
  const [optionsDraft, setOptionsDraft] = useState<SetupDraft>(() => initialDraft(optionsGroup));
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);

  const adopt = useMutation({
    /**
     * Adds the device.
     *
     * @param values - What the driver's form collected.
     * @param values.transportConfig - The transport's fields discovery did not fill.
     * @param values.options - The integration's own fields.
     * @returns The device as it now stands.
     */
    mutationFn: async (values: { transportConfig: JsonObject; options: JsonObject }) =>
      adoptDiscovered(device?.id ?? '', {
        id: suggestDeviceId(vendor?.id ?? '', name.trim(), target?.existingIds ?? []),
        name: name.trim(),
        ...(icon === null ? {} : { icon }),
        ...(choices.length > 1 ? { model } : {}),
        tagIds: [...tagIds],
        ...(areaId === null ? {} : { areaId }),
        ...values,
      }),

    /**
     * Hands the added device back to the page.
     *
     * @param added - As it now stands.
     */
    onSuccess: (added): void => {
      onAdopted(added);
    },

    /**
     * Keeps the server's word on what is wrong, field by field where it named one.
     *
     * @param error - What the request threw.
     */
    onError: (error: unknown): void => {
      const issues = serverIssuesOf(error);

      setErrors({
        transport: errorsByField(issues, 'transportConfig'),
        options: errorsByField(issues, 'options'),
        general:
          issues.length > 0 && issues.every((issue) => issue.path.includes('.'))
            ? undefined
            : toMessage(error),
      });
    },
  });

  /** Reads what was typed and, when nothing stops it, adds the device. */
  const submit = (): void => {
    const transport = toValues(transportGroup, transportDraft, 'complete');
    const options = toValues(optionsGroup, optionsDraft, 'complete');
    const isNamed = name.trim() !== '';

    setErrors({
      transport: transport.errors,
      options: options.errors,
      general: isNamed
        ? undefined
        : t('library.adoptDialog.deviceNeedsAName', 'The device needs a name.'),
    });

    if (
      isNamed &&
      Object.keys(transport.errors).length === 0 &&
      Object.keys(options.errors).length === 0
    ) {
      adopt.mutate({ transportConfig: transport.values, options: options.values });
    }
  };

  /**
   * Changes one field of one group.
   *
   * @param group - Which group.
   * @returns The change handler the form calls.
   */
  const change =
    (group: 'transport' | 'options') =>
    (key: string, value: DraftValue): void => {
      const update = group === 'transport' ? setTransportDraft : setOptionsDraft;

      update((current) => ({ ...current, [key]: value }));
    };

  const title =
    device === undefined
      ? t('library.adoptDialog.adopt', 'Adopt')
      : t('library.adoptDialog.adoptDevice', 'Adopt {{device}}', {
          device: discoveredTitle(device, vendor?.name ?? ''),
        });
  const where =
    device === undefined
      ? ''
      : `${vendor?.name ?? device.vendorId} ${device.model ?? choices.join(' or ')}, at ${device.address}.`;
  const isAsking = transportGroup.fields.length > 0 || optionsGroup.fields.length > 0;

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      title={title}
      description={t(
        'library.adoptDialog.whereItIsAdded',
        '{{where}} It is added as one typed in would be, and the hub starts talking to it at once.',
        { where },
      )}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button isBusy={adopt.isPending} disabled={adopt.isPending} onClick={submit}>
            {t('library.adoptDialog.adopt', 'Adopt')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <NameIconField
          value={name}
          onChange={(value) => {
            setName(value);
            setNameEdited(true);
          }}
          icon={icon}
          onIconChange={(view) => {
            setIcon(view.id);
          }}
          hint={
            device?.name === null || device?.name === undefined
              ? t(
                  'library.adoptDialog.deviceGaveNoName',
                  'The device gave no name of its own; it starts as its model.',
                )
              : t(
                  'library.adoptDialog.nameTheDeviceWas',
                  'The name the device was given in its own app.',
                )
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
          hint={t(
            'library.adoptDialog.whatAutomationsAndScenes',
            'What automations and scenes will pick this device by.',
          )}
        />

        <SelectField
          label={t('library.adoptDialog.room', 'Room')}
          options={rooms}
          value={areaId ?? ''}
          hint={
            rooms.length === 1
              ? t(
                  'library.adoptDialog.noRoomsYetMake',
                  'No rooms yet: make the house, its floors and their rooms under Areas.',
                )
              : t(
                  'library.adoptDialog.itsEntitiesAreIn',
                  'Its entities are in the same room unless one of them says otherwise.',
                )
          }
          onChange={(value) => {
            setAreaId(value === '' ? null : value);
          }}
        />

        {choices.length > 1 ? (
          <SelectField
            label={t('library.adoptDialog.model', 'Model')}
            options={choices.map((each) => ({ value: each, label: each }))}
            value={model}
            hint={t(
              'library.adoptDialog.deviceSaidWhichFamily',
              'The device said which family it is, not which of it.',
            )}
            onChange={(value) => {
              setModel(value);

              if (!isNameEdited && (device?.name === null || device?.name === undefined)) {
                // The name still reads as the model, so it follows the pick.
                setName(value);
              }
            }}
          />
        ) : null}

        {isAsking ? (
          <div className="flex flex-col gap-4">
            <SetupForm
              group={transportGroup}
              draft={transportDraft}
              errors={errors.transport}
              kept={[]}
              onChange={change('transport')}
            />
            <SetupForm
              group={optionsGroup}
              draft={optionsDraft}
              errors={errors.options}
              kept={[]}
              onChange={change('options')}
            />
          </div>
        ) : null}

        {errors.general === undefined ? null : (
          <p role="alert" className="text-ui text-danger">
            {errors.general}
          </p>
        )}
      </div>
    </Modal>
  );
}
