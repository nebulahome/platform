/**
 * Adding a card, in one step (`N-Dashboard-Add*`): a catalogue of every kind of card, each tile
 * holding the real card drawn with a sample, its name, what it shows and the sizes it comes in.
 * One click adds that card in the empty space that was clicked, at its smallest size, closes the
 * dialog and opens the card's settings on the page - where its entity and its size are chosen with
 * the card itself in sight. There is no step for the size.
 *
 * The search looks in three places at once: the entities, by name, room and address, each row
 * with one button - the card that entity gets, its entity already set; and the kinds of card.
 *
 * Kinds are grouped: for one entity, together, summing up, from packages, and the others - the
 * group among them, added like any card; it is not offered inside a group. "From packages" shows
 * only when an installed package offers cards.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { DashboardCard, EntityView, SceneView, TogetherDomain } from '@nebulahome/contracts';
import { AppIcon, cn, Modal } from '@nebulahome/ui';

import { kindDescription, kindName } from '@/dashboard/card-options';
import {
  allowedSizes,
  CARD_SIZES,
  cardKindOf,
  ENTITY_CARD_KINDS,
  packageCardSizes,
  sizeName,
  type CardSize,
  type EntityCardKind,
} from '@/dashboard/card-sizes';
import {
  actionsCard,
  activityCard,
  automationCard,
  clockCard,
  compareCard,
  containerCard,
  entityCardFor,
  listCard,
  packageCardFor,
  pendingCardFor,
  roomCardFor,
  sceneCardFor,
  shortcutCard,
  summaryCardFor,
  togetherCardFor,
} from '@/dashboard/new-cards';
import { defineMessage, text, type Message } from '@/i18n/messages';
import { entityKindOf } from '@/library/entity-kind';
import { readingOf } from '@/library/entity-reading';
import { useInstalledPackages } from '@/packages/use-packages';
import { CardPreview } from '@/routes/dashboard/card-preview';
import { SAMPLE_ENTITIES, sampleDashboardData } from '@/routes/dashboard/card-samples';
import { SAMPLE_CARDS } from '@/routes/dashboard/samples/cards';
import type { DashboardData } from '@/routes/dashboard/use-dashboard-data';
import { EntityTile } from '@/routes/library/entity-tile';

/** A card added, and the kind it will be when it still waits for its entity. */
export type AddedCard = { readonly card: DashboardCard; readonly pendingKind: string | null };

/** What the dialog needs. */
export type AddCardDialogProps = {
  /** Whether it is open. */
  readonly isOpen: boolean;

  /** Closes it. */
  readonly onClose: () => void;

  /** Where the card goes, by name: the dashboard's, or the group's. */
  readonly targetName: string;

  /** Whether the space chosen is inside a group: no group is offered then. */
  readonly isInGroup: boolean;

  /** What the page read: the entities the search finds. */
  readonly data: DashboardData;

  /** The scenes this person may see. */
  readonly scenes: readonly SceneView[];

  /** Takes the card chosen. */
  readonly onAdd: (added: AddedCard) => void;
};

/** The groups of the catalogue. */
type Category = 'all' | 'entity' | 'together' | 'summing' | 'packages' | 'other';

/** One tile of the catalogue. */
type Tile = {
  readonly id: string;
  readonly category: Exclude<Category, 'all'>;
  readonly name: string;
  readonly description: string;

  /** The sizes it comes in, written as cells; "Full width" for a group. */
  readonly sizes: string;

  /** The card drawn on the tile, or null when it has no preview to show. */
  readonly preview: DashboardCard | null;

  /** The package it comes with, when it does. */
  readonly packageName?: string;

  /** Makes the card. */
  readonly make: () => AddedCard;
};

/** The order the kinds for one entity are shown in: the commonest first, as the boards list them. */
const ENTITY_ORDER: readonly string[] = [
  'light',
  'switch',
  'sensor',
  'thermostat',
  'cover',
  'lock',
  'media',
  'camera',
  'fan',
  'binary',
  'text',
  'vacuum',
  'mower',
  'select',
  'number',
  'button',
  'update',
  'picture',
  'custom',
];

/**
 * The sizes of a kind, as the catalogue writes them.
 *
 * @param sizes - The sizes.
 * @returns "1×1 · 1×2 · 2×2".
 */
