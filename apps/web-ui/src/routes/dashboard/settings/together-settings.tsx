/**
 * The settings of a together card, in the floating panel, above its size
 * (`N-Dashboard-Card-Settings-Together`, `K-Aggregate` "Choosing members").
 *
 * Members by rule - the default - follow the house: every entity of the card's kind in an area, or
 * in the whole house, but the ones left out; the line under them says how many match now. By hand
 * the person picks them from the entities of the kind, and the list never changes alone. Then the
 * card's name and icon, as the board draws them for this card.
 */
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  CapabilityState,
  DashboardCard,
  DashboardTogetherCard,
  EntityView,
  TogetherDomain,
  TogetherMembers,
} from '@nebulahome/contracts';
import { AppIcon, cn, SelectField } from '@nebulahome/ui';

import { kindIcon, kindName } from '@/dashboard/card-options';
import { cardKindOf } from '@/dashboard/card-sizes';
import { defineMessage, text, type Message } from '@/i18n/messages';
import { matchesQuery } from '@/lib/search-text';
import { signalled } from '@/lib/signalled';
import { fetchAreas, LIBRARY_QUERY_KEYS } from '@/library/api';
import { capabilityStateOf } from '@/library/entity-control';
import { useCardSample } from '@/routes/dashboard/cards/card-sample';
import { togetherMembers } from '@/routes/dashboard/cards/together-members';
import { MemberMarks, membersCount } from '@/routes/dashboard/cards/together-parts';
import type { TypeSettingsProps } from '@/routes/dashboard/settings/type-settings';
import { NameIconField } from '@/routes/library/name-icon-field';

/** What the members of each kind are called, together: "lights". */
const NOUNS: Readonly<Record<TogetherDomain, Message>> = {
  light: defineMessage('dashboard.togetherSettings.lights', 'lights'),
  switch: defineMessage('dashboard.togetherSettings.switches', 'switches'),
  cover: defineMessage('dashboard.togetherSettings.covers', 'covers'),
  lock: defineMessage('dashboard.togetherSettings.locks', 'locks'),
  thermostat: defineMessage('dashboard.togetherSettings.thermostats', 'thermostats'),
};

/** The colour a member's mark is lit in, by kind. */
const LIT: Readonly<Record<TogetherDomain, string>> = {
  light: 'text-lamp',
  switch: 'text-primary',
  cover: 'text-cyan',
  lock: 'text-success',
  thermostat: 'text-heat',
};

/**
 * Whether a member is on, open, locked or working: its mark is lit.
 *
 * @param domain - Its kind.
 * @param state - Its state.
 * @returns True when it is.
 */
function isLitIn(domain: TogetherDomain, state: CapabilityState): boolean {
  switch (domain) {
    case 'light':
    case 'switch':
      return state.on_off?.isOn ?? (state.level?.level ?? 0) > 0;
    case 'cover':
      return (state.cover?.position ?? 0) > 0;
    case 'lock':
      return state.lock?.lockState === 'locked';
    case 'thermostat':
      return state.thermostat !== undefined && state.thermostat.mode !== 'off';
  }
}

/**
 * Renders a field's label row, as the panel's own fields have it, and the control.
 *
 * @param props - The field.
 * @param props.label - What it sets.
 * @param props.children - The control.
 * @returns The field.
 */
function Field(props: { readonly label: string; readonly children: ReactNode }) {
  const { label, children } = props;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex h-4.5 items-center text-caption text-foreground-subtle">{label}</span>
      {children}
    </div>
  );
}

/** What the pick list needs. */
type PickListProps = {
  /** The entities offered. */
  readonly entities: readonly EntityView[];

  /** The ones chosen, by address. */
  readonly chosen: ReadonlySet<string>;

  /** What the search says while empty: "Search lights". */
  readonly placeholder: string;

  /** When one is pressed: chosen, or chosen no more. */
  readonly onToggle: (entity: EntityView) => void;
};

/**
 * Renders a search and the entities it finds, the chosen ones ticked: the members picked by hand,
 * or the ones a rule leaves out.
 *
 * @param props - See {@link PickListProps}.
 * @returns The list.
 */
