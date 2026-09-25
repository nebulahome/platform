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
  Activity,
  ArrowDownToLine,
  ArrowUpToLine,
  Blinds,
  Cable,
  Camera,
  ChartLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock,
  Copy,
  Cpu,
  DoorOpen,
  Download,
  EllipsisVertical,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  GripHorizontal,
  HardDrive,
  Info,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Leaf,
  Library,
  Lightbulb,
  ListFilter,
  Lock,
  LockOpen,
  Maximize,
  MemoryStick,
  Minus,
  Network,
  Package,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  Power,
  RotateCcw,
  RotateCcwClock,
  Rss,
  Search,
  Server,
  Settings,
  Sigma,
  SkipBack,
  SkipForward,
  Square,
  Sun,
  Tag,
  Thermometer,
  Trash2,
  TriangleAlert,
  Type,
  Upload,
  Volume2,
  VolumeX,
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
  'chevron-left': drawing(ChevronLeft),
  'chevron-right': drawing(ChevronRight),
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

  // The dashboard: a card's grip and menu, the pencil that unlocks the layout, a clock, a group.
  clock: drawing(Clock),
  'ellipsis-vertical': drawing(EllipsisVertical),
  'grip-horizontal': drawing(GripHorizontal),
  'layout-grid': drawing(LayoutGrid),
  pencil: drawing(Pencil),

  // What an entity is and what it can do, on its row and on its own page.
  activity: drawing(Activity),
  'arrow-down-to-line': drawing(ArrowDownToLine),
  'arrow-up-to-line': drawing(ArrowUpToLine),
  blinds: drawing(Blinds),
  camera: drawing(Camera),
  'circle-dot': drawing(CircleDot),
  'door-open': drawing(DoorOpen),
  gauge: drawing(Gauge),
  'rotate-ccw-clock': drawing(RotateCcwClock),
  layers: drawing(Layers),
  lightbulb: drawing(Lightbulb),
  'lock-open': drawing(LockOpen),
  minus: drawing(Minus),
  palette: drawing(Palette),
  pause: drawing(Pause),
  play: drawing(Play),
  power: drawing(Power),
  sigma: drawing(Sigma),
  'skip-back': drawing(SkipBack),
  'skip-forward': drawing(SkipForward),
  square: drawing(Square),
  sun: drawing(Sun),
  thermometer: drawing(Thermometer),
  type: drawing(Type),
  'volume-2': drawing(Volume2),
  'volume-x': drawing(VolumeX),
  'chart-line': drawing(ChartLine),
  leaf: drawing(Leaf),
} satisfies Record<string, IconNode>;

/** A catalogue id the interface draws itself with. */
export type UiIconId = keyof typeof BUILTIN_UI_NODES;

/** The ids, for the settings page to mark and the test to check. */
export const UI_ICON_IDS = Object.keys(BUILTIN_UI_NODES) as readonly UiIconId[];

/** The box every bundled drawing is in: lucide's. */
export const BUILTIN_UI_FRAME: IconFrame = { x: 0, y: 0, size: 24 };
