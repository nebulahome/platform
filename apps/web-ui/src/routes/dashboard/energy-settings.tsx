/**
 * An energy card's settings: which entity is each meter, and which way each counts.
 *
 * Every meter may be left empty: a house without panels has no panels meter, and the card then
 * draws no panels. The house's own meter is the one most houses lack, and the card works it out
 * from the others when it is not given. Meters disagree about signs, so the battery and the grid
 * each say which way they count.
 *
 * Each picker offers only what its meter can be - a power meter for the flows, a battery level for
 * the charge - as {@link ENERGY_CARD_REQUIREMENTS} says.
 */
import {
  ENERGY_CARD_REQUIREMENTS,
  HOUSE_STYLES,
  meetsRequirement,
  type HouseStyle,
  type DashboardCard,
  type DashboardEnergyCard,
  type EntityView,
} from '@nebulahome/contracts';
import { SelectField, Switch, TextField } from '@nebulahome/ui';

import { EntityField } from '@/routes/library/entity-field';

/** The fields that name a meter, what each is called, and the hint under it. */
const METER_FIELDS = [
  {
    field: 'solarPower',
    label: 'Solar panels',
    hint: 'What the panels produce now: a power meter, in W or kW.',
  },
  {
    field: 'batteryPower',
    label: 'Battery power',
    hint: 'What goes in or out of the battery now.',
  },
  { field: 'batteryLevel', label: 'Battery level', hint: 'How full it is, in percent.' },
  { field: 'gridPower', label: 'Grid', hint: 'What the house buys from or sells to the grid.' },
  {
    field: 'homePower',
    label: 'House',
    hint: 'What the house uses. Left empty, it is worked out from the others.',
  },
] as const;

/** What each house the card can draw is called. */
const HOUSE_STYLE_LABELS: Readonly<Record<HouseStyle, string>> = {
  european: 'European - a gabled house',
  american: 'American - a garage wing in front of the house',
  arabic: 'Arabic - flat roof and terrace',
};

/**
 * Narrows a choice to a house style.
 *
 * @param value - What the dropdown reported.
 * @returns The style, or the European one for anything else.
 */
function houseStyleOf(value: string): HouseStyle {
  return HOUSE_STYLES.find((style) => style === value) ?? 'european';
}

/**
 * What a meter's picker accepts.
 *
 * @param field - The meter.
 * @returns Whether an entity can be it.
 */
function acceptsFor(
  field: (typeof METER_FIELDS)[number]['field'],
): (entity: EntityView) => boolean {
  return (entity) => meetsRequirement(entity, ENERGY_CARD_REQUIREMENTS[field]);
}

/** What the settings need. */
export type EnergySettingsProps = {
  readonly card: DashboardEnergyCard;

  /** Changes the card. */
  readonly onChange: (update: (current: DashboardCard) => DashboardCard) => void;
};

/**
 * Renders the settings.
 *
 * @param props - See {@link EnergySettingsProps}.
 * @returns The fields.
 */
export function EnergySettings(props: EnergySettingsProps) {
  const { card, onChange } = props;

  /**
   * Changes one setting of the card.
   *
   * @param update - What to set.
   */
  const set = (update: Partial<DashboardEnergyCard>): void => {
    onChange((current) => (current.type === 'energy' ? { ...current, ...update } : current));
  };

  return (
    <div className="flex flex-col gap-3.5">
      <TextField
        label="Title"
        size="compact"
        value={card.title ?? ''}
        placeholder="Energy"
        hint="Empty for Energy."
        onChange={(event) => {
          const title = event.target.value;

          set({ title: title.trim() === '' ? null : title });
        }}
      />

      <SelectField
        label="House"
        size="compact"
        options={HOUSE_STYLES.map((style) => ({ value: style, label: HOUSE_STYLE_LABELS[style] }))}
        value={card.houseStyle}
        hint="The house the card draws; the panels, battery and wires sit on it the same way."
        onChange={(value) => {
          set({ houseStyle: houseStyleOf(value) });
        }}
      />

      {METER_FIELDS.map((meter) => (
        <div key={meter.field} className="flex flex-col gap-2">
          <EntityField
            label={meter.label}
            size="compact"
            value={card[meter.field] ?? ''}
            accept={acceptsFor(meter.field)}
            isOptional
            pickerTitle={`Which entity is the ${meter.label.toLowerCase()} meter?`}
            hint={meter.hint}
            onChange={(value, entity) => {
              set({ [meter.field]: value === '' ? null : (entity?.entityId ?? null) });
            }}
          />

          {meter.field === 'batteryPower' && card.batteryPower !== null ? (
            <div className="flex items-center justify-between gap-3 text-ui">
              <span aria-hidden="true">Discharging counts as positive</span>
              <Switch
                label="Discharging counts as positive"
                isOn={card.isBatteryDischargePositive}
                onChange={(isBatteryDischargePositive) => {
                  set({ isBatteryDischargePositive });
                }}
              />
            </div>
          ) : null}

          {meter.field === 'gridPower' && card.gridPower !== null ? (
            <div className="flex items-center justify-between gap-3 text-ui">
              <span aria-hidden="true">Buying counts as positive</span>
              <Switch
                label="Buying counts as positive"
                isOn={card.isGridImportPositive}
                onChange={(isGridImportPositive) => {
                  set({ isGridImportPositive });
                }}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