const sizesLine = (sizes: readonly CardSize[]): string => sizes.map(sizeName).join(' · ');

/** The samples every preview reads. */
const SAMPLES = sampleDashboardData();

/**
 * The catalogue's tiles.
 *
 * @param input - What it is drawn from.
 * @param input.scenes - The scenes there are.
 * @param input.packageTiles - The cards the installed packages offer.
 * @param input.isInGroup - Whether the space is inside a group.
 * @param input.groupName - What a new group is called.
 * @returns The tiles, in the order the catalogue shows them.
 */
function tilesOf(input: {
  readonly scenes: readonly SceneView[];
  readonly packageTiles: readonly Tile[];
  readonly isInGroup: boolean;
  readonly groupName: string;
}): Tile[] {
  const { scenes, packageTiles, isInGroup, groupName } = input;
  const ordered = [...ENTITY_CARD_KINDS].sort(
    (a, b) =>
      (ENTITY_ORDER.indexOf(a) + 1 || ENTITY_ORDER.length + 1) -
      (ENTITY_ORDER.indexOf(b) + 1 || ENTITY_ORDER.length + 1),
  );
  const entityTiles = ordered.flatMap((kind): Tile[] => {
    const sample = SAMPLE_ENTITIES.find((entity) => cardKindOf(entity) === kind);
    const sizes = CARD_SIZES[kind].sizes;

    if (sample === undefined) {
      return [];
    }

    const preview = entityCardFor(sample);

    return [
      {
        id: kind,
        category: 'entity',
        name: kindName(kind),
        description: kindDescription(kind),
        sizes: sizesLine(sizes),
        preview: { ...preview, ...(allowedSizes(sample)[0] ?? sizes[0]) },
        /**
         * A card of this kind, waiting for its entity.
         *
         * @returns The card.
         */
        make: () => ({ card: pendingCardFor(kind), pendingKind: kind }),
      },
    ];
  });
  const firstScene = scenes[0];
  const group = containerCard(groupName);
  const sampleGroup: DashboardCard = {
    ...group,
    w: 2,
    cards: SAMPLE_ENTITIES.slice(0, 2).map((entity, index) => ({
      ...entityCardFor(entity),
      x: index,
      y: 0,
      w: 1,
      h: 1,
    })),
  };

  return [
    ...entityTiles,
    ...newTypeTiles(),
    ...packageTiles,
    ...(isInGroup
      ? []
      : [
          {
            id: 'group',
            category: 'other' as const,
            name: kindName('group'),
            description: kindDescription('group'),
            sizes: '',
            preview: sampleGroup,
            /**
             * An empty group.
             *
             * @returns The group.
             */
            make: () => ({ card: containerCard(groupName), pendingKind: null }),
          },
        ]),
    {
      id: 'clock',
      category: 'other',
      name: kindName('clock'),
      description: kindDescription('clock'),
      sizes: sizesLine(CARD_SIZES.clock.sizes),
      preview: clockCard(),
      /**
       * A clock.
       *
       * @returns The card.
       */
      make: () => ({ card: clockCard(), pendingKind: null }),
    },
    ...(firstScene === undefined
      ? []
      : [
          {
            id: 'scene',
            category: 'other' as const,
            name: kindName('scene'),
            description: kindDescription('scene'),
            sizes: sizesLine(CARD_SIZES.scene.sizes),
            preview: null,
            /**
             * A scene's card, on the first scene: another is chosen in its settings.
             *
             * @returns The card.
             */
            make: () => ({ card: sceneCardFor(firstScene.id), pendingKind: null }),
          },
        ]),
  ];
}

/** A tile of a card type that is not one entity's card. */
type TypeTile = {
  readonly type: TypeTileKind;
  readonly category: Exclude<Category, 'all' | 'packages' | 'entity'>;
  readonly id: string;
  readonly name: string;
  readonly description: string;

  /** For a Together tile, the kind it gathers: its preview is the sample of that kind. */
  readonly domain?: TogetherDomain;

  /** Makes the card, and says whether it waits for something before Done keeps it. */
  readonly make: () => AddedCard;
};

