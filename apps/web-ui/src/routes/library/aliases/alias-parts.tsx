/**
 * The Parts tab: every part of the alias as a row with its last 24 hours, its source under its
 * name and its value now. A row opens in place to change where the part takes its value from -
 * Stored, an Entity, several Entities, a Formula or Code, as many as its kind takes - and that
 * source's settings, and its actions: what it does when a command reaches it or its value changes
 * (`alias-actions.tsx`). Optional parts are added from Add a part (they start Stored) and removed
 * from their own row.
 *
 * While a number part's source is being edited, its chart draws the edited source over the same
 * 24 hours as a dashed line beside the saved one.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ALIAS_RULES_BY_KIND,
  ALIAS_SOURCES_BY_KIND,
  aliasCodeExpectation,
  aliasEnumValues,
  defaultAliasPart,
  fitReturn,
  LOCATION_SOURCES,
  NUMBER_MODES,
  type AliasActionLastRun,
  type AliasDisplay,
  type AliasPartConfig,
  type AliasPartDef,
  type AliasParts,
  type AliasPartSettings,
  type AliasSource,
  type AliasTypeDef,
  type CheckedFunction,
  type EntityView,
  type StateHistoryPoint,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  IconButton,
  Menu,
  Segmented,
  SelectField,
  Switch,
  TextField,
  type MenuItem,
  type UiIconId,
} from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';
import {
  formatPartValue,
  partGroupLabel,
  partLabel,
  partValueOf,
  readable,
  ruleLabel,
  sourceChip,
  sourceLabel,
  uiIcon,
} from '@/library/alias-model';
import { useEditPreview } from '@/library/use-alias-preview';
import { useCauseNames } from '@/library/use-cause-names';
import { PartActions } from '@/routes/library/aliases/alias-actions';
import {
  NoValues,
  PartChart,
  partTrack,
  type ChartWindow,
} from '@/routes/library/aliases/alias-charts';
import { EntityFormulaInput } from '@/routes/library/aliases/entity-formula-input';
import { EntityField } from '@/routes/library/entity-field';
import { EntityPicker } from '@/routes/library/entity-picker/entity-picker';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';

/** The columns of a row: the part, its chart, its value now, its toggle. */
// On a phone a part is a card: its name and source, its value; the chart needs a wider window.
const COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_auto_28px] items-center gap-3 px-4 ' +
  'md:grid-cols-[236px_minmax(0,1fr)_84px_28px]';

/** A formula to show in an empty field: code, never translated. */
const FORMULA_EXAMPLE = 'avg(sensor.kitchen_humidity, sensor.hall_humidity)';

/** The settings a part carries whatever its source. */
const SETTING_KEYS = [
  'min',
  'max',
  'step',
  'offered',
  'options',
  'numberMode',
  'assumed',
  'code',
  'speeds',
  'locationSource',
  'actions',
] as const;

/**
 * A part's settings, without its source.
 *
 * @param config - The part.
 * @returns Its settings.
 */
function settingsOf(config: AliasPartConfig): AliasPartSettings {
  const settings: Record<string, unknown> = {};

  for (const key of SETTING_KEYS) {
    if (config[key] !== undefined) {
      settings[key] = config[key];
    }
  }

  return settings;
}

/**
 * A part moved to another source, keeping its settings.
 *
 * @param def - The part.
 * @param config - Where it takes its value from now.
 * @param source - Where it is to take it from.
 * @param now - Its value now, for a part turned Stored.
 * @returns The part.
 */
export function switchSource(
  def: AliasPartDef,
  config: AliasPartConfig,
  source: AliasSource,
  now: unknown,
): AliasPartConfig {
  const settings = settingsOf(config);

  switch (source) {
    case 'stored': {
      const kept = def.kind === 'color' || now === undefined ? defaultAliasPart(def) : null;

      return {
        ...settings,
        from: 'stored',
        value: (kept?.from === 'stored' ? kept.value : now) as never,
      };
    }
    case 'entity':
      return {
        ...settings,
        from: 'entity',
        entity: (config.from === 'entities' ? config.entities[0] : '') as never,
      };
    case 'entities':
      return {
        ...settings,
        from: 'entities',
        entities: config.from === 'entity' && config.entity !== '' ? [config.entity] : [],
        rule: ALIAS_RULES_BY_KIND[def.kind][0] ?? 'first',
      };
    case 'formula':
      return { ...settings, from: 'formula', formula: '' };
    case 'code':
      return { ...settings, from: 'code', function: def.key };
  }
}

/** What the tab needs. */
export type AliasPartsProps = {
  readonly type: AliasTypeDef;

  /** The type's parts, required first. */
  readonly defs: readonly AliasPartDef[];

  /** The parts as edited. */
  readonly parts: AliasParts;

  /** The parts as saved, for New and the edit preview. */
  readonly saved: AliasParts;

  readonly onChange: (parts: AliasParts) => void;

  /** The alias's state now. */
  readonly state: unknown;

  /** The alias's unit, for a reading. */
  readonly unit: string | null;

  /** The alias's changes over the window, oldest first; undefined while read. */
  readonly history: readonly StateHistoryPoint[] | undefined;
  readonly window: ChartWindow;

  readonly canEdit: boolean;

  /** Whether code can be chosen: developer mode is on. */
  readonly canUseCode: boolean;

  /** The functions of the alias's code, as the checker found them. */
  readonly functions: readonly CheckedFunction[];

  /** Opens the Code tab at a function; a new one is added from its template first. */
  readonly onOpenCode: (name: string, template?: { readonly def: AliasPartDef }) => void;

  /** The alias entity: an action that commands it is flagged. */
  readonly entityId: string;

  /** How each action last ran. */
  readonly lastActionRuns: readonly AliasActionLastRun[];
};

/**
 * The Parts tab.
 *
 * @param props - See {@link AliasPartsProps}.
 * @returns The timeline of the parts.
 */
