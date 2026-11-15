/**
 * The package SDK's preview (`pnpm preview:sdk`, development only): every component a package can
 * import from `@nebulahome/package-sdk/components`, and what `/ui` can draw without a server, each
 * with its states, its variants and the code that draws it.
 *
 * Everything on the page is imported from the SDK and drawn through its forwarders against the
 * host the interface installs for a package (`installPackageHost`), so what is seen here is what a
 * package gets - not the design system's component beside it. The house and the icons are the
 * entity lab's samples; requests for icons are answered from the chrome's own set, since the page
 * runs with no API behind it.
 *
 * {@link COMPONENTS} is keyed by the SDK's exports: a component added to `/components` without an
 * example here fails the type check.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';

import { SDK_VERSION } from '@nebulahome/package-sdk';
import type * as SdkComponents from '@nebulahome/package-sdk/components';
import {
  Badge,
  Button,
  Calendar,
  CardHeading,
  Checkbox,
  cn,
  DateField,
  EntityField,
  EntityPicker,
  Figure,
  Hint,
  Icon,
  IconButton,
  IconField,
  Modal,
  NameIconField,
  Panel,
  PanelNote,
  PanelRow,
  ProgressBar,
  RadioGroup,
  Segmented,
  SelectField,
  Slider,
  StatusDot,
  Stepper,
  Switch,
  TagChip,
  TextField,
  Tooltip,
  type DayRange,
  type TagColor,
} from '@nebulahome/package-sdk/components';
import type * as SdkUi from '@nebulahome/package-sdk/ui';
import {
  Floating,
  PackageLink,
  PageActions,
  PlatformLink,
  useClickOutside,
  useEscape,
  useNow,
} from '@nebulahome/package-sdk/ui';
import { Toaster } from '@nebulahome/ui';

import { applyLanguage } from '@/i18n/language';
import { FloatingLayer } from '@/packages/floating/floating-layer';
import { PageActionsProvider } from '@/packages/page-actions';
import { PackageScope } from '@/packages/sdk-ui';
import { installPackageHost } from '@/packages/shared-modules';
import { LAB_ICONS, labCache } from '@/testing/entity-lab/lab-cache';

import './styles/globals.css';

installPackageHost();

/** The fetch the page started with. */
const networkFetch = globalThis.fetch.bind(globalThis);

/**
 * Answers the catalogue's icon requests from the chrome's own icons, by id or by search, since
 * the page runs with no API behind it; every other request goes out as it is.
 *
 * @param input - What is fetched.
 * @param init - How.
 * @returns The answer.
 */
async function previewFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, globalThis.location.origin);

  if (!url.pathname.endsWith('/icons')) {
    return networkFetch(input, init);
  }

  const ids = url.searchParams.get('ids')?.split(',');
  const search = (url.searchParams.get('q') ?? '').toLowerCase();

  return Response.json({
    items: LAB_ICONS.filter((icon) =>
      ids === undefined ? icon.id.includes(search) : ids.includes(icon.id),
    ),
  });
}

globalThis.fetch = previewFetch;

/** The package the page pretends to be, for what asks whose component it is. */
const PREVIEW_PACKAGE = { id: 'demo.preview', version: '1.0.0', name: 'Preview' };

/** One export's examples. */
type Entry = {
  /** The SDK version that added it. */
  readonly since: string;

  /** What it is for, in a line. */
  readonly about: string;

  /** The code that draws it. */
  readonly code: string;

  /** Its states and variants, drawn. */
  readonly demo: () => ReactNode;
};

/** An export drawn in another's examples: a panel's row is shown in the panel. */
type ShownWith<TName extends string> = { readonly shownWith: TName };

/** What a labelled example needs. */
type ExampleProps = {
  /** Which state or variant it is. */
  readonly label: string;

  /** Whether what it holds are fields, laid in two columns, and not things in a row. */
  readonly isFields?: boolean;

  readonly children: ReactNode;
};

/**
 * One state or variant, under its name.
 *
 * @param props - See {@link ExampleProps}.
 * @returns The example.
 */
