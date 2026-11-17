/**
 * A card's settings: a panel that floats over the dashboard while it is edited, in one fixed
 * place - the top right, under the editing header - so the card is watched while it changes
 * (`N-Dashboard-Card-Settings*`).
 *
 * It is not a dialog: there is no scrim, the dashboard under it stays live and scrolls, a click on
 * another card switches the panel to it, and Escape or the close button closes it. It does not
 * follow the card and is not dragged; when the card chosen lies under it, the editor puts it in
 * the mirrored place, top left. Every field writes to the draft at once, so the card redraws as it
 * is set; nothing is saved before Done.
 *
 * What it holds, top to bottom: what the card is about (its entity, its scene, a package's own
 * options), its size - the only place a size is chosen, each one drawn as its cells - and then
 * its name and icon, the parts it shows, and what a tap does. At the foot, Remove and Copy.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DASHBOARD_COLUMNS,
  type DashboardCard,
  type DashboardEntityCard,
  type DashboardLayout,
  type EntityView,
  type IconView,
  type SceneView,
} from '@nebulahome/contracts';
import { AppIcon, cn, SelectField, Switch } from '@nebulahome/ui';

import { kindName, partsOf, tapChoices } from '@/dashboard/card-options';
import {
  allowedSizes,
  CARD_SIZES,
  cardKindOf,
  CONTAINER_WIDTHS,
  missingSizes,
  sameSize,
  sizeName,
  type CardSize,
} from '@/dashboard/card-sizes';
import {
  allCards,
  findCard,
  minimumContainerWidth,
  resizeCard,
  updateCard,
} from '@/dashboard/dashboard-layout';
import { defineMessage, text } from '@/i18n/messages';
import { entityKindOf } from '@/library/entity-kind';
import { readingOf } from '@/library/entity-reading';
import { cardTitle } from '@/routes/dashboard/card-view';
import { EnergySettings } from '@/routes/dashboard/energy-settings';
import { PackageCardSettings } from '@/routes/dashboard/package-card-settings';
import { ActionsSettings } from '@/routes/dashboard/settings/actions-settings';
import { ActivitySettings } from '@/routes/dashboard/settings/activity-settings';
import { AutomationSettings } from '@/routes/dashboard/settings/automation-settings';
import { CompareSettings } from '@/routes/dashboard/settings/compare-settings';
import { ListSettings } from '@/routes/dashboard/settings/list-settings';
import { RoomSettings } from '@/routes/dashboard/settings/room-settings';
import { ShortcutSettings } from '@/routes/dashboard/settings/shortcut-settings';
import { SummarySettings } from '@/routes/dashboard/settings/summary-settings';
import { TogetherSettings } from '@/routes/dashboard/settings/together-settings';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { EntityTile } from '@/routes/library/entity-tile';
import { NameIconField } from '@/routes/library/name-icon-field';

/** What the panel needs. */
export type CardSettingsProps = {
  /** The layout being edited. */
  readonly layout: DashboardLayout;

  /** The card whose settings are open. */
  readonly cardId: string;

  /** The kind of card it will be, when it still waits for its entity. */
  readonly pendingKind: string | null;

  /** What the page read for its cards. */
  readonly data: DashboardData;

  /** The scenes this person may see, for a scene card. */
  readonly scenes: readonly SceneView[];

  /** Which side of the page it floats on. */
  readonly side: 'left' | 'right';

  /** Whether the card copied is this one. */
  readonly isCopied: boolean;

  /** Takes the changed layout. */
  readonly onChange: (layout: DashboardLayout) => void;

  /** The card waiting for what it shows - its entity, its room - was given it. */
  readonly onSettled: (cardId: string) => void;

  /** Takes the card off. */
  readonly onRemove: (cardId: string) => void;

  /** Copies the card. */
  readonly onCopy: (card: DashboardCard) => void;

  /** Closes the panel. */
  readonly onClose: () => void;
};

