/**
 * A list of names to pick one from - presets, modes, effects, sources, options - drawn by the
 * rule every kind of thing shares (canvas board `N-Entity-Index-Fields`, "Lists"):
 *
 * - 2 to 4: one segmented row;
 * - 5 to 8: chips, up to two rows;
 * - 9 or more: five chips, the chosen one always among them, then "more", which opens the whole
 *   list with a search in place of the dialog's body (`N-Entity-Shared-List`).
 *
 * Names are shown as the device sends them; a few known ones get an icon, the others a dot.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import {
  TONE_CHOSEN,
  TONE_DOT,
  TONE_SEGMENT,
  TONE_TEXT,
  type SheetTone,
} from '@/routes/library/entity/sheet/tones';

/** One name in a list. */
export type ListOption = {
  /** What is sent when it is picked. */
  readonly value: string;

  /** What it is called; the value when not given. */
  readonly label?: string;
};

/** The whole list, as the view behind "more" shows it. */
export type ListView = {
  /** What the list is: "Preset". */
  readonly title: string;

  /** The names. */
  readonly options: readonly ListOption[];

  /** The one chosen. */
  readonly value: string | null;

  /** Called with the one picked. */
  readonly onPick: (value: string) => void;

  /** The kind's colour. */
  readonly tone: SheetTone;
};

/** Opens a whole list in place of the dialog's body. */
export const ListViewContext = createContext<(view: ListView) => void>(() => undefined);

/** The glyphs of the names devices commonly send, by the name in lower case. */
const KNOWN: Readonly<Record<string, UiIconId>> = {
  home: 'house',
  away: 'plane',
  eco: 'leaf',
  sleep: 'moon',
  night: 'moon',
  boost: 'rocket',
  comfort: 'armchair',
  activity: 'sparkles',
  auto: 'sun-snow',
  heat: 'flame',
  cool: 'snowflake',
  dry: 'droplet',
  fan: 'fan',
  off: 'power',
};

/**
 * The glyph of a name, when it is a known one.
 *
 * @param name - The name.
 * @returns The glyph, or undefined for a dot.
 */
export function knownIcon(name: string): UiIconId | undefined {
  return KNOWN[name.toLowerCase()];
}

/** What the list needs. */
export type OptionListProps = {
  /** What the list is, for a screen reader and the view behind "more": "Preset". */
  readonly title: string;

  /** The names, in the device's order. */
  readonly options: readonly ListOption[];

  /** The one chosen, or null for none. */
  readonly value: string | null;

  /** Called with the one picked. */
  readonly onPick: (value: string) => void;

  /** The kind's colour. */
  readonly tone: SheetTone;

  /** Whether it cannot be used now. */
  readonly disabled?: boolean;

  /** Whether known names get their glyph; effects and sources keep a dot. */
  readonly hasIcons?: boolean;

  /** Whether a segmented row tints its chosen segment in the kind's colour, as a swing's. */
  readonly isTinted?: boolean;
};

/**
 * The glyph or the dot before a name.
 *
 * @param props - The name, whether it is chosen, whether glyphs are drawn, and the colour.
 * @param props.name - The name.
 * @param props.isChosen - Whether it is the one chosen.
 * @param props.hasIcons - Whether a known name gets its glyph.
 * @param props.tone - The kind's colour.
 * @returns The mark.
 */
function Mark(props: {
  readonly name: string;
  readonly isChosen: boolean;
  readonly hasIcons: boolean;
  readonly tone: SheetTone;
}): ReactNode {
  const icon = props.hasIcons ? knownIcon(props.name) : undefined;

  if (icon !== undefined) {
    return <AppIcon id={icon} size={15} />;
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        props.isChosen ? TONE_DOT[props.tone] : 'bg-foreground-disabled',
      )}
    />
  );
}

/**
 * Renders the list by its length's rule.
 *
 * @param props - See {@link OptionListProps}.
 * @returns The row, the chips, or the chips and "more".
 */
