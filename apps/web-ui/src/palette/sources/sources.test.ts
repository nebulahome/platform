import { describe, expect, it } from 'vitest';

import { actionItems } from '@/palette/sources/actions';
import { entityItems } from '@/palette/sources/entities';
import { integrationItems } from '@/palette/sources/integrations';
import { pageItems } from '@/palette/sources/pages';
import { settingItems } from '@/palette/sources/settings';
import { reachableTree } from '@/routes/settings/settings-tree';
import { aDevice, anEntity, aTag, aVendor } from '@/testing/fixtures';

/**
 * A permission check that holds only the keys given, with the scopes given (none: everywhere).
 *
 * @param keys - The keys held.
 * @param scopes - Where they hold, when limited.
 * @returns The check.
 */
function holding(keys: readonly string[], scopes?: readonly string[]) {
  return (key: string, asked: readonly string[] = []): boolean =>
    keys.includes(key) &&
    (scopes === undefined || asked.length === 0 || asked.some((scope) => scopes.includes(scope)));
}

describe('entityItems', () => {
  it('drops hidden and disabled entities', () => {
    const items = entityItems({
      entities: [
        anEntity({ entityId: 'switch.shown' }),
        anEntity({ entityId: 'switch.hidden', isHidden: true }),
        anEntity({ entityId: 'switch.off', isEnabled: false }),
      ],
      devices: [],
      tags: [],
      can: holding(['entity:read']),
    });

    expect(items.map((item) => item.refId)).toEqual(['switch.shown']);
  });

  it('offers Tab only with entity:control for the entity’s own scopes', () => {
    const entity = anEntity({ entityId: 'switch.porch', areaKey: 'garden' });
    const source = { entities: [entity], devices: [], tags: [] };

    expect(
      entityItems({ ...source, can: holding(['entity:control']) })[0]?.secondaryAction,
    ).toBeDefined();
    expect(
      entityItems({ ...source, can: holding(['entity:control'], ['area.garden']) })[0]
        ?.secondaryAction,
    ).toBeDefined();
    expect(
      entityItems({ ...source, can: holding(['entity:control'], ['area.kitchen']) })[0]
        ?.secondaryAction,
    ).toBeUndefined();
  });

  it('takes the device’s name and tags from the device it belongs to', () => {
    const tag = aTag('outdoor');
    const items = entityItems({
      entities: [anEntity({ entityId: 'switch.porch', source: 'porch-relay' })],
      devices: [aDevice({ id: 'porch-relay', name: 'Porch relay', tagIds: [tag.id] })],
      tags: [tag],
      can: holding(['entity:control'], ['tag.outdoor']),
    });

    expect(items[0]?.secondary).toBe('Porch relay');
    expect(items[0]?.secondaryAction).toBeDefined();
  });
});

describe('integrationItems', () => {
  it('offers Add device only where devices are added by hand and nothing is left to set up', () => {
    const vendors = [
      aVendor({ id: 'ready', adoption: 'owner' }),
      aVendor({ id: 'automatic', adoption: 'automatic' }),
      aVendor({ id: 'setup', needsSetup: true }),
      aVendor({ id: 'account', needsAccount: true }),
      aVendor({ id: 'package', needsPackage: true }),
    ];
    const items = integrationItems(vendors, true);
    const withTab = items.filter(
      (item) => item.group === 'integrations' && item.secondaryAction !== undefined,
    );

    expect(withTab.map((item) => item.refId)).toEqual(['ready']);
    expect(items.filter((item) => item.requiresVerb === true)).toHaveLength(1);
    expect(integrationItems(vendors, false).some((item) => item.secondaryAction)).toBe(false);
  });
});

describe('pageItems and actionItems', () => {
  it('offers a page or an action only with its permission', () => {
    const can = holding(['tag:read', 'automation:write']);
    const pages = pageItems({ settings: [], dashboards: [], areas: [], can });
    const paths = pages.map((item) => item.refId);

    expect(paths).toContain('/tags');
    expect(paths).toContain('/dashboards');
    expect(paths).not.toContain('/devices');
    expect(paths).not.toContain('/brokers/matter');
    expect(actionItems(can).map((item) => item.refId)).toEqual(['new-automation', 'sign-out']);
  });
});

describe('settingItems', () => {
  it('leaves out the settings of a page the person may not open', () => {
    const everything = settingItems(
      reachableTree(() => true),
      1,
    );
    const personal = settingItems(
      reachableTree(() => false),
      1,
    );

    expect(everything.some((item) => item.refId === 'system.restart')).toBe(true);
    expect(personal.some((item) => item.refId === 'system.restart')).toBe(false);
    expect(personal.some((item) => item.refId === 'theme')).toBe(true);
  });
});
