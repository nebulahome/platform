/**
 * The actions of a part, under its source: what it does when a command reaches it or its value
 * changes.
 *
 * Each action is a When block - Command (a command the part takes, with an optional "Only when")
 * or Change (From / To, or above / below a number, for at least a time) - holding a Then branch of
 * the automation editor's own action blocks. A command with an action runs only that action: a
 * Stored part still keeps the value, nothing is forwarded, a Formula or Code part no longer
 * refuses it. Under the list, what a command with no action does.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  aliasEnumValues,
  aliasStepTargets,
  partCommands,
  type AliasAction,
  type AliasActionLastRun,
  type AliasPartConfig,
  type AliasPartDef,
  type AliasParts,
  type AutomationAction,
  type ComparisonOperator,
  type EntityChange,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Block,
  BlockBranch,
  BlockNotice,
  BlockStatus,
  Button,
  laneClass,
  Menu,
  SelectField,
  TextField,
  type MenuItem,
} from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';
import { BlockDragProvider } from '@/lib/block-drag';
import { BlockUiProvider } from '@/lib/block-ui';
import { commandChoicesOf, commandLabel } from '@/lib/command-choices';
import { formatDuration } from '@/lib/duration';
import { partLabel } from '@/library/alias-model';
import type { AutomationDraft } from '@/library/automation-draft';
import { moveBlock, stepBlock } from '@/library/block-path';
import { ActionList } from '@/routes/library/automation/action-blocks';
import { DurationField } from '@/routes/library/automation/duration-field';
import { EditorHouseProvider } from '@/routes/library/automation/editor-house';
import { Comparison, operatorOptions } from '@/routes/library/automation/entity-match-fields';
import { StepFormulasProvider } from '@/routes/library/automation/step-formulas';

/** The longest a change may be waited on: the format's week. */
const WEEK_MS = 604_800_000;

/** What the actions need. */
export type PartActionsProps = {
  readonly def: AliasPartDef;
  readonly defs: readonly AliasPartDef[];
  readonly parts: AliasParts;
  readonly config: AliasPartConfig;
  readonly set: (next: AliasPartConfig) => void;
  readonly canEdit: boolean;

  /** The alias entity: an action that sets its own part is flagged. */
  readonly aliasEntityId: string;

  /** How this part's actions last ran. */
  readonly lastRuns: readonly AliasActionLastRun[];

  /** An entity's name, for what a command does without an action. */
  readonly nameOf: (entityId: string) => string;
};

/**
 * A new id for an action, unique within the part.
 *
 * @param actions - The part's actions.
 * @returns The id.
 */
function newId(actions: readonly AliasAction[]): string {
  let index = actions.length + 1;

  while (actions.some((action) => action.id === `a${String(index)}`)) {
    index += 1;
  }

  return `a${String(index)}`;
}

/**
 * The actions of a part.
 *
 * @param props - See {@link PartActionsProps}.
 * @returns The row of actions, with its Add.
 */