export function AliasParts(props: AliasPartsProps) {
  const { t } = useTranslation();
  const { type, defs, parts, saved, onChange, window, canEdit } = props;
  const [open, setOpen] = useState<string | null>(null);
  const present = defs.filter((def) => parts[def.key] !== undefined);
  const groups = [
    {
      title: t('library.aliases.required', 'Required'),
      rows: present.filter((def) => def.isRequired),
    },
    {
      title: t('library.aliases.optional', 'Optional'),
      rows: present.filter((def) => !def.isRequired),
    },
  ].filter((group) => group.rows.length > 0);
  // Optional parts not there yet, a group once.
  const addable = defs.filter(
    (def, index) =>
      !def.isRequired &&
      parts[def.key] === undefined &&
      (def.group === undefined || defs.findIndex((other) => other.group === def.group) === index),
  );
  const hour = dateTimeFormat({ hour: '2-digit', minute: '2-digit' });
  const axis = [0, 6, 12, 18].map((hours) => ({
    hours,
    label: hour.format(window.from + hours * 3_600_000),
  }));

  /**
   * Adds an optional part, and the parts it goes with, Stored.
   *
   * @param def - The part.
   */
  const add = (def: AliasPartDef): void => {
    const together =
      def.group === undefined ? [def] : defs.filter((other) => other.group === def.group);
    const next: AliasParts = { ...parts };

    for (const each of together) {
      next[each.key] = defaultAliasPart(each);
    }

    onChange(next);
    setOpen(def.key);
  };

  /**
   * Removes an optional part, and the parts it goes with.
   *
   * @param def - The part.
   */
  const remove = (def: AliasPartDef): void => {
    const next: AliasParts = { ...parts };

    for (const each of def.group === undefined
      ? [def]
      : defs.filter((other) => other.group === def.group)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- a part is removed by its key
      delete next[each.key];
    }

    onChange(next);
    setOpen(null);
  };

  return (
    <div className="rounded-panel border border-border bg-surface">
      <div className="relative">
        <div>
          <div
            className={`${COLUMNS} border-b border-border py-3 font-mono text-label text-foreground-subtle uppercase`}
          >
            <span>{t('library.aliasPage.part', 'Part')}</span>
            <span className="hidden md:block">{t('library.aliasPage.last24h', 'Last 24 h')}</span>
            <span className="text-right">{t('library.aliases.now', 'Now')}</span>
            <span />
          </div>
          {groups.map((group) => (
            <div key={group.title}>
              <div className="flex items-center gap-2 border-b border-border bg-canvas/40 px-4 py-1.5">
                <span className="text-caption font-medium text-foreground-muted">
                  {group.title}
                </span>
                <span className="text-caption text-foreground-subtle">{group.rows.length}</span>
              </div>
              {group.rows.map((def) => (
                <PartRow
                  key={def.key}
                  {...props}
                  def={def}
                  isOpen={open === def.key}
                  onToggle={() => {
                    setOpen(open === def.key ? null : def.key);
                  }}
                  onRemove={() => {
                    remove(def);
                  }}
                  isNew={saved[def.key] === undefined}
                />
              ))}
            </div>
          ))}
          <div className={`${COLUMNS} py-2 max-md:hidden`}>
            <span className="flex items-center gap-1.5 text-caption text-foreground-subtle">
              <span className="size-[6px] rotate-45 rounded-[1px] bg-foreground" />
              {t('library.aliasPage.command', 'Command')}
            </span>
            <span className="relative h-4 font-mono text-label text-foreground-subtle">
              {axis.map(({ hours, label }) => (
                <span
                  key={hours}
                  className={`absolute top-0 ${hours === 0 ? '' : '-translate-x-1/2'}`}
                  // eslint-disable-next-line react/forbid-dom-props -- each label sits at its own hour
                  style={{ left: `${String((hours / 24) * 100)}%` }}
                >
                  {label}
                </span>
              ))}
              <span className="absolute top-0 right-0 bg-surface pl-1">
                {t('library.aliases.now', 'Now')}
              </span>
            </span>
            <span />
            <span />
          </div>
        </div>
      </div>
      {!canEdit || addable.length === 0 ? null : (
        <div className="flex items-center gap-3 border-t border-border px-4 py-3">
          <Menu
            items={addable.map((def): MenuItem => ({
              label: partGroupLabel(def),
              icon: uiIcon(def.icon),
              ...(def.group === undefined
                ? {}
                : {
                    description: defs
                      .filter((other) => other.group === def.group)
                      .map(partLabel)
                      .join(' · '),
                  }),
              /** Adds the part, Stored. */
              onSelect: () => {
                add(def);
              },
            }))}
            width="wide"
            align="start"
            trigger={({ isOpen, toggle, buttonRef }) => (
              <Button
                ref={buttonRef}
                variant="ghost"
                size="compact"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onClick={toggle}
              >
                <AppIcon id="plus" size={13} />
                {t('library.aliasPage.addPart', 'Add a part')}
                <AppIcon id="chevron-down" size={13} className="text-foreground-subtle" />
              </Button>
            )}
          />
          <span className="text-caption text-foreground-subtle">
            {t('library.aliasPage.available', '{{count}} available · {{type}}', {
              count: addable.length,
              type: type.label,
            })}
          </span>
        </div>
      )}
    </div>
  );
}

/** What one row needs. */
type PartRowProps = AliasPartsProps & {
  readonly def: AliasPartDef;
  readonly isOpen: boolean;
  readonly isNew: boolean;
  readonly onToggle: () => void;
  readonly onRemove: () => void;
};

/**
 * One part: its name and source, its last 24 hours, its value now; opened, its editor.
 *
 * @param props - See {@link PartRowProps}.
 * @returns The row.
 */
