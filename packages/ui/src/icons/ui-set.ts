/**
 * The icons the interface draws itself with, and the drawing each starts from.
 *
 * Every one is a catalogue id. The chrome needs them before anybody has signed in - the sign-in
 * page has a lock on it - so the drawings are bundled, imported one by one from lucide, which
 * is the same set the catalogue serves. Once signed in, the catalogue's own answer replaces
 * each of them: an owner who draws `settings` afresh in Settings changes the sidebar's cog too.
 *
 * Adding an icon to the interface is adding an id here. It must exist in the catalogue, which
 * the test beside this file enforces; a glyph drawn in a component is what this replaces.
 */
import {
  Check,
  ChevronDown,
  Copy,
  Expand,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Info,
  LayoutDashboard,
  Library,
  ListFilter,
  Lock,
  Maximize,
  Network,
  Package,
  Plus,
  RotateCcw,
  Rss,
  Search,
  Settings,
  Trash2,
  TriangleAlert,
  Upload,
  Wrench,
  X,
} from 'lucide';

import type { IconFrame, IconNode } from '@nebula-home/contracts';

/** The catalogue ids the interface uses for its own chrome, and what each starts drawn as. */
export const BUILTIN_UI_NODES = {
  'layout-dashboard': LayoutDashboard,
  library: Library,
  package: Package,
  settings: Settings,
  'chevron-down': ChevronDown,
  expand: Expand,
  lock: Lock,
  check: Check,
  'triangle-alert': TriangleAlert,
  info: Info,
  copy: Copy,
  eye: Eye,
  'eye-off': EyeOff,
  globe: Globe,
  rss: Rss,
  network: Network,
  'list-filter': ListFilter,
  'external-link': ExternalLink,
  wrench: Wrench,
  x: X,
  search: Search,
  plus: Plus,
  'trash-2': Trash2,
  upload: Upload,
  'rotate-ccw': RotateCcw,
  maximize: Maximize,
} satisfies Record<string, IconNode>;

/** A catalogue id the interface draws itself with. */
export type UiIconId = keyof typeof BUILTIN_UI_NODES;

/** The ids, for the settings page to mark and the test to check. */
export const UI_ICON_IDS = Object.keys(BUILTIN_UI_NODES) as readonly UiIconId[];

/** The box every bundled drawing is in: lucide's. */
export const BUILTIN_UI_FRAME: IconFrame = { x: 0, y: 0, size: 24 };
