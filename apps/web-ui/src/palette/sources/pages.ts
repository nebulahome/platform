/**
 * Pages in the command palette (the Pages group): the sidebar's pages, each broker, each dashboard
 * by name and each area - an area lists its devices. Each page is offered under the same
 * permission as its route; the settings pages come from the settings tree as far as the person may
 * open it.
 */
import { BROKER_IDS, type AreaView, type DashboardView } from '@nebulahome/contracts';
import type { UiIconId } from '@nebulahome/ui';

import { defineMessage, text, type Message } from '@/i18n/messages';
import type { PaletteItem } from '@/palette/palette-types';
import { goTo, HINTS, makeItem } from '@/palette/sources/make-item';
import { brokerNameOf } from '@/routes/library/brokers-page';
import type { SettingsGroup } from '@/routes/settings/settings-tree';

/** Where a page lives: the sidebar's sections. */
const WHERE = {
  automate: defineMessage('nav.groups.automate', 'Automate'),
  house: defineMessage('nav.groups.house', 'House'),
  system: defineMessage('nav.groups.system', 'System'),
  settings: defineMessage('nav.settings', 'Settings'),
  dashboard: defineMessage('palette.kinds.dashboard', 'Dashboard'),
  area: defineMessage('palette.kinds.area', 'Area'),
  broker: defineMessage('palette.kinds.broker', 'Broker'),
};

const KIND = defineMessage('palette.kinds.page', 'Page');

/** One of the sidebar's pages. */
type StaticPage = {
  readonly to: string;
  readonly label: Message;
  readonly where?: Message;
  readonly icon: UiIconId;

  /** As the route asks; none for a page everybody signed in may open. */
  readonly permission?: string;
};

/** The sidebar's pages, in its order (`sidebar.tsx`). */
const PAGES: readonly StaticPage[] = [
  {
    to: '/dashboards',
    label: defineMessage('nav.dashboards', 'Dashboards'),
    icon: 'layout-dashboard',
  },
  {
    to: '/automations',
    label: defineMessage('nav.automations', 'Automations'),
    where: WHERE.automate,
    icon: 'zap',
    permission: 'automation:read',
  },
  {
    to: '/scenes',
    label: defineMessage('nav.scenes', 'Scenes'),
    where: WHERE.automate,
    icon: 'layers',
    permission: 'scene:read',
  },
  {
    to: '/aliases',
    label: defineMessage('nav.aliases', 'Aliases'),
    where: WHERE.automate,
    icon: 'sigma',
    permission: 'alias:read',
  },
  {
    to: '/devices',
    label: defineMessage('nav.devices', 'Devices'),
    where: WHERE.house,
    icon: 'cpu',
    permission: 'device:read',
  },
  {
    to: '/areas',
    label: defineMessage('nav.areas', 'Areas'),
    where: WHERE.house,
    icon: 'house',
    permission: 'area:read',
  },
  {
    to: '/tags',
    label: defineMessage('nav.tags', 'Tags'),
    where: WHERE.house,
    icon: 'tag',
    permission: 'tag:read',
  },
  {
    to: '/configuration/dashboards',
    label: defineMessage('nav.dashboardSetup', 'Dashboard setup'),
    where: WHERE.house,
    icon: 'layout-grid',
    permission: 'dashboard:manage',
  },
  {
    to: '/brokers',
    label: defineMessage('nav.brokers', 'Brokers'),
    where: WHERE.system,
    icon: 'waypoints',
    permission: 'device:read',
  },
  {
    to: '/integrations',
    label: defineMessage('nav.integrations', 'Integrations'),
    where: WHERE.system,
    icon: 'library',
    permission: 'integration:read',
  },
  {
    to: '/packages',
    label: defineMessage('nav.packages', 'Packages'),
    where: WHERE.system,
    icon: 'package',
    permission: 'package:read',
  },
  {
    to: '/containers',
    label: defineMessage('nav.containers', 'Containers'),
    where: WHERE.system,
    icon: 'container',
    permission: 'container:read',
  },
];

/** What the pages are built from. */
export type PageSource = {
  /** The settings tree, as far as the person may open it (`reachableTree`). */
  readonly settings: readonly SettingsGroup[];

  /** The dashboards the person has. */
  readonly dashboards: readonly DashboardView[];

  /** The areas; empty without `area:read`. */
  readonly areas: readonly AreaView[];
  readonly can: (key: string) => boolean;
};

/**
 * The Pages group's rows.
 *
 * @param source - See {@link PageSource}.
 * @returns The rows.
 */
export function pageItems(source: PageSource): PaletteItem[] {
  const { settings, dashboards, areas, can } = source;
  const kind = text(KIND);

  /**
   * Builds one page's row.
   *
   * @param to - Its address.
   * @param title - Its name.
   * @param where - Where it lives.
   * @param icon - Its glyph.
   * @returns The row.
   */
  const page = (to: string, title: string, where: string, icon: UiIconId): PaletteItem =>
    makeItem({
      group: 'pages',
      refId: to,
      title,
      secondary: where,
      kindLabel: kind,
      icon: { kind: 'ui', id: icon },
      primary: goTo(to, HINTS.goTo),
    });

  return [
    ...PAGES.filter((entry) => entry.permission === undefined || can(entry.permission)).map(
      (entry) =>
        page(
          entry.to,
          text(entry.label),
          entry.where === undefined ? '' : text(entry.where),
          entry.icon,
        ),
    ),
    ...(can('device:read')
      ? BROKER_IDS.map((broker) =>
          page(`/brokers/${broker}`, brokerNameOf(broker), text(WHERE.broker), 'waypoints'),
        )
      : []),
    ...settings.flatMap((group) =>
      group.pages.map((entry) =>
        page(
          entry.path,
          text(entry.label),
          group.isLeaf ? text(WHERE.settings) : `${text(WHERE.settings)} › ${text(group.label)}`,
          entry.icon,
        ),
      ),
    ),
    ...dashboards.map((dashboard) =>
      makeItem({
        group: 'pages',
        refId: `/dashboards/${dashboard.id}`,
        title: dashboard.name,
        secondary: text(WHERE.dashboard),
        kindLabel: text(WHERE.dashboard),
        exactIds: [dashboard.id],
        icon: { kind: 'catalogue', iconId: dashboard.icon, fallback: 'layout-dashboard' },
        isName: true,
        primary: goTo(`/dashboards/${dashboard.id}`, HINTS.goTo),
      }),
    ),
    ...areas.map((area) =>
      makeItem({
        group: 'pages',
        refId: `area:${area.key}`,
        title: area.name,
        secondary: text(WHERE.area),
        kindLabel: text(WHERE.area),
        exactIds: [area.id, `area.${area.key}`],
        icon: { kind: 'catalogue', iconId: area.icon, fallback: 'house' },
        isName: true,
        primary: goTo(`/devices?area=${encodeURIComponent(area.key)}`),
      }),
    ),
  ];
}