export function PartActions(props: PartActionsProps) {
  const { t } = useTranslation();
  const { def, defs, parts, config, set, canEdit, nameOf } = props;
  const actions = config.actions ?? [];
  const commands = partCommands(defs, parts, def.key);
  const answered = new Set(
    actions.flatMap((action) =>
      action.when.kind === 'command' && action.when.match === undefined
        ? [action.when.command]
        : [],
    ),
  );
  const unanswered = commands.filter((command) => !answered.has(command));
  const [open, setOpen] = useState<string | null>(null);

  /**
   * Changes the part's actions.
   *
   * @param next - The actions as they are to be.
   */
  const setActions = (next: readonly AliasAction[]): void => {
    const rest: AliasPartConfig = { ...config };

    delete rest.actions;
    set(next.length === 0 ? rest : { ...config, actions: [...next] });
  };

  /**
   * Adds an action, open.
   *
   * @param when - What starts it.
   */
  const add = (when: AliasAction['when']): void => {
    const id = newId(actions);

    setActions([...actions, { id, when, then: [] }]);
    setOpen(id);
  };

  // What a command does with no action: as the source says.
  const today =
    config.from === 'stored'
      ? t('library.aliasActions.defaultStored', 'sets the value')
      : config.from === 'entity'
        ? t('library.aliasActions.defaultEntity', 'sent to {{name}}', {
            name: nameOf(config.entity),
          })
        : config.from === 'entities'
          ? t('library.aliasActions.defaultEntities', 'sent to the {{count}} entities', {
              count: config.entities.length,
            })
          : t('library.aliasActions.defaultRefused', 'refused');
  const changes = changeChoices(def);
  const items: MenuItem[] = [
    ...commands.map((command) => ({
      label: commandLabel(command),
      icon: 'arrow-down-to-line' as const,
      description: t('library.aliasActions.commandToday', 'Command · today {{today}}', { today }),
      disabled: answered.has(command),
      disabledReason: t('library.aliasActions.added', 'Added'),
      /** Adds an action on this command. */
      onSelect: () => {
        add({ kind: 'command', command });
      },
    })),
    ...changes.map((choice) => ({
      label: choice.label,
      icon: choice.change.kind === 'numeric' ? ('gauge' as const) : ('activity' as const),
      description: t('library.aliasActions.changeAny', 'Change · whatever causes it'),
      /** Adds an action on this change. */
      onSelect: () => {
        add({ kind: 'change', change: choice.change });
      },
    })),
  ];

  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3 border-t border-border pt-4">
      <span className="pt-1.5 text-caption text-foreground-subtle">
        {t('library.aliasActions.actions', 'Actions')}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        {actions.length === 0 ? (
          <span className="pt-1.5 text-caption text-foreground-subtle">
            {commands.length === 0
              ? t(
                  'library.aliasActions.noneNoCommands',
                  'None · {{part}} takes no commands, only changes',
                  {
                    part: partLabel(def),
                  },
                )
              : t('library.aliasActions.none', 'None · a command is {{today}}', { today })}
          </span>
        ) : (
          <EditorHouseProvider>
            <BlockUiProvider>
              <ActionsDrag actions={actions} onChange={setActions}>
                {actions.map((action, index) => (
                  <ActionBlock
                    key={action.id}
                    {...props}
                    action={action}
                    index={index}
                    isOpen={open === action.id}
                    onToggle={() => {
                      setOpen(open === action.id ? null : action.id);
                    }}
                    onChange={(next) => {
                      setActions(actions.map((each) => (each.id === action.id ? next : each)));
                    }}
                    onRemove={() => {
                      setActions(actions.filter((each) => each.id !== action.id));
                    }}
                  />
                ))}
              </ActionsDrag>
            </BlockUiProvider>
          </EditorHouseProvider>
        )}
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-3">
          {canEdit && items.length > 0 ? (
            <Menu
              items={items}
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
                  {t('library.aliasActions.add', 'Add an action')}
                  <AppIcon id="chevron-down" size={13} className="text-foreground-subtle" />
                </Button>
              )}
            />
          ) : null}
          {actions.length > 0 && unanswered.length > 0 ? (
            <span className="min-w-0 truncate text-caption text-foreground-subtle">
              {t('library.aliasActions.unanswered', '{{commands}} · {{today}}', {
                commands: unanswered.map(commandLabel).join(', '),
                today,
              })}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/**
 * Lets the blocks of every action be dragged and moved with the keyboard, each list addressed as
 * `actions.N.then`.
 *
 * @param props - The actions, how to change them, and what they hold.
 * @param props.actions - The part's actions.
 * @param props.onChange - Called with them as they now stand.
 * @param props.children - The blocks.
 * @returns The provider.
 */
function ActionsDrag(props: {
  readonly actions: readonly AliasAction[];
  readonly onChange: (actions: readonly AliasAction[]) => void;
  readonly children: ReactNode;
}) {
  const { actions, onChange, children } = props;
  // The block paths walk any root; this one is the part's actions, not an automation.
  const root = { actions } as unknown as AutomationDraft;

  return (
    <BlockDragProvider
      onMove={(from, to) => {
        const moved = moveBlock(root, from, to) as unknown as { actions?: AliasAction[] } | null;

        if (moved?.actions !== undefined) {
          onChange(moved.actions);
        }
      }}
      onStep={(from, step) => {
        const stepped = stepBlock(root, from, step);
        const next = stepped?.draft as unknown as { actions?: AliasAction[] } | undefined;

        if (stepped === null || next?.actions === undefined) {
          return null;
        }

        onChange(next.actions);

        return stepped.at;
      }}
    >
      {children}
    </BlockDragProvider>
  );
}

/** What one action's block needs. */
type ActionBlockProps = PartActionsProps & {
  readonly action: AliasAction;
  readonly index: number;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly onChange: (action: AliasAction) => void;
  readonly onRemove: () => void;
};

/**
 * One action: its When as a block, its Then as the blocks it holds.
 *
 * @param props - See {@link ActionBlockProps}.
 * @returns The block.
 */
function ActionBlock(props: ActionBlockProps) {
  const { t } = useTranslation();
  const { def, action, index, isOpen, onToggle, onChange, onRemove, canEdit, aliasEntityId } =
    props;
  const { when } = action;
  const last = props.lastRuns.find((run) => run.actionId === action.id);
  const time = dateTimeFormat({ hour: '2-digit', minute: '2-digit' });
  // A Change that commands its own alias starts itself again with every run.
  const loops =
    when.kind === 'change' && aliasStepTargets(action.then).entities.includes(aliasEntityId);
  const names =
    when.kind === 'command'
      ? (commandChoicesOf(def.capability)
          .find((choice) => choice.command === when.command)
          ?.fields.map((field) => `command.${field.key}`) ?? [])
      : [];
  const status =
    last === undefined ? (
      isOpen ? undefined : (
        <BlockStatus tone="neutral">
          {t('library.aliasActions.steps', '{{count}} actions', { count: action.then.length })}
        </BlockStatus>
      )
    ) : last.result === 'success' ? (
      <BlockStatus tone="success">
        {t('library.aliasActions.ran', 'Ran {{time}}', { time: time.format(last.at) })}
      </BlockStatus>
    ) : (
      <BlockStatus tone="danger">
        {t('library.aliasActions.failed', 'Failed · {{time}}', { time: time.format(last.at) })}
      </BlockStatus>
    );
  const notice = loops ? (
    <BlockNotice tone="warning">
      {t('library.aliasActions.loops', 'It sets this alias, so every run can start the next one.')}
    </BlockNotice>
  ) : last?.error === null || last === undefined || last.result === 'success' ? undefined : (
    <BlockNotice tone="danger">
      {t('library.aliasActions.lastFailed', 'Last run {{time}} · {{error}}', {
        time: time.format(last.at),
        error: last.error,
      })}
    </BlockNotice>
  );

  return (
    <Block
      lane="when"
      glyph={
        <AppIcon
          id={
            when.kind === 'command'
              ? 'arrow-down-to-line'
              : when.change.kind === 'numeric'
                ? 'gauge'
                : 'activity'
          }
          size={15}
        />
      }
      kind={
        when.kind === 'command'
          ? t('library.aliasActions.command', 'Command')
          : t('library.aliasActions.change', 'Change')
      }
      summary={whenSummary(def, when)}
      isOpen={isOpen}
      onToggle={onToggle}
      {...(canEdit ? { onRemove } : {})}
      status={status}
      notice={notice}
      isWarning={loops}
      branches={
        <div className={laneClass('then')}>
          <BlockBranch label={t('library.aliasActions.then', 'Then')}>
            <StepFormulasProvider names={names}>
              <ActionList
                items={action.then}
                path={`actions.${String(index)}.then`}
                isNested
                onChange={(then: readonly AutomationAction[]) => {
                  onChange({ ...action, then: [...then] });
                }}
              />
            </StepFormulasProvider>
          </BlockBranch>
        </div>
      }
    >
      <fieldset disabled={!canEdit} className="flex flex-col gap-3.5">
        {when.kind === 'command' ? (
          <CommandWhen {...props} when={when} />
        ) : (
          <ChangeWhen {...props} when={when} />
        )}
      </fieldset>
    </Block>
  );
}

/**
 * The fields of a Command: which command, and only when a number it carries compares so.
 *
 * @param props - The action and its When.
 * @returns The fields.
 */
function CommandWhen(
  props: ActionBlockProps & { readonly when: Extract<AliasAction['when'], { kind: 'command' }> },
) {
  const { t } = useTranslation();
  const { def, defs, parts, config, action, when, onChange, nameOf } = props;
  const commands = partCommands(defs, parts, def.key);
  const numbers =
    commandChoicesOf(def.capability)
      .find((choice) => choice.command === when.command)
      ?.fields.filter((field) => field.kind === 'percent' || field.kind === 'number') ?? [];
  const match = when.match;

  /**
   * Changes the When.
   *
   * @param next - It as it is to be.
   */
  const setWhen = (next: typeof when): void => {
    onChange({ ...action, when: next });
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={t('library.aliasActions.commandField', 'Command')}
          size="compact"
          options={commands.map((command) => ({ value: command, label: commandLabel(command) }))}
          value={when.command}
          onChange={(command) => {
            setWhen({ kind: 'command', command });
          }}
        />
        {numbers.length === 0 ? null : (
          <SelectField
            label={t('library.aliasActions.onlyWhen', 'Only when')}
            size="compact"
            options={[
              { value: '', label: t('library.aliasActions.anyValue', 'Any value') },
              ...numbers.map((field) => ({ value: field.key, label: field.label })),
            ]}
            value={match?.field ?? ''}
            onChange={(field) => {
              const plain = { kind: 'command' as const, command: when.command };

              setWhen(
                field === '' ? plain : { ...plain, match: { field, operator: 'gt', value: 0 } },
              );
            }}
          />
        )}
      </div>
      {match === undefined ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Comparison
            operator={match.operator}
            value={match.value}
            reading={null}
            onChange={(operator: ComparisonOperator, value: number) => {
              setWhen({ ...when, match: { ...match, operator, value } });
            }}
          />
        </div>
      )}
      <span className="flex items-center gap-1.5 text-caption text-foreground-subtle">
        <AppIcon id="info" size={12} className="shrink-0" />
        {config.from === 'stored'
          ? t('library.aliasActions.afterKept', 'After the value is kept')
          : config.from === 'entity'
            ? t('library.aliasActions.insteadOfEntity', 'Instead of sending it to {{name}}', {
                name: nameOf(config.entity),
              })
            : config.from === 'entities'
              ? t(
                  'library.aliasActions.insteadOfEntities',
                  'Instead of sending it to the {{count}} entities',
                  {
                    count: config.entities.length,
                  },
                )
              : t('library.aliasActions.insteadOfRefusing', 'Instead of refusing it')}
        {numbers.length === 0
          ? null
          : ` · ${numbers.map((field) => `command.${field.key}`).join(', ')}`}
      </span>
    </>
  );
}

/**
 * The fields of a Change: From and To, or a number crossed, and for how long.
 *
 * @param props - The action and its When.
 * @returns The fields.
 */
function ChangeWhen(
  props: ActionBlockProps & { readonly when: Extract<AliasAction['when'], { kind: 'change' }> },
) {
  const { t } = useTranslation();
  const { def, config, action, when, onChange } = props;
  const { change } = when;
  const values = stateValues(def, config);

  /**
   * Changes what it waits for.
   *
   * @param next - The change as it is to be.
   */
  const setChange = (next: EntityChange): void => {
    onChange({ ...action, when: { ...when, change: next } });
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {change.kind === 'numeric' ? (
          <Comparison
            operator={change.operator}
            value={change.value}
            reading={null}
            onChange={(operator: ComparisonOperator, value: number) => {
              setChange({ kind: 'numeric', operator, value });
            }}
          />
        ) : (
          (['from', 'to'] as const).map((side) =>
            values === null ? (
              <TextField
                key={side}
                label={
                  side === 'from'
                    ? t('library.aliasActions.from', 'From')
                    : t('library.aliasActions.to', 'To')
                }
                size="compact"
                value={change[side] ?? ''}
                placeholder={t('library.aliasActions.anyValue', 'Any value')}
                onChange={(event) => {
                  setChange({
                    ...change,
                    [side]: event.target.value === '' ? null : event.target.value,
                  });
                }}
              />
            ) : (
              <SelectField
                key={side}
                label={
                  side === 'from'
                    ? t('library.aliasActions.from', 'From')
                    : t('library.aliasActions.to', 'To')
                }
                size="compact"
                options={[{ value: '', label: t('library.aliasActions.any', 'Any') }, ...values]}
                value={change[side] ?? ''}
                onChange={(value) => {
                  setChange({ ...change, [side]: value === '' ? null : value });
                }}
              />
            ),
          )
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DurationField
          label={t('library.aliasActions.forAtLeast', 'For at least')}
          isOptional
          maxMs={WEEK_MS}
          value={when.forMs ?? null}
          onChange={(forMs) => {
            onChange({ ...action, when: { ...when, forMs: forMs === 0 ? null : forMs } });
          }}
        />
      </div>
      <span className="flex items-center gap-1.5 text-caption text-foreground-subtle">
        <AppIcon id="info" size={12} className="shrink-0" />
        {t('library.aliasActions.whatever', 'Whatever changes it: the card, a scene, its source')}
      </span>
    </>
  );
}

/**
 * The values a part's From and To offer: on and off, its names; null when any text goes.
 *
 * @param def - The part.
 * @param config - Its configuration.
 * @returns The choices, or null for a free field.
 */
function stateValues(
  def: AliasPartDef,
  config: AliasPartConfig,
): { readonly value: string; readonly label: string }[] | null {
  if (def.kind === 'boolean') {
    return [
      { value: 'on', label: WORDS.on() },
      { value: 'off', label: WORDS.off() },
    ];
  }

  const names = aliasEnumValues(def, config);

  return names === undefined ? null : names.map((name) => ({ value: name, label: name }));
}

/** The words of the summaries and the Add menu, in the reader's language. */
const WORDS = {
  /**
   * The word for on.
   *
   * @returns "On".
   */
  on: () => translate('library.aliasActions.on', 'On'),
  /**
   * The word for off.
   *
   * @returns "Off".
   */
  off: () => translate('library.aliasActions.off', 'Off'),
  /**
   * A switch turning on.
   *
   * @returns "Turns on".
   */
  turnsOn: () => translate('library.aliasActions.turnsOn', 'Turns on'),
  /**
   * A switch turning off.
   *
   * @returns "Turns off".
   */
  turnsOff: () => translate('library.aliasActions.turnsOff', 'Turns off'),
  /**
   * Any change.
   *
   * @returns "Changes".
   */
  changes: () => translate('library.aliasActions.changes', 'Changes'),
  /**
   * A number crossing up.
   *
   * @returns "Rises above".
   */
  risesAbove: () => translate('library.aliasActions.risesAbove', 'Rises above'),
  /**
   * A number crossing down.
   *
   * @returns "Falls below".
   */
  fallsBelow: () => translate('library.aliasActions.fallsBelow', 'Falls below'),
  /**
   * A value entered.
   *
   * @param to - The value entered.
   * @returns "Becomes …".
   */
  becomes: (to: string) => translate('library.aliasActions.becomes', 'Becomes {{to}}', { to }),
};

/**
 * The changes a part's Add offers: turns on and off for a switch, crossing a number for a
 * number, any change for the rest.
 *
 * @param def - The part.
 * @returns The choices, each with its label.
 */
function changeChoices(
  def: AliasPartDef,
): { readonly label: string; readonly change: EntityChange }[] {
  if (def.kind === 'number') {
    return [
      { label: WORDS.risesAbove(), change: { kind: 'numeric', operator: 'gt', value: 0 } },
      { label: WORDS.fallsBelow(), change: { kind: 'numeric', operator: 'lt', value: 0 } },
    ];
  }

  if (def.kind === 'boolean') {
    return [
      { label: WORDS.turnsOn(), change: { kind: 'state', to: 'on' } },
      { label: WORDS.turnsOff(), change: { kind: 'state', to: 'off' } },
      { label: WORDS.changes(), change: { kind: 'state' } },
    ];
  }

  return def.kind === 'press' ? [] : [{ label: WORDS.changes(), change: { kind: 'state' } }];
}

/**
 * What starts an action, as its block's summary says it.
 *
 * @param def - The part.
 * @param when - The When.
 * @returns The sentence.
 */
function whenSummary(def: AliasPartDef, when: AliasAction['when']): string {
  if (when.kind === 'command') {
    const label = commandLabel(when.command);

    if (when.match === undefined) {
      return label;
    }

    const operator =
      operatorOptions().find((option) => option.value === when.match?.operator)?.label ?? '';

    return `${label} · ${when.match.field} ${operator} ${String(when.match.value)}`;
  }

  const { change } = when;
  const hold =
    when.forMs === undefined || when.forMs === null ? '' : ` · ${formatDuration(when.forMs)}`;

  if (change.kind === 'numeric') {
    const words = { part: partLabel(def), value: String(change.value) };
    const crossed =
      change.operator === 'gt' || change.operator === 'gte'
        ? translate('library.aliasActions.crossesUp', '{{part}} rises above {{value}}', words)
        : change.operator === 'lt' || change.operator === 'lte'
          ? translate('library.aliasActions.crossesDown', '{{part}} falls below {{value}}', words)
          : change.operator === 'eq'
            ? translate('library.aliasActions.reaches', '{{part}} reaches {{value}}', words)
            : translate('library.aliasActions.leaves', '{{part}} leaves {{value}}', words);

    return `${crossed}${hold}`;
  }

  if (change.to === 'on' && def.kind === 'boolean') {
    return `${WORDS.turnsOn()}${hold}`;
  }

  if (change.to === 'off' && def.kind === 'boolean') {
    return `${WORDS.turnsOff()}${hold}`;
  }

  return change.to === undefined || change.to === null
    ? `${WORDS.changes()}${hold}`
    : `${WORDS.becomes(change.to)}${hold}`;
}
