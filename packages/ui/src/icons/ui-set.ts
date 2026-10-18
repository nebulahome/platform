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
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpToLine,
  BadgeCheck,
  Bell,
  Blinds,
  Bluetooth,
  Bot,
  Braces,
  Cable,
  Calendar,
  Camera,
  ChartLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  CircleArrowUp,
  CircleCheck,
  CircleDot,
  CircleX,
  Clock,
  Columns2,
  Compass,
  Container,
  Copy,
  Cpu,
  DoorOpen,
  Download,
  Ellipsis,
  EllipsisVertical,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  GitBranch,
  Globe,
  GripHorizontal,
  GripVertical,
  HardDrive,
  Hash,
  Hourglass,
  House,
  Image,
  Info,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Leaf,
  Library,
  Lightbulb,
  List,
  ListFilter,
  ListOrdered,
  Lock,
  LockOpen,
  MapPin,
  Maximize,
  MemoryStick,
  Minus,
  Moon,
  MousePointerClick,
  Network,
  OctagonX,
  Package,
  Palette,
  Pause,
  Pencil,
  Pipette,
  Play,
  Plus,
  Power,
  Radio,
  RadioTower,
  RefreshCw,
  Repeat,
  RotateCcw,
  RotateCcwClock,
  Router,
  Rss,
  Search,
  Server,
  Settings,
  Sigma,
  SkipBack,
  SkipForward,
  Split,
  Square,
  Star,
  Sun,
  Sunrise,
  Sunset,
  Tag,
  TextWrap,
  Thermometer,
  Timer,
  Tractor,
  Trash2,
  TriangleAlert,
  Type,
  Upload,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Waypoints,
  Wrench,
  X,
  Zap,
} from 'lucide';

import { iconNodeSchema, type IconFrame, type IconNode } from '@nebulahome/contracts';

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
  container: drawing(Container),
  settings: drawing(Settings),
  'chevron-down': drawing(ChevronDown),
  'chevron-left': drawing(ChevronLeft),
  'chevron-right': drawing(ChevronRight),
  'chevrons-left': drawing(ChevronsLeft),
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
  'refresh-cw': drawing(RefreshCw),
  'text-wrap': drawing(TextWrap),
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
  'circle-arrow-up': drawing(CircleArrowUp),
  pipette: drawing(Pipette),
  video: drawing(Video),
  'video-off': drawing(VideoOff),
  // A robot mower, its station, and the settings picked from a list or set as a number.
  tractor: drawing(Tractor),
  // A robot vacuum, and a picture that changes: a robot's map.
  bot: drawing(Bot),
  image: drawing(Image),
  house: drawing(House),
  list: drawing(List),
  hash: drawing(Hash),

  // The Community Hub's marks in the install dialogs: who publishes it, how it is liked.
  'badge-check': drawing(BadgeCheck),
  star: drawing(Star),

  // The health strip of a detail page, the sort of a table's columns, the window of a history,
  // looking for devices, and the people a role is held by.
  'circle-check': drawing(CircleCheck),
  'circle-x': drawing(CircleX),
  'arrow-up': drawing(ArrowUp),
  'arrow-down': drawing(ArrowDown),
  'arrow-right': drawing(ArrowRight),
  'arrow-up-down': drawing(ArrowUpDown),
  calendar: drawing(Calendar),
  radio: drawing(Radio),
  users: drawing(Users),

  // The wires a vendor's devices are reached over, on its card.
  bluetooth: drawing(Bluetooth),
  'radio-tower': drawing(RadioTower),
  router: drawing(Router),
  waypoints: drawing(Waypoints),

  // The automation editor: a block's grip and its glyph, by what it is - a hold, a wait, a branch,
  // a loop, a sun, a notification.
  'grip-vertical': drawing(GripVertical),
  hourglass: drawing(Hourglass),
  'git-branch': drawing(GitBranch),
  split: drawing(Split),
  repeat: drawing(Repeat),
  bell: drawing(Bell),
  sunset: drawing(Sunset),
  sunrise: drawing(Sunrise),
  timer: drawing(Timer),
  braces: drawing(Braces),
  'octagon-x': drawing(OctagonX),
  'mouse-pointer-click': drawing(MousePointerClick),
  'list-ordered': drawing(ListOrdered),
  'columns-2': drawing(Columns2),

  // A block's menu, and the sun: where it stands, and the night it leaves.
  ellipsis: drawing(Ellipsis),
  compass: drawing(Compass),
  moon: drawing(Moon),

  // Where the house stands, in the first-run setup.
  'map-pin': drawing(MapPin),
} satisfies Record<string, IconNode>;

/** A catalogue id the interface draws itself with. */
export type UiIconId = keyof typeof BUILTIN_UI_NODES;

/** The ids, for the settings page to mark and the test to check. */
export const UI_ICON_IDS = Object.keys(BUILTIN_UI_NODES) as readonly UiIconId[];

/** The box every bundled drawing is in: lucide's. */
export const BUILTIN_UI_FRAME: IconFrame = { x: 0, y: 0, size: 24 };
