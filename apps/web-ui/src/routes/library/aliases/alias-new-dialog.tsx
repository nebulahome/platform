/**
 * New alias: one dialog, as the platform draws a create flow - the alias mark before the title,
 * the name and icon with the room, the type (searched by name and words, every type of the
 * backend), the parts it brings in two lines, and the device it goes on: a virtual one (the shared
 * "Aliases", one of the owner's, or a new one) or an existing device, whose room it takes.
 *
 * Create makes the alias with every required part Stored and opens its page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  ALIAS_TYPE_GROUPS,
  type AliasCustomField,
  type AliasDeviceInput,
  type AliasTypeDef,
  type AliasTypeGroup,
  type AliasTypeId,
} from '@nebulahome/contracts';
import { AppIcon, Button, Modal, Segmented, SelectField, TextField, toast } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import {
  aliasDefs,
  groupLabel,
  partGroupLabel,
  searchTypes,
  typeLabel,
  typeOf,
  uiIcon,
} from '@/library/alias-model';
import { createAlias, fetchAliasDevices, fetchDevices, LIBRARY_QUERY_KEYS } from '@/library/api';
import { useInstalledPackages } from '@/packages/use-packages';
import { AreaKeyField } from '@/routes/library/area-key-field';
import { EntityField } from '@/routes/library/entity-field';
import { NameIconField } from '@/routes/library/name-icon-field';
import { SearchField } from '@/routes/library/search-field';

/** The query key of the virtual devices an alias can go on. */
export const ALIAS_DEVICES_KEY = [...LIBRARY_QUERY_KEYS.aliases, 'devices'] as const;

/** The choice that makes a new virtual device. */
const NEW_DEVICE = 'new';

/**
 * The alias mark: the tile before a dialog's title.
 *
 * @param props - The mark's tone.
 * @param props.tone - Danger for a deletion.
 * @returns The mark.
 */
export function AliasMark(props: { readonly tone?: 'danger' }) {
  return (
    <span
      className={`flex size-11 shrink-0 items-center justify-center rounded-tile border ${
        props.tone === 'danger'
          ? 'border-danger/40 bg-danger/12 text-danger'
          : 'border-primary/40 bg-primary/12 text-primary'
      }`}
    >
      <AppIcon id={props.tone === 'danger' ? 'trash-2' : 'sigma'} size={20} />
    </span>
  );
}

/** What the type picker needs. */
type TypePickerProps = {
  readonly value: AliasTypeId;
  readonly onChange: (type: AliasTypeId) => void;

  /** Tiles per row: three in a dialog, two on a phone. */
  readonly columns?: 2 | 3;
};

/**
 * The type picker: a search over names and words, the groups as a filter, compact tiles in a box
 * that scrolls; a search shows only what matches and lets the box grow.
 *
 * @param props - See {@link TypePickerProps}.
 * @returns The picker.
 */