function Example(props: ExampleProps) {
  const { label, isFields = false, children } = props;

  return (
    <div className="flex flex-col gap-2.5">
      <span className="font-mono text-label text-foreground-subtle uppercase">{label}</span>
      <div
        className={
          isFields
            ? 'grid max-w-2xl items-start gap-4 sm:grid-cols-2'
            : 'flex flex-wrap items-center gap-3'
        }
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Button: its variants, sizes, and the states it can be in.
 *
 * @returns The examples.
 */
function ButtonDemo() {
  return (
    <>
      <Example label="variant">
        <Button variant="primary">Primary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
      </Example>
      <Example label="size">
        <Button size="compact">Compact</Button>
        <Button size="medium">Medium</Button>
        <Button size="large">Large</Button>
      </Example>
      <Example label="isBusy · disabled · with an icon">
        <Button isBusy>Saving</Button>
        <Button disabled>Disabled</Button>
        <Button variant="ghost">
          <Icon id="plus" size={16} />
          Add a room
        </Button>
      </Example>
    </>
  );
}

/**
 * IconButton: its variants, sizes and disabled.
 *
 * @returns The examples.
 */
function IconButtonDemo() {
  return (
    <>
      <Example label="variant">
        <IconButton label="Edit">
          <Icon id="pencil" size={16} />
        </IconButton>
        <IconButton variant="danger" label="Remove">
          <Icon id="x" size={16} />
        </IconButton>
      </Example>
      <Example label="size · disabled">
        <IconButton size="small" label="Settings, small">
          <Icon id="settings" size={14} />
        </IconButton>
        <IconButton size="medium" label="Settings, medium">
          <Icon id="settings" size={16} />
        </IconButton>
        <IconButton size="large" label="Settings, large">
          <Icon id="settings" size={18} />
        </IconButton>
        <IconButton disabled label="Settings, disabled">
          <Icon id="settings" size={16} />
        </IconButton>
      </Example>
    </>
  );
}

/**
 * Icon: a few of the catalogue, and its sizes.
 *
 * @returns The examples.
 */
function IconDemo() {
  return (
    <>
      <Example label="id">
        {['lightbulb', 'thermometer', 'zap', 'bell', 'sun', 'moon', 'star', 'power'].map((id) => (
          <Icon key={id} id={id} />
        ))}
      </Example>
      <Example label="size · colour from the text">
        <Icon id="lightbulb" size={14} />
        <Icon id="lightbulb" size={20} />
        <Icon id="lightbulb" size={32} />
        <Icon id="lightbulb" size={32} className="text-primary" />
      </Example>
    </>
  );
}

/**
 * Badge: its tones, sizes and icon.
 *
 * @returns The examples.
 */
function BadgeDemo() {
  return (
    <>
      <Example label="tone">
        <Badge tone="neutral">Neutral</Badge>
        <Badge tone="accent">Accent</Badge>
        <Badge tone="success">Online</Badge>
        <Badge tone="warning">Low battery</Badge>
        <Badge tone="danger">Offline</Badge>
      </Example>
      <Example label="size · icon">
        <Badge size="small">Small</Badge>
        <Badge size="medium">Medium</Badge>
        <Badge tone="success" icon={<Icon id="check" size={12} />}>
          Paired
        </Badge>
      </Example>
    </>
  );
}

/**
 * Panel, with its rows and its note: raised and flat.
 *
 * @returns The examples.
 */
function PanelDemo() {
  const [isOn, setOn] = useState(true);

  return (
    <>
      <Example label="raised · action · rows · note">
        <div className="w-full max-w-xl">
          <Panel
            title="Recording"
            action={
              <Button size="compact" variant="ghost">
                Edit
              </Button>
            }
          >
            <PanelRow
              title="Record on motion"
              note="Keeps a clip from ten seconds before."
              control={<Switch label="Record on motion" isOn={isOn} onChange={setOn} />}
            />
            <PanelRow title="Kept for" control={<Badge>14 days</Badge>} />
            <PanelRow title="A row with content under it">
              <ProgressBar percent={62} label="Disk used" />
            </PanelRow>
          </Panel>
          <PanelNote>Clips older than this are removed every night.</PanelNote>
        </div>
      </Example>
      <Example label={'elevation="flat"'}>
        <div className="w-full max-w-xl">
          <Panel title="Inside another panel" elevation="flat">
            <PanelRow title="Quality" control={<Badge tone="accent">1080p</Badge>} />
          </Panel>
        </div>
      </Example>
    </>
  );
}

/**
 * CardHeading: with a subtitle, a tail, and muted.
 *
 * @returns The examples.
 */
function CardHeadingDemo() {
  return (
    <Example label="title · subtitle · tail · isMuted" isFields>
      <div className="rounded-card border border-border bg-surface-raised p-4">
        <CardHeading title="Living room" subtitle="3 lights on" />
      </div>
      <div className="rounded-card border border-border bg-surface-raised p-4">
        <CardHeading title="Boiler" subtitle="Heating" tail={<Badge tone="warning">58 °C</Badge>} />
      </div>
      <div className="rounded-card border border-border bg-surface-raised p-4">
        <CardHeading title="Garage door" subtitle="Unavailable" isMuted />
      </div>
    </Example>
  );
}

/**
 * Figure: its sizes, unit and colour.
 *
 * @returns The examples.
 */
function FigureDemo() {
  return (
    <>
      <Example label="size">
        <Figure value="21.5" unit="°C" size="large" />
        <Figure value="21.5" unit="°C" size="medium" />
        <Figure value="21.5" unit="°C" size="small" />
      </Example>
      <Example label="no unit · color">
        <Figure value="1 284" />
        <Figure value="3.2" unit="kW" color="var(--color-success)" />
      </Example>
    </>
  );
}

/**
 * StatusDot: its tones, and busy.
 *
 * @returns The examples.
 */
function StatusDotDemo() {
  return (
    <>
      <Example label="tone">
        <StatusDot tone="success" title="Online" />
        <StatusDot tone="warning" title="Weak signal" />
        <StatusDot tone="danger" title="Offline" />
        <StatusDot tone="neutral" title="Unknown" />
        <StatusDot tone="accent" title="Updating" />
      </Example>
      <Example label="isBusy">
        <StatusDot tone="accent" title="Pairing" isBusy />
      </Example>
    </>
  );
}

/**
 * ProgressBar: empty, part, full, and not known yet.
 *
 * @returns The examples.
 */
function ProgressBarDemo() {
  return (
    <Example label="percent: 0 · 40 · 100 · null" isFields>
      <ProgressBar percent={0} label="Not started" />
      <ProgressBar percent={40} label="Downloading" />
      <ProgressBar percent={100} label="Done" />
      <ProgressBar percent={null} label="Waiting" />
    </Example>
  );
}

/**
 * Hint: beside a label.
 *
 * @returns The examples.
 */
function HintDemo() {
  return (
    <Example label="hover it, or focus it">
      <span className="flex items-center gap-1.5 text-ui text-foreground">
        Poll interval
        <Hint text="How often the device is asked for its state. Shorter drains a battery faster." />
      </span>
    </Example>
  );
}

/**
 * TextField: its sizes, what it says under it, and the states it can be in.
 *
 * @returns The examples.
 */
function TextFieldDemo() {
  const [name, setName] = useState('Kitchen');

  return (
    <>
      <Example label="value · hint · placeholder · type" isFields>
        <TextField
          label="Name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <TextField label="Host" placeholder="192.168.1.20" hint="The address of the bridge." />
        <TextField label="Port" type="number" defaultValue={1883} />
        <TextField label="Search" isLabelHidden placeholder="isLabelHidden: search…" />
      </Example>
      <Example label="error · warning · disabled" isFields>
        <TextField label="Host" defaultValue="bridge" error="Not an address." />
        <TextField label="Interval" defaultValue="1" warning="Every second drains the battery." />
        <TextField label="Serial" defaultValue="NB-2041" disabled />
      </Example>
      <Example label="size" isFields>
        <TextField label="Compact" size="compact" defaultValue="compact" />
        <TextField label="Medium" size="medium" defaultValue="medium" />
        <TextField label="Large" size="large" defaultValue="large" />
      </Example>
    </>
  );
}

/** A select's sample options. */
const QUALITIES = [
  { value: 'low', label: 'Low (480p)' },
  { value: 'medium', label: 'Medium (720p)' },
  { value: 'high', label: 'High (1080p)' },
];

/**
 * SelectField: its sizes, hint, error and disabled.
 *
 * @returns The examples.
 */
function SelectFieldDemo() {
  const [quality, setQuality] = useState('medium');

  return (
    <>
      <Example label="value · hint · error · disabled" isFields>
        <SelectField label="Quality" options={QUALITIES} value={quality} onChange={setQuality} />
        <SelectField
          label="Quality"
          options={QUALITIES}
          value={quality}
          onChange={setQuality}
          hint="What the recorder keeps."
        />
        <SelectField
          label="Quality"
          options={QUALITIES}
          value={quality}
          onChange={setQuality}
          error="The camera cannot send this."
        />
        <SelectField
          label="Quality"
          options={QUALITIES}
          value={quality}
          onChange={setQuality}
          disabled
        />
      </Example>
      <Example label="size · isLabelHidden" isFields>
        <SelectField
          label="Compact"
          size="compact"
          options={QUALITIES}
          value={quality}
          onChange={setQuality}
        />
        <SelectField
          label="Quality"
          isLabelHidden
          options={QUALITIES}
          value={quality}
          onChange={setQuality}
        />
      </Example>
    </>
  );
}

/**
 * Switch: on and off, its sizes, disabled and busy.
 *
 * @returns The examples.
 */
function SwitchDemo() {
  const [isOn, setOn] = useState(true);

  return (
    <>
      <Example label="isOn · size">
        <Switch label="Notifications" isOn={isOn} onChange={setOn} />
        <Switch label="Notifications, small" size="small" isOn={isOn} onChange={setOn} />
      </Example>
      <Example label="disabled · isBusy">
        <Switch label="Disabled, off" isOn={false} onChange={setOn} disabled />
        <Switch label="Disabled, on" isOn onChange={setOn} disabled />
        <Switch label="Busy" isOn={isOn} onChange={setOn} isBusy />
      </Example>
    </>
  );
}

/** A segmented control's sample options. */
const PERIODS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
] as const;

/**
 * Segmented: its sizes and disabled.
 *
 * @returns The examples.
 */
function SegmentedDemo() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['value']>('week');

  return (
    <>
      <Example label="size">
        <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />
        <Segmented
          label="Period, compact"
          size="compact"
          options={PERIODS}
          value={period}
          onChange={setPeriod}
        />
      </Example>
      <Example label="disabled">
        <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} disabled />
      </Example>
    </>
  );
}

