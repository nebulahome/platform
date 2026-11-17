/**
 * An entity of a kind a package defines - a print job, a recording - as a grid of its fields.
 *
 * Each field is its label and its value, read the way its package's type says: a choice by its
 * label, a number in its unit, a moment as a time. The strip shows the first four; the square
 * puts the first in a line of its own and the next six in a grid under it. A field the type does not
 * name is still shown, by its key, so an entity of a package no longer installed keeps saying what
 * it last reported.
 */
import { useTranslation } from 'react-i18next';

import type { PackageEntityField } from '@nebulahome/contracts';
import { cn } from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import { useInstalledPackages } from '@/packages/use-packages';
import { Caption, CardHead } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { StatCell } from '@/routes/dashboard/cards/control-parts';
import { cardTime, sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';

/** A value an entity of a package's kind reports. */
type CustomValue = string | number | boolean | null;

/** One field as the card draws it. */
type Row = { readonly key: string; readonly label: string; readonly text: string };

/**
 * A field's value, as its field says it reads.
 *
 * @param field - The field, if the type names it.
 * @param value - What the entity reported.
 * @returns It, in words.
 */
function fieldText(field: PackageEntityField | undefined, value: CustomValue | undefined): string {
  if (value === undefined || value === null) {
    return '—';
  }

  if (typeof value === 'boolean') {
    return value
      ? translate('dashboard.cards.custom.yes', 'Yes')
      : translate('dashboard.cards.custom.no', 'No');
  }

  if (typeof value === 'number') {
    const figure = numberFormat({ maximumFractionDigits: 2 }).format(value);

    return field?.unit === undefined ? figure : `${figure} ${field.unit}`;
  }

  if (field?.type === 'timestamp') {
    const at = new Date(value);

    return Number.isNaN(at.getTime()) ? value : cardTime(at);
  }

  return field?.choices?.find((choice) => choice.value === value)?.label ?? value;
}

/**
 * Renders a package entity's card.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function CustomCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title } = model;
  const params = paramsOf(entity, 'custom');
  const { packages } = useInstalledPackages();
  const type = packages
    .find((each) => each.id === params?.packageId)
    ?.entityTypes.find((each) => each.id === params?.type);
  const values = state.custom?.values ?? {};
  const declared = type?.state ?? [];
  const named = new Set(declared.map((field) => field.key));
  const rows: Row[] = [
    ...declared.map((field) => ({
      key: field.key,
      label: field.label,
      text: fieldText(field, values[field.key]),
    })),
    ...Object.keys(values)
      .filter((key) => !named.has(key))
      .map((key) => ({
        key,
        // `nozzleTemp` reads "Nozzle temp".
        label: key
          .replace(/(?<lower>[a-z])(?<upper>[A-Z])/gu, '$<lower> $<upper>')
          .replace(/^./u, (first) => first.toUpperCase()),
        text: fieldText(undefined, values[key]),
      })),
  ];
  const head = <CardHead model={model} isActive={null} />;
  const tone = model.isOffline ? 'text-foreground-subtle' : undefined;

  /**
   * Draws fields as cells.
   *
   * @param some - The fields.
   * @returns The cells.
   */
  const cells = (some: readonly Row[]) =>
    some.map((row) => (
      <StatCell key={row.key} label={row.label}>
        <span className={tone}>{row.text}</span>
      </StatCell>
    ));

  if (rows.length === 0) {
    return (
      <CardFrame label={title}>
        {head}
        <div className="grow" />
        <Caption>{t('dashboard.cards.custom.nothingYet', 'Nothing reported yet')}</Caption>
      </CardFrame>
    );
  }

  if (sizeKey(model.size) === '2x1') {
    return (
      <CardFrame label={title}>
        <div className="flex h-full min-w-0 items-center gap-5">
          <div className="w-[190px] shrink-0">{head}</div>
          <div className="grid min-w-0 grow grid-cols-4 gap-3">{cells(rows.slice(0, 4))}</div>
        </div>
      </CardFrame>
    );
  }

  const [first, ...rest] = rows;

  return (
    <CardFrame label={title}>
      {head}
      {first === undefined ? null : (
        <div className="mt-3.5 flex min-w-0 items-baseline justify-between gap-2.5">
          <span className={cn('truncate text-ui font-medium', tone)}>{first.text}</span>
          <Caption>{first.label}</Caption>
        </div>
      )}
      <div className="grow" />
      {rest.length === 0 ? null : (
        <div className="grid grid-cols-3 gap-x-4 gap-y-3.5 border-t border-border pt-3.5">
          {cells(rest.slice(0, 6))}
        </div>
      )}
    </CardFrame>
  );
}