function PartRow(props: PartRowProps) {
  const { t } = useTranslation();
  const { def, parts, saved, state, unit, history, window, isOpen, isNew, onToggle } = props;
  const config = parts[def.key];
  const was = saved[def.key];
  const isEdited = JSON.stringify(config) !== JSON.stringify(was);
  const causeName = useCauseNames();
  const { nameOf } = useEntityNames();
  const time = dateTimeFormat({ hour: '2-digit', minute: '2-digit' });
  const preview = useEditPreview(
    def.kind === 'number' && isEdited && config !== undefined && config.from !== 'stored'
      ? config
      : undefined,
  );
  // Where the fold last came to rest: the editor stays mounted until it has folded shut.
  const [isSettledOpen, setSettledOpen] = useState(isOpen);

  if (config === undefined) {
    return null;
  }

  const chip = sourceChip(config, nameOf);
  const actionCount = config.actions?.length ?? 0;
  const hasFailed = props.lastActionRuns.some(
    (run) =>
      run.part === def.key &&
      run.result !== 'success' &&
      config.actions?.some((action) => action.id === run.actionId) === true,
  );
  const now = partValueOf(def, state);
  const { track, marks } =
    history === undefined
      ? { track: { kind: 'none' as const }, marks: [] }
      : partTrack(def, was, history, window, (point) => {
          const cause = causeName(point.context ?? null);

          return `${time.format(point.time)} · ${cause.label}`;
        });

  return (
    <div>
      {/* The chevron is the control a keyboard reaches; the row is a bigger target for a pointer. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the IconButton below is the keyboard path */}
      <div
        className={`${COLUMNS} group cursor-pointer border-b border-border py-2.5 transition-colors duration-200 ${
          isOpen ? 'bg-primary/[0.05]' : 'hover:bg-surface-raised/40'
        }`}
        onClick={(event) => {
          if ((event.target as Element).closest('button, a') === null) {
            onToggle();
          }
        }}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] transition-colors duration-200 ${
              isOpen
                ? 'bg-primary/15 text-primary'
                : 'bg-surface-raised text-foreground-muted group-hover:text-foreground'
            }`}
          >
            <AppIcon id={uiIcon(def.icon)} size={15} />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2 truncate text-ui-sm font-medium text-foreground">
              {partLabel(def)}
              {isNew ? (
                <span className="rounded-pill bg-primary/15 px-1.5 text-caption font-normal text-primary">
                  {t('library.aliases.new', 'New')}
                </span>
              ) : null}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                title={chip.text}
                className="flex h-6 max-w-full min-w-0 items-center gap-1.5 self-start rounded-pill border border-border bg-canvas pr-2.5 pl-2 text-caption text-foreground-muted"
              >
                <AppIcon id={chip.icon} size={12} className={`shrink-0 ${chip.tone}`} />
                <span className={`truncate ${chip.isMono ? 'font-mono text-mono-caption' : ''}`}>
                  {chip.text}
                </span>
              </span>
              {actionCount === 0 ? null : (
                <span
                  title={t('library.aliasActions.count', '{{count}} actions', {
                    count: actionCount,
                  })}
                  className={`flex h-6 shrink-0 items-center gap-1 rounded-pill border bg-canvas px-2 text-caption tabular ${
                    hasFailed
                      ? 'border-warning/40 text-warning'
                      : 'border-border text-foreground-muted'
                  }`}
                >
                  <AppIcon id="zap" size={12} className={hasFailed ? '' : 'text-primary'} />
                  {actionCount}
                </span>
              )}
            </span>
          </span>
        </span>
        <div className="relative hidden h-9 w-full md:block">
          {def.kind === 'number' || def.kind === 'boolean' || def.kind === 'enum' ? (
            <PartChart track={track} marks={marks} window={window} edited={preview} />
          ) : (
            <NoValues>{formatPartValue(def, now, unit)}</NoValues>
          )}
        </div>
        <span className="flex min-w-0 flex-col items-end">
          <span className="max-w-full truncate text-ui font-semibold text-foreground tabular">
            {formatPartValue(def, now, unit)}
          </span>
          {isEdited && !isNew ? (
            <span className="text-caption text-warning">
              {t('library.aliasPage.edited', 'Edited')}
            </span>
          ) : null}
        </span>
        <IconButton
          label={
            isOpen
              ? t('library.aliasPage.close', 'Close {{name}}', { name: partLabel(def) })
              : t('library.aliasPage.edit', 'Edit {{name}}', { name: partLabel(def) })
          }
          size="small"
          aria-expanded={isOpen}
          onClick={onToggle}
        >
          <AppIcon
            id="chevron-down"
            size={14}
            className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </IconButton>
      </div>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
        inert={!isOpen}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget) {
            setSettledOpen(isOpen);
          }
        }}
      >
        {/* Clipped only while it moves: open, its menus must reach past the row. */}
        <div className={isOpen && isSettledOpen ? '' : 'min-h-0 overflow-hidden'}>
          {isOpen || isSettledOpen ? (
            <div className="border-b border-border bg-canvas px-4 py-4">
              <PartEditor {...props} config={config} now={now} hasPreview={preview !== undefined} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The entities by id, named.
 *
 * @returns The lookup.
 */
function useEntityNames(): {
  readonly nameOf: (entityId: string) => string;
  readonly entityOf: (entityId: string) => EntityView | undefined;
  readonly entities: readonly EntityView[];
  readonly isOn: (entityId: string) => boolean | null;
} {
  const { entities, readings } = useEntityDirectory(false);
  const byId = new Map(entities.map((entity) => [entity.entityId as string, entity]));

  return {
    entities,
    /**
     * An entity's name.
     *
     * @param entityId - The entity.
     * @returns The name, or null.
     */
    nameOf: (entityId) => byId.get(entityId)?.name ?? entityId,
    /**
     * An entity, by id.
     *
     * @param entityId - The entity.
     * @returns The entity, or undefined.
     */
    entityOf: (entityId) => byId.get(entityId),
    /**
     * Whether an entity is on, for those that are on or off.
     *
     * @param entityId - The entity.
     * @returns On or off, or null for an entity that is neither.
     */
    isOn: (entityId) => {
      const live = readings[entityId]?.state ?? byId.get(entityId)?.state;
      const value = live as
        { on_off?: { isOn?: unknown }; sensor_binary?: { isOn?: unknown } } | undefined;
      const on = value?.on_off?.isOn ?? value?.sensor_binary?.isOn;

      return typeof on === 'boolean' ? on : null;
    },
  };
}

/**
 * One row of the editor: a label column and its fields.
 *
 * @param props - The row.
 * @param props.label - What it is.
 * @param props.children - Its fields.
 * @returns The row.
 */
function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3">
      <span className="pt-1.5 text-caption text-foreground-subtle">{props.label}</span>
      <div className="flex min-w-0 flex-col gap-1.5">{props.children}</div>
    </div>
  );
}

/**
 * A line under a field.
 *
 * @param props - The words.
 * @param props.children - The words.
 * @returns The line.
 */
function Hint(props: { readonly children: ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-caption text-foreground-subtle">
      {props.children}
    </span>
  );
}

/** What the editor needs. */
type PartEditorProps = PartRowProps & {
  readonly config: AliasPartConfig;
  readonly now: unknown;
  readonly hasPreview: boolean;
};

/**
 * A part opened: its source and that source's settings, its key, Remove the part and Done.
 *
 * @param props - See {@link PartEditorProps}.
 * @returns The editor.
 */
function PartEditor(props: PartEditorProps) {
  const { t } = useTranslation();
  const { def, config, parts, onChange, canEdit, canUseCode, now, onToggle, onRemove } = props;
  const { nameOf } = useEntityNames();
  const sources = ALIAS_SOURCES_BY_KIND[def.kind].filter(
    (source) => source !== 'code' || canUseCode || config.from === 'code',
  );

  /**
   * Changes the part.
   *
   * @param next - The part as it is to be.
   */
  const set = (next: AliasPartConfig): void => {
    onChange({ ...parts, [def.key]: next });
  };

  return (
    <div className="flex flex-col gap-4">
      <fieldset disabled={!canEdit} className="flex max-w-[560px] flex-col gap-3.5">
        <Field label={t('library.aliasPage.source', 'Source')}>
          {sources.length > 1 ? (
            <>
              <Segmented
                label={t('library.aliasPage.source', 'Source')}
                size="compact"
                className="self-start max-md:hidden"
                options={sources.map((source) => ({
                  value: source,
                  label: sourceLabel(source),
                }))}
                value={config.from}
                disabled={!canEdit}
                onChange={(source) => {
                  set(switchSource(def, config, source, now));
                }}
              />
              {/* A phone has no room for the five side by side. */}
              <span className="w-40 md:hidden">
                <SelectField
                  label={t('library.aliasPage.source', 'Source')}
                  isLabelHidden
                  size="compact"
                  options={sources.map((source) => ({ value: source, label: sourceLabel(source) }))}
                  value={config.from}
                  disabled={!canEdit}
                  onChange={(source) => {
                    const next = sources.find((each) => each === source);

                    if (next !== undefined) {
                      set(switchSource(def, config, next, now));
                    }
                  }}
                />
              </span>
            </>
          ) : (
            <span className="pt-1.5 text-ui-sm text-foreground">{sourceLabel(config.from)}</span>
          )}
        </Field>
        <SourceFields {...props} set={set} />
        <SettingFields def={def} config={config} set={set} />
      </fieldset>
      <PartActions
        def={def}
        defs={props.defs}
        parts={parts}
        config={config}
        set={set}
        canEdit={canEdit}
        aliasEntityId={props.entityId}
        lastRuns={props.lastActionRuns.filter((run) => run.part === def.key)}
        nameOf={nameOf}
      />
      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="font-mono text-mono-caption text-foreground-subtle">{def.key}</span>
        <span className="flex items-center gap-2">
          {def.isRequired || !canEdit ? null : (
            <Button
              variant="bare"
              size="compact"
              className="text-foreground-muted hover:enabled:bg-danger-soft hover:enabled:text-danger"
              onClick={onRemove}
            >
              <AppIcon id="trash-2" size={13} />
              {t('library.aliasPage.removePart', 'Remove the part')}
            </Button>
          )}
          <Button variant="ghost" size="compact" onClick={onToggle}>
            <AppIcon id="check" size={13} />
            {t('library.aliasPage.done', 'Done')}
          </Button>
        </span>
      </div>
    </div>
  );
}

/**
 * The fields of the part's source.
 *
 * @param props - The editor's props, and how to change the part.
 * @returns The fields.
 */
function SourceFields(props: PartEditorProps & { readonly set: (next: AliasPartConfig) => void }) {
  const { config } = props;

  switch (config.from) {
    case 'stored':
      return <StoredValue {...props} config={config} />;
    case 'entity':
      return <EntitySource {...props} config={config} />;
    case 'entities':
      return <EntitiesSource {...props} config={config} />;
    case 'formula':
      return <FormulaSource {...props} config={config} />;
    case 'code':
      return <CodeSource {...props} config={config} />;
  }
}

/**
 * Mireds as kelvin, or kelvin as mireds: the same sum both ways.
 *
 * @param value - The temperature, or undefined.
 * @returns The other unit, rounded; undefined for none or zero.
 */
function toKelvin(value: number | undefined): number | undefined {
  return value === undefined || value <= 0 ? undefined : Math.round(1_000_000 / value);
}

/**
 * A number typed in a text field: the text kept while it does not read as a number.
 *
 * @param props - The field's label, its value and how to change it.
 * @param props.label - What it is.
 * @param props.value - The number, or undefined for none.
 * @param props.onChange - Called with the number, or undefined when cleared.
 * @param props.suffix - A unit after it.
 * @returns The field.
 */
function NumberInput(props: {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (value: number | undefined) => void;
  readonly suffix?: string | undefined;
}) {
  const [text, setText] = useState(props.value === undefined ? '' : String(props.value));
  const shown =
    Number(text) === props.value || (text === '' && props.value === undefined)
      ? text
      : String(props.value ?? '');

  return (
    <span className="w-28">
      <TextField
        label={props.label}
        isLabelHidden
        size="compact"
        inputMode="decimal"
        value={shown}
        // A unit is a few letters: the field's room for a long one would hide the number.
        {...(props.suffix === undefined ? {} : { trail: props.suffix, className: 'pr-11' })}
        onChange={(event) => {
          const next = event.target.value.replace(',', '.');
          setText(next);

          if (next.trim() === '') {
            props.onChange(undefined);
          } else if (Number.isFinite(Number(next))) {
            props.onChange(Number(next));
          }
        }}
      />
    </span>
  );
}

/**
 * A stored part's value, by its kind.
 *
 * @param props - The editor's props, the stored part and how to change it.
 * @returns The fields.
 */
function StoredValue(
  props: PartEditorProps & {
    readonly config: Extract<AliasPartConfig, { from: 'stored' }>;
    readonly set: (next: AliasPartConfig) => void;
  },
) {
  const { t } = useTranslation();
  const { def, config, set, unit } = props;
  const value = config.value ?? (def.initial as never);
  const label = t('library.aliasPage.value', 'Value');

  switch (def.kind) {
    case 'number': {
      const isMireds = def.key === 'color_temp';

      return (
        <Field label={label}>
          <NumberInput
            label={label}
            value={
              typeof value === 'number'
                ? isMireds
                  ? Math.round(1_000_000 / value)
                  : value
                : undefined
            }
            suffix={isMireds ? 'K' : (def.unit ?? unit ?? undefined)}
            onChange={(next) => {
              set({
                ...config,
                value: next === undefined ? null : isMireds ? Math.round(1_000_000 / next) : next,
              });
            }}
          />
        </Field>
      );
    }
    case 'boolean':
      return (
        <Field label={label}>
          <span className="pt-1">
            <Switch
              label={label}
              isOn={value === true}
              onChange={(isOn) => {
                set({ ...config, value: isOn });
              }}
            />
          </span>
        </Field>
      );
    case 'enum': {
      const values = aliasEnumValues(def, config) ?? [];

      return (
        <Field label={label}>
          <span className="w-56">
            <SelectField
              label={label}
              isLabelHidden
              size="compact"
              options={[
                ...(def.isNullable === true
                  ? [{ value: '', label: t('library.aliasPage.none', 'None') }]
                  : []),
                ...values.map((each) => ({
                  value: each,
                  label:
                    config.options?.find((option) => option.value === each)?.label ??
                    readable(each),
                })),
              ]}
              value={typeof value === 'string' ? value : ''}
              onChange={(next) => {
                set({ ...config, value: next === '' ? null : next });
              }}
            />
          </span>
        </Field>
      );
    }
    case 'text':
      return (
        <Field label={label}>
          <TextField
            label={label}
            isLabelHidden
            size="compact"
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => {
              set({ ...config, value: event.target.value });
            }}
          />
        </Field>
      );
    case 'color': {
      const color =
        typeof value === 'object' && !Array.isArray(value) ? value : { hue: 0, saturation: 0 };

      return (
        <Field label={label}>
          <span className="flex items-center gap-2">
            <NumberInput
              label={t('library.aliasPage.hue', 'Hue')}
              value={color.hue}
              suffix="°"
              onChange={(hue) => {
                set({ ...config, value: { ...color, hue: Math.min(360, Math.max(0, hue ?? 0)) } });
              }}
            />
            <NumberInput
              label={t('library.aliasPage.saturation', 'Saturation')}
              value={color.saturation}
              suffix="%"
              onChange={(saturation) => {
                set({
                  ...config,
                  value: { ...color, saturation: Math.min(100, Math.max(0, saturation ?? 0)) },
                });
              }}
            />
          </span>
        </Field>
      );
    }
    case 'press':
      return (
        <Hint>
          {t('library.aliasPage.pressStored', 'A press is recorded, and shown as a mark.')}
        </Hint>
      );
    case 'picture':
    case 'rooms':
      return (
        <Hint>{t('library.aliasPage.onlyEntity', 'Only another entity has it: pick Entity.')}</Hint>
      );
  }
}

/**
 * One entity the part reads.
 *
 * @param props - The editor's props, the part and how to change it.
 * @returns The field.
 */
function EntitySource(
  props: PartEditorProps & {
    readonly config: Extract<AliasPartConfig, { from: 'entity' }>;
    readonly set: (next: AliasPartConfig) => void;
  },
) {
  const { t } = useTranslation();
  const { config, set } = props;
  const label = t('library.aliasPage.sources.entity', 'Entity');

  return (
    <Field label={label}>
      <EntityField
        label={label}
        isLabelHidden
        size="compact"
        value={config.entity}
        onChange={(entity) => {
          set({ ...config, entity: entity as never });
        }}
        hint={t('library.aliasPage.entityHint', 'Its same reading; a command is sent on to it.')}
      />
    </Field>
  );
}

/**
 * Several entities and how they combine.
 *
 * @param props - The editor's props, the part and how to change it.
 * @returns The fields.
 */
function EntitiesSource(
  props: PartEditorProps & {
    readonly config: Extract<AliasPartConfig, { from: 'entities' }>;
    readonly set: (next: AliasPartConfig) => void;
  },
) {
  const { t } = useTranslation();
  const { def, config, set } = props;
  const { nameOf, isOn } = useEntityNames();
  const [isPicking, setPicking] = useState(false);
  const rules = ALIAS_RULES_BY_KIND[def.kind];
  const on = config.entities.filter((id) => isOn(id) === true).length;
  const hasOnOff = config.entities.some((id) => isOn(id) !== null);

  return (
    <>
      <Field label={t('library.aliasPage.rule', 'Rule')}>
        <span className="w-48">
          <SelectField
            label={t('library.aliasPage.rule', 'Rule')}
            isLabelHidden
            size="compact"
            options={rules.map((rule) => ({ value: rule, label: ruleLabel(rule) }))}
            value={config.rule}
            onChange={(rule) => {
              set({ ...config, rule: rule as typeof config.rule });
            }}
          />
        </span>
      </Field>
      <Field label={t('library.aliasPage.sources.entities', 'Entities')}>
        <span className="flex flex-wrap gap-1.5">
          {config.entities.map((id) => (
            <span
              key={id}
              className="flex items-center gap-1.5 rounded-pill border border-border bg-surface py-0.5 pr-1 pl-2 text-caption text-foreground-muted"
            >
              {isOn(id) === null ? null : (
                <span
                  className={`size-1.5 rounded-full ${isOn(id) === true ? 'bg-foreground' : 'bg-foreground-subtle/50'}`}
                />
              )}
              {nameOf(id)}
              <button
                type="button"
                aria-label={t('library.aliasPage.removeEntity', 'Remove {{name}}', {
                  name: nameOf(id),
                })}
                className="flex size-4 items-center justify-center rounded-full text-foreground-subtle transition-colors hover:bg-surface-high hover:text-foreground"
                onClick={() => {
                  set({ ...config, entities: config.entities.filter((each) => each !== id) });
                }}
              >
                <AppIcon id="x" size={10} />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="flex items-center gap-1 rounded-pill px-1.5 text-caption text-primary transition-colors hover:bg-primary/10 hover:text-primary-hover"
            onClick={() => {
              setPicking(true);
            }}
          >
            <AppIcon id="plus" size={12} />
            {t('library.aliasPage.addEntity', 'Entity')}
          </button>
        </span>
        <Hint>
          {hasOnOff
            ? t('library.aliasPage.entitiesOn', '{{count}} entities · {{on}} on', {
                count: config.entities.length,
                on,
              })
            : t('library.aliasPage.entitiesCount', {
                count: config.entities.length,
                defaultValue_one: '{{count}} entity',
                defaultValue_other: '{{count}} entities',
              })}
        </Hint>
      </Field>
      <EntityPicker
        isOpen={isPicking}
        isMultiple
        value={config.entities}
        onClose={() => {
          setPicking(false);
        }}
        onChoose={(chosen) => {
          setPicking(false);
          set({ ...config, entities: chosen.map((entity) => entity.entityId) });
        }}
      />
    </>
  );
}

/**
 * A formula over entities, with entity completion.
 *
 * @param props - The editor's props, the part and how to change it.
 * @returns The field.
 */
function FormulaSource(
  props: PartEditorProps & {
    readonly config: Extract<AliasPartConfig, { from: 'formula' }>;
    readonly set: (next: AliasPartConfig) => void;
  },
) {
  const { t } = useTranslation();
  const { config, set, hasPreview } = props;

  return (
    <Field label={t('library.aliasPage.sources.formula', 'Formula')}>
      <EntityFormulaInput
        label={t('library.aliasPage.sources.formula', 'Formula')}
        value={config.formula}
        onChange={(formula) => {
          set({ ...config, formula });
        }}
        placeholder={FORMULA_EXAMPLE}
        aside={
          hasPreview ? (
            <span className="flex items-center gap-1.5 text-foreground-subtle">
              <span className="h-px w-4 border-t border-dashed border-violet" />
              {t('library.aliasPage.editedOver', 'Edited, over the same 24 h')}
            </span>
          ) : null
        }
      />
    </Field>
  );
}

/**
 * A function of the alias's code.
 *
 * @param props - The editor's props, the part and how to change it.
 * @returns The field.
 */
function CodeSource(
  props: PartEditorProps & {
    readonly config: Extract<AliasPartConfig, { from: 'code' }>;
    readonly set: (next: AliasPartConfig) => void;
  },
) {
  const { t } = useTranslation();
  const { def, config, set, parts, functions, onOpenCode, canUseCode } = props;
  const expectation = aliasCodeExpectation(def, config);
  const bound = new Set(
    Object.values(parts).flatMap((part) => (part.from === 'code' ? [part.function] : [])),
  );

  /**
   * What a function returns, in words.
   *
   * @param fn - The function.
   * @returns For example "Returns off, idle, heating…".
   */
  const returns = (fn: CheckedFunction): string => {
    const literals = fn.literalReturns
      .filter((value) => value !== null)
      .map((value) => JSON.stringify(value));

    return literals.length === 0
      ? t('library.aliasPage.returnsWorkedOut', 'Returns a worked-out value')
      : t('library.aliasPage.returns', 'Returns {{list}}', {
          list: literals.slice(0, 3).join(', ') + (literals.length > 3 ? '…' : ''),
        });
  };

  /**
   * Why a function cannot compute this part, if it cannot.
   *
   * @param fn - The function.
   * @returns The reason, or null when it fits.
   */
  const unfit = (fn: CheckedFunction): string | null => {
    if (fn.params.length > 0) {
      return t('library.aliasPage.takesArguments', 'Takes {{count}} arguments · helper', {
        count: fn.params.length,
      });
    }

    const misfit = fn.literalReturns.find(
      (value) => value !== null && !fitReturn(value, expectation).ok,
    );

    return misfit === undefined
      ? null
      : t('library.aliasPage.doesNotFit', 'Returns {{value}} · not a {{part}}', {
          value: JSON.stringify(misfit),
          part: partLabel(def).toLowerCase(),
        });
  };

  /**
   * A function name the code has not got yet.
   *
   * @param base - The name wanted.
   * @returns It, or it with a number.
   */
  const free = (base: string): string => {
    const taken = new Set(functions.map((fn) => fn.name));
    let name = base;

    for (let index = 2; taken.has(name); index += 1) {
      name = `${base}_${String(index)}`;
    }

    return name;
  };

  const chosen = functions.find((fn) => fn.name === config.function);
  const items: MenuItem[] = [
    ...functions.map((fn): MenuItem => {
      const reason = unfit(fn);

      return {
        label: `${fn.name}(${fn.params.join(', ')})`,
        icon: 'braces',
        description: `${returns(fn)} · ${
          fn.name === config.function
            ? t('library.aliasPage.thisPart', 'this part')
            : bound.has(fn.name)
              ? t('library.aliasPage.usedElsewhere', 'another part')
              : t('library.aliasPage.unused', 'unused')
        }`,
        ...(reason === null ? {} : { disabled: true, disabledReason: reason }),
        /** Binds the part to this function. */
        onSelect: () => {
          set({ ...config, function: fn.name });
        },
      };
    }),
    ...(canUseCode
      ? [
          {
            label: t('library.aliasPage.newFunction', 'New function'),
            icon: 'plus' as UiIconId,
            description: t(
              'library.aliasPage.newFunctionNote',
              'def {{name}}() with the template of the part',
              {
                name: free(def.key),
              },
            ),
            /** New function. */
            onSelect: () => {
              const name = free(def.key);

              set({ ...config, function: name });
              onOpenCode(name, { def });
            },
          },
        ]
      : []),
    {
      label: t('library.aliasPage.openInCode', 'Open in Code'),
      icon: 'external-link',
      description: t('library.aliasPage.openInCodeNote', 'Code tab, at this function'),
      /** Open in Code. */
      onSelect: () => {
        onOpenCode(config.function);
      },
    },
  ];

  return (
    <Field label={t('library.aliasPage.function', 'Function')}>
      <span className="flex items-center gap-1.5">
        <Menu
          items={items}
          width="wide"
          align="start"
          trigger={({ isOpen, toggle, buttonRef }) => (
            <button
              ref={buttonRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={toggle}
              className="flex h-control-sm w-56 items-center justify-between gap-2 rounded-field border border-border bg-surface-raised px-3 font-mono text-ui-sm text-foreground transition-colors hover:border-border-strong hover:bg-surface-high"
            >
              <span className="truncate">{config.function}()</span>
              <AppIcon id="chevron-down" size={14} className="shrink-0 text-foreground-subtle" />
            </button>
          )}
        />
        <Button
          variant="bare"
          size="compact"
          onClick={() => {
            onOpenCode(config.function);
          }}
        >
          <AppIcon id="external-link" size={13} />
          {t('library.aliasPage.openInCode', 'Open in Code')}
        </Button>
      </span>
      <Hint>
        {chosen === undefined
          ? t('library.aliasPage.noSuchFunction', 'There is no {{name}}() in the code yet', {
              name: config.function,
            })
          : returns(chosen)}
      </Hint>
    </Field>
  );
}

/**
 * The settings the part carries, whatever its source: its range, its offered names, a switch's
 * assumed state, a lock's code, a fan's speeds, a number's mode, a location's source.
 *
 * @param props - The part and how to change it.
 * @param props.def - The part.
 * @param props.config - Its configuration.
 * @param props.set - Changes it.
 * @returns The fields.
 */
function SettingFields(props: {
  readonly def: AliasPartDef;
  readonly config: AliasPartConfig;
  readonly set: (next: AliasPartConfig) => void;
}) {
  const { t } = useTranslation();
  const { def, config, set } = props;
  const settings = new Set(def.settings);
  const isOffered = settings.has('offered') || def.isOffered === true;

  return (
    <>
      {def.kind === 'number' &&
      (settings.has('range') || config.min !== undefined || config.max !== undefined) ? (
        <>
          <Field label={t('library.aliasPage.range', 'Range')}>
            {def.key === 'color_temp' ? (
              // Stored in mireds, shown in kelvin like its value: the warmest is the most mireds.
              <span className="flex items-center gap-2">
                <NumberInput
                  label={t('library.aliasPage.lowest', 'Lowest')}
                  value={toKelvin(config.max)}
                  suffix="K"
                  onChange={(kelvin) => {
                    set({ ...config, max: toKelvin(kelvin) });
                  }}
                />
                <span className="text-foreground-subtle">–</span>
                <NumberInput
                  label={t('library.aliasPage.highest', 'Highest')}
                  value={toKelvin(config.min)}
                  suffix="K"
                  onChange={(kelvin) => {
                    set({ ...config, min: toKelvin(kelvin) });
                  }}
                />
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <NumberInput
                  label={t('library.aliasPage.lowest', 'Lowest')}
                  value={config.min}
                  onChange={(min) => {
                    set({ ...config, min });
                  }}
                />
                <span className="text-foreground-subtle">–</span>
                <NumberInput
                  label={t('library.aliasPage.highest', 'Highest')}
                  value={config.max}
                  onChange={(max) => {
                    set({ ...config, max });
                  }}
                />
              </span>
            )}
          </Field>
          <Field label={t('library.aliasPage.step', 'Step')}>
            <NumberInput
              label={t('library.aliasPage.step', 'Step')}
              value={config.step}
              onChange={(step) => {
                set({ ...config, step: step !== undefined && step > 0 ? step : undefined });
              }}
            />
          </Field>
        </>
      ) : null}
      {isOffered && def.kind === 'enum' && config.options === undefined ? (
        <Field label={t('library.aliasPage.offered', 'Offered')}>
          <TextField
            label={t('library.aliasPage.offered', 'Offered')}
            isLabelHidden
            size="compact"
            value={(config.offered ?? []).join(', ')}
            onChange={(event) => {
              const offered = event.target.value
                .split(',')
                .map((each) => each.trim())
                .filter((each) => each !== '');

              set({ ...config, offered });
            }}
            hint={
              def.values === undefined
                ? t('library.aliasPage.offeredHint', 'Names, separated by commas')
                : t('library.aliasPage.offeredOf', 'Some of: {{list}}', {
                    list: def.values.join(', '),
                  })
            }
          />
        </Field>
      ) : null}
      {settings.has('options') && config.options !== undefined ? (
        <Field label={t('library.aliasPage.options', 'Options')}>
          <TextField
            label={t('library.aliasPage.options', 'Options')}
            isLabelHidden
            size="compact"
            value={config.options.map((option) => option.label).join(', ')}
            onChange={(event) => {
              const labels = event.target.value
                .split(',')
                .map((each) => each.trim())
                .filter((each) => each !== '');
              const options = labels.map((label) => ({
                value:
                  label
                    .toLowerCase()
                    .replaceAll(/[^a-z0-9]+/gu, '_')
                    .replaceAll(/^_|_$/gu, '') || 'option',
                label,
              }));

              if (options.length > 0) {
                set({ ...config, options });
              }
            }}
            hint={t('library.aliasPage.optionsHint', 'Labels, separated by commas')}
          />
        </Field>
      ) : null}
      {settings.has('numberMode') ? (
        <Field label={t('library.aliasPage.mode', 'Mode')}>
          <Segmented
            label={t('library.aliasPage.mode', 'Mode')}
            size="compact"
            className="self-start"
            options={NUMBER_MODES.map((mode) => ({ value: mode, label: readable(mode) }))}
            value={config.numberMode ?? 'auto'}
            onChange={(numberMode) => {
              set({ ...config, numberMode });
            }}
          />
        </Field>
      ) : null}
      {settings.has('assumed') ? (
        <Field label={t('library.aliasPage.assumed', 'Assumed')}>
          <span className="pt-1">
            <Switch
              label={t('library.aliasPage.assumedState', 'State is the last command')}
              isOn={config.assumed === true}
              onChange={(assumed) => {
                set({ ...config, assumed });
              }}
            />
          </span>
        </Field>
      ) : null}
      {settings.has('code') ? (
        <Field label={t('library.aliasPage.lockCode', 'Code')}>
          <span className="flex items-center gap-3 pt-1">
            <Switch
              label={t('library.aliasPage.codeRequired', 'Asks for a code')}
              isOn={config.code?.required === true}
              onChange={(required) => {
                set({ ...config, code: { ...config.code, required } });
              }}
            />
            {config.code?.required === true ? (
              <NumberInput
                label={t('library.aliasPage.codeLength', 'Digits')}
                value={config.code.length}
                onChange={(length) => {
                  set({
                    ...config,
                    code: {
                      required: true,
                      ...(length === undefined
                        ? {}
                        : { length: Math.min(16, Math.max(1, Math.round(length))) }),
                    },
                  });
                }}
              />
            ) : null}
          </span>
        </Field>
      ) : null}
      {settings.has('speeds') ? (
        <Field label={t('library.aliasPage.speeds', 'Speeds')}>
          <NumberInput
            label={t('library.aliasPage.speeds', 'Speeds')}
            value={config.speeds}
            onChange={(speeds) => {
              set({ ...config, speeds: Math.min(100, Math.max(0, Math.round(speeds ?? 0))) });
            }}
          />
        </Field>
      ) : null}
      {settings.has('locationSource') ? (
        <Field label={t('library.aliasPage.locationSource', 'From')}>
          <span className="w-48">
            <SelectField
              label={t('library.aliasPage.locationSource', 'From')}
              isLabelHidden
              size="compact"
              options={LOCATION_SOURCES.map((source) => ({
                value: source,
                label: readable(source),
              }))}
              value={config.locationSource ?? 'gps'}
              onChange={(locationSource) => {
                set({
                  ...config,
                  locationSource: locationSource as (typeof LOCATION_SOURCES)[number],
                });
              }}
            />
          </span>
        </Field>
      ) : null}
    </>
  );
}

/**
 * The Display section of a reading: how it is shown, its unit and precision.
 *
 * @param props - The type, the display and how to change it.
 * @param props.type - The alias's type.
 * @param props.display - How it is shown.
 * @param props.onChange - Called with the new display.
 * @param props.canEdit - Whether it can be changed.
 * @returns The section, or nothing for a type without one.
 */
export function DisplaySection(props: {
  readonly type: AliasTypeDef;
  readonly display: AliasDisplay;
  readonly onChange: (display: AliasDisplay) => void;
  readonly canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { type, display, onChange, canEdit } = props;

  if (type.display === undefined) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-title font-semibold text-foreground">
        {t('library.aliasPage.display', 'Display')}
      </h2>
      <fieldset
        disabled={!canEdit}
        className={`grid gap-4 rounded-panel border border-border bg-surface px-4 py-4 ${
          type.display === 'numeric' ? 'sm:grid-cols-3' : 'sm:grid-cols-1'
        }`}
      >
        <TextField
          label={t('library.aliasPage.shownAs', 'Shown as')}
          size="compact"
          placeholder={
            type.display === 'numeric'
              ? t('library.aliasPage.shownAsNumeric', 'temperature')
              : t('library.aliasPage.shownAsBinary', 'window')
          }
          value={display.deviceClass ?? ''}
          hint={t('library.aliasPage.shownAsHint', 'A device class, such as temperature or door')}
          onChange={(event) => {
            const value = event.target.value.trim();
            onChange({ ...display, deviceClass: value === '' ? null : value });
          }}
        />
        {type.display === 'numeric' ? (
          <>
            <TextField
              label={t('library.aliasPage.unit', 'Unit')}
              size="compact"
              placeholder={t('library.aliasPage.unitExample', '°C')}
              value={display.unit ?? ''}
              onChange={(event) => {
                const value = event.target.value.trim();
                onChange({ ...display, unit: value === '' ? null : value });
              }}
            />
            <SelectField
              label={t('library.aliasPage.precision', 'Precision')}
              size="compact"
              options={[
                { value: '', label: t('library.aliasPage.asItComes', 'As it comes') },
                ...[0, 1, 2, 3].map((digits) => ({
                  value: String(digits),
                  label: digits === 0 ? '1' : `0.${'0'.repeat(digits - 1)}1`,
                })),
              ]}
              value={display.precision === null ? '' : String(display.precision)}
              onChange={(value) => {
                onChange({ ...display, precision: value === '' ? null : Number(value) });
              }}
            />
          </>
        ) : null}
      </fieldset>
    </section>
  );
}
