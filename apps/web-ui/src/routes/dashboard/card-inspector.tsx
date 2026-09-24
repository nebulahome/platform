/**
 * The inspector: one card, opened beside the grid while the layout is edited.
 *
 * What it offers depends on the card. Every card has a size - only the sizes it is drawn for, the
 * ones its grid is wide enough for - a place (the page, or a group), and a way off the page. An
 * entity's card can be pointed at another entity, given a title and an icon of its own, and told
 * how far back its chart looks; a scene's at another scene; a clock whether it shows seconds and
 * the date; a group its name, its icon and its width.
 *
 * Everything changes the draft at once, so the grid beside it shows the card as it will be. It
 * floats over the page rather than taking a column beside the grid: a grid that narrowed whenever
 * a card was chosen would resize every other card on it.
 */
import {
  DASHBOARD_COLUMNS,
  DASHBOARD_HISTORY_RANGES,
  type DashboardCard,
  type DashboardContainerCard,
  type DashboardHistoryRange,
  type DashboardLayout,
  type IconView,
  type SceneView,
} from '@nebula-home/contracts';
import { AppIcon, Button, IconButton, Segmented, SelectField, Switch } from '@nebula-home/ui';

import {
  CARD_SIZES,
  cardKindOf,
  CONTAINER_WIDTHS,
  sizeName,
  type CardSize,
} from '@/dashboard/card-sizes';
import {
  findCard,
  minimumContainerWidth,
  placeCard,
  resizeCard,
  updateCard,
} from '@/dashboard/dashboard-layout';
import { cardTitle } from '@/routes/dashboard/card-view';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { EntityField } from '@/routes/library/entity-field';
import { NameIconField } from '@/routes/library/name-icon-field';

/** What the inspector needs. */
export type CardInspectorProps = {
  /** The layout being edited. */
  readonly layout: DashboardLayout;

  /** The card open in it. */
  readonly cardId: string;

  /** What the page read for its cards. */
  readonly data: DashboardData;

  /** The scenes this person may see, for a scene card. */
  readonly scenes: readonly SceneView[];

  /** Takes the changed layout. */
  readonly onChange: (layout: DashboardLayout) => void;

  /** Takes the card off. */
  readonly onRemove: (cardId: string) => void;

  /** Closes the inspector. */
  readonly onClose: () => void;
};

/** The words for what a card is, in the inspector's heading. */
const TYPE_NAMES = {
  entity: 'Entity card',
  scene: 'Scene card',
  clock: 'Clock',
  container: 'Group',
} as const;

/**
 * Names a size as the size picker's value.
 *
 * @param size - The size.
 * @returns `1x2` and the like.
 */
function sizeValue(size: CardSize): string {
  return `${String(size.w)}x${String(size.h)}`;
}

/**
 * Renders the inspector.
 *
 * @param props - See {@link CardInspectorProps}.
 * @returns The inspector, or nothing when the card is no longer there.
 */