/**
 * Slider: its fills, a commit on release, and disabled.
 *
 * @returns The examples.
 */
function SliderDemo() {
  const [level, setLevel] = useState(40);
  const [kelvin, setKelvin] = useState(3200);
  const [committed, setCommitted] = useState(40);

  return (
    <>
      <Example label="fill: accent · warm" isFields>
        <Slider
          label="Brightness"
          min={0}
          max={100}
          value={level}
          display={`${String(level)} %`}
          onChange={setLevel}
          onCommit={setCommitted}
        />
        <Slider
          label="Warmth"
          fill="warm"
          min={2200}
          max={6500}
          step={100}
          value={kelvin}
          display={`${String(kelvin)} K`}
          onChange={setKelvin}
        />
      </Example>
      <Example label="onCommit: once the knob is let go">
        <span className="font-mono text-caption text-foreground-muted">
          last committed: {committed} %
        </span>
      </Example>
      <Example label="disabled · isLabelHidden" isFields>
        <Slider
          label="Volume"
          min={0}
          max={100}
          value={25}
          display="25 %"
          onChange={setLevel}
          disabled
        />
        <Slider
          label="Brightness"
          isLabelHidden
          min={0}
          max={100}
          value={level}
          display={`${String(level)} %`}
          onChange={setLevel}
        />
      </Example>
    </>
  );
}

/**
 * Stepper: a value by steps, and disabled.
 *
 * @returns The examples.
 */
function StepperDemo() {
  const [target, setTarget] = useState(21.5);

  /**
   * Writes a temperature.
   *
   * @param value - The degrees.
   * @returns `21.5 °C`.
   */
  const format = (value: number): string => `${value.toFixed(1)} °C`;

  return (
    <Example label="value · disabled">
      <Stepper
        label="Target"
        min={5}
        max={30}
        step={0.5}
        value={target}
        format={format}
        onChange={setTarget}
      />
      <Stepper
        label="Target, disabled"
        min={5}
        max={30}
        step={0.5}
        value={18}
        format={format}
        onChange={setTarget}
        disabled
      />
    </Example>
  );
}

/** Every colour of the tag palette. */
const TAG_COLORS: readonly TagColor[] = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink',
];

/**
 * TagChip: the palette, its sizes, and one that can be removed.
 *
 * @returns The examples.
 */
function TagChipDemo() {
  const [tags, setTags] = useState(['evening', 'cooking', 'guests']);

  return (
    <>
      <Example label="color">
        {TAG_COLORS.map((color) => (
          <TagChip key={color} color={color}>
            {color}
          </TagChip>
        ))}
      </Example>
      <Example label="size · onRemove">
        <TagChip color="blue" size="small">
          small
        </TagChip>
        {tags.map((tag) => (
          <TagChip
            key={tag}
            color="violet"
            onRemove={() => {
              setTags(tags.filter((each) => each !== tag));
            }}
          >
            {tag}
          </TagChip>
        ))}
      </Example>
    </>
  );
}

/**
 * Modal: its sizes, with a description and a footer.
 *
 * @returns The examples.
 */
function ModalDemo() {
  const [size, setSize] = useState<'small' | 'medium' | 'large' | null>(null);

  /** Shuts the dialog. */
  const close = (): void => {
    setSize(null);
  };

  return (
    <Example label="size">
      {(['small', 'medium', 'large'] as const).map((each) => (
        <Button
          key={each}
          variant="ghost"
          onClick={() => {
            setSize(each);
          }}
        >
          Open {each}
        </Button>
      ))}
      <Modal
        isOpen={size !== null}
        onClose={close}
        size={size ?? 'medium'}
        title="Remove the camera?"
        description="Its recordings stay on the disk until they expire."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" onClick={close}>
              Remove
            </Button>
          </>
        }
      >
        <TextField label="Type the camera's name to confirm" placeholder="Porch" />
      </Modal>
    </Example>
  );
}