/** What each type of card is called under its name in the panel's head. */
const TYPE_NAMES = {
  entity: defineMessage('dashboard.cardInspector.entityCard', 'Entity card'),
  scene: defineMessage('dashboard.cardInspector.sceneCard', 'Scene card'),
  clock: defineMessage('dashboard.cardInspector.clock', 'Clock'),
  energy: defineMessage('dashboard.cardInspector.energyCard', 'Energy card'),
  package: defineMessage('dashboard.cardInspector.packageCard', 'Package card'),
  container: defineMessage('dashboard.cardInspector.group', 'Group'),
} as const;

/**
 * Renders one field of the panel: its label, a quiet note at the right, and the control.
 *
 * @param props - The field.
 * @param props.label - What it sets.
 * @param props.note - A quiet word at the right of the label.
 * @param props.children - The control.
 * @returns The field.
 */
function Field(props: {
  readonly label: string;
  readonly note?: string | undefined;
  readonly children: ReactNode;
}) {
  const { label, note, children } = props;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-4.5 items-center justify-between gap-2 text-caption text-foreground-subtle">
        <span>{label}</span>
        {note === undefined ? null : <span>{note}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Renders a size as the small blocks of its cells.
 *
 * @param props - The size and whether it is chosen.
 * @param props.size - The size.
 * @param props.isOn - Whether it is the card's size.
 * @returns The drawing.
 */
function Cells(props: { readonly size: CardSize; readonly isOn: boolean }) {
  const { size, isOn } = props;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 auto-rows-[5px] gap-px',
        size.w === 1 ? 'grid-cols-[7px]' : 'grid-cols-[7px_7px]',
      )}
    >
      {Array.from({ length: size.w * size.h }, (unused, index) => (
        <span
          key={index}
          className={cn(
            'rounded-[1px] transition-colors duration-150',
            isOn ? 'bg-primary-hover' : 'bg-foreground-disabled',
          )}
        />
      ))}
    </span>
  );
}

/**
 * Renders the size choice: the sizes on offer, each drawn as its cells and written "1×2", and a
 * quiet line naming a size of its kind this card cannot take.
 *
 * @param props - The sizes.
 * @param props.label - What it is called: Size, or Width for a group.
 * @param props.sizes - The sizes on offer.
 * @param props.value - The card's size.
 * @param props.missing - A line on what is not offered, when something is not.
 * @param props.onChange - When another is chosen.
 * @returns The choice.
 */
function SizeChoice(props: {
  readonly label: string;
  readonly sizes: readonly CardSize[];
  readonly value: CardSize;
  readonly missing?: string | undefined;
  readonly onChange: (size: CardSize) => void;
}) {
  const { label, sizes, value, missing, onChange } = props;

  return (
    <Field label={label}>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex gap-1 rounded-pill border border-border-strong bg-surface p-1"
      >
        {sizes.map((size) => {
          const isOn = sameSize(size, value);

          return (
            <button
              key={sizeName(size)}
              type="button"
              role="radio"
              aria-checked={isOn}
              className={cn(
                'flex h-7.5 flex-1 items-center justify-center gap-[7px] rounded-pill text-ui-sm whitespace-nowrap tabular',
                'transition-[background-color,color] duration-150 ease-out',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
                isOn
                  ? 'bg-surface-high font-medium text-foreground'
                  : 'text-foreground-muted hover:text-foreground',
              )}
              onClick={() => {
                onChange(size);
              }}
            >
              <Cells size={size} isOn={isOn} />
              {sizeName(size)}
            </button>
          );
        })}
      </div>
      {missing === undefined ? null : (
        <span className="text-caption text-foreground-subtle">{missing}</span>
      )}
    </Field>
  );
}

/** What the entity chooser needs. */
type EntityChooserProps = {
  /** The kind of card: only the entities it takes are offered. */
  readonly kind: string;

  /** The entity chosen, if any. */
  readonly value: string | null;

  /** Whether it opens unfolded: for a card that waits for its entity. */
  readonly isOpenAtFirst: boolean;

  /** What the page read. */
  readonly data: DashboardData;

  /** The entities already on the page, drawn dimmed. */
  readonly onPage: ReadonlySet<string>;

  /** When one is chosen. */
  readonly onChoose: (entity: EntityView) => void;
};

