/**
 * The interface against the SDK: every hook, link and component a package can import from
 * `@nebulahome/package-sdk/ui` and `/components` is one the interface lends, so a package built
 * against this SDK finds all of it here.
 */
import { describe, expect, it } from 'vitest';

import * as SdkComponents from '@nebulahome/package-sdk/components';
import * as SdkUi from '@nebulahome/package-sdk/ui';

import { COMPONENTS_HOST } from '@/packages/sdk-components';
import { UI_HOST } from '@/packages/sdk-ui';

describe('what the interface lends a package', () => {
  it('holds every member of the SDK’s /ui', () => {
    expect(Object.keys(UI_HOST).sort()).toEqual(Object.keys(SdkUi).sort());
  });

  it('holds every member of the SDK’s /components', () => {
    expect(Object.keys(COMPONENTS_HOST).sort()).toEqual(Object.keys(SdkComponents).sort());
  });
});