/** The types of card a type tile adds. */
type TypeTileKind =
  | 'together'
  | 'summary'
  | 'room'
  | 'list'
  | 'actions'
  | 'compare'
  | 'activity'
  | 'automation'
  | 'shortcut';

/** The kinds of entity gathered by a Together card, and what each tile is called. */
const TOGETHER_TILES: readonly { readonly domain: TogetherDomain; readonly name: Message }[] = [
  {
    domain: 'light',
    name: defineMessage('dashboard.addCardDialog.lightsTogether', 'Lights together'),
  },
  {
    domain: 'switch',
    name: defineMessage('dashboard.addCardDialog.switchesTogether', 'Switches together'),
  },
  {
    domain: 'cover',
    name: defineMessage('dashboard.addCardDialog.coversTogether', 'Covers together'),
  },
  {
    domain: 'lock',
    name: defineMessage('dashboard.addCardDialog.locksTogether', 'Locks together'),
  },
  {
    domain: 'thermostat',
    name: defineMessage('dashboard.addCardDialog.climateTogether', 'Climate together'),
  },
];

/**
 * The tiles of the card types that are not one entity's card.
 *
 * @returns The tiles, with their previews among the sample cards.
 */
function newTypeTiles(): Tile[] {
  const tiles: TypeTile[] = [
    ...TOGETHER_TILES.map((each): TypeTile => ({
      type: 'together',
      category: 'together',
      id: `together-${each.domain}`,
      name: text(each.name),
      description: kindDescription(`together-${each.domain}`),
      domain: each.domain,
      /**
       * Every one of the kind in the house.
       *
       * @returns The card.
       */
      make: () => ({ card: togetherCardFor(each.domain), pendingKind: null }),
    })),
    {
      type: 'summary',
      category: 'summing',
      id: 'summary',
      name: kindName('summary'),
      description: kindDescription('summary'),
      /**
       * Doors and windows open, across the house: what it counts is changed in its settings.
       *
       * @returns The card.
       */
      make: () => ({ card: summaryCardFor('openings'), pendingKind: null }),
    },
    {
      type: 'room',
      category: 'summing',
      id: 'room',
      name: kindName('room'),
      description: kindDescription('room'),
      /**
       * A room's card, waiting for its room.
       *
       * @returns The card.
       */
      make: () => ({ card: roomCardFor(), pendingKind: 'room' }),
    },
    {
      type: 'list',
      category: 'summing',
      id: 'list',
      name: kindName('list'),
      description: kindDescription('list'),
      /**
       * An empty list, waiting for its entities.
       *
       * @returns The card.
       */
      make: () => ({ card: listCard(), pendingKind: 'list' }),
    },
    {
      type: 'actions',
      category: 'summing',
      id: 'actions',
      name: kindName('actions'),
      description: kindDescription('actions'),
      /**
       * Quick actions, waiting for their buttons.
       *
       * @returns The card.
       */
      make: () => ({ card: actionsCard(), pendingKind: 'actions' }),
    },
    {
      type: 'compare',
      category: 'summing',
      id: 'compare',
      name: kindName('compare'),
      description: kindDescription('compare'),
      /**
       * A comparison, waiting for its readings.
       *
       * @returns The card.
       */
      make: () => ({ card: compareCard(), pendingKind: 'compare' }),
    },
    {
      type: 'activity',
      category: 'summing',
      id: 'activity',
      name: kindName('activity'),
      description: kindDescription('activity'),
      /**
       * What happened lately in the house.
       *
       * @returns The card.
       */
      make: () => ({ card: activityCard(), pendingKind: null }),
    },
    {
      type: 'automation',
      category: 'other',
      id: 'automation',
      name: kindName('automation'),
      description: kindDescription('automation'),
      /**
       * An automation's card, waiting for its automation.
       *
       * @returns The card.
       */
      make: () => ({ card: automationCard(), pendingKind: 'automation' }),
    },
    {
      type: 'shortcut',
      category: 'other',
      id: 'shortcut',
      name: kindName('shortcut'),
      description: kindDescription('shortcut'),
      /**
       * A shortcut, waiting for where it goes.
       *
       * @returns The card.
       */
      make: () => ({ card: shortcutCard(), pendingKind: 'shortcut' }),
    },
  ];

  return tiles.map((tile) => ({
    id: tile.id,
    category: tile.category,
    name: tile.name,
    description: tile.description,
    sizes: sizesLine(CARD_SIZES[tile.type].sizes),
    preview:
      SAMPLE_CARDS.find(
        (card) =>
          card.type === tile.type &&
          (card.type !== 'together' || tile.domain === undefined || card.domain === tile.domain),
      ) ?? null,
    make: tile.make,
  }));
}

