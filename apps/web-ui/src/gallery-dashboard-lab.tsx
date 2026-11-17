/**
 * The dashboard lab (`pnpm preview:dashboard`, development only): every card kind at every size it
 * is drawn for, with the samples the Add card catalogue shows (`card-samples.ts`), each in a box of
 * the grid's own cells - columns 267 px, rows 100 px, 16 px apart - so a screenshot of it lies
 * beside the design board `K-All` cell for cell. `?only=<kind>` keeps one kind of card.
 *
 * The cards are the real ones, drawn as samples: their past and their pictures come from the
 * sample source, and nothing on the page asks a hub.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';

import { entityIdSchema, type DashboardLeafCard } from '@nebulahome/contracts';
import { Toaster } from '@nebulahome/ui';

import {
  allowedSizes,
  CARD_SIZES,
  cardKindOf,
  sizeName,
  type CardSize,
} from '@/dashboard/card-sizes';
import { applyLanguage } from '@/i18n/language';
import {
  SAMPLE_ENTITIES,
  SAMPLE_SOURCE,
  SAMPLE_VARIANTS,
  sampleDashboardData,
} from '@/routes/dashboard/card-samples';
import { CardView } from '@/routes/dashboard/card-view';
import { CardSampleContext } from '@/routes/dashboard/cards/card-sample';
import { SAMPLE_SCENES } from '@/routes/dashboard/samples/more';

import './styles/globals.css';

/** A card's width on the grid, by its columns. */
const WIDTH: Readonly<Record<number, string>> = { 1: 'w-[267px]', 2: 'w-[550px]' };

/** A card's height on the grid, by its rows. */
const HEIGHT: Readonly<Record<number, string>> = {
  1: 'h-[100px]',
  2: 'h-[216px]',
  3: 'h-[332px]',
  4: 'h-[448px]',
};

/** One card of the lab: what it is called and the card. */
type LabCard = { readonly caption: string; readonly card: DashboardLeafCard };

/** One kind of card and every size it is drawn at. */
type LabSection = { readonly kind: string; readonly cards: readonly LabCard[] };

/**
 * A card at a place on the lab, for an entity.
 *
 * @param entityId - The entity.
 * @param size - Its size.
 * @returns The card.
 */
function entityCard(entityId: string, size: CardSize): DashboardLeafCard {
  return {
    type: 'entity',
    id: `lab${entityId.replace(/[^a-z0-9]/gu, '')}${String(size.w)}${String(size.h)}`.slice(0, 32),
    x: 0,
    y: 0,
    w: size.w,
    h: size.h,
    entityId: entityIdSchema.parse(entityId),
    title: null,
    icon: null,
    range: null,
  };
}

/** Every entity the lab draws: the catalogue's samples, then what each kind looks like with less. */
const ENTITIES = [...SAMPLE_ENTITIES, ...SAMPLE_VARIANTS];

/** The kinds of card, in the order they first appear among the samples. */
const KINDS = [...new Set(ENTITIES.map((entity) => cardKindOf(entity)))];

/** Every section of the lab: one per kind of entity card, then the clock, the scenes, a removed entity. */
const SECTIONS: readonly LabSection[] = [
  ...KINDS.map((kind) => ({
    kind,
    cards: ENTITIES.filter((entity) => cardKindOf(entity) === kind).flatMap((entity) =>
      allowedSizes(entity).map((size) => ({
        caption: `${entity.name} · ${sizeName(size)}`,
        card: entityCard(entity.entityId, size),
      })),
    ),
  })),
  {
    kind: 'clock',
    cards: CARD_SIZES.clock.sizes.map((size) => ({
      caption: sizeName(size),
      card: {
        type: 'clock',
        id: `labclock${String(size.w)}${String(size.h)}`,
        x: 0,
        y: 0,
        w: size.w,
        h: size.h,
        showSeconds: false,
        showDate: true,
      },
    })),
  },
  {
    kind: 'scene',
    cards: SAMPLE_SCENES.flatMap((scene) =>
      CARD_SIZES.scene.sizes.map((size) => ({
        caption: `${scene.name} · ${sizeName(size)}`,
        card: {
          type: 'scene',
          id: `labscene${scene.key}${String(size.w)}${String(size.h)}`,
          x: 0,
          y: 0,
          w: size.w,
          h: size.h,
          sceneId: scene.id,
          title: null,
          icon: null,
        },
      })),
    ),
  },
  {
    // An entity the samples do not have: removed, as the board's Kitchen relay.
    kind: 'missing',
    cards: CARD_SIZES.missing.sizes.map((size) => ({
      caption: sizeName(size),
      card: { ...entityCard('switch.kitchen_relay_1', size), title: 'Kitchen relay' },
    })),
  },
];

/** The cache the cards' queries sit in: nothing goes stale, nothing is asked again. */
const CACHE = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } },
});

/**
 * Renders the lab.
 *
 * @returns The page.
 */
function DashboardLab() {
  const query = new URLSearchParams(window.location.search);
  const only = query.get('only');

  document.documentElement.setAttribute('data-theme', query.get('theme') ?? 'dark');
  const data = sampleDashboardData();

  return (
    <QueryClientProvider client={CACHE}>
      <MemoryRouter>
        <CardSampleContext value={SAMPLE_SOURCE}>
          <main className="flex min-h-screen flex-col gap-10 bg-canvas p-12 text-foreground">
            {SECTIONS.filter((section) => only === null || section.kind === only).map((section) => (
              <section key={section.cards[0]?.card.id} className="flex flex-col gap-4">
                <h2 className="font-mono text-label tracking-wider text-foreground-subtle uppercase">
                  {section.kind}
                </h2>
                <div className="flex flex-wrap items-start gap-6">
                  {section.cards.map(({ caption, card }) => (
                    <div key={card.id} className="flex flex-col gap-2.5">
                      <span className="font-mono text-label text-foreground-subtle">{caption}</span>
                      <div className={`${WIDTH[card.w] ?? ''} ${HEIGHT[card.h] ?? ''}`}>
                        <CardView card={card} data={data} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </main>
        </CardSampleContext>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');

if (root !== null) {
  void applyLanguage('en');
  createRoot(root).render(
    <StrictMode>
      <DashboardLab />
      <Toaster />
    </StrictMode>,
  );
}
