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
  Cable,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  HardDrive,
  Info,
  LayoutDashboard,
  Library,
  ListFilter,
  Lock,
  Maximize,
  MemoryStick,
  Network,
  Package,
  Plus,
  RotateCcw,
  Rss,
  Search,
  Server,
  Settings,
  Tag,
  Trash2,
  TriangleAlert,
  Upload,
  Wrench,
  X,
  Zap,
} from 'lucide';

import { iconNodeSchema, type IconFrame, type IconNode } from '@nebula-home/contracts';

/**
 * Reads a lucide drawing into the catalogue's shape.
 *
 * Checked rather than cast: the catalogue allows seven elements, and a lucide icon drawn with
 * an eighth would be refused by the server and must be refused here too.
 *
 * @param node - As lucide ships it.
 * @returns The same drawing, in the catalogue's shape.
 */
function drawing(node: unknown): IconNode {
  return iconNodeSchema.parse(node);
}

/** The catalogue ids the interface uses for its own chrome, and what each starts drawn as. */
export const BUILTIN_UI_NODES = {
  'layout-dashboard': drawing(LayoutDashboard),
  library: drawing(Library),
  package: drawing(Package),
  settings: drawing(Settings),
  'chevron-down': drawing(ChevronDown),
  lock: drawing(Lock),
  check: drawing(Check),
  'triangle-alert': drawing(TriangleAlert),
  info: drawing(Info),
  copy: drawing(Copy),
  eye: drawing(Eye),
  'eye-off': drawing(EyeOff),
  globe: drawing(Globe),
  rss: drawing(Rss),
  network: drawing(Network),
  cable: drawing(Cable),
  'list-filter': drawing(ListFilter),
  'external-link': drawing(ExternalLink),
  wrench: drawing(Wrench),
  zap: drawing(Zap),
  x: drawing(X),
  search: drawing(Search),
  plus: drawing(Plus),
  'trash-2': drawing(Trash2),
  upload: drawing(Upload),
  'rotate-ccw': drawing(RotateCcw),
  maximize: drawing(Maximize),
  tag: drawing(Tag),
  cpu: drawing(Cpu),
  'memory-stick': drawing(MemoryStick),
  'hard-drive': drawing(HardDrive),
  download: drawing(Download),
  server: drawing(Server),
} satisfies Record<string, IconNode>;

/** A catalogue id the interface draws itself with. */
export type UiIconId = keyof typeof BUILTIN_UI_NODES;

/** The ids, for the settings page to mark and the test to check. */
export const UI_ICON_IDS = Object.keys(BUILTIN_UI_NODES) as readonly UiIconId[];

/** The box every bundled drawing is in: lucide's. */
export const BUILTIN_UI_FRAME: IconFrame = { x: 0, y: 0, size: 24 };
