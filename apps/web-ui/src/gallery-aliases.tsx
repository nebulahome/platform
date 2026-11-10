/**
 * The alias pages on sample data, for the gallery: the list (and its empty state), New alias,
 * and an alias's page on each of its tabs - a thermostat of parts from every source, a light of
 * five lamps, a sensor with its Display, and a binary sensor whose code is failing.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

import { AliasPage } from '@/routes/library/aliases/alias-page';
import { AliasesPage } from '@/routes/library/aliases/aliases-page';
import {
  HOUSE_TEMPERATURE,
  LIGHTS,
  sampleAliasCache,
  THERMOSTAT,
  WASHER,
} from '@/testing/alias-samples';

const FULL = sampleAliasCache(false);
const EMPTY = sampleAliasCache(true);
const READ_ONLY = sampleAliasCache(false, false);

/**
 * A page of the application, framed the way the shell frames it.
 *
 * @param props - The page and where it is.
 * @param props.path - The route the page answers.
 * @param props.at - Where the router starts.
 * @param props.cache - The cache it reads.
 * @param props.children - The page.
 * @returns The framed page.
 */
function Frame(props: {
  readonly path: string;
  readonly at: string;
  readonly cache?: QueryClient;
  readonly children: ReactNode;
}) {
  return (
    <QueryClientProvider client={props.cache ?? FULL}>
      <MemoryRouter initialEntries={[props.at]}>
        <div
          data-sample={props.at}
          className="relative left-1/2 flex h-[60rem] w-[min(94vw,90rem)] shrink-0 -translate-x-1/2 overflow-hidden rounded-panel border border-border bg-canvas"
        >
          <Routes>
            <Route path={props.path} element={props.children} />
          </Routes>
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * The list, full, with its problems, and empty. New alias is a modal over the whole page, so the
 * list's own button opens it here.
 *
 * @returns The pages.
 */
export function AliasListSamples() {
  return (
    <div className="flex w-full flex-col gap-6">
      <Frame path="/aliases" at="/aliases">
        <AliasesPage />
      </Frame>
      <Frame path="/aliases" at="/aliases?show=problems">
        <AliasesPage />
      </Frame>
      <Frame path="/aliases" at="/aliases" cache={EMPTY}>
        <AliasesPage />
      </Frame>
    </div>
  );
}

/**
 * An alias's page on each tab.
 *
 * @returns The pages.
 */
export function AliasPageSamples() {
  /**
   * One alias's page on one tab.
   *
   * @param aliasId - The alias.
   * @param tab - The tab; Parts when blank.
   * @param cache - The cache, when not the full one.
   * @returns The framed page.
   */
  const page = (aliasId: string, tab = '', cache?: QueryClient) => (
    <Frame
      path="/aliases/:aliasId"
      at={`/aliases/${aliasId}${tab === '' ? '' : `?tab=${tab}`}`}
      {...(cache === undefined ? {} : { cache })}
    >
      <AliasPage />
    </Frame>
  );

  return (
    <div className="flex w-full flex-col gap-6">
      {page(THERMOSTAT.id)}
      {page(THERMOSTAT.id, 'code')}
      {page(THERMOSTAT.id, 'file')}
      {page(THERMOSTAT.id, 'history')}
      {page(LIGHTS.id)}
      {page(HOUSE_TEMPERATURE.id)}
      {page(WASHER.id, 'code')}
      {page(THERMOSTAT.id, 'code', READ_ONLY)}
    </div>
  );
}