export function TypePicker(props: TypePickerProps) {
  const { t } = useTranslation();
  const { value, onChange, columns = 3 } = props;
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<AliasTypeGroup | 'all'>('all');
  const isSearching = query.trim() !== '';
  const found = searchTypes(query).filter(
    (match) => isSearching || group === 'all' || match.type.group === group,
  );
  const wanted = query.trim().toLowerCase();

  /**
   * A type's name with what was typed in it marked.
   *
   * @param name - The name.
   * @returns The name, marked.
   */
  const marked = (name: string): ReactNode => {
    const at = wanted === '' ? -1 : name.toLowerCase().indexOf(wanted);

    return at < 0 ? (
      name
    ) : (
      <>
        {name.slice(0, at)}
        <span className="text-primary">{name.slice(at, at + wanted.length)}</span>
        {name.slice(at + wanted.length)}
      </>
    );
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-ui-sm text-foreground-muted">
        {t('library.aliases.type', 'Type')}
      </legend>
      <SearchField
        placeholder={t('library.aliases.searchTypes', 'Search {{count}} types', {
          count: searchTypes('').length,
        })}
        value={query}
        onChange={setQuery}
        className="w-full lg:w-full"
      />
      {isSearching ? (
        <span className="text-caption text-foreground-subtle">
          {t('library.aliases.typeMatches', {
            count: found.length,
            defaultValue_one: '{{count}} match · names and words such as “heating”',
            defaultValue_other: '{{count}} matches · names and words such as “heating”',
          })}
        </span>
      ) : (
        <span className="flex flex-wrap gap-1.5">
          {(['all', ...ALIAS_TYPE_GROUPS] as const).map((each) => (
            <button
              key={each}
              type="button"
              aria-pressed={group === each}
              className={`rounded-pill border px-2.5 py-0.5 text-caption ${
                group === each
                  ? 'border-primary/60 bg-primary/10 text-foreground'
                  : 'border-border text-foreground-muted hover:text-foreground'
              }`}
              onClick={() => {
                setGroup(each);
              }}
            >
              {each === 'all' ? t('library.aliases.allTypes', 'All') : groupLabel(each)}
            </button>
          ))}
        </span>
      )}
      <div
        className={`relative overflow-y-auto rounded-inner border border-border bg-surface p-1.5 ${
          isSearching ? 'max-h-80' : 'h-[146px]'
        }`}
      >
        <div
          role="radiogroup"
          aria-label={t('library.aliases.type', 'Type')}
          className={`grid gap-1 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}
        >
          {found.map(({ type, word }) => {
            const isOn = type.id === value;

            return (
              <button
                key={type.id}
                type="button"
                role="radio"
                aria-checked={isOn}
                className={`flex h-10 items-center gap-2.5 rounded-field px-2.5 text-left text-ui-sm ${
                  isOn
                    ? 'bg-primary/10 font-medium text-foreground ring-1 ring-primary/50'
                    : 'text-foreground-muted hover:bg-surface-raised hover:text-foreground'
                }`}
                onClick={() => {
                  onChange(type.id);
                }}
              >
                <AppIcon
                  id={uiIcon(type.icon)}
                  size={15}
                  className={isOn ? 'shrink-0 text-primary' : 'shrink-0 text-foreground-subtle'}
                />
                <span className="truncate">{marked(typeLabel(type))}</span>
                {word === null ? null : (
                  <span className="ml-auto truncate text-caption text-foreground-subtle">
                    {word}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

/**
 * The chosen type's parts in two lines: what it must have, what it may.
 *
 * @param props - The type and, for a custom one, its fields.
 * @param props.type - The type.
 * @param props.customFields - A custom type's fields, once its package type is picked.
 * @returns The two lines.
 */
export function PartsPreview(props: {
  readonly type: AliasTypeDef;
  readonly customFields?: readonly AliasCustomField[] | undefined;
}) {
  const { t } = useTranslation();
  const defs = aliasDefs(props.type.id, props.customFields);
  // Parts added together (a target range) count once.
  /**
   * The names of the required or the optional parts.
   *
   * @param isRequired - Which.
   * @returns The names.
   */
  const names = (isRequired: boolean): string[] => [
    ...new Set(defs.filter((def) => def.isRequired === isRequired).map(partGroupLabel)),
  ];

  /**
   * One line: its label and up to four names.
   *
   * @param label - Required or Optional.
   * @param items - The names.
   * @param isMuted - Whether it reads quieter.
   * @returns The line.
   */
  const line = (label: string, items: readonly string[], isMuted: boolean): ReactNode => (
    <div className="flex gap-3">
      <span className="w-16 shrink-0 text-caption leading-5 text-foreground-subtle">{label}</span>
      <span
        className={`text-ui-sm leading-5 ${isMuted ? 'text-foreground-muted' : 'text-foreground'}`}
      >
        {items.length === 0 ? '—' : items.slice(0, 4).join(' · ')}
        {items.length > 4 ? (
          <span className="text-foreground-subtle"> · +{items.length - 4}</span>
        ) : null}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-1 rounded-inner bg-canvas px-3.5 py-2.5">
      {line(t('library.aliases.required', 'Required'), names(true), false)}
      {line(t('library.aliases.optional', 'Optional'), names(false), true)}
    </div>
  );
}

/** Where a new alias goes, as the dialog holds it. */
export type DeviceChoice = {
  readonly kind: 'virtual' | 'existing';

  /** For a virtual device: its id, or `new`. */
  readonly virtualId: string;

  /** For a new virtual device: its name. */
  readonly newName: string;

  /** For an existing device: its id. */
  readonly deviceId: string;
};

/**
 * The device field: virtual or existing, then which.
 *
 * @param props - The choice and how to change it.
 * @param props.value - The choice.
 * @param props.onChange - Called with the new choice.
 * @returns The field.
 */
export function DeviceField(props: {
  readonly value: DeviceChoice;
  readonly onChange: (value: DeviceChoice) => void;
}) {
  const { t } = useTranslation();
  const { value, onChange } = props;
  const virtual = useQuery({
    queryKey: ALIAS_DEVICES_KEY,
    /**
     * Reads the virtual devices.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The devices.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAliasDevices(signal),
  });
  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    /**
     * Reads the devices.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The devices.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchDevices(signal),
    enabled: value.kind === 'existing',
  });

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-ui-sm text-foreground-muted">
        {t('library.aliases.device', 'Device')}
      </span>
      <Segmented
        label={t('library.aliases.device', 'Device')}
        size="compact"
        className="self-start"
        options={[
          { value: 'virtual', label: t('library.aliases.virtualDevice', 'Virtual device') },
          { value: 'existing', label: t('library.aliases.existingDevice', 'Existing device') },
        ]}
        value={value.kind}
        onChange={(kind) => {
          onChange({ ...value, kind });
        }}
      />
      {value.kind === 'virtual' ? (
        <>
          <SelectField
            label={t('library.aliases.virtualDevice', 'Virtual device')}
            isLabelHidden
            options={[
              ...(virtual.data ?? []).map((device) => ({ value: device.id, label: device.name })),
              {
                value: NEW_DEVICE,
                label: t('library.aliases.newVirtualDevice', 'New virtual device…'),
              },
            ]}
            value={
              value.virtualId === ''
                ? (virtual.data?.find((device) => device.isShared)?.id ?? '')
                : value.virtualId
            }
            onChange={(virtualId) => {
              onChange({ ...value, virtualId });
            }}
            hint={t('library.aliases.virtualHint', 'Shared virtual device · or a new one')}
          />
          {value.virtualId === NEW_DEVICE ? (
            <TextField
              label={t('library.aliases.newDeviceName', 'Name of the new device')}
              value={value.newName}
              onChange={(event) => {
                onChange({ ...value, newName: event.target.value });
              }}
            />
          ) : null}
        </>
      ) : (
        <SelectField
          label={t('library.aliases.existingDevice', 'Existing device')}
          isLabelHidden
          options={[
            { value: '', label: t('library.aliases.chooseDevice', 'Choose a device…') },
            ...(devices.data ?? [])
              .toSorted((left, right) => left.name.localeCompare(right.name))
              .map((device) => ({
                value: device.id,
                label: device.model === null ? device.name : `${device.name} · ${device.model}`,
              })),
          ]}
          value={value.deviceId}
          onChange={(deviceId) => {
            onChange({ ...value, deviceId });
          }}
          hint={t('library.aliases.existingHint', 'Listed with the device’s own entities')}
        />
      )}
    </div>
  );
}

/** What the dialog needs. */
type NewAliasDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;

  /** Opens Import instead. */
  readonly onImport: () => void;
};

/**
 * The New alias dialog.
 *
 * @param props - See {@link NewAliasDialogProps}.
 * @returns The dialog.
 */
export function NewAliasDialog(props: NewAliasDialogProps) {
  const { t } = useTranslation();
  const { isOpen, onClose, onImport } = props;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { packages } = useInstalledPackages();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [area, setArea] = useState('');
  const [typeId, setTypeId] = useState<AliasTypeId>('sensor');
  const [custom, setCustom] = useState('');
  const [picture, setPicture] = useState('');
  const [device, setDevice] = useState<DeviceChoice>({
    kind: 'virtual',
    virtualId: '',
    newName: '',
    deviceId: '',
  });
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const virtual = useQuery({
    queryKey: ALIAS_DEVICES_KEY,
    /**
     * Reads the virtual devices, to name the shared one.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The devices.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAliasDevices(signal),
    enabled: isOpen,
  });
  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    /**
     * Reads the devices, for the room of the one picked.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The devices.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchDevices(signal),
    enabled: isOpen && device.kind === 'existing',
  });
  const type = typeOf(typeId);
  const customTypes = packages.flatMap((each) =>
    each.entityTypes.map((entityType) => ({
      value: `${each.id}/${entityType.id}`,
      label: `${entityType.name} · ${each.name}`,
      fields: entityType.state,
      packageId: each.id,
      type: entityType.id,
    })),
  );
  const chosenCustom = customTypes.find((each) => each.value === custom);
  const shared = virtual.data?.find((each) => each.isShared);
  const virtualId = device.virtualId === '' ? (shared?.id ?? '') : device.virtualId;
  const existing = devices.data?.find((each) => each.id === device.deviceId);
  const onName = device.kind === 'existing' ? existing?.name : undefined;

  const create = useMutation({
    /**
     * Creates the alias.
     *
     * @returns The alias.
     */
    mutationFn: async () => {
      const target: AliasDeviceInput =
        device.kind === 'existing'
          ? { kind: 'device', deviceId: device.deviceId }
          : virtualId === NEW_DEVICE
            ? { kind: 'new', name: device.newName.trim() }
            : virtualId === '' || virtualId === shared?.id
              ? { kind: 'shared' }
              : { kind: 'device', deviceId: virtualId };

      return createAlias({
        name: name.trim(),
        icon,
        area: device.kind === 'existing' || area === '' ? null : area,
        behavesAs: typeId,
        customType:
          chosenCustom === undefined
            ? null
            : { packageId: chosenCustom.packageId, type: chosenCustom.type },
        device: target,
        ...(typeId === 'image' ? { parts: { picture: { from: 'entity', entity: picture } } } : {}),
      });
    },

    /**
     * Opens the new alias.
     *
     * @param view - The alias.
     */
    onSuccess: async (view) => {
      await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.aliases });
      toast.success({
        title: t('library.aliases.created', '{{name}} created', { name: view.name }),
      });
      onClose();
      await navigate(`/aliases/${view.id}`);
    },

    /**
     * Says why it was not created.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      setProblem(toMessage(error));
    },
  });

  /**
   * Checks the form and creates the alias.
   */
  const onCreate = (): void => {
    const missing =
      name.trim() === ''
        ? t('library.aliases.nameNeeded', 'Give it a name')
        : typeId === 'custom' && chosenCustom === undefined
          ? t('library.aliases.customNeeded', 'Pick the package type it behaves as')
          : typeId === 'image' && picture === ''
            ? t('library.aliases.pictureNeeded', 'Pick the entity its picture comes from')
            : device.kind === 'existing' && device.deviceId === ''
              ? t('library.aliases.deviceNeeded', 'Pick the device it goes on')
              : device.kind === 'virtual' &&
                  virtualId === NEW_DEVICE &&
                  device.newName.trim() === ''
                ? t('library.aliases.deviceNameNeeded', 'Name the new device')
                : undefined;

    setProblem(missing);

    if (missing === undefined) {
      create.mutate();
    }
  };

  const where =
    device.kind === 'existing'
      ? t('library.aliases.onDevice', 'on {{name}}', { name: onName ?? '…' })
      : virtualId === NEW_DEVICE
        ? t('library.aliases.onNewDevice', 'on a new virtual device')
        : virtualId === '' || virtualId === shared?.id
          ? t('library.aliases.onShared', 'on the Aliases virtual device')
          : t('library.aliases.onDevice', 'on {{name}}', {
              name: virtual.data?.find((each) => each.id === virtualId)?.name ?? '…',
            });

  return (
    <Modal
      isOpen={isOpen}
      size="large"
      layout="card"
      lead={<AliasMark />}
      title={t('library.aliases.newAlias', 'New alias')}
      description={`${typeLabel(type)} · ${where}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="bare" onClick={onImport}>
            <AppIcon id="download" size={15} />
            {t('library.aliases.importFile', 'Import a file')}
          </Button>
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button isBusy={create.isPending} onClick={onCreate}>
              <AppIcon id="check" size={15} />
              {t('library.aliases.create', 'Create')}
            </Button>
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
          <NameIconField
            value={name}
            onChange={setName}
            icon={icon}
            fallback={uiIcon(type.icon)}
            onIconChange={(picked) => {
              setIcon(picked.id);
            }}
            required
            error={problem}
          />
          {device.kind === 'existing' ? (
            <SelectField
              label={t('library.aliases.room', 'Room')}
              options={[{ value: '', label: existing?.areaName ?? '—' }]}
              value=""
              onChange={() => undefined}
              disabled
              hint={t('library.aliases.fromTheDevice', 'From the device')}
            />
          ) : (
            <AreaKeyField
              label={t('library.aliases.room', 'Room')}
              value={area}
              onChange={setArea}
            />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <TypePicker value={typeId} onChange={setTypeId} />
          {typeId === 'custom' ? (
            <SelectField
              label={t('library.aliases.packageType', 'Package type')}
              options={[
                {
                  value: '',
                  label: t('library.aliases.choosePackageType', 'Choose a package type…'),
                },
                ...customTypes,
              ]}
              value={custom}
              onChange={setCustom}
            />
          ) : null}
          {typeId === 'image' ? (
            <EntityField
              label={t('library.aliases.pictureFrom', 'Picture from')}
              value={picture}
              onChange={setPicture}
              accept={(entity) => entity.domain === 'image' || entity.domain === 'camera'}
            />
          ) : null}
          <PartsPreview type={type} customFields={chosenCustom?.fields} />
        </div>
        <div className="border-t border-border pt-5">
          <DeviceField value={device} onChange={setDevice} />
        </div>
      </div>
    </Modal>
  );
}