/**
 * Renders one tile of the catalogue: the card drawn small on its dotted floor, then its name,
 * what it shows and its sizes. The whole tile is the button; under the pointer it takes the
 * accent and says "+ Add".
 *
 * @param props - The tile.
 * @param props.tile - See {@link Tile}.
 * @param props.index - Its place, for the order the tiles arrive in.
 * @param props.onChoose - When it is chosen.
 * @returns The tile.
 */
function CatalogueTile(props: {
  readonly tile: Tile;
  readonly index: number;
  readonly onChoose: () => void;
}) {
  const { t } = useTranslation();

  const { tile, index, onChoose } = props;

  return (
    <button
      type="button"
      className={cn(
        'group/tile relative flex animate-rise flex-col overflow-hidden rounded-[18px] border border-border bg-surface text-left',
        'transition-[border-color,box-shadow,transform] duration-150 ease-out',
        'hover:border-primary hover:shadow-[0_0_0_3px_rgb(124_134_255/0.16)] active:scale-[0.99]',
        'focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_rgb(124_134_255/0.16)] focus-visible:outline-none',
      )}
      /* eslint-disable-next-line react/forbid-dom-props -- the tiles arrive one after another. */
      style={{ animationDelay: `${String(Math.min(index, 8) * 18)}ms`, animationFillMode: 'both' }}
      onClick={onChoose}
    >
      <span className="flex h-32 items-center justify-center border-b border-border bg-well bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-size-[16px_16px]">
        {tile.preview === null ? (
          <span className="flex h-[100px] w-59 flex-col items-center justify-center gap-1.5 rounded-card border border-dashed border-border-strong text-caption text-foreground-subtle">
            <AppIcon
              id={tile.packageName === undefined ? 'layout-dashboard' : 'package'}
              size={18}
            />
            {tile.packageName === undefined
              ? tile.name
              : t('dashboard.addCardDialog.noPreview', 'No preview from this package')}
          </span>
        ) : (
          <CardPreview card={tile.preview} data={SAMPLES} fit={{ width: 236, height: 104 }} />
        )}
      </span>
      <span className="flex flex-col gap-[5px] px-3.5 pt-3 pb-3.5">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[14.5px] font-semibold">{tile.name}</span>
          <span className="inline-flex shrink-0 items-center gap-[5px] text-ui-sm font-medium text-primary-hover opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100">
            <AppIcon id="plus" size={14} />
            {t('dashboard.addCardDialog.add', 'Add')}
          </span>
          {tile.packageName === undefined ? null : (
            <span className="inline-flex shrink-0 items-center gap-[5px] text-caption text-foreground-subtle group-hover/tile:hidden">
              <AppIcon id="package" size={12} />
              {tile.packageName}
            </span>
          )}
        </span>
        <span className="truncate text-[12.5px] text-foreground-muted">{tile.description}</span>
        <span className="font-mono text-label tracking-[0.08em] text-foreground-subtle uppercase tabular">
          {tile.sizes === '' ? t('dashboard.addCardDialog.fullWidth', 'Full width') : tile.sizes}
        </span>
      </span>
    </button>
  );
}

/**
 * Renders a group of tiles under its heading.
 *
 * @param props - The group.
 * @param props.label - Its heading.
 * @param props.count - How many it holds, written at the right.
 * @param props.children - The tiles.
 * @returns The group.
 */
