/**
 * What the interface shares with the packages: its own React, DOM renderer, JSX runtime, design
 * system and package SDK, on `globalThis.__nebula.modules` (PACKAGES.md 5).
 *
 * A package's build reads each of these from here instead of bundling its own copy, so its
 * components run on the interface's React - one React, whose hooks, context and theme reach
 * across. Loaded with the first package's module, not with the page: a house with no package that
 * draws anything never pays for the namespace objects below.
 */
import * as React from 'react';
import * as JsxDevRuntime from 'react/jsx-dev-runtime';
import * as JsxRuntime from 'react/jsx-runtime';
import * as ReactDom from 'react-dom';
import * as ReactDomClient from 'react-dom/client';

import type { SharedModule } from '@nebula-home/package-ui';
import * as Ui from '@nebula-home/ui';

import { PACKAGE_UI_RUNTIME } from '@/packages/runtime';

/** Where the modules are put. */
type NebulaGlobal = { __nebula?: { readonly modules: Readonly<Record<SharedModule, unknown>> } };

/** Every module the SDK's list names: the type refuses a list that misses one. */
const MODULES: Readonly<Record<SharedModule, unknown>> = {
  react: React,
  'react-dom': ReactDom,
  'react-dom/client': ReactDomClient,
  'react/jsx-runtime': JsxRuntime,
  'react/jsx-dev-runtime': JsxDevRuntime,
  '@nebula-home/ui': Ui,
  '@nebula-home/package-ui': PACKAGE_UI_RUNTIME,
};

/** Puts the shared modules where a package's build reads them. Once. */
export function installPackageHost(): void {
  const target = globalThis as NebulaGlobal;

  target.__nebula ??= { modules: MODULES };
}
