/**
 * The dashboard editor lab (`dashboard-editor-lab.html`, development only): the real editor page on
 * a sample dashboard - the one the design board `N-Dashboard-Edit` draws - with the cards' samples
 * in place of the hub's answers, so the editor can be seen and tried without signing in.
 *
 * `?selected=<card id>` opens that card's settings once the page is up. Nothing is saved: Done
 * asks a hub that is not there and says so.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';

import {
  entityIdSchema,
  type DashboardCard,
  type DashboardLeafCard,
  type DashboardView,
} from '@nebulahome/contracts';
import { Toaster } from '@nebulahome/ui';

import { DASHBOARD_QUERY_KEYS } from '@/dashboard/api';
import { applyLanguage } from '@/i18n/language';
import { SAMPLE_SOURCE, sampleDashboardData } from '@/routes/dashboard/card-samples';
import { CardSampleContext } from '@/routes/dashboard/cards/card-sample';
import { useDashboardDraft } from '@/routes/dashboard/dashboard-draft';
import { DashboardEditorPage } from '@/routes/dashboard/dashboard-editor-page';
import { DashboardDataContext } from '@/routes/dashboard/use-dashboard-data';

import './styles/globals.css';

/**
 * An entity card of the sample dashboard.
 *
 * @param id - Its id.
 * @param entityId - The entity.
 * @param at - Its column, row, width and height.
 * @returns The card.
 */
function entityAt(
  id: string,
  entityId: string,
  at: readonly [number, number, number, number],
): DashboardLeafCard {
  const [x, y, w, h] = at;

  return {
    type: 'entity',
    id,
    x,
    y,
    w,
    h,
    entityId: entityIdSchema.parse(entityId),
    title: null,
    icon: null,
    range: null,
  };
}

/** The sample dashboard's cards, laid out as `N-Dashboard-Edit` lays them. */
const CARDS: DashboardCard[] = [
  { type: 'clock', id: 'labclock01', x: 0, y: 0, w: 2, h: 1, showSeconds: false, showDate: true },
  entityAt('labsensor01', 'sensor.living_temperature', [2, 0, 1, 1]),
  entityAt('labswitch01', 'switch.coffee', [3, 0, 1, 1]),
  entityAt('lablight01', 'light.island', [0, 1, 1, 2]),
  entityAt('labclimate1', 'climate.living', [1, 1, 1, 2]),
  entityAt('labmedia001', 'media_player.living_speaker', [2, 1, 2, 2]),
  entityAt('labcamera01', 'camera.garden', [0, 3, 2, 2]),
  entityAt('labdoor0001', 'binary_sensor.front_door', [2, 3, 1, 1]),
  entityAt('lablock0001', 'lock.front_door', [3, 3, 1, 1]),
  entityAt('labcover001', 'cover.living_blinds', [2, 4, 1, 1]),
  entityAt('labwasher01', 'sensor.washer', [3, 4, 1, 1]),
  {
    type: 'container',
    id: 'labgarden01',
    x: 0,
    y: 5,
    w: 4,
    h: 2,
    title: 'Garden',
    icon: null,
    cards: [
      entityAt('labporch001', 'light.porch', [0, 0, 1, 1]),
      entityAt('labreading1', 'light.reading_lamp', [1, 0, 1, 1]),
    ],
  },
];

/** The sample dashboard. */
const DASHBOARD: DashboardView = {
  id: '00000000-0000-4000-8000-0000000000d1',
  name: 'Home',
  icon: null,
  layout: { cards: CARDS },
  layoutVersion: 1,
  userIds: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** The cache, with the dashboard in it as the manage page would have read it. */
const CACHE = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } },
});

CACHE.setQueryData(DASHBOARD_QUERY_KEYS.managed, [DASHBOARD]);
CACHE.setQueryData(DASHBOARD_QUERY_KEYS.assignees, []);

/**
 * Renders the lab.
 *
 * @returns The page.
 */
function EditorLab() {
  const query = new URLSearchParams(globalThis.location.search);
  const selected = query.get('selected');

  document.documentElement.setAttribute('data-theme', query.get('theme') ?? 'dark');

  // Once the editor has begun its copy, open the card asked for.
  useEffect(() => {
    if (selected === null) {
      return undefined;
    }

    const timer = setTimeout(() => {
      useDashboardDraft.getState().select(selected);
    }, 100);

    return (): void => {
      clearTimeout(timer);
    };
  }, [selected]);

  return (
    <QueryClientProvider client={CACHE}>
      <MemoryRouter initialEntries={[`/configuration/dashboards/${DASHBOARD.id}/edit`]}>
        <CardSampleContext value={SAMPLE_SOURCE}>
          <DashboardDataContext value={sampleDashboardData()}>
            <div className="flex h-screen bg-canvas text-foreground">
              <Routes>
                <Route
                  path="/configuration/dashboards/:dashboardId/edit"
                  element={<DashboardEditorPage />}
                />
                <Route path="*" element={<p className="p-8">Left the editor.</p>} />
              </Routes>
            </div>
          </DashboardDataContext>
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
      <EditorLab />
      <Toaster />
    </StrictMode>,
  );
}
