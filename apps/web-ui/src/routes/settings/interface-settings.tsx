import { Panel, PanelNote, PanelRow, Segmented, SelectField } from '@nebulahome/ui';

/**
 * The preferences that belong to this browser.
 *
 * Every control here changes something the moment it is touched - there is no Save, because
 * there is nothing to send anywhere and nothing that can be refused. Seeing the theme change
 * under your hand is the confirmation; a button that said "saved" would be telling you something
 * you had already watched happen.
 *
 * Only preferences something actually reads are on this page. The design drew a density switch
 * and a time format, and neither has anything reading it yet: a control that changes nothing is
 * worse than a missing one, because it costs the person the trouble of deciding.
 */
import {
  MOTION_CHOICES,
  SIDEBAR_CHOICES,
  START_PAGES,
  THEME_CHOICES,
  usePreferences,
  type MotionChoice,
  type SidebarChoice,
  type StartPage,
  type ThemeChoice,
} from '@/settings/preferences';

/** What each theme is called on screen. */
const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** What each motion setting is called on screen. */
const MOTION_LABELS: Readonly<Record<MotionChoice, string>> = {
  system: 'System',
  full: 'Full',
  reduced: 'Reduced',
};

/** What each start page is called on screen. */
/** What each rail width is called. */
const SIDEBAR_LABELS: Readonly<Record<SidebarChoice, string>> = {
  expanded: 'Expanded',
  collapsed: 'Collapsed',
};

const START_PAGE_LABELS: Readonly<Record<StartPage, string>> = {
  '/dashboards': 'Dashboards',
  '/automations': 'Automations',
  '/scenes': 'Scenes',
  '/devices': 'Devices',
  '/aliases': 'Aliases',
  '/tags': 'Tags',
  '/packages': 'Packages',
};

/**
 * Renders the interface preferences.
 *
 * @returns The page.
 */
export function InterfaceSettings() {
  const theme = usePreferences((state) => state.theme);
  const motion = usePreferences((state) => state.motion);
  const startPage = usePreferences((state) => state.startPage);
  const sidebar = usePreferences((state) => state.sidebar);
  const change = usePreferences((state) => state.set);

  return (
    <>
      <Panel title="Appearance">
        <PanelRow
          title="Theme"
          note="Follows the operating system unless you pick one."
          control={
            <Segmented
              label="Theme"
              value={theme}
              options={THEME_CHOICES.map((choice) => ({
                value: choice,
                label: THEME_LABELS[choice],
              }))}
              onChange={(next) => {
                change({ theme: next });
              }}
            />
          }
        />

        <PanelRow
          title="Motion"
          note="Reduced stops the drifting sky behind the sign-in screen and turns the loading mark into a pulse."
          control={
            <Segmented
              label="Motion"
              value={motion}
              options={MOTION_CHOICES.map((choice) => ({
                value: choice,
                label: MOTION_LABELS[choice],
              }))}
              onChange={(next) => {
                change({ motion: next });
              }}
            />
          }
        />

        <PanelRow
          title="Sidebar"
          note="Collapsed keeps only the glyphs, for more room. The dashboard editor collapses it anyway."
          control={
            <Segmented
              label="Sidebar"
              value={sidebar}
              options={SIDEBAR_CHOICES.map((choice) => ({
                value: choice,
                label: SIDEBAR_LABELS[choice],
              }))}
              onChange={(next) => {
                change({ sidebar: next });
              }}
            />
          }
        />
      </Panel>

      <Panel title="Startup">
        <PanelRow
          title="Open on"
          note="Which page you land on when you sign in."
          control={
            <SelectField
              label="Start page"
              isLabelHidden
              value={startPage}
              options={START_PAGES.map((page) => ({
                value: page,
                label: START_PAGE_LABELS[page],
              }))}
              onChange={(next) => {
                const chosen = START_PAGES.find((page) => page === next);

                if (chosen !== undefined) {
                  change({ startPage: chosen });
                }
              }}
              className="w-42.5"
            />
          }
        />

        <PanelNote>
          These are stored in this browser only. Signing in somewhere else starts from the defaults
          again — which is the point: a wall tablet in a hallway and a laptop in a bedroom want
          different answers, and the same person owns both.
        </PanelNote>
      </Panel>
    </>
  );
}
