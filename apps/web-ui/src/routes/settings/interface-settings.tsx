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
import { useTranslation } from 'react-i18next';

import { Panel, PanelNote, PanelRow, Segmented, SelectField } from '@nebulahome/ui';

import { defineMessage, text, type Message } from '@/i18n/messages';
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
const THEME_LABELS: Readonly<Record<ThemeChoice, Message>> = {
  system: defineMessage('settings.interface.themes.system', 'System'),
  light: defineMessage('settings.interface.themes.light', 'Light'),
  dark: defineMessage('settings.interface.themes.dark', 'Dark'),
};

/** What each motion setting is called on screen. */
const MOTION_LABELS: Readonly<Record<MotionChoice, Message>> = {
  system: defineMessage('settings.interface.motions.system', 'System'),
  full: defineMessage('settings.interface.motions.full', 'Full'),
  reduced: defineMessage('settings.interface.motions.reduced', 'Reduced'),
};

/** What each rail width is called. */
const SIDEBAR_LABELS: Readonly<Record<SidebarChoice, Message>> = {
  expanded: defineMessage('settings.interface.sidebars.expanded', 'Expanded'),
  collapsed: defineMessage('settings.interface.sidebars.collapsed', 'Collapsed'),
};

/** What each start page is called on screen: the rail's names for them. */
const START_PAGE_LABELS: Readonly<Record<StartPage, Message>> = {
  '/dashboards': defineMessage('nav.dashboards', 'Dashboards'),
  '/automations': defineMessage('nav.automations', 'Automations'),
  '/scenes': defineMessage('nav.scenes', 'Scenes'),
  '/devices': defineMessage('nav.devices', 'Devices'),
  '/aliases': defineMessage('nav.aliases', 'Aliases'),
  '/tags': defineMessage('nav.tags', 'Tags'),
  '/packages': defineMessage('nav.packages', 'Packages'),
};

/**
 * Renders the interface preferences.
 *
 * @returns The page.
 */
export function InterfaceSettings() {
  const { t } = useTranslation();
  const theme = usePreferences((state) => state.theme);
  const motion = usePreferences((state) => state.motion);
  const startPage = usePreferences((state) => state.startPage);
  const sidebar = usePreferences((state) => state.sidebar);
  const change = usePreferences((state) => state.set);

  return (
    <>
      <Panel title={t('settings.interface.appearance', 'Appearance')}>
        <PanelRow
          title={t('settings.interface.theme', 'Theme')}
          note={t(
            'settings.interface.themeNote',
            'Follows the operating system unless you pick one.',
          )}
          control={
            <Segmented
              label={t('settings.interface.theme', 'Theme')}
              value={theme}
              options={THEME_CHOICES.map((choice) => ({
                value: choice,
                label: text(THEME_LABELS[choice]),
              }))}
              onChange={(next) => {
                change({ theme: next });
              }}
            />
          }
        />

        <PanelRow
          title={t('settings.interface.motion', 'Motion')}
          note={t(
            'settings.interface.motionNote',
            'Reduced stops the drifting sky behind the sign-in screen and turns the loading mark into a pulse.',
          )}
          control={
            <Segmented
              label={t('settings.interface.motion', 'Motion')}
              value={motion}
              options={MOTION_CHOICES.map((choice) => ({
                value: choice,
                label: text(MOTION_LABELS[choice]),
              }))}
              onChange={(next) => {
                change({ motion: next });
              }}
            />
          }
        />

        <PanelRow
          title={t('settings.interface.sidebar', 'Sidebar')}
          note={t(
            'settings.interface.sidebarNote',
            'Collapsed keeps only the glyphs, for more room. The dashboard editor collapses it anyway.',
          )}
          control={
            <Segmented
              label={t('settings.interface.sidebar', 'Sidebar')}
              value={sidebar}
              options={SIDEBAR_CHOICES.map((choice) => ({
                value: choice,
                label: text(SIDEBAR_LABELS[choice]),
              }))}
              onChange={(next) => {
                change({ sidebar: next });
              }}
            />
          }
        />
      </Panel>

      <Panel title={t('settings.interface.startup', 'Startup')}>
        <PanelRow
          title={t('settings.interface.openOn', 'Open on')}
          note={t('settings.interface.openOnNote', 'Which page you land on when you sign in.')}
          control={
            <SelectField
              label={t('settings.interface.startPage', 'Start page')}
              isLabelHidden
              value={startPage}
              options={START_PAGES.map((page) => ({
                value: page,
                label: text(START_PAGE_LABELS[page]),
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
          {t(
            'settings.interface.browserOnly',
            'These are stored in this browser only. Signing in somewhere else starts from the defaults again — which is the point: a wall tablet in a hallway and a laptop in a bedroom want different answers, and the same person owns both. Your language is kept with your account, under Account & security.',
          )}
        </PanelNote>
      </Panel>
    </>
  );
}