function PickList(props: PickListProps) {
  const { t } = useTranslation();

  const { entities, chosen, placeholder, onToggle } = props;
  const [query, setQuery] = useState('');
  const shown = entities.filter((entity) =>
    matchesQuery([entity.name, entity.areaName, entity.entityId], query),
  );

  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex h-9.5 items-center gap-2 rounded-tile border border-border-strong bg-surface px-3 text-ui-sm text-foreground-subtle focus-within:border-primary">
        <AppIcon id="search" size={15} />
        <input
          type="search"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 grow bg-transparent text-foreground outline-none placeholder:text-foreground-subtle"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </label>
      <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
        {shown.length === 0 ? (
          <li className="px-2.5 py-3 text-caption text-foreground-subtle">
            {t('dashboard.cardSettings.nothingFound', 'Nothing matches')}
          </li>
        ) : (
          shown.map((entity) => {
            const isChosen = chosen.has(entity.entityId);

            return (
              <li key={entity.entityId}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isChosen}
                  className={cn(
                    'flex h-9 w-full items-center gap-2.5 rounded-field px-2.5 text-left transition-colors duration-150',
                    'hover:bg-surface-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
                    isChosen && 'bg-surface-raised',
                  )}
                  onClick={() => {
                    onToggle(entity);
                  }}
                >
                  <span className="inline-flex w-3.5 shrink-0 text-primary">
                    {isChosen ? <AppIcon id="check" size={14} /> : null}
                  </span>
                  <span className="min-w-0 grow truncate text-ui-sm text-foreground">
                    {entity.name}
                  </span>
                  {entity.areaName === null ? null : (
                    <span className="shrink-0 text-caption text-foreground-subtle">
                      {entity.areaName}
                    </span>
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

/**
 * Changes a together card's members, from the card as the draft has it now.
 *
 * @param update - The new members, from the current ones.
 * @returns The change, for the panel's `onChange`.
 */
function withMembers(
  update: (members: TogetherMembers) => TogetherMembers,
): (current: DashboardCard) => DashboardCard {
  return (current) =>
    current.type === 'together' ? { ...current, members: update(current.members) } : current;
}

/**
 * Renders the settings.
 *
 * @param props - See {@link TypeSettingsProps}.
 * @returns The fields.
 */
export function TogetherSettings(props: TypeSettingsProps<DashboardTogetherCard>) {
  const { t } = useTranslation();

  const { card, data, onChange } = props;
  const { domain, members } = card;
  const sample = useCardSample();
  // A sample card asks no hub: its areas are the ones its entities name.
  const areas = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.areas,
    queryFn: signalled(fetchAreas),
    enabled: sample === null,
  });
  const [isAdding, setAdding] = useState(false);
  const entities = [...data.entityById.values()];
  const ofKind = entities.filter(
    (entity) => entity.isEnabled && !entity.isHidden && cardKindOf(entity) === domain,
  );
  const found = togetherMembers(card, entities, areas.data ?? []);
  const noun = text(NOUNS[domain]);
  const known = areas.data?.map((area) => ({ value: area.key, label: area.name }));
  const named = [
    ...new Map(
      ofKind.flatMap((entity) =>
        entity.areaKey === null || entity.areaName === null
          ? []
          : [[entity.areaKey, { value: entity.areaKey, label: entity.areaName }] as const],
      ),
    ).values(),
  ];
  const areaKey = members.mode === 'rule' ? members.areaKey : null;
  const areaName =
    areaKey === null
      ? null
      : ((known ?? named).find((option) => option.value === areaKey)?.label ?? null);
  const marks = found
    .map((entity) => ({
      id: entity.entityId,
      icon: kindIcon(`together-${domain}`),
      isOn: isLitIn(domain, capabilityStateOf(entity, data.readings[entity.entityId])),
    }))
    .sort((a, b) => Number(b.isOn) - Number(a.isOn));

  /**
   * Chooses how the members are chosen: by hand starts from the ones the rule finds now, by rule
   * from the area the first of them is in.
   *
   * @param mode - By rule or by hand.
   */
  const chooseMode = (mode: TogetherMembers['mode']): void => {
    setAdding(false);
    onChange(
      withMembers((current) => {
        if (current.mode === mode) {
          return current;
        }

        return mode === 'hand'
          ? { mode, entityIds: found.map((entity) => entity.entityId) }
          : { mode, areaKey: found[0]?.areaKey ?? null, exclude: [] };
      }),
    );
  };

  /**
   * Picks an entity by hand, or picks it no more.
   *
   * @param entity - The entity.
   */
  const togglePicked = (entity: EntityView): void => {
    onChange(
      withMembers((current) =>
        current.mode !== 'hand'
          ? current
          : {
              ...current,
              entityIds: current.entityIds.includes(entity.entityId)
                ? current.entityIds.filter((id) => id !== entity.entityId)
                : [...current.entityIds, entity.entityId],
            },
      ),
    );
  };

  /**
   * Leaves an entity out of the rule, or lets it back in.
   *
   * @param entity - The entity.
   */
  const toggleLeftOut = (entity: EntityView): void => {
    onChange(
      withMembers((current) =>
        current.mode !== 'rule'
          ? current
          : {
              ...current,
              exclude: current.exclude.includes(entity.entityId)
                ? current.exclude.filter((id) => id !== entity.entityId)
                : [...current.exclude, entity.entityId],
            },
      ),
    );
  };

  const modes = [
    { value: 'rule', label: t('dashboard.togetherSettings.byRule', 'By rule') },
    { value: 'hand', label: t('dashboard.togetherSettings.byHand', 'By hand') },
  ] as const;

  return (
    <>
      <Field label={t('dashboard.togetherSettings.members', 'Members')}>
        <div
          role="radiogroup"
          aria-label={t('dashboard.togetherSettings.members', 'Members')}
          className="flex gap-1 rounded-pill border border-border-strong bg-surface p-1"
        >
          {modes.map((mode) => {
            const isOn = members.mode === mode.value;

            return (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={isOn}
                className={cn(
                  'flex h-7.5 flex-1 items-center justify-center rounded-pill text-ui-sm whitespace-nowrap',
                  'transition-[background-color,color] duration-150 ease-out',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
                  isOn
                    ? 'bg-surface-high font-medium text-foreground'
                    : 'text-foreground-muted hover:text-foreground',
                )}
                onClick={() => {
                  chooseMode(mode.value);
                }}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </Field>

      {members.mode === 'rule' ? (
        <>
          <SelectField
            label={t('dashboard.togetherSettings.where', 'Where')}
            size="compact"
            options={[
              {
                value: '',
                label: t('dashboard.togetherSettings.wholeHouse', 'Whole house'),
              },
              ...(known ?? named),
            ]}
            value={members.areaKey ?? ''}
            onChange={(value) => {
              setAdding(false);
              onChange(
                withMembers((current) =>
                  current.mode === 'rule'
                    ? { ...current, areaKey: value === '' ? null : value, exclude: [] }
                    : current,
                ),
              );
            }}
          />

          <Field label={t('dashboard.togetherSettings.leaveOut', 'Leave out')}>
            <div className="flex flex-wrap items-center gap-2">
              {members.exclude.map((entityId) => {
                const name = data.entityById.get(entityId)?.name ?? entityId;

                return (
                  <span
                    key={entityId}
                    className="inline-flex h-7.5 items-center gap-1.5 rounded-pill border border-border-strong bg-surface-raised pr-1.5 pl-3 text-caption font-medium text-foreground"
                  >
                    {name}
                    <button
                      type="button"
                      aria-label={t(
                        'dashboard.togetherSettings.letBackIn',
                        'Let {{name}} back in',
                        {
                          name,
                        },
                      )}
                      className="press-scale inline-flex size-5 items-center justify-center rounded-full text-foreground-subtle transition-colors duration-150 hover:text-foreground"
                      onClick={() => {
                        onChange(
                          withMembers((current) =>
                            current.mode === 'rule'
                              ? {
                                  ...current,
                                  exclude: current.exclude.filter((id) => id !== entityId),
                                }
                              : current,
                          ),
                        );
                      }}
                    >
                      <AppIcon id="x" size={11} />
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                aria-expanded={isAdding}
                className="press-scale inline-flex h-7.5 items-center gap-1.5 rounded-pill px-2.5 text-ui-sm text-foreground-muted transition-colors duration-150 hover:text-foreground"
                onClick={() => {
                  setAdding(!isAdding);
                }}
              >
                <AppIcon id={isAdding ? 'check' : 'plus'} size={14} />
                {isAdding
                  ? t('dashboard.togetherSettings.done', 'Done')
                  : t('dashboard.togetherSettings.add', 'Add')}
              </button>
            </div>
            {isAdding ? (
              <PickList
                entities={togetherMembers(
                  { domain, members: { ...members, exclude: [] } },
                  entities,
                  areas.data ?? [],
                )}
                chosen={new Set(members.exclude)}
                placeholder={t('dashboard.togetherSettings.searchKind', 'Search {{kind}}', {
                  kind: noun,
                })}
                onToggle={toggleLeftOut}
              />
            ) : null}
          </Field>

          <div className="flex min-w-0 items-center justify-between gap-2.5 border-t border-border pt-3.5">
            <MemberMarks marks={marks} lit={LIT[domain]} />
            <span className="shrink-0 text-caption text-foreground-muted tabular-nums">
              {t('dashboard.togetherSettings.matchNow', {
                count: found.length,
                members: membersCount(domain, found.length),
                defaultValue_one: '{{members}} matches now',
                defaultValue_other: '{{members}} match now',
              })}
            </span>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <PickList
            entities={ofKind}
            chosen={new Set(members.entityIds)}
            placeholder={t('dashboard.togetherSettings.searchKind', 'Search {{kind}}', {
              kind: noun,
            })}
            onToggle={togglePicked}
          />
          <div className="flex min-w-0 items-center justify-between gap-2.5 border-t border-border pt-3 text-caption">
            <span className="text-foreground-muted tabular-nums">
              {t('dashboard.togetherSettings.picked', {
                count: members.entityIds.length,
                defaultValue_one: '{{count}} picked',
                defaultValue_other: '{{count}} picked',
              })}
            </span>
            <span className="text-foreground-subtle">
              {t('dashboard.togetherSettings.onlyKind', 'Only {{kind}} can join', { kind: noun })}
            </span>
          </div>
        </div>
      )}

      <NameIconField
        label={t('dashboard.cardSettings.nameAndIcon', 'Name and icon')}
        value={card.title ?? ''}
        placeholder={areaName ?? kindName(`together-${domain}`)}
        fallback={kindIcon(`together-${domain}`)}
        onChange={(name) => {
          onChange((current) =>
            current.type === 'together'
              ? { ...current, title: name.trim() === '' ? null : name }
              : current,
          );
        }}
        icon={card.icon}
        onIconChange={(view) => {
          onChange((current) =>
            current.type === 'together' ? { ...current, icon: view.id } : current,
          );
        }}
      />
    </>
  );
}