/**
 * IconField: empty, chosen, with a hint and with an error.
 *
 * @returns The examples.
 */
function IconFieldDemo() {
  const [icon, setIcon] = useState<string | null>('lightbulb');

  return (
    <Example label="value: null · chosen · hint · error" isFields>
      <IconField label="Icon" value={null} onChange={setIcon} />
      <IconField label="Icon" value={icon} onChange={setIcon} />
      <IconField label="Icon" value={icon} onChange={setIcon} hint="Shown on the card." />
      <IconField label="Icon" value={icon} onChange={setIcon} error="Pick one." />
    </Example>
  );
}

/**
 * EntityField: chosen, optional and empty, limited to some domains, compact, and its states.
 *
 * @returns The examples.
 */
function EntityFieldDemo() {
  const [entityId, setEntityId] = useState('switch.dryer_plug');
  const [sensor, setSensor] = useState('');

  return (
    <>
      <Example label="value · isOptional · domains · pickerTitle" isFields>
        <EntityField label="Entity" value={entityId} onChange={setEntityId} />
        <EntityField label="Optional" isOptional value={sensor} onChange={setSensor} />
        <EntityField
          label="Sensors only"
          domains={['sensor']}
          pickerTitle="Which sensor?"
          value={sensor}
          onChange={setSensor}
          hint={'domains={["sensor"]}'}
        />
      </Example>
      <Example label="size · error · disabled" isFields>
        <EntityField label="Compact" size="compact" value={entityId} onChange={setEntityId} />
        <EntityField label="Entity" value="" onChange={setEntityId} error="Choose an entity." />
        <EntityField label="Disabled" value={entityId} onChange={setEntityId} disabled />
      </Example>
    </>
  );
}

/**
 * EntityPicker: the dialog on its own, for one entity and for several.
 *
 * @returns The examples.
 */
function EntityPickerDemo() {
  const [mode, setMode] = useState<'one' | 'several' | null>(null);
  const [chosen, setChosen] = useState<readonly string[]>([]);

  return (
    <Example label="one · isMultiple">
      <Button
        variant="ghost"
        onClick={() => {
          setMode('one');
        }}
      >
        Choose one
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setMode('several');
        }}
      >
        Choose several
      </Button>
      <span className="font-mono text-caption text-foreground-muted">
        onChoose: [{chosen.join(', ')}]
      </span>
      <EntityPicker
        isOpen={mode !== null}
        isMultiple={mode === 'several'}
        title={mode === 'several' ? 'Which ones?' : 'Which one?'}
        value={chosen}
        onClose={() => {
          setMode(null);
        }}
        onChoose={(entityIds) => {
          setChosen(entityIds);
          setMode(null);
        }}
      />
    </Example>
  );
}

/**
 * Checkbox: ticked, mixed, with a note and a count, the warning tone, and disabled.
 *
 * @returns The examples.
 */
function CheckboxDemo() {
  const [rooms, setRooms] = useState<readonly string[]>(['Kitchen']);
  const [isAccepted, setAccepted] = useState(false);
  const all = ['Kitchen', 'Study', 'Bedroom'];

  return (
    <>
      <Example label="isChecked · isMixed · count">
        <div className="flex w-64 flex-col gap-2.5">
          <Checkbox
            label="Every room"
            isChecked={rooms.length === all.length}
            isMixed={rooms.length > 0 && rooms.length < all.length}
            count={all.length}
            onChange={(isChecked) => {
              setRooms(isChecked ? all : []);
            }}
          />
          {all.map((room) => (
            <Checkbox
              key={room}
              label={room}
              className="pl-6"
              isChecked={rooms.includes(room)}
              onChange={(isChecked) => {
                setRooms(isChecked ? [...rooms, room] : rooms.filter((each) => each !== room));
              }}
            />
          ))}
        </div>
      </Example>
      <Example label={'note · tone="warning" · disabled'}>
        <div className="flex max-w-md flex-col gap-2.5">
          <Checkbox
            label="Delete the recordings too"
            note="They cannot be brought back."
            tone="warning"
            isChecked={isAccepted}
            onChange={setAccepted}
          />
          <Checkbox label="Disabled, ticked" isChecked onChange={setAccepted} disabled />
          <Checkbox label="Disabled" isChecked={false} onChange={setAccepted} disabled />
        </div>
      </Example>
    </>
  );
}

/** A radio group's sample options. */
const MISSING = [
  { value: 'skip', label: 'Skip it', note: 'The average is of the sources that answer.' },
  { value: 'zero', label: 'Count it as zero', note: 'The average drops while it is away.' },
  { value: 'stop', label: 'Stop', note: 'The alias reads unavailable.' },
] as const;

/**
 * RadioGroup: choices with a line each, and a hidden label.
 *
 * @returns The examples.
 */
function RadioGroupDemo() {
  const [missing, setMissing] = useState<(typeof MISSING)[number]['value']>('skip');
  const [order, setOrder] = useState<'name' | 'room'>('name');

  return (
    <Example label="options with a note · isLabelHidden, no notes" isFields>
      <RadioGroup
        label="When a source is missing"
        options={MISSING}
        value={missing}
        onChange={setMissing}
      />
      <RadioGroup
        label="Sort by"
        isLabelHidden
        options={[
          { value: 'name', label: 'Name' },
          { value: 'room', label: 'Room' },
        ]}
        value={order}
        onChange={setOrder}
      />
    </Example>
  );
}

/**
 * Tooltip: over a control and under it, on a button and on an icon button.
 *
 * @returns The examples.
 */
function TooltipDemo() {
  return (
    <Example label="side: top · bottom — hover, or focus with Tab">
      <Tooltip text="Starts a recording now">
        <Button variant="ghost">Record</Button>
      </Tooltip>
      <Tooltip text="Opens under the control" side="bottom">
        <Button variant="ghost">side=&quot;bottom&quot;</Button>
      </Tooltip>
      <Tooltip text="Last seen 3 minutes ago, on the kitchen bridge">
        <IconButton label="Signal">
          <Icon id="zap" size={16} />
        </IconButton>
      </Tooltip>
    </Example>
  );
}