/**
 * Renders the entity a card shows: folded, the entity chosen; unfolded, a search and the entities
 * this kind of card takes, the ones already on this page dimmed ("on this page") and still offered.
 *
 * @param props - See {@link EntityChooserProps}.
 * @returns The chooser.
 */
function EntityChooser(props: EntityChooserProps) {
  const { t } = useTranslation();

  const { kind, value, isOpenAtFirst, data, onPage, onChoose } = props;
  const [isOpen, setOpen] = useState(isOpenAtFirst);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const chosen = value === null ? undefined : data.entityById.get(value);
  const offered = [...data.entityById.values()]
    .filter((entity) => entity.isEnabled && !entity.isHidden && cardKindOf(entity) === kind)
    .sort((a, b) => a.name.localeCompare(b.name));
  const words = query.trim().toLowerCase();
  const found =
    words === ''
      ? offered
      : offered.filter((entity) =>
          `${entity.name} ${entity.areaName ?? ''} ${entity.entityId}`
            .toLowerCase()
            .includes(words),
        );
  const noun = offered[0] === undefined ? '' : entityKindOf(offered[0]).label.toLowerCase();

  useEffect(() => {
    if (isOpen) {
      searchRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) {
    return (
      <Field label={t('dashboard.cardSettings.entity', 'Entity')}>
        <button
          type="button"
          className="flex h-10 items-center gap-2 rounded-tile border border-border-strong bg-surface-raised px-3 text-left text-ui-sm transition-colors duration-150 hover:border-foreground-disabled"
          onClick={() => {
            setOpen(true);
          }}
        >
          {chosen === undefined ? null : (
            <EntityTile
              icon={undefined}
              kind={entityKindOf(chosen)}
              isActive={null}
              size="tiny"
              isPlain
            />
          )}
          <span className="min-w-0 grow truncate">
            {chosen === undefined ? (value ?? '') : chosen.name}
            {chosen?.areaName === undefined || chosen.areaName === null ? null : (
              <span className="text-foreground-subtle"> · {chosen.areaName}</span>
            )}
          </span>
          <AppIcon id="chevron-down" size={14} />
        </button>
      </Field>
    );
  }

  return (
    <Field
      label={t('dashboard.cardSettings.entity', 'Entity')}
      note={t('dashboard.cardSettings.countOfKind', '{{count}} {{noun}}', {
        count: offered.length,
        noun,
      })}
    >
      <div className="overflow-hidden rounded-tile border border-primary bg-surface shadow-[0_0_0_3px_rgb(124_134_255/0.16)]">
        <label className="flex h-10 items-center gap-2 border-b border-border px-3 text-ui-sm">
          <AppIcon id="search" size={15} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            aria-controls={listId}
            placeholder={t('dashboard.cardSettings.searchKind', 'Search {{noun}}', { noun })}
            className="min-w-0 grow bg-transparent text-foreground outline-none placeholder:text-foreground-subtle"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && value !== null) {
                event.stopPropagation();
                setOpen(false);
              }
            }}
          />
        </label>
        <ul id={listId} className="flex max-h-60 flex-col overflow-y-auto p-1">
          {found.length === 0 ? (
            <li className="px-2.5 py-3 text-caption text-foreground-subtle">
              {t('dashboard.cardSettings.nothingFound', 'Nothing matches')}
            </li>
          ) : (
            found.map((entity) => {
              const isHere = onPage.has(entity.entityId) && entity.entityId !== value;
              const reading = readingOf(entity, data.readings[entity.entityId]);

              return (
                <li key={entity.entityId}>
                  <button
                    type="button"
                    className={cn(
                      'flex h-10 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left transition-colors duration-100',
                      'hover:bg-primary/12 focus-visible:bg-primary/12 focus-visible:outline-none',
                      entity.entityId === value ? 'bg-primary/12' : undefined,
                      isHere ? 'opacity-55' : undefined,
                    )}
                    onClick={() => {
                      setOpen(false);
                      setQuery('');
                      onChoose(entity);
                    }}
                  >
                    <EntityTile
                      icon={undefined}
                      kind={entityKindOf(entity)}
                      isActive={null}
                      size="tiny"
                      isPlain
                    />
                    <span className="flex min-w-0 grow items-baseline gap-1.5">
                      <span className="truncate text-ui-sm">{entity.name}</span>
                      {entity.areaName === null ? null : (
                        <span className="shrink-0 text-caption text-foreground-subtle">
                          {entity.areaName}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-caption text-foreground-subtle">
                      {isHere
                        ? t('dashboard.cardSettings.onThisPage', 'on this page')
                        : reading.text}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </Field>
  );
}

/**
 * Renders the settings panel.
 *
 * @param props - See {@link CardSettingsProps}.
 * @returns The panel, or nothing when the card is no longer there.
 */
export function CardSettings(props: CardSettingsProps) {
  const { t } = useTranslation();

  const {
    layout,
    cardId,
    pendingKind,
    data,
    scenes,
    side,
    isCopied,
    onChange,
    onSettled,
    onRemove,
    onCopy,
    onClose,
  } = props;
  const found = findCard(layout, cardId);

  // Escape closes the panel and gives the focus back to the card.
  useEffect(() => {
    /**
     * Closes on Escape.
     *
     * @param event - The key.
     */
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose();
        document
          .querySelector<HTMLElement>(`[data-card-id="${cardId}"] button[aria-pressed]`)
          ?.focus();
      }
    };

    globalThis.addEventListener('keydown', onKey);

    return (): void => {
      globalThis.removeEventListener('keydown', onKey);
    };
  }, [cardId, onClose]);

  if (found === null) {
    return null;
  }

  const { card, parentId } = found;
  const parent = parentId === null ? null : findCard(layout, parentId)?.card;
  const gridColumns = parent === null || parent === undefined ? DASHBOARD_COLUMNS : parent.w;
  const entity = card.type === 'entity' ? data.entityById.get(card.entityId) : undefined;
  const onPage = new Set(
    allCards(layout).flatMap((each) => (each.type === 'entity' ? [each.entityId] : [])),
  );

  /**
   * Changes the card's settings.
   *
   * @param update - What to make of it.
   */
  const change = (update: (current: DashboardCard) => DashboardCard): void => {
    onChange(updateCard(layout, cardId, update));
  };

  /**
   * Points an entity card at an entity, at the size it had when the entity's card takes it, or
   * at the smallest the entity's card takes.
   *
   * @param chosen - The entity.
   */
  const chooseEntity = (chosen: EntityView): void => {
    const next = updateCard(layout, cardId, (current) =>
      current.type === 'entity' ? { ...current, entityId: chosen.entityId } : current,
    );
    const sizes = allowedSizes(chosen);
    const fits = sizes.some((size) => sameSize(size, card));
    const smallest = sizes[0];

    onChange(
      fits || smallest === undefined ? next : resizeCard(next, cardId, smallest, data.sizesOf),
    );
    onSettled(cardId);
  };

  const kind = pendingKind ?? (entity === undefined ? null : cardKindOf(entity));
  const sizes: readonly CardSize[] =
    card.type === 'container'
      ? CONTAINER_WIDTHS.filter((w) => w >= minimumContainerWidth(card, data.sizesOf)).map((w) => ({
          w,
          h: card.h,
        }))
      : (
          Object.entries(CARD_SIZES).find(([each]) => each === pendingKind)?.[1].sizes ??
          data.sizesOf(card)
        ).filter((size) => size.w <= gridColumns);
  const missing = entity === undefined ? [] : missingSizes(entity);
  const missingLine =
    missing[0] === undefined
      ? undefined
      : t('dashboard.cardSettings.noSize', 'No {{size}}: {{reason}}', {
          size: sizeName(missing[0].size),
          reason: missing[0].reason,
        });
  const title =
    pendingKind === null
      ? cardTitle(card, data)
      : t('dashboard.cardSettings.newKindCard', 'New {{kind}} card', {
          kind: kindName(pendingKind).toLowerCase(),
        });
  const typeName = Object.entries(TYPE_NAMES).find(([type]) => type === card.type)?.[1];
  const subtitle =
    pendingKind !== null
      ? card.type === 'entity'
        ? t('dashboard.cardSettings.chooseItsEntity', 'Choose its entity')
        : t('dashboard.cardSettings.chooseWhatItShows', 'Choose what it shows')
      : entity !== undefined
        ? t('dashboard.cardSettings.kindCard', '{{kind}} card', {
            kind: kindName(cardKindOf(entity)),
          })
        : typeName === undefined
          ? kindName(card.type)
          : text(typeName);

  /** Says the card now has what it waited for. */
  const settle = (): void => {
    onSettled(cardId);
  };
  const icon: IconView | undefined =
    'icon' in card && card.icon !== null ? data.icons.get(card.icon) : undefined;

  /**
   * Resizes the card where it is; the grid makes room as it does for a corner dragged.
   *
   * @param size - The new size.
   */
  const resize = (size: CardSize): void => {
    onChange(resizeCard(layout, cardId, size, data.sizesOf));
  };

  return (
    <aside
      aria-label={t('dashboard.cardSettings.settingsOf', 'Settings of {{title}}', { title })}
      className={cn(
        'pointer-events-auto absolute top-0 z-30 flex max-h-full w-80 animate-rise flex-col overflow-hidden rounded-[20px] border border-border-strong bg-surface',
        'shadow-[0_40px_90px_-24px_rgb(0_0_0/0.95),0_0_0_1px_rgb(124_134_255/0.10)]',
        'transition-[left,right] duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
        side === 'right' ? 'right-0' : 'right-[calc(100%-20rem)]',
        'max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[50vh] max-sm:w-full max-sm:rounded-b-none',
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border pr-3 pl-3.5">
        {entity === undefined ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-field bg-primary/14 text-primary">
            <AppIcon
              id={
                card.type === 'container'
                  ? 'layout-grid'
                  : card.type === 'clock'
                    ? 'clock'
                    : 'layout-dashboard'
              }
              size={14}
            />
          </span>
        ) : (
          <EntityTile
            icon={icon}
            kind={entityKindOf(entity)}
            isActive={null}
            size="small"
            className="rounded-field"
          />
        )}
        <div className="flex min-w-0 grow flex-col">
          <span className="truncate text-ui leading-[18px] font-medium">{title}</span>
          <span className="truncate text-caption leading-4 text-foreground-subtle">{subtitle}</span>
        </div>
        <button
          type="button"
          aria-label={t('dashboard.cardSettings.close', 'Close the settings')}
          className="press-scale flex size-7 shrink-0 items-center justify-center rounded-pill border border-border-strong bg-surface-raised text-foreground-muted hover:text-foreground"
          onClick={onClose}
        >
          <AppIcon id="x" size={13} />
        </button>
      </div>

      <div
        key={cardId}
        className="flex min-h-0 animate-fade-in flex-col gap-4 overflow-y-auto p-3.5"
      >
        {card.type === 'entity' && kind !== null ? (
          <EntityChooser
            key={card.entityId}
            kind={kind}
            value={pendingKind === null ? card.entityId : null}
            isOpenAtFirst={pendingKind !== null}
            data={data}
            onPage={onPage}
            onChoose={chooseEntity}
          />
        ) : null}

        {card.type === 'together' ? (
          <TogetherSettings
            card={card}
            layout={layout}
            data={data}
            isPending={pendingKind !== null}
            onChange={change}
            onSettled={settle}
          />
        ) : null}
        {card.type === 'summary' ? (
          <SummarySettings
            card={card}
            layout={layout}
            data={data}
            isPending={pendingKind !== null}
            onChange={change}
            onSettled={settle}
          />
        ) : null}
        {card.type === 'room' ? (
          <RoomSettings
            card={card}
            layout={layout}
            data={data}
            isPending={pendingKind !== null}
            onChange={change}
            onSettled={settle}
          />
        ) : null}
        {card.type === 'list' ? (
          <ListSettings
            card={card}
            layout={layout}
            data={data}
            isPending={pendingKind !== null}
            onChange={change}
            onSettled={settle}
          />
        ) : null}
        {card.type === 'actions' ? (
          <ActionsSettings
            card={card}
            layout={layout}
            data={data}
            isPending={pendingKind !== null}
            onChange={change}
            onSettled={settle}
          />
        ) : null}
        {card.type === 'compare' ? (
          <CompareSettings
            card={card}
            layout={layout}
            data={data}
            isPending={pendingKind !== null}
            onChange={change}
            onSettled={settle}
          />
        ) : null}
        {card.type === 'activity' ? (
          <ActivitySettings
            card={card}
            layout={layout}
            data={data}
            isPending={pendingKind !== null}
            onChange={change}
            onSettled={settle}
          />
        ) : null}
        {card.type === 'automation' ? (
          <AutomationSettings
            card={card}
            layout={layout}
            data={data}
            isPending={pendingKind !== null}
            onChange={change}
            onSettled={settle}
          />
        ) : null}
        {card.type === 'shortcut' ? (
          <ShortcutSettings
            card={card}
            layout={layout}
            data={data}
            isPending={pendingKind !== null}
            onChange={change}
            onSettled={settle}
          />
        ) : null}

        {card.type === 'package' ? (
          <div className="flex flex-col gap-3 rounded-tile border border-border bg-surface-raised/50 p-3">
            <span className="text-caption text-foreground-subtle">
              {t('dashboard.cardSettings.askedByThePackage', 'Asked by the package')}
            </span>
            <PackageCardSettings key={card.id} card={card} data={data} onChange={change} />
          </div>
        ) : null}

        {card.type === 'scene' ? (
          <SelectField
            label={t('dashboard.cardInspector.scene', 'Scene')}
            size="compact"
            options={scenes.map((scene) => ({ value: scene.id, label: scene.name }))}
            value={card.sceneId}
            onChange={(sceneId) => {
              change((current) => (current.type === 'scene' ? { ...current, sceneId } : current));
            }}
          />
        ) : null}

        {card.type === 'container' ? (
          <NameIconField
            label={t('dashboard.cardInspector.name', 'Name')}
            value={card.title}
            required
            onChange={(name) => {
              change((current) =>
                current.type === 'container' ? { ...current, title: name } : current,
              );
            }}
            icon={card.icon}
            onIconChange={(view: IconView) => {
              change((current) =>
                current.type === 'container' ? { ...current, icon: view.id } : current,
              );
            }}
          />
        ) : null}

        {sizes.length > 1 ? (
          <SizeChoice
            label={
              card.type === 'container'
                ? t('dashboard.cardInspector.width', 'Width')
                : t('dashboard.cardInspector.size', 'Size')
            }
            sizes={sizes}
            value={card}
            missing={missingLine}
            onChange={resize}
          />
        ) : null}

        {pendingKind === null && (card.type === 'entity' || card.type === 'scene') ? (
          <NameIconField
            label={t('dashboard.cardSettings.nameAndIcon', 'Name and icon')}
            value={card.title ?? ''}
            placeholder={cardTitle({ ...card, title: null }, data)}
            fallback={entity === undefined ? 'sparkles' : entityKindOf(entity).icon}
            onChange={(name) => {
              change((current) =>
                current.type === 'entity' || current.type === 'scene'
                  ? { ...current, title: name.trim() === '' ? null : name }
                  : current,
              );
            }}
            icon={card.icon}
            onIconChange={(view) => {
              change((current) =>
                current.type === 'entity' || current.type === 'scene'
                  ? { ...current, icon: view.id }
                  : current,
              );
            }}
          />
        ) : null}

        {card.type === 'entity' && entity !== undefined && pendingKind === null ? (
          <EntityOptions card={card} entity={entity} onChange={change} />
        ) : null}

        {card.type === 'clock' ? (
          <Field label={t('dashboard.cardSettings.show', 'Show')}>
            <div className="flex flex-col">
              <PartSwitch
                label={t('dashboard.cardInspector.seconds', 'Seconds')}
                isOn={card.showSeconds}
                isFirst
                onChange={(showSeconds) => {
                  change((current) =>
                    current.type === 'clock' ? { ...current, showSeconds } : current,
                  );
                }}
              />
              <PartSwitch
                label={t('dashboard.cardInspector.date', 'Date')}
                isOn={card.showDate}
                onChange={(showDate) => {
                  change((current) =>
                    current.type === 'clock' ? { ...current, showDate } : current,
                  );
                }}
              />
            </div>
          </Field>
        ) : null}

        {card.type === 'energy' ? <EnergySettings card={card} onChange={change} /> : null}
      </div>

      <div className="flex h-13 shrink-0 items-center justify-between border-t border-border px-2">
        <button
          type="button"
          className="press-scale inline-flex h-8 items-center gap-2 rounded-pill px-2.5 text-ui-sm font-medium text-danger transition-colors hover:bg-danger-soft"
          onClick={() => {
            onRemove(cardId);
          }}
        >
          <AppIcon id="trash-2" size={15} />
          {card.type === 'container'
            ? t('dashboard.cardSettings.removeGroup', 'Remove group')
            : t('common.remove', 'Remove')}
        </button>
        <button
          type="button"
          aria-live="polite"
          disabled={pendingKind !== null}
          className={cn(
            'press-scale inline-flex h-8 items-center gap-2 rounded-pill px-2.5 text-ui-sm font-medium transition-colors duration-150 disabled:opacity-40',
            isCopied ? 'text-success' : 'text-foreground-muted hover:text-foreground',
          )}
          onClick={() => {
            onCopy(card);
          }}
        >
          <span key={String(isCopied)} className="inline-flex animate-fade-in">
            <AppIcon id={isCopied ? 'check' : 'copy'} size={15} />
          </span>
          {isCopied
            ? t('dashboard.cardSettings.copied', 'Copied')
            : t('dashboard.cardSettings.copy', 'Copy')}
        </button>
      </div>
    </aside>
  );
}

/**
 * Renders one switch of the parts a card shows.
 *
 * @param props - The part.
 * @param props.label - What it is.
 * @param props.isOn - Whether it is shown.
 * @param props.isFirst - Whether it is the first, drawn without the line above.
 * @param props.onChange - When switched.
 * @returns The row.
 */
function PartSwitch(props: {
  readonly label: string;
  readonly isOn: boolean;
  readonly isFirst?: boolean;
  readonly onChange: (isOn: boolean) => void;
}) {
  const { label, isOn, isFirst = false, onChange } = props;

  return (
    <div
      className={cn(
        'flex h-9 items-center justify-between gap-2.5 text-ui-sm',
        isFirst ? undefined : 'border-t border-border',
      )}
    >
      <span aria-hidden="true">{label}</span>
      <Switch label={label} size="small" isOn={isOn} onChange={onChange} />
    </div>
  );
}

/**
 * Renders the options of an entity's card: the parts its size shows, and what a tap does.
 *
 * @param props - The card and its entity.
 * @param props.card - The card.
 * @param props.entity - Its entity.
 * @param props.onChange - Changes the card.
 * @returns The options.
 */
function EntityOptions(props: {
  readonly card: DashboardEntityCard;
  readonly entity: EntityView;
  readonly onChange: (update: (current: DashboardCard) => DashboardCard) => void;
}) {
  const { t } = useTranslation();

  const { card, entity, onChange } = props;
  const parts = partsOf(entity, card);
  const hidden = new Set(card.hide ?? []);
  const choices = tapChoices(entity);

  return (
    <>
      {parts.length === 0 ? null : (
        <Field label={t('dashboard.cardSettings.show', 'Show')}>
          <div className="flex flex-col">
            {parts.map((part, index) => (
              <PartSwitch
                key={part.id}
                label={text(part.label)}
                isOn={!hidden.has(part.id)}
                isFirst={index === 0}
                onChange={(isOn) => {
                  onChange((current) => {
                    if (current.type !== 'entity') {
                      return current;
                    }

                    const rest = (current.hide ?? []).filter((id) => id !== part.id);

                    return { ...current, hide: isOn ? rest : [...rest, part.id] };
                  });
                }}
              />
            ))}
          </div>
        </Field>
      )}
      <SelectField
        label={t('dashboard.cardSettings.whenTapped', 'When tapped')}
        size="compact"
        options={choices.map((choice) => ({ value: choice.value, label: choice.label }))}
        value={card.tap ?? 'sheet'}
        onChange={(value) => {
          const tap = choices.find((choice) => choice.value === value)?.value;

          onChange((current) =>
            current.type !== 'entity' || tap === undefined ? current : { ...current, tap },
          );
        }}
      />
    </>
  );
}
