/**
 * An entity of a kind a package declared - a recording, a playlist, a zone (PACKAGES.md 6).
 *
 * A package that draws its kind (`ui.entityViews`) draws it here, inside the block, while it
 * runs. Any other - or one whose package is stopped, or gone - is shown as what its type says it
 * holds: each field with its label and its value, in the unit it is counted in, and a button for
 * each command that asks nothing. A field the type does not name is still shown, by its key, so an
 * entity of a package no longer installed keeps saying what it last reported.
 */
import type { PackageEntityField, PackageEntityType } from '@nebula-home/contracts';
import { Button } from '@nebula-home/ui';

import { absoluteTime } from '@/lib/format-time';
import { paramsOf } from '@/library/entity-control';
import { PackageSlot } from '@/packages/package-slot';
import { useInstalledPackages } from '@/packages/use-packages';
import {
  ControlBlock,
  isBusy,
  type ControlProps,
} from '@/routes/library/entity/controls/control-block';

/** A value an entity of a package's kind reports. */
type CustomValue = string | number | boolean | null;

/**
 * One value, as its field says it reads.
 *
 * @param field - The field, if the type names it.
 * @param value - What the entity reported.
 * @returns It, in words.
 */
function valueText(field: PackageEntityField | undefined, value: CustomValue | undefined): string {
  if (value === undefined || value === null) {
    return '—';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (field?.type === 'timestamp' && typeof value === 'string') {
    const at = new Date(value);

    return Number.isNaN(at.getTime()) ? value : absoluteTime(at);
  }

  if (field?.type === 'choice') {
    return field.choices?.find((choice) => choice.value === value)?.label ?? String(value);
  }

  if (typeof value === 'number') {
    return field?.unit === undefined ? String(value) : `${String(value)} ${field.unit}`;
  }

  return value;
}

/**
 * The fields and values, as a list.
 *
 * @param props - The type, if known, and what was reported.
 * @param props.type - The package's declaration of the kind.
 * @param props.values - What the entity reported.
 * @returns The list.
 */
function FieldList(props: {
  readonly type: PackageEntityType | undefined;
  readonly values: Readonly<Record<string, CustomValue>>;
}) {
  const { type, values } = props;
  const declared = type?.state ?? [];
  const named = new Set(declared.map((field) => field.key));
  const rows = [
    ...declared.map((field) => ({ key: field.key, label: field.label, field })),
    ...Object.keys(values)
      .filter((key) => !named.has(key))
      .map((key) => ({ key, label: key, field: undefined })),
  ];

  if (rows.length === 0) {
    return <p className="text-ui text-foreground-subtle">Nothing reported yet.</p>;
  }

  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-ui">
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <dt className="truncate text-foreground-muted">{row.label}</dt>
          <dd className="text-right text-foreground tabular">
            {valueText(row.field, values[row.key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Renders the block.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function CustomControl(props: ControlProps) {
  const { entity, state, commander, disabled } = props;
  const params = paramsOf(entity, 'custom');
  const { packages } = useInstalledPackages();
  const found = packages.find((each) => each.id === params?.packageId);
  const type = found?.entityTypes.find((each) => each.id === params?.type);
  const values = state.custom?.values ?? {};
  const viewType =
    found?.state === 'running' && params !== null && found.ui?.entityViews.includes(params.type)
      ? params.type
      : null;
  const isDrawnByPackage = viewType !== null;
  const plainCommands = (type?.commands ?? []).filter((command) => command.fields.length === 0);

  return (
    <ControlBlock
      title={type?.name ?? 'Details'}
      {...(found === undefined ? {} : { value: found.name })}
    >
      {found !== undefined && viewType !== null ? (
        <PackageSlot
          found={found}
          target={{
            kind: 'entityView',
            type: viewType,
            props: { entityId: entity.entityId },
          }}
          loading={<FieldList type={type} values={values} />}
          renderProblem={(message) => (
            <div className="flex flex-col gap-3">
              <FieldList type={type} values={values} />
              <p role="alert" className="text-caption text-danger">
                {found.name} could not draw this: {message}
              </p>
            </div>
          )}
        />
      ) : (
        <FieldList type={type} values={values} />
      )}

      {isDrawnByPackage || plainCommands.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {plainCommands.map((command) => (
            <Button
              key={command.id}
              size="compact"
              variant="ghost"
              disabled={disabled}
              isBusy={isBusy(props, 'custom')}
              onClick={() => {
                commander.send('custom', { command: command.id, args: {} });
              }}
            >
              {command.name}
            </Button>
          ))}
        </div>
      )}
    </ControlBlock>
  );
}