/**
 * Calendar: free, and bound to a few days around today.
 *
 * @returns The examples.
 */
function CalendarDemo() {
  const [day, setDay] = useState<string | null>(null);
  const [bound, setBound] = useState<string | null>(null);
  const [week, setWeek] = useState<DayRange | null>(null);
  const today = new Date();
  const month = `${String(today.getFullYear())}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  return (
    <Example label="value: null · min and max — arrows move by a day and a week">
      <div className="flex flex-col gap-2">
        <div className="rounded-card border border-border bg-surface-raised p-3">
          <Calendar value={day} onChange={setDay} />
        </div>
        <span className="font-mono text-caption text-foreground-muted">value: {day ?? 'null'}</span>
      </div>
      <div className="flex flex-col gap-2">
        <div className="rounded-card border border-border bg-surface-raised p-3">
          <Calendar value={bound} min={`${month}-05`} max={`${month}-20`} onChange={setBound} />
        </div>
        <span className="font-mono text-caption text-foreground-muted">
          min: {month}-05 · max: {month}-20
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <div className="rounded-card border border-border bg-surface-raised p-3">
          <Calendar mode="range" maxDays={7} value={week} onChange={setWeek} />
        </div>
        <span className="font-mono text-caption text-foreground-muted">
          mode=&quot;range&quot; maxDays=7 · {week === null ? 'null' : `${week.from} → ${week.to}`}
        </span>
      </div>
    </Example>
  );
}

/**
 * DateField: empty, chosen, bound, compact, and its states.
 *
 * @returns The examples.
 */
function DateFieldDemo() {
  const [day, setDay] = useState<string | null>('2026-06-21');
  const [none, setNone] = useState<string | null>(null);
  const [stay, setStay] = useState<DayRange | null>({ from: '2026-06-21', to: '2026-06-25' });
  const [noRange, setNoRange] = useState<DayRange | null>(null);

  return (
    <>
      <Example label="value: null · chosen · min · hint" isFields>
        <DateField label="From" value={none} onChange={setNone} />
        <DateField label="Day" value={day} onChange={setDay} />
        <DateField
          label="Not before June"
          value={day}
          min="2026-06-01"
          onChange={setDay}
          hint={'min="2026-06-01"'}
        />
      </Example>
      <Example label="size · error · disabled" isFields>
        <DateField label="Compact" size="compact" value={day} onChange={setDay} />
        <DateField label="Day" value={none} onChange={setNone} error="Choose a day." />
        <DateField label="Disabled" value={day} onChange={setDay} disabled />
      </Example>
      <Example label={'mode="range" · maxDays'} isFields>
        <DateField mode="range" label="Days away" value={noRange} onChange={setNoRange} />
        <DateField
          mode="range"
          label="Stay"
          value={stay}
          maxDays={14}
          onChange={setStay}
          hint="At most 14 days: maxDays={14}"
        />
      </Example>
    </>
  );
}

/**
 * NameIconField: with an icon, without one, and with an error.
 *
 * @returns The examples.
 */
function NameIconFieldDemo() {
  const [name, setName] = useState('Desk lamp');
  const [icon, setIcon] = useState<string | null>('lightbulb');
  const [blank, setBlank] = useState('');

  return (
    <Example label="icon · icon: null · error" isFields>
      <NameIconField value={name} onChange={setName} icon={icon} onIconChange={setIcon} />
      <NameIconField
        label="Scene"
        value={name}
        onChange={setName}
        icon={null}
        onIconChange={setIcon}
        hint="What the dashboard calls it."
      />
      <NameIconField
        required
        value={blank}
        onChange={setBlank}
        icon={icon}
        onIconChange={setIcon}
        error={blank === '' ? 'Give it a name.' : undefined}
      />
    </Example>
  );
}

/**
 * `cn`: what it joins, and which class wins.
 *
 * @returns The examples.
 */
function CnDemo() {
  return (
    <Example label="the later class wins · conditions are dropped">
      <code className="font-mono text-caption text-foreground-muted">
        {cn('px-2 text-ui', false, ['px-4', null], { 'text-primary': true, hidden: false })}
      </code>
    </Example>
  );
}

/**
 * PackageLink and PlatformLink: where each goes, said by the page's own address.
 *
 * @returns The examples.
 */
function LinksDemo() {
  const { pathname, search } = useLocation();

  return (
    <Example label="press one: the address the interface goes to">
      <PackageLink to="/cameras/porch" className="text-ui text-primary underline">
        PackageLink to=&quot;/cameras/porch&quot;
      </PackageLink>
      <PlatformLink to={{ kind: 'dashboard' }} className="text-ui text-primary underline">
        PlatformLink to a dashboard
      </PlatformLink>
      <PlatformLink
        to={{ kind: 'entity', entityId: 'switch.dryer_plug' }}
        className="text-ui text-primary underline"
      >
        PlatformLink to an entity
      </PlatformLink>
      <span className="w-full font-mono text-caption text-foreground-muted">
        {pathname}
        {search}
      </span>
    </Example>
  );
}

/**
 * The header's count of its actions, which the sample header does not keep.
 *
 * @returns Nothing.
 */
const ignoreCount = (): undefined => undefined;

/**
 * PageActions: the package's buttons, drawn in a page's header and not where they are written.
 *
 * @returns The examples.
 */
function PageActionsDemo() {
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const [isEditing, setEditing] = useState(false);

  return (
    <Example label="written in the page, drawn in its header">
      <div className="w-full max-w-xl overflow-hidden rounded-card border border-border">
        <div className="flex h-14 items-center justify-between border-b border-border bg-rail px-4">
          <span className="text-title font-medium text-foreground">Cameras</span>
          <div ref={setHeader} />
        </div>
        <div className="p-4 text-ui-sm text-foreground-muted">
          <PageActionsProvider value={{ target: header, onChange: ignoreCount }}>
            The package&apos;s page{isEditing ? ', being edited' : ''}.
            <PageActions>
              <Button
                size="compact"
                variant={isEditing ? 'primary' : 'ghost'}
                onClick={() => {
                  setEditing(!isEditing);
                }}
              >
                {isEditing ? 'Done' : 'Edit'}
              </Button>
            </PageActions>
          </PageActionsProvider>
        </div>
      </div>
    </Example>
  );
}

/**
 * Floating: a window of the package over a page, to drag, throw to a corner and close.
 *
 * @returns The examples.
 */
function FloatingDemo() {
  const [isOpen, setOpen] = useState(true);

  return (
    <Example label="open · onClose — drag it, throw it to a corner">
      <Button
        variant="ghost"
        size="compact"
        disabled={isOpen}
        onClick={() => {
          setOpen(true);
        }}
      >
        Open it again
      </Button>
      <div className="relative flex h-80 w-full overflow-hidden rounded-card border border-border bg-canvas">
        <FloatingLayer>
          <p className="p-4 text-ui-sm text-foreground-subtle">A page of the interface.</p>
          <Floating
            open={isOpen}
            label="Now playing"
            onClose={() => {
              setOpen(false);
            }}
          >
            <div className="flex w-64 flex-col gap-1 p-4">
              <span className="text-title font-medium text-foreground">Midnight City</span>
              <span className="text-ui-sm text-foreground-muted">M83 · Downstairs</span>
            </div>
          </Floating>
        </FloatingLayer>
      </div>
    </Example>
  );
}

/**
 * useClickOutside and useEscape: a menu of the package's own, closed by either.
 *
 * @returns The examples.
 */
function OutsideDemo() {
  const [isOpen, setOpen] = useState(false);
  const [closedBy, setClosedBy] = useState('nothing yet');
  const wrap = useRef<HTMLDivElement>(null);

  // One element holds the button and the menu; a list of refs does for two that are apart.
  useClickOutside(
    wrap,
    () => {
      setOpen(false);
      setClosedBy('a press outside');
    },
    isOpen,
  );
  useEscape(() => {
    setOpen(false);
    setClosedBy('Escape');
  }, isOpen);

  return (
    <Example label="open it, then press outside or Escape">
      <div ref={wrap} className="relative">
        <Button
          variant="ghost"
          aria-expanded={isOpen}
          onClick={() => {
            setOpen(!isOpen);
          }}
        >
          A menu of its own
        </Button>
        {isOpen ? (
          <div className="absolute top-full left-0 z-10 mt-2 w-56 rounded-card border border-border-strong bg-surface-raised p-3 text-ui-sm text-foreground-muted shadow-popover">
            A press in here keeps it open.
          </div>
        ) : null}
      </div>
      <span className="font-mono text-caption text-foreground-muted">closed by: {closedBy}</span>
    </Example>
  );
}

/**
 * useNow: the time, read again every second and every ten.
 *
 * @returns The examples.
 */
function NowDemo() {
  const [since] = useState(() => Date.now());
  const everySecond = useNow();
  const everyTen = useNow(10_000);

  return (
    <Example label="useNow() · useNow(10_000)">
      <Figure value={new Date(everySecond).toLocaleTimeString()} size="medium" />
      <span className="text-ui-sm text-foreground-muted">
        opened {Math.round((everySecond - since) / 1000)} s ago · read every ten seconds:{' '}
        {new Date(everyTen).toLocaleTimeString()}
      </span>
    </Example>
  );
}

/** The name of something `/components` exports. */
type ComponentName = keyof typeof SdkComponents;

/** Every export of `/components`, with its examples or the export it is shown with. */
const COMPONENTS: Record<ComponentName, Entry | ShownWith<ComponentName>> = {
  Button: {
    since: '1.0',
    about: 'An action. A native button’s attributes, a variant and a size.',
    code: '<Button variant="primary" size="medium" isBusy={isSaving} onClick={save}>Save</Button>',
    demo: ButtonDemo,
  },
  IconButton: {
    since: '1.0',
    about: 'An action with an icon and no text; `label` names it for a screen reader.',
    code: '<IconButton label="Edit" variant="bare" size="medium"><Icon id="pencil" size={16} /></IconButton>',
    demo: IconButtonDemo,
  },
  Icon: {
    since: '1.0',
    about: 'A catalogue icon, by the ids `icon` fields take. It takes the text’s colour.',
    code: '<Icon id="lightbulb" size={20} />',
    demo: IconDemo,
  },
  Badge: {
    since: '1.0',
    about: 'A short state.',
    code: '<Badge tone="success" size="small" icon={<Icon id="check" size={12} />}>Paired</Badge>',
    demo: BadgeDemo,
  },
  Panel: {
    since: '1.0',
    about: 'A titled section, with `PanelRow` for its rows and `PanelNote` under it.',
    code: `<Panel title="Recording" action={<Button size="compact" variant="ghost">Edit</Button>}>
  <PanelRow title="Record on motion" note="Keeps a clip." control={<Switch … />} />
</Panel>
<PanelNote>Clips older than this are removed every night.</PanelNote>`,
    demo: PanelDemo,
  },
  PanelRow: { shownWith: 'Panel' },
  PanelNote: { shownWith: 'Panel' },
  CardHeading: {
    since: '1.0',
    about: 'A card’s two-line heading, as the dashboard’s own cards draw it.',
    code: '<CardHeading title="Boiler" subtitle="Heating" tail={<Badge>58 °C</Badge>} isMuted={!isAvailable} />',
    demo: CardHeadingDemo,
  },
  Figure: {
    since: '1.0',
    about: 'A reading as a number, already written, and its unit.',
    code: '<Figure value="21.5" unit="°C" size="large" />',
    demo: FigureDemo,
  },
  StatusDot: {
    since: '1.0',
    about: 'A state at a glance; `title` says what it means.',
    code: '<StatusDot tone="success" title="Online" isBusy={isPairing} />',
    demo: StatusDotDemo,
  },
  ProgressBar: {
    since: '1.0',
    about: 'How far something has come; `null` pulses the whole bar.',
    code: '<ProgressBar percent={40} label="Downloading" />',
    demo: ProgressBarDemo,
  },
  Hint: {
    since: '1.0',
    about: 'An explanation behind a small `i`, opened by hover and by focus.',
    code: '<Hint text="How often the device is asked for its state." />',
    demo: HintDemo,
  },
  TextField: {
    since: '1.0',
    about: 'A labelled text input: an input’s attributes, a label, and what it says under it.',
    code: `<TextField label="Host" value={host} onChange={(event) => setHost(event.target.value)}
  hint="The address of the bridge." error={problem} />`,
    demo: TextFieldDemo,
  },
  SelectField: {
    since: '1.0',
    about: 'A labelled choice from a list.',
    code: `<SelectField label="Quality" value={quality} onChange={setQuality}
  options={[{ value: 'low', label: 'Low (480p)' }, { value: 'high', label: 'High (1080p)' }]} />`,
    demo: SelectFieldDemo,
  },
  Switch: {
    since: '1.0',
    about: 'On or off, now. For a choice saved later with a form, a `Checkbox`.',
    code: '<Switch label="Notifications" isOn={isOn} onChange={setOn} isBusy={isSending} />',
    demo: SwitchDemo,
  },
  Segmented: {
    since: '1.0',
    about: 'One of a few, side by side.',
    code: `<Segmented label="Period" value={period} onChange={setPeriod}
  options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />`,
    demo: SegmentedDemo,
  },
  Slider: {
    since: '1.0',
    about: 'A value in a range; `onCommit` is called once the knob is let go.',
    code: `<Slider label="Brightness" min={0} max={100} value={level} display={\`\${level} %\`}
  onChange={setLevel} onCommit={send} />`,
    demo: SliderDemo,
  },
  Stepper: {
    since: '1.0',
    about: 'A value by steps.',
    code: `<Stepper label="Target" min={5} max={30} step={0.5} value={target}
  format={(value) => \`\${value.toFixed(1)} °C\`} onChange={setTarget} />`,
    demo: StepperDemo,
  },
  TagChip: {
    since: '1.0',
    about: 'A coloured tag; `onRemove` gives it a remove button.',
    code: '<TagChip color="violet" onRemove={() => remove(tag)}>evening</TagChip>',
    demo: TagChipDemo,
  },
  Modal: {
    since: '1.0',
    about: 'A dialog, drawn inside the package’s scope.',
    code: `<Modal isOpen={isOpen} onClose={close} title="Remove the camera?" size="small"
  footer={<Button variant="danger" onClick={remove}>Remove</Button>}>
  …
</Modal>`,
    demo: ModalDemo,
  },
  IconField: {
    since: '1.7',
    about: 'One icon of the catalogue: the 44 px icon button and the interface’s icon picker.',
    code: '<IconField label="Icon" value={icon} onChange={setIcon} />',
    demo: IconFieldDemo,
  },
  EntityField: {
    since: '1.7',
    about: 'One entity of the house, from the interface’s entity picker.',
    code: `<EntityField label="Light" value={entityId} onChange={setEntityId}
  domains={['light']} isOptional pickerTitle="Which light?" />`,
    demo: EntityFieldDemo,
  },
  EntityPicker: {
    since: '1.7',
    about: 'The entity picker’s dialog on its own, for one entity or several.',
    code: `<EntityPicker isOpen={isOpen} onClose={close} isMultiple value={entityIds}
  onChoose={(chosen) => { setEntityIds(chosen); close(); }} />`,
    demo: EntityPickerDemo,
  },
  Checkbox: {
    since: '1.10',
    about: 'A box ticked on a form saved later - where a `Switch` is an action that happens now.',
    code: `<Checkbox label="Delete the recordings too" note="They cannot be brought back."
  tone="warning" isChecked={isChecked} onChange={setChecked} />`,
    demo: CheckboxDemo,
  },
  RadioGroup: {
    since: '1.10',
    about: 'One choice of a few, each with a line saying what it means.',
    code: `<RadioGroup label="When a source is missing" value={missing} onChange={setMissing}
  options={[{ value: 'skip', label: 'Skip it', note: 'The average is of the rest.' }, …]} />`,
    demo: RadioGroupDemo,
  },
  Tooltip: {
    since: '1.10',
    about:
      'A line of words over a control while it is hovered or focused. The control keeps a name of its own.',
    code: `<Tooltip text="Last seen 3 minutes ago" side="top">
  <IconButton label="Signal"><Icon id="zap" size={16} /></IconButton>
</Tooltip>`,
    demo: TooltipDemo,
  },
  Calendar: {
    since: '1.10',
    about:
      'A month of days to pick one day, or a run of days, from. A day is a plain `2026-06-21`, a run `{ from, to }`.',
    code: `<Calendar value={day} onChange={setDay} min="2026-06-01" max="2026-06-30" />
<Calendar mode="range" maxDays={7} value={week} onChange={setWeek} />`,
    demo: CalendarDemo,
  },
  DateField: {
    since: '1.10',
    about: 'One day, or a run of days, chosen from a calendar the field opens under it.',
    code: `<DateField label="From" value={day} onChange={setDay} min="2026-06-01" />
<DateField mode="range" label="Stay" value={stay} onChange={setStay} maxDays={14} />`,
    demo: DateFieldDemo,
  },
  NameIconField: {
    since: '1.10',
    about: 'A name with its icon beside it, under one label.',
    code: `<NameIconField value={name} onChange={setName}
  icon={icon} onIconChange={setIcon} required error={problem} />`,
    demo: NameIconFieldDemo,
  },
  cn: {
    since: '1.0',
    about: 'Joins class names, resolving Tailwind conflicts.',
    code: "cn('px-2 text-ui', isActive && 'text-primary', className)",
    demo: CnDemo,
  },
};