export function OptionList(props: OptionListProps) {
  const { t } = useTranslation();
  const {
    title,
    options,
    value,
    onPick,
    tone,
    disabled = false,
    hasIcons = true,
    isTinted = false,
  } = props;
  const openList = useContext(ListViewContext);
  /**
   * What an option is called.
   *
   * @param option - The option.
   * @returns Its label, or its value.
   */
  const labelOf = (option: ListOption): string => option.label ?? option.value;

  if (options.length <= 4) {
    return (
      <div
        role="radiogroup"
        aria-label={title}
        className="flex gap-0.5 rounded-pill border border-border-strong bg-well p-0.75"
      >
        {options.map((option) => {
          const isChosen = option.value === value;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isChosen}
              disabled={disabled}
              onClick={() => {
                onPick(option.value);
              }}
              className={cn(
                'h-7.5 min-w-0 flex-1 cursor-pointer truncate rounded-pill px-3 text-ui-sm',
                'transition-colors disabled:cursor-not-allowed',
                isChosen
                  ? isTinted
                    ? TONE_SEGMENT[tone]
                    : 'bg-surface-high font-medium text-foreground'
                  : 'text-foreground-muted hover:text-foreground',
              )}
            >
              {labelOf(option)}
            </button>
          );
        })}
      </div>
    );
  }

  const isLong = options.length > 8;
  const chosenIndex = options.findIndex((option) => option.value === value);
  // Five shown, the chosen one always among them: in its place when it is among the first five,
  // in the fifth place when it is further down.
  const shown = !isLong
    ? options
    : chosenIndex < 5
      ? options.slice(0, 5)
      : [...options.slice(0, 4), options[chosenIndex] ?? options[4]].filter(
          (option): option is ListOption => option !== undefined,
        );

  return (
    <div role="radiogroup" aria-label={title} className="flex flex-wrap gap-2">
      {shown.map((option) => {
        const isChosen = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isChosen}
            disabled={disabled}
            onClick={() => {
              onPick(option.value);
            }}
            className={cn(
              'inline-flex h-9 cursor-pointer items-center gap-1.75 rounded-pill border pr-3.5 pl-3',
              'text-ui-sm font-medium transition-colors disabled:cursor-not-allowed',
              isChosen
                ? TONE_CHOSEN[tone]
                : 'border-border-strong bg-surface-raised text-foreground',
            )}
          >
            <Mark name={option.value} isChosen={isChosen} hasIcons={hasIcons} tone={tone} />
            {labelOf(option)}
          </button>
        );
      })}
      {isLong ? (
        <button
          type="button"
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => {
            openList({ title, options, value, onPick, tone });
          }}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-pill border border-dashed border-border-strong pr-3 pl-3.5 text-ui-sm text-foreground-muted"
        >
          {t('entity.sheet.list.more', '+{{count}} more', { count: options.length - shown.length })}
          <AppIcon id="chevron-right" size={14} />
        </button>
      ) : null}
    </div>
  );
}

/** What the view behind "more" needs. */
export type ListViewPanelProps = ListView & {
  /** The entity's name, for the line under the title. */
  readonly entityName: string;

  /** Called to go back to the dialog's body. */
  readonly onBack: () => void;

  /** Called to put the dialog away. */
  readonly onClose: () => void;
};

/**
 * The whole list, with a search, in place of the dialog's body: back, the list's name, and every
 * name with the chosen one ticked.
 *
 * @param props - See {@link ListViewPanelProps}.
 * @returns The view.
 */
export function ListViewPanel(props: ListViewPanelProps) {
  const { t } = useTranslation();
  const { title, options, value, onPick, tone, entityName, onBack, onClose } = props;
  const [search, setSearch] = useState('');
  const found = options.filter((option) =>
    (option.label ?? option.value).toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 pt-5 pr-3.5 pb-4 pl-5">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('entity.sheet.list.back', 'Back')}
          title={t('entity.sheet.list.back', 'Back')}
          className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground-muted hover:bg-surface-raised"
        >
          <AppIcon id="chevron-left" size={18} />
        </button>
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-[13px] border border-cyan/28 bg-cyan/12 text-cyan',
          )}
        >
          <AppIcon id="list" size={20} />
        </span>
        <div className="flex min-w-0 grow flex-col gap-0.75">
          <span className="truncate text-[17px] font-medium tracking-[-0.01em]">{title}</span>
          <span className="truncate text-ui-sm text-foreground-subtle">
            {t('entity.sheet.list.options', '{{name}} · {{count}} options', {
              name: entityName,
              count: options.length,
            })}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close', 'Close')}
          title={t('common.close', 'Close')}
          className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground-muted hover:bg-surface-raised"
        >
          <AppIcon id="x" size={17} />
        </button>
      </div>
      <div className="flex flex-col gap-4 px-6 pt-1 pb-6">
        <label className="flex h-10 items-center gap-2 rounded-tile border border-border-strong bg-surface-raised px-3 text-ui-sm text-foreground-subtle">
          <AppIcon id="search" size={15} />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder={t('entity.sheet.list.find', 'Find a {{what}}', {
              what: title.toLowerCase(),
            })}
            className="min-w-0 grow bg-transparent text-foreground outline-none placeholder:text-foreground-subtle"
          />
        </label>
        <div role="radiogroup" aria-label={title} className="-mx-2 -mt-1.5 flex flex-col gap-0.5">
          {found.map((option) => {
            const isChosen = option.value === value;
            const icon = knownIcon(option.value);

            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isChosen}
                onClick={() => {
                  onPick(option.value);
                  onBack();
                }}
                className={cn(
                  'flex h-11 cursor-pointer items-center gap-3 rounded-tile border px-3 text-left text-ui',
                  isChosen ? TONE_CHOSEN[tone] : 'border-transparent hover:bg-surface-raised',
                )}
              >
                {icon === undefined ? (
                  <span aria-hidden="true" className="flex w-4.25 justify-center">
                    <span className="size-1.5 rounded-full bg-foreground-disabled" />
                  </span>
                ) : (
                  <AppIcon
                    id={icon}
                    size={17}
                    className={isChosen ? TONE_TEXT[tone] : 'text-foreground-muted'}
                  />
                )}
                <span className="grow text-foreground">{option.label ?? option.value}</span>
                {isChosen ? <AppIcon id="check" size={17} className={TONE_TEXT[tone]} /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