function TileGroup(props: {
  readonly label: string;
  readonly count: string;
  readonly children: ReactNode;
}) {
  const { label, count, children } = props;

  return (
    <section className="flex flex-col">
      <div className="flex h-7.5 items-center justify-between font-mono text-label tracking-[0.08em] text-foreground-subtle uppercase">
        <span>{label}</span>
        <span>{count}</span>
      </div>
      <div className="mb-4.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link AddCardDialogProps}.
 * @returns The dialog.
 */
export function AddCardDialog(props: AddCardDialogProps) {
  const { t } = useTranslation();

  const { isOpen, onClose, targetName, isInGroup, data, scenes, onAdd } = props;
  const [category, setCategory] = useState<Category>('all');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const { packages } = useInstalledPackages();

  // The dialog opens on its search: typing is the quickest way to a card. After the native dialog
  // has put the focus on its first control.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      searchRef.current?.focus();
    });

    return (): void => {
      cancelAnimationFrame(frame);
    };
  }, [isOpen]);
  const packageTiles: Tile[] = packages.flatMap((found) =>
    (found.ui?.cards ?? []).map((declared) => ({
      id: `${found.id}:${declared.id}`,
      category: 'packages' as const,
      name: declared.name,
      description: declared.description ?? found.name,
      sizes: sizesLine(packageCardSizes(declared.sizes)),
      // shortcut: package cards show the neutral tile until the SDK draws its own previews.
      preview: null,
      packageName: found.name,
      /**
       * The package's card, with the defaults its options declare.
       *
       * @returns The card.
       */
      make: () => ({ card: packageCardFor(found.id, declared), pendingKind: null }),
    })),
  );
  const tiles = tilesOf({
    scenes,
    packageTiles,
    isInGroup,
    groupName: t('dashboard.dashboardEditor.newGroup', 'New group'),
  });
  const categories: readonly { readonly id: Category; readonly label: string }[] = [
    { id: 'all', label: t('dashboard.addCardDialog.allCards', 'All cards') },
    { id: 'entity', label: t('dashboard.addCardDialog.forOneEntity', 'For one entity') },
    { id: 'together', label: t('dashboard.addCardDialog.together', 'Together') },
    { id: 'summing', label: t('dashboard.addCardDialog.summingUp', 'Summing up') },
    { id: 'packages', label: t('dashboard.addCardDialog.fromPackages', 'From packages') },
    { id: 'other', label: t('dashboard.addCardDialog.other', 'Other') },
  ];
  /**
   * How many tiles a group of the catalogue holds.
   *
   * @param id - The group.
   * @returns How many.
   */
  const countOf = (id: Category): number =>
    id === 'all' ? tiles.length : tiles.filter((tile) => tile.category === id).length;
  const words = query.trim().toLowerCase();

  /**
   * Adds a card and closes.
   *
   * @param added - The card.
   */
  const choose = (added: AddedCard): void => {
    onAdd(added);
    setQuery('');
    setCategory('all');
  };

  const found: readonly EntityView[] =
    words === ''
      ? []
      : [...data.entityById.values()]
          .filter(
            (entity) =>
              entity.isEnabled &&
              !entity.isHidden &&
              `${entity.name} ${entity.areaName ?? ''} ${entity.entityId}`
                .toLowerCase()
                .includes(words),
          )
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 30);
  const matchingTiles =
    words === ''
      ? []
      : tiles.filter((tile) => `${tile.name} ${tile.description}`.toLowerCase().includes(words));
  const shown = category === 'all' ? tiles : tiles.filter((tile) => tile.category === category);
  const shownGroups = categories.filter(
    (each) => each.id !== 'all' && shown.some((tile) => tile.category === each.id),
  );
  const help =
    words !== ''
      ? t(
          'dashboard.addCardDialog.searchHelp',
          'The button on a row adds that entity’s card, with the entity already set.',
        )
      : category === 'packages'
        ? t(
            'dashboard.addCardDialog.packagesHelp',
            'A package draws its own preview. When it gives none, the card shows its name and sizes only.',
          )
        : category === 'other' && !isInGroup
          ? t(
              'dashboard.addCardDialog.groupHelp',
              'A group is added like a card: it takes the full width and its own empty spaces take cards.',
            )
          : t(
              'dashboard.addCardDialog.help',
              'A click adds the card at its smallest size and opens its settings on the page.',
            );
  const total =
    words !== ''
      ? t('dashboard.addCardDialog.results', {
          count: found.length + matchingTiles.length,
          defaultValue_one: '{{count}} result',
          defaultValue_other: '{{count}} results',
        })
      : category === 'all'
        ? t('dashboard.addCardDialog.cards', {
            count: tiles.length,
            defaultValue_one: '{{count}} card',
            defaultValue_other: '{{count}} cards',
          })
        : t('dashboard.addCardDialog.someOfCards', '{{some}} of {{count}} cards', {
            some: shown.length,
            count: tiles.length,
          });
  const title = t('dashboard.addCardDialog.addACard', 'Add a card');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} layout="bare">
      <div className="relative isolate m-auto flex h-full max-h-[860px] w-[1120px] max-w-full animate-dialog-in flex-col overflow-hidden rounded-[26px] border border-border-strong bg-well shadow-[0_50px_140px_-30px_rgb(0_0_0/0.95)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-65 bg-[radial-gradient(60%_100%_at_10%_0%,rgb(124_134_255/0.20),transparent_70%),radial-gradient(50%_90%_at_90%_0%,rgb(167_139_250/0.12),transparent_70%)]"
        />
        <div className="flex shrink-0 items-center gap-3.5 pt-5.5 pr-5.5 pl-7">
          <span className="flex min-w-0 grow flex-col gap-[3px]">
            <h2 className="text-headline font-semibold tracking-[-0.02em]">{title}</h2>
            <span className="text-[13.5px] text-foreground-muted">
              {t('dashboard.addCardDialog.toTarget', 'to {{name}}, in the space you clicked', {
                name: targetName,
              })}
            </span>
          </span>
          <button
            type="button"
            aria-label={t('ui.modal.close', 'Close')}
            className="press-scale flex size-9.5 shrink-0 items-center justify-center rounded-pill border border-foreground/14 bg-canvas/45 text-foreground hover:bg-surface-raised"
            onClick={onClose}
          >
            <AppIcon id="x" size={16} />
          </button>
        </div>

        <div className="shrink-0 px-7 pt-4.5 pb-3.5">
          <label className="flex h-10.5 items-center gap-2.5 rounded-pill border border-border-strong bg-well px-4 transition-[border-color,box-shadow] duration-150 focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgb(124_134_255/0.16)]">
            <AppIcon id="search" size={16} />
            <input
              type="search"
              value={query}
              aria-label={t('dashboard.addCardDialog.search', 'Search entities, rooms and cards')}
              placeholder={t('dashboard.addCardDialog.search', 'Search entities, rooms and cards')}
              ref={searchRef}
              autoComplete="off"
              className="min-w-0 grow bg-transparent text-[14.5px] text-foreground outline-none placeholder:text-foreground-subtle [&::-webkit-search-cancel-button]:appearance-none"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </label>
        </div>

        {words === '' ? (
          <div className="flex min-h-0 grow gap-5 pl-7">
            <nav
              aria-label={t('dashboard.addCardDialog.kinds', 'Kinds of card')}
              className="flex w-[190px] shrink-0 flex-col gap-0.5 pt-0.5 max-md:hidden"
            >
              {categories
                .filter((each) => each.id === 'all' || countOf(each.id) > 0)
                .map((each) => (
                  <button
                    key={each.id}
                    type="button"
                    aria-current={category === each.id ? 'true' : undefined}
                    className={cn(
                      'flex h-9.5 items-center justify-between rounded-field border px-3 text-ui transition-colors duration-150',
                      category === each.id
                        ? 'border-border-strong bg-surface-raised font-medium text-foreground'
                        : 'border-transparent text-foreground-muted hover:text-foreground',
                    )}
                    onClick={() => {
                      setCategory(each.id);
                    }}
                  >
                    {each.label}
                    <span className="font-mono text-label text-foreground-subtle">
                      {countOf(each.id)}
                    </span>
                  </button>
                ))}
            </nav>
            <div key={category} className="min-w-0 grow overflow-y-auto pr-7 pb-1">
              {shownGroups.map((each) => {
                const inGroup = shown.filter((tile) => tile.category === each.id);

                return (
                  <TileGroup
                    key={each.id}
                    label={each.label}
                    count={t('dashboard.addCardDialog.cards', {
                      count: inGroup.length,
                      defaultValue_one: '{{count}} card',
                      defaultValue_other: '{{count}} cards',
                    })}
                  >
                    {inGroup.map((tile, index) => (
                      <CatalogueTile
                        key={tile.id}
                        tile={tile}
                        index={index}
                        onChoose={() => {
                          choose(tile.make());
                        }}
                      />
                    ))}
                  </TileGroup>
                );
              })}
              {category === 'packages' || (category === 'all' && packageTiles.length > 0) ? (
                <Link
                  to="/packages"
                  className="mb-4 flex h-13 items-center justify-center gap-2 rounded-card border border-dashed border-foreground/14 text-ui-sm text-foreground-muted transition-colors hover:border-primary/60"
                >
                  {t('dashboard.addCardDialog.moreCards', 'More cards come with packages')}
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    {t('dashboard.addCardDialog.browsePackages', 'Browse packages')}
                    <AppIcon id="external-link" size={14} />
                  </span>
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="min-h-0 grow animate-fade-in overflow-y-auto px-3.5 pb-3">
            {found.length === 0 && matchingTiles.length === 0 ? (
              <p className="px-3.5 py-8 text-center text-ui-sm text-foreground-subtle">
                {t('dashboard.addCardDialog.nothingFound', 'Nothing matches “{{query}}”', {
                  query: query.trim(),
                })}
              </p>
            ) : null}
            {found.length === 0 ? null : (
              <section>
                <div className="flex h-7.5 items-center justify-between px-3.5 font-mono text-label tracking-[0.08em] text-foreground-subtle uppercase">
                  <span>{t('dashboard.addCardDialog.entities', 'Entities')}</span>
                  <span>
                    {t('dashboard.addCardDialog.found', '{{count}} found', {
                      count: found.length,
                    })}
                  </span>
                </div>
                <ul className="mb-3.5 flex flex-col gap-0.5">
                  {found.map((entity) => {
                    const kind: EntityCardKind = cardKindOf(entity);

                    return (
                      <li
                        key={entity.entityId}
                        className="grid min-h-15.5 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[14px] border border-transparent px-3.5 transition-colors duration-150 hover:border-primary/60 hover:bg-primary/8"
                      >
                        <EntityTile
                          icon={undefined}
                          kind={entityKindOf(entity)}
                          isActive={null}
                          size="well"
                          className="size-10 rounded-tile"
                        />
                        <span className="flex min-w-0 flex-col gap-[3px]">
                          <span className="truncate text-[14.5px] font-semibold">
                            {entity.name}
                          </span>
                          <span className="truncate text-[12.5px] text-foreground-muted">
                            {entity.areaName === null
                              ? entity.entityId
                              : `${entity.areaName} · ${entity.entityId}`}
                          </span>
                        </span>
                        <span className="flex items-center gap-3.5">
                          <span className="text-[12.5px] whitespace-nowrap text-foreground-subtle max-sm:hidden">
                            {readingOf(entity, data.readings[entity.entityId]).text}
                          </span>
                          <button
                            type="button"
                            className="press-scale inline-flex h-7.5 items-center gap-1.5 rounded-pill border border-border-strong pr-3 pl-2 text-[12.5px] font-medium whitespace-nowrap text-foreground hover:border-primary/60 hover:bg-primary/10"
                            onClick={() => {
                              choose({ card: entityCardFor(entity), pendingKind: null });
                            }}
                          >
                            <AppIcon id="plus" size={14} />
                            {kindName(kind)}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {matchingTiles.length === 0 ? null : (
              <div className="px-3.5">
                <TileGroup
                  label={t('dashboard.addCardDialog.cardsLabel', 'Cards')}
                  count={t('dashboard.addCardDialog.found', '{{count}} found', {
                    count: matchingTiles.length,
                  })}
                >
                  {matchingTiles.map((tile, index) => (
                    <CatalogueTile
                      key={tile.id}
                      tile={tile}
                      index={index}
                      onChoose={() => {
                        choose(tile.make());
                      }}
                    />
                  ))}
                </TileGroup>
              </div>
            )}
          </div>
        )}

        <div className="flex h-14 shrink-0 items-center gap-3 border-t border-border px-7 text-ui-sm text-foreground-muted">
          <AppIcon id="info" size={15} />
          <span className="min-w-0 grow truncate">{help}</span>
          <span className="shrink-0">{total}</span>
        </div>
      </div>
    </Modal>
  );
}