/** What `/ui` exports that draws without a server, each with its examples. */
const UI: Partial<Record<keyof typeof SdkUi, Entry | ShownWith<keyof typeof SdkUi>>> = {
  PackageLink: {
    since: '1.0',
    about: 'Links to a path of the package’s page, and to a place of the platform.',
    code: `<PackageLink to="/cameras/porch">Porch</PackageLink>
<PlatformLink to={{ kind: 'entity', entityId: 'light.desk' }}>Desk lamp</PlatformLink>`,
    demo: LinksDemo,
  },
  PlatformLink: { shownWith: 'PackageLink' },
  PageActions: {
    since: '1.3',
    about: 'Buttons drawn in the header of the package’s page, beside its title.',
    code: '<PageActions><Button size="compact" variant="ghost">Edit</Button></PageActions>',
    demo: PageActionsDemo,
  },
  Floating: {
    since: '1.6',
    about: 'A window of the package floating over the interface’s pages.',
    code: '<Floating open={isOpen} label="Now playing" onClose={close}>…</Floating>',
    demo: FloatingDemo,
  },
  useClickOutside: {
    since: '1.10',
    about: 'Call back on a press outside an element (or several), and on Escape.',
    code: `useClickOutside([button, menu], close, isOpen);
useEscape(close, isOpen);`,
    demo: OutsideDemo,
  },
  useEscape: { shownWith: 'useClickOutside' },
  useNow: {
    since: '1.10',
    about: 'The time, read again at an interval: for “3 min ago” and clocks.',
    code: `const now = useNow();          // every second
const slow = useNow(60_000);   // every minute`,
    demo: NowDemo,
  },
};

