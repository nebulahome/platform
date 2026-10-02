/**
 * What the interface lends the packages, on `globalThis.__nebula` (PACKAGES_DOCS.md 6.1): its own
 * React, DOM renderer and JSX runtime, and its implementation of the SDK's `/ui` and `/components`
 * under their major version, with the SDK version it implements.
 *
 * A package's build reads React from here instead of bundling its own copy, so its components run
 * on the interface's React - one React, whose hooks, context and theme reach across - and its SDK
 * forwarders read the hooks and components from here. A package built against SDK 2 finds no
 * `@nebulahome/package-sdk/ui@2` on an interface that implements 1, and says so; one built against
 * a newer 1.x is told which member it needs. Loaded with the first package's module, not with the
 * page: a house with no package that draws anything never pays for the namespace objects below.
 */
import * as React from 'react';
import * as JsxDevRuntime from 'react/jsx-dev-runtime';
import * as JsxRuntime from 'react/jsx-runtime';
import * as ReactDom from 'react-dom';
import * as ReactDomClient from 'react-dom/client';

import { SDK_VERSION } from '@nebulahome/package-sdk';

import { COMPONENTS_HOST } from '@/packages/sdk-components';
import { UI_HOST } from '@/packages/sdk-ui';

/** The SDK's major version the interface implements: the key its modules are lent under. */
export const SDK_MAJOR = Number(SDK_VERSION.split('.')[0]);

/** Every module the interface lends, by the key a package's build reads it under. */
export const LENT_MODULES = {
  react: React,
  'react-dom': ReactDom,
  'react-dom/client': ReactDomClient,
  'react/jsx-runtime': JsxRuntime,
  'react/jsx-dev-runtime': JsxDevRuntime,
  [`@nebulahome/package-sdk/ui@${String(SDK_MAJOR)}`]: UI_HOST,
  [`@nebulahome/package-sdk/components@${String(SDK_MAJOR)}`]: COMPONENTS_HOST,
} as const;

/** What is put on `globalThis`. */
type NebulaGlobal = {
  __nebula?: {
    /** The SDK version the interface implements: `1.0.0`. */
    readonly sdk: string;
    readonly modules: Readonly<Record<string, unknown>>;
  };
};

/** Puts what the interface lends where a package's build reads it. Once. */
export function installPackageHost(): void {
  const target = globalThis as NebulaGlobal;

  target.__nebula ??= { sdk: SDK_VERSION, modules: LENT_MODULES };
}