export function CardInspector(props: CardInspectorProps) {
  const { layout, cardId, data, scenes, onChange, onRemove, onClose } = props;
  const found = findCard(layout, cardId);

  if (found === null) {
    return null;
  }

  const { card, parentId } = found;
  const parent = parentId === null ? null : findCard(layout, parentId)?.card;
  const gridColumns = parent === null || parent === undefined ? DASHBOARD_COLUMNS : parent.w;
  const groups = layout.cards.filter(
    (one): one is DashboardContainerCard => one.type === 'container',
  );

  /**
   * Changes the card's settings.
   *
   * @param update - What to make of it.
   */
  const change = (update: (current: DashboardCard) => DashboardCard): void => {
    onChange(updateCard(layout, cardId, update));
  };

  const sizes: readonly CardSize[] =
    card.type === 'container'
      ? CONTAINER_WIDTHS.filter((w) => w >= minimumContainerWidth(card, data.sizesOf)).map((w) => ({
          w,
          h: card.h,
        }))
      : data.sizesOf(card).filter((size) => size.w <= gridColumns);

  return (
    <aside
      aria-label={`${TYPE_NAMES[card.type]}: ${cardTitle(card, data)}`}
      className="fixed top-22 right-6 z-30 flex max-h-[calc(100vh-7rem)] w-80 flex-col gap-4 overflow-y-auto rounded-dialog border border-border-strong bg-surface p-4.5 shadow-dialog"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-title font-semibold tracking-tight">{TYPE_NAMES[card.type]}</h2>
          <p className="truncate text-caption text-foreground-subtle">{cardTitle(card, data)}</p>
        </div>
        <IconButton variant="raised" size="small" label="Close the inspector" onClick={onClose}>
          <AppIcon id="x" size={14} />
        </IconButton>
      </div>

      {card.type === 'entity' ? (
        <>
          <EntityField
            label="Entity"
            size="compact"
            value={card.entityId}
            onChange={(value, entity) => {
              if (entity === undefined || value === '') {
                return;
              }

              // A card pointed at another kind of thing keeps its size when that kind is drawn
              // at it, and takes the size the kind starts at otherwise.
              const next = updateCard(layout, cardId, (current) =>
                current.type === 'entity' ? { ...current, entityId: entity.entityId } : current,
              );
              const rule = CARD_SIZES[cardKindOf(entity)];
              const fits = rule.sizes.some((size) => size.w === card.w && size.h === card.h);

              onChange(fits ? next : resizeCard(next, cardId, rule.preferred, data.sizesOf));
            }}
          />
          <TitleAndIcon
            card={card}
            placeholder={data.entityById.get(card.entityId)?.name ?? card.entityId}
            onChange={change}
          />
          {data.entityById
            .get(card.entityId)
            ?.capabilities.some((entry) => entry.capability === 'sensor_numeric') === true ? (
            <Segmented<DashboardHistoryRange>
              label="Chart"
              size="compact"
              className="self-start"
              options={DASHBOARD_HISTORY_RANGES.map((range) => ({ value: range, label: range }))}
              value={card.range ?? '24h'}
              onChange={(range) => {
                change((current) => (current.type === 'entity' ? { ...current, range } : current));
              }}
            />
          ) : null}
        </>
      ) : null}

      {card.type === 'scene' ? (
        <>
          <SelectField
            label="Scene"
            size="compact"
            options={scenes.map((scene) => ({ value: scene.id, label: scene.name }))}
            value={card.sceneId}
            onChange={(sceneId) => {
              change((current) => (current.type === 'scene' ? { ...current, sceneId } : current));
            }}
          />
          <TitleAndIcon
            card={card}
            placeholder={data.sceneById.get(card.sceneId)?.name ?? 'Scene'}
            onChange={change}
          />
        </>
      ) : null}

      {card.type === 'clock' ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 text-ui">
            <span aria-hidden="true">Seconds</span>
            <Switch
              label="Show seconds"
              isOn={card.showSeconds}
              onChange={(showSeconds) => {
                change((current) =>
                  current.type === 'clock' ? { ...current, showSeconds } : current,
                );
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-ui">
            <span aria-hidden="true">Date</span>
            <Switch
              label="Show the date"
              isOn={card.showDate}
              onChange={(showDate) => {
                change((current) =>
                  current.type === 'clock' ? { ...current, showDate } : current,
                );
              }}
            />
          </div>
        </div>
      ) : null}

      {card.type === 'container' ? (
        <NameIconField
          label="Name"
          value={card.title}
          required
          onChange={(title) => {
            change((current) => (current.type === 'container' ? { ...current, title } : current));
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
        <Segmented
          label={card.type === 'container' ? 'Width' : 'Size'}
          size="compact"
          className="self-start"
          options={sizes.map((size) => ({
            value: sizeValue(size),
            label: card.type === 'container' ? `${String(size.w)} col` : sizeName(size),
          }))}
          value={sizeValue(card)}
          onChange={(value) => {
            const size = sizes.find((candidate) => sizeValue(candidate) === value);

            if (size !== undefined) {
              onChange(resizeCard(layout, cardId, size, data.sizesOf));
            }
          }}
        />
      ) : null}

      {card.type === 'container' || groups.length === 0 ? null : (
        <SelectField
          label="Place in"
          size="compact"
          options={[
            { value: '', label: 'The page' },
            ...groups.map((group) => ({ value: group.id, label: group.title })),
          ]}
          value={parentId ?? ''}
          hint="Or drag it by its grip."
          onChange={(value) => {
            const target = value === '' ? null : value;

            // To the end of wherever it goes; the grid packs it up to the first free place.
            onChange(placeCard(layout, cardId, { parentId: target, x: 0, y: 999 }, data.sizesOf));
          }}
        />
      )}

      <Button
        variant="danger"
        size="compact"
        className="self-start"
        onClick={() => {
          onRemove(cardId);
        }}
      >
        Remove {card.type === 'container' ? 'group and its cards' : 'card'}
      </Button>
    </aside>
  );
}

/** What the title and icon fields need. */
type TitleAndIconProps = {
  readonly card: Extract<DashboardCard, { title: string | null }>;

  /** The name shown when the card has no title of its own. */
  readonly placeholder: string;

  readonly onChange: (update: (current: DashboardCard) => DashboardCard) => void;
};

/**
 * Renders a card's own title and icon, each of which may be left to the thing it shows.
 *
 * @param props - See {@link TitleAndIconProps}.
 * @returns The fields.
 */
function TitleAndIcon(props: TitleAndIconProps) {
  const { card, placeholder, onChange } = props;

  return (
    <div className="flex flex-col gap-1.5">
      <NameIconField
        label="Title"
        value={card.title ?? ''}
        hint={`Empty for its own name, ${placeholder}.`}
        onChange={(value) => {
          onChange((current) =>
            current.type === 'entity' || current.type === 'scene'
              ? { ...current, title: value.trim() === '' ? null : value }
              : current,
          );
        }}
        icon={card.icon}
        onIconChange={(view) => {
          onChange((current) =>
            current.type === 'entity' || current.type === 'scene'
              ? { ...current, icon: view.id }
              : current,
          );
        }}
      />
      {card.icon === null ? null : (
        <button
          type="button"
          className="self-start text-caption text-foreground-subtle underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => {
            onChange((current) =>
              current.type === 'entity' || current.type === 'scene'
                ? { ...current, icon: null }
                : current,
            );
          }}
        >
          Use its own icon
        </button>
      )}
    </div>
  );
}