/** What a group of entries needs. */
type GroupProps = {
  /** The entry point they are imported from. */
  readonly from: string;

  /** The exports, by name. */
  readonly entries: Readonly<Record<string, Entry | ShownWith<string> | undefined>>;
};

/**
 * The names an entry stands for: its own, and those shown with it.
 *
 * @param entries - The group.
 * @param name - The entry.
 * @returns The names, its own first.
 */
function namesOf(entries: GroupProps['entries'], name: string): readonly string[] {
  return [
    name,
    ...Object.entries(entries).flatMap(([other, entry]) =>
      entry !== undefined && 'shownWith' in entry && entry.shownWith === name ? [other] : [],
    ),
  ];
}

/**
 * One entry point's exports, each a section: its name, what it is for, its examples and its code.
 *
 * @param props - See {@link GroupProps}.
 * @returns The sections.
 */
function Group(props: GroupProps) {
  const { from, entries } = props;

  return (
    <>
      <h2 id={from} className="scroll-mt-24 font-mono text-ui text-foreground-muted">
        @nebulahome/package-sdk{from}
      </h2>
      {Object.entries(entries).map(([name, entry]) => {
        if (entry === undefined || 'shownWith' in entry) {
          return null;
        }

        const Demo = entry.demo;

        return (
          <section
            key={name}
            id={name}
            className="flex scroll-mt-24 flex-col gap-5 rounded-card border border-border bg-surface p-5"
          >
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h3 className="font-mono text-title font-medium text-foreground">
                {namesOf(entries, name).join(' · ')}
              </h3>
              <Badge size="small" tone={entry.since === '1.10' ? 'accent' : 'neutral'}>
                since {entry.since}
              </Badge>
              <p className="w-full text-ui-sm text-foreground-muted">{entry.about}</p>
            </header>
            <Demo />
            <pre className="overflow-x-auto rounded-tile bg-rail p-3 font-mono text-caption text-foreground-muted">
              <code>{entry.code}</code>
            </pre>
          </section>
        );
      })}
    </>
  );
}

/**
 * The links down the side: every export, by entry point.
 *
 * @param props - See {@link GroupProps}.
 * @returns The list.
 */
function GroupLinks(props: GroupProps) {
  const { from, entries } = props;

  return (
    <div className="flex flex-col gap-0.5">
      <a href={`#${from}`} className="mb-1 font-mono text-label text-foreground-subtle uppercase">
        {from}
      </a>
      {Object.entries(entries).map(([name, entry]) =>
        entry === undefined ? null : (
          <a
            key={name}
            href={`#${'shownWith' in entry ? entry.shownWith : name}`}
            className="rounded-chip px-2 py-1 font-mono text-caption text-foreground-muted transition-colors hover:bg-surface-high hover:text-foreground"
          >
            {name}
          </a>
        ),
      )}
    </div>
  );
}

/**
 * Renders the preview: a header with the theme and the language, the exports down the side, and
 * their sections.
 *
 * @returns The page.
 */
function SdkPreview() {
  const [cache] = useState(labCache);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [language, setLanguage] = useState<'en' | 'it'>('en');

  // The root element is outside React: the same attribute the application sets on it.
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  useEffect(() => {
    void applyLanguage(language);
  }, [language]);

  return (
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <PackageScope value={PREVIEW_PACKAGE} portal={null}>
          <div className="min-h-screen bg-canvas text-foreground">
            <header className="sticky top-0 z-20 border-b border-border bg-canvas/85 backdrop-blur-xl">
              <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-5 gap-y-2 px-8 py-3.5">
                <h1 className="text-title font-medium">Package SDK preview</h1>
                <Badge tone="accent">@nebulahome/package-sdk {SDK_VERSION}</Badge>
                <div className="ml-auto flex items-center gap-3">
                  <Segmented
                    label="Language"
                    size="compact"
                    options={[
                      { value: 'en', label: 'English' },
                      { value: 'it', label: 'Italiano' },
                    ]}
                    value={language}
                    onChange={setLanguage}
                  />
                  <Segmented
                    label="Theme"
                    size="compact"
                    options={[
                      { value: 'dark', label: 'Dark' },
                      { value: 'light', label: 'Light' },
                    ]}
                    value={theme}
                    onChange={setTheme}
                  />
                </div>
              </div>
            </header>

            <div className="mx-auto flex max-w-[1240px] items-start gap-8 px-8 py-8">
              <nav
                aria-label="Exports"
                className="sticky top-24 hidden max-h-[calc(100vh-7rem)] w-44 shrink-0 flex-col gap-5 overflow-y-auto lg:flex"
              >
                <GroupLinks from="/components" entries={COMPONENTS} />
                <GroupLinks from="/ui" entries={UI} />
              </nav>
              <main className="flex min-w-0 grow flex-col gap-6">
                <Group from="/components" entries={COMPONENTS} />
                <Group from="/ui" entries={UI} />
              </main>
            </div>
          </div>
        </PackageScope>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <SdkPreview />
      <Toaster />
    </StrictMode>,
  );
}
