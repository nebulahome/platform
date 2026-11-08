/**
 * The entity lab (`pnpm dev:entity`, development only): one domain at a time, picked from every
 * domain the contracts define, with the capabilities, params and state of each way its entity may
 * be as switches and fields on the left, and the entity dialog drawn from them on the right - the
 * same `EntitySheet` the platform opens over its pages (`entity-dialog.tsx`), with the same props,
 * so what is seen here is what the app shows. "Open as a dialog" opens it in the same dialog the
 * platform puts it in - centred over a backdrop, arriving and leaving as it does - and a window's
 * history takes a moment to arrive, as a read from the hub does.
 *
 * Nothing on this page lists a domain, a capability or a field: the domains are
 * `ENTITY_DOMAINS`, what each carries is `DOMAIN_CAPABILITIES`, each capability's fields are its
 * schemas. A domain or a capability added to the contracts appears here as it is. Only `alias` is
 * left out: an alias is not a kind of thing but a copy of another entity, drawn as that one is.
 */
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';

import {
  DOMAIN_CAPABILITIES,
  ENTITY_DOMAINS,
  ENTITY_STATE_CLASSES,
  type CapabilityName,
  type EntityDomain,
  type IconView,
  type JsonObject,
} from '@nebulahome/contracts';
import {
  AppIcon,
  BUILTIN_UI_FRAME,
  BUILTIN_UI_NODES,
  cn,
  Modal,
  Segmented,
  SelectField,
  Switch,
  Toaster,
  type UiIconId,
} from '@nebulahome/ui';

import { applyLanguage } from '@/i18n/language';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { EntitySheet } from '@/routes/library/entity/sheet/entity-sheet';
import { sheetKindOf } from '@/routes/library/entity/sheet/kinds';
import type { SheetRange } from '@/routes/library/entity/sheet/sheet-types';
import { labStateHistory, labTelemetry, windowOfRange } from '@/testing/entity-lab/lab-history';
import {
  applyCommand,
  buildRow,
  deviceClassesOf,
  initialRows,
  withCapability,
  withOneOf,
  type LabRow,
  type LabValues,
} from '@/testing/entity-lab/lab-model';
import { firstValue, sampleItem } from '@/testing/entity-lab/sample';
import { capabilityFields, type SchemaField } from '@/testing/entity-lab/schema-fields';
import { anArea, aTag } from '@/testing/fixtures';
import { linkedSampleCache } from '@/testing/linked-samples';

import './styles/globals.css';

/** The time the page opened: every row's "since" and history are measured from it. */
const NOW = Date.now();

/** The domains the lab draws: every one but `alias`, which only ever copies another. */
const DOMAINS: readonly EntityDomain[] = ENTITY_DOMAINS.filter((domain) => domain !== 'alias');

/** A camera's still, as the snapshot endpoint would send one: a porch at dusk. */
const CAMERA_STILL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22305e"/><stop offset=".6" stop-color="#7a5aa8"/><stop offset="1" stop-color="#f0a46c"/></linearGradient></defs><rect width="640" height="400" fill="url(#s)"/><circle cx="470" cy="270" r="34" fill="#ffd9a0" opacity=".85"/><path d="M0 300 Q160 250 320 290 T640 280 V400 H0Z" fill="#171a33"/><path d="M90 300 V200 L170 150 L250 200 V300Z" fill="#232848"/><rect x="150" y="235" width="40" height="65" rx="4" fill="#ffcf7a" opacity=".8"/><rect x="0" y="372" width="640" height="28" fill="#0a0c16" opacity=".7"/><text x="16" y="391" fill="#e3e6ff" font-family="monospace" font-size="14">PORCH · 19:42:07</text></svg>`;

/** A robot's map, as the image endpoint would send one: four rooms, its path and where it is. */
const ROBOT_MAP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><rect width="480" height="360" fill="#0a0c16"/><g stroke="#2d3352" stroke-width="2"><path d="M40 40 H250 V190 H40Z" fill="#1d2a4a"/><path d="M250 40 H440 V150 H250Z" fill="#2a2148"/><path d="M40 190 H200 V320 H40Z" fill="#1c3a3a"/><path d="M200 150 H440 V320 H200Z" fill="#33263a"/></g><g fill="#a4a8c6" font-family="sans-serif" font-size="13"><text x="56" y="64">Living room</text><text x="266" y="64">Kitchen</text><text x="56" y="214">Office</text><text x="216" y="174">Bedroom</text></g><path d="M80 150 H220 V90 H120 V120 H230 M300 120 H410 V80 H300" fill="none" stroke="#4fd0ee" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 7" opacity=".85"/><circle cx="300" cy="120" r="9" fill="#f2f3ff" stroke="#4fd0ee" stroke-width="3"/><rect x="58" y="292" width="22" height="14" rx="3" fill="#52cd86"/></svg>`;

/** The fetch the page started with. */
const networkFetch = globalThis.fetch.bind(globalThis);

/**
 * Answers the requests the API would answer with a picture - a camera's still, an image entity's
 * picture - since the lab runs with no API behind it; every other request goes out as it is.
 *
 * @param input - What is fetched.
 * @param init - How.
 * @returns The answer.
 */
async function labFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const picture = /\/camera\/snapshot(?:\?|$)/u.test(url)
    ? CAMERA_STILL
    : url.includes('/image?revision=')
      ? ROBOT_MAP
      : null;

  return picture === null
    ? networkFetch(input, init)
    : new Response(new Blob([picture], { type: 'image/svg+xml' }), { status: 200 });
}

globalThis.fetch = labFetch;

/**
 * The cache the dialog's settings read from: rooms, tags, the icon catalogue and the vendors of
 * the linked sample.
 *
 * @returns The cache.
 */
function labCache(): QueryClient {
  const client = linkedSampleCache();
  const icons: IconView[] = Object.entries(BUILTIN_UI_NODES).map(([id, node]) => ({
    id,
    name: id,
    keywords: [],
    origin: 'builtin',
    isOverridden: false,
    node,
    frame: BUILTIN_UI_FRAME,
  }));

  client.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } });
  client.setQueryData(LIBRARY_QUERY_KEYS.areas, [
    anArea('home', 'house', null, { name: 'Home' }),
    anArea('ground', 'floor', 'home', { name: 'Ground floor' }),
    anArea('living_room', 'room', 'ground'),
  ]);
  client.setQueryData(LIBRARY_QUERY_KEYS.tags, [aTag('evening'), aTag('cooking')]);
  client.setQueryData([...LIBRARY_QUERY_KEYS.icons, 'search', ''], icons);

  return client;
}

/** A small input's look. */
const INPUT =
  'h-7.5 min-w-0 rounded-chip border border-border-strong bg-surface-raised px-2 text-caption text-foreground transition-colors hover:border-foreground-subtle focus:border-primary focus:outline-none';

/** What a field's control needs. */
type FieldControlProps = {
  readonly field: SchemaField;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
};

/**
 * One field's control, picked by what its schema says it holds.
 *
 * @param props - See {@link FieldControlProps}.
 * @returns The control.
 */
function FieldControl(props: FieldControlProps) {
  const { field, value, onChange } = props;
  const kind = field.kind;

  switch (kind.type) {
    case 'boolean': {
      return <Switch label={field.key} size="small" isOn={value === true} onChange={onChange} />;
    }
    case 'enum': {
      return (
        <select
          className={INPUT}
          value={String(value)}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {kind.values.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    case 'number': {
      const number = typeof value === 'number' ? value : 0;
      const hasRange = kind.min !== undefined && kind.max !== undefined;

      return (
        <span className="flex min-w-0 items-center gap-2">
          {hasRange ? (
            <input
              type="range"
              min={kind.min}
              max={kind.max}
              step={kind.isInt ? 1 : ((kind.max ?? 1) - (kind.min ?? 0)) / 200}
              value={number}
              onChange={(event) => {
                onChange(Number(event.target.value));
              }}
              className="w-24 accent-primary"
            />
          ) : null}
          <input
            type="number"
            className={cn(INPUT, 'w-18 text-right tabular')}
            value={Number(number.toFixed(3))}
            onChange={(event) => {
              onChange(Number(event.target.value));
            }}
          />
        </span>
      );
    }
    case 'string': {
      return (
        <input
          className={cn(INPUT, 'w-40')}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      );
    }
    case 'enum-list': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];

      return (
        <span className="flex flex-wrap justify-end gap-1">
          {kind.values.map((option) => {
            const isOn = chosen.includes(option);

            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(
                    isOn
                      ? chosen.filter((each) => each !== option)
                      : kind.values.filter((each) => each === option || chosen.includes(each)),
                  );
                }}
                className={cn(
                  'press h-6 cursor-pointer rounded-pill border px-2 font-mono text-[11px] transition-colors',
                  isOn
                    ? 'border-primary/50 bg-primary/12 text-primary'
                    : 'border-border-strong text-foreground-subtle hover:text-foreground',
                )}
              >
                {option}
              </button>
            );
          })}
        </span>
      );
    }
    case 'list': {
      const list = Array.isArray(value) ? (value as unknown[]) : [];
      /**
       * Grows or shrinks the list, keeping the members it has.
       *
       * @param length - How many it should hold.
       */
      const resize = (length: number): void => {
        const size = Math.min(kind.maxItems, Math.max(0, length));

        onChange(
          [...Array.from({ length: size }).keys()].map(
            (index) => list[index] ?? sampleItem(kind.item, index),
          ),
        );
      };

      return (
        <span className="flex items-center rounded-chip border border-border-strong bg-surface-raised">
          <button
            type="button"
            aria-label={`Fewer ${field.key}`}
            className="press flex size-7 cursor-pointer items-center justify-center text-foreground-muted hover:text-foreground"
            onClick={() => {
              resize(list.length - 1);
            }}
          >
            <AppIcon id="minus" size={13} />
          </button>
          <span className="w-7 text-center font-mono text-caption tabular">{list.length}</span>
          <button
            type="button"
            aria-label={`More ${field.key}`}
            className="press flex size-7 cursor-pointer items-center justify-center text-foreground-muted hover:text-foreground"
            onClick={() => {
              resize(list.length + 1);
            }}
          >
            <AppIcon id="plus" size={13} />
          </button>
        </span>
      );
    }
    case 'json': {
      return (
        <input
          // Read again whenever the value changes from elsewhere: a command answered.
          key={JSON.stringify(value ?? {})}
          className={cn(INPUT, 'w-40 font-mono')}
          defaultValue={JSON.stringify(value ?? {})}
          onBlur={(event) => {
            try {
              onChange(JSON.parse(event.target.value));
            } catch {
              // Left as it was until it reads.
            }
          }}
        />
      );
    }
  }
}

/** What a group of fields needs. */
type FieldGroupProps = {
  readonly title: string;
  readonly fields: readonly SchemaField[];
  readonly values: LabValues;
  readonly onChange: (values: LabValues) => void;
};

/**
 * A capability's params or state: one line per field, with a box for whether an optional one is
 * there and a "null" chip for a nullable one.
 *
 * @param props - See {@link FieldGroupProps}.
 * @returns The group, or nothing for a schema without fields.
 */
function FieldGroup(props: FieldGroupProps) {
  const { title, fields, values, onChange } = props;

  if (fields.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <span className="pb-1 font-mono text-[10px] tracking-[0.08em] text-foreground-subtle uppercase">
        {title}
      </span>
      {fields.map((field) => {
        const value = values[field.key];
        const isPresent = value !== undefined;
        const isOptional = !field.isRequired && !field.hasDefault;
        /**
         * Sets this field.
         *
         * @param next - Its value; undefined leaves it out.
         */
        const set = (next: unknown): void => {
          const others = Object.entries(values).filter(([key]) => key !== field.key);

          onChange(
            Object.fromEntries(next === undefined ? others : [...others, [field.key, next]]),
          );
        };

        return (
          <div
            key={field.key}
            className="flex min-h-9 items-center justify-between gap-3 border-t border-border/60 py-1"
          >
            <label className="flex min-w-0 items-center gap-2">
              {isOptional ? (
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 accent-primary"
                  checked={isPresent}
                  onChange={(event) => {
                    set(event.target.checked ? firstValue(field) : undefined);
                  }}
                />
              ) : (
                <span
                  title={field.isRequired ? 'Required' : 'Has a default'}
                  className={cn(
                    'mx-1 size-1.5 shrink-0 rounded-full',
                    field.isRequired ? 'bg-primary' : 'bg-foreground-subtle',
                  )}
                />
              )}
              <span
                className={cn(
                  'truncate font-mono text-caption',
                  isPresent ? 'text-foreground' : 'text-foreground-subtle',
                )}
              >
                {field.key}
              </span>
            </label>
            {isPresent ? (
              <span className="flex min-w-0 items-center gap-2">
                {field.isNullable ? (
                  <button
                    type="button"
                    onClick={() => {
                      set(value === null ? (firstValue(field) ?? 'Sample') : null);
                    }}
                    className={cn(
                      'press h-6 cursor-pointer rounded-pill border px-2 font-mono text-[10px] transition-colors',
                      value === null
                        ? 'border-primary/50 bg-primary/12 text-primary'
                        : 'border-border-strong text-foreground-subtle hover:text-foreground',
                    )}
                  >
                    null
                  </button>
                ) : null}
                {value === null ? null : (
                  <FieldControl field={field} value={value} onChange={set} />
                )}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** What a card of the left column needs. */
type PanelProps = {
  readonly title: string;
  readonly aside?: string;
  readonly children: ReactNode;
};

/**
 * A card of the left column: its name in small capitals, then its lines.
 *
 * @param props - See {@link PanelProps}.
 * @returns The card.
 */
function Panel(props: PanelProps) {
  return (
    <section className="flex flex-col gap-2 rounded-panel border border-border bg-surface p-4 shadow-edge">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-label tracking-[0.08em] text-foreground-muted uppercase">
          {props.title}
        </span>
        {props.aside === undefined ? null : (
          <span className="font-mono text-[10px] text-foreground-subtle">{props.aside}</span>
        )}
      </div>
      {props.children}
    </section>
  );
}

/** What one variant needs. */
type VariantProps = {
  readonly row: LabRow;
  readonly onChange: (row: LabRow) => void;
};

/**
 * One entity being tried: its switches and fields on the left, its dialog on the right.
 *
 * @param props - See {@link VariantProps}.
 * @returns The variant.
 */
function Variant(props: VariantProps) {
  const { row, onChange } = props;
  const [range, setRange] = useState<SheetRange>('24h');
  const [busy, setBusy] = useState<ReadonlySet<CapabilityName>>(new Set());
  const [closed, setClosed] = useState(false);
  const [isDialog, setDialog] = useState(false);
  // The window whose history has "arrived": another is still being read, for a moment.
  const [loaded, setLoaded] = useState<SheetRange | null>(null);
  const [reportedAt, setReportedAt] = useState(NOW);
  const rowRef = useRef(row);
  // How many commands for each capability are on their way, as the platform's commander counts
  // them: a capability is busy until the last one is answered.
  const inFlight = useRef(new Map<CapabilityName, number>());
  const build = buildRow(row, NOW);
  const window = windowOfRange(range, NOW);
  const stateKey = JSON.stringify(build.entity.state);
  const states = useMemo(
    () => labStateHistory(build.entity, range, window),
    // A history per state and window: rebuilt when either changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the entity is rebuilt each render
    [stateKey, range],
  );

  // A command answered after a while applies to the row as it is then, not as it was sent.
  useEffect(() => {
    rowRef.current = row;
  });

  // A window's history arrives a moment after it is chosen, as a read from the hub does.
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setLoaded(range);
    }, 900);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [range]);
  const telemetry = labTelemetry(build.entity, range, window);
  const { oneOf, may } = DOMAIN_CAPABILITIES[row.domain];
  const classes = deviceClassesOf(row.domain);

  /**
   * Counts a command for a capability in or out, and says which are busy.
   *
   * @param capability - The capability.
   * @param change - One more on its way, or one fewer.
   */
  const count = (capability: CapabilityName, change: 1 | -1): void => {
    const next = Math.max(0, (inFlight.current.get(capability) ?? 0) + change);

    inFlight.current.set(capability, next);
    setBusy(new Set([...inFlight.current].filter(([, each]) => each > 0).map(([key]) => key)));
  };

  /**
   * Sends a command the way a device that obeys would answer it: a moment's wait, then the state.
   *
   * @param capability - The capability.
   * @param command - The command.
   */
  const send = (capability: CapabilityName, command: JsonObject): void => {
    count(capability, 1);
    globalThis.setTimeout(() => {
      const latest = rowRef.current;

      onChange({
        ...latest,
        state: {
          ...latest.state,
          [capability]: applyCommand(latest.state[capability] ?? {}, command),
        },
      });
      setReportedAt(Date.now());
      count(capability, -1);
    }, 700);
  };

  /**
   * The dialog's card, as the platform draws it.
   *
   * @param onClose - What its Close does.
   * @returns The card.
   */
  const sheetOf = (onClose: () => void): ReactNode => (
    <EntitySheet
      key={`${row.id}:${row.capabilities.join(',')}`}
      entity={build.entity}
      state={build.state}
      reportedAt={reportedAt}
      commander={{
        send,
        busy: row.isSending ? new Set(row.capabilities) : busy,
        problem: null,
      }}
      disabled={!row.isAvailable}
      history={{
        range,
        onRange: setRange,
        window,
        states,
        telemetry,
        isLoading: loaded !== range,
      }}
      battery={row.battery}
      now={NOW}
      deviceName="Living room lamp"
      onClose={onClose}
      onSave={(change) => {
        onChange({
          ...row,
          ...(change.isEnabled === undefined ? {} : { isEnabled: change.isEnabled }),
        });
      }}
      onEnable={() => {
        onChange({ ...row, isEnabled: true });
      }}
      // The app asks first (its Unlink dialog); the lab unlinks at once.
      {...(row.isLinked
        ? {
            /** Unlinks at once. */
            onUnlink: () => {
              onChange({ ...row, isLinked: false });
            },
          }
        : {})}
    />
  );

  return (
    <div className="grid grid-cols-[minmax(0,400px)_minmax(0,1fr)] items-start gap-8">
      <div className="flex flex-col gap-3">
        <Panel title="Capabilities" aside={`${String(row.capabilities.length)} on`}>
          {[...oneOf, ...may].map((capability) => {
            const isOn = row.capabilities.includes(capability);
            const isOneOf = oneOf.includes(capability);

            return (
              <label
                key={capability}
                className="flex h-9 items-center justify-between gap-2 border-t border-border/60"
              >
                <span className="flex items-center gap-2 font-mono text-caption">
                  {capability}
                  <span
                    className={cn(
                      'rounded-chip border px-1.5 py-px text-[9px] tracking-[0.06em] uppercase',
                      isOneOf
                        ? 'border-primary/45 text-primary'
                        : 'border-foreground-muted/40 text-foreground-muted',
                    )}
                  >
                    {isOneOf ? (oneOf.length > 1 ? 'One of' : 'Required') : 'Optional'}
                  </span>
                </span>
                {isOneOf && oneOf.length === 1 ? (
                  <Switch
                    label={capability}
                    size="small"
                    isOn
                    disabled
                    onChange={() => undefined}
                  />
                ) : isOneOf ? (
                  <input
                    type="radio"
                    className="size-4 accent-primary"
                    checked={isOn}
                    onChange={() => {
                      onChange(withOneOf(row, capability));
                    }}
                  />
                ) : (
                  <Switch
                    label={capability}
                    size="small"
                    isOn={isOn}
                    onChange={(next) => {
                      onChange(withCapability(row, capability, next));
                    }}
                  />
                )}
              </label>
            );
          })}
        </Panel>

        {row.capabilities.map((capability) => {
          const fields = capabilityFields(capability);

          return (
            <details
              key={capability}
              open
              className="group rounded-panel border border-border bg-surface shadow-edge"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 font-mono text-caption text-foreground">
                {capability}
                <AppIcon
                  id="chevron-down"
                  size={15}
                  className="text-foreground-subtle transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="flex flex-col gap-3 px-4 pb-4">
                <FieldGroup
                  title="Params"
                  fields={fields.params}
                  values={row.params[capability] ?? {}}
                  onChange={(values) => {
                    onChange({ ...row, params: { ...row.params, [capability]: values } });
                  }}
                />
                <FieldGroup
                  title="State"
                  fields={fields.state}
                  values={row.state[capability] ?? {}}
                  onChange={(values) => {
                    onChange({ ...row, state: { ...row.state, [capability]: values } });
                  }}
                />
              </div>
            </details>
          );
        })}

        <Panel title="Entity">
          <label className="flex h-9 items-center justify-between gap-2 border-t border-border/60 font-mono text-caption">
            device_class
            {classes === null ? (
              <input
                className={cn(INPUT, 'w-40')}
                value={row.deviceClass ?? ''}
                onChange={(event) => {
                  onChange({
                    ...row,
                    deviceClass: event.target.value === '' ? null : event.target.value,
                  });
                }}
              />
            ) : (
              <select
                className={INPUT}
                value={row.deviceClass ?? ''}
                onChange={(event) => {
                  onChange({
                    ...row,
                    deviceClass: event.target.value === '' ? null : event.target.value,
                  });
                }}
              >
                <option value="">—</option>
                {classes.map((each) => (
                  <option key={each} value={each}>
                    {each}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="flex h-9 items-center justify-between gap-2 border-t border-border/60 font-mono text-caption">
            unit
            <input
              className={cn(INPUT, 'w-24')}
              value={row.unit ?? ''}
              onChange={(event) => {
                onChange({ ...row, unit: event.target.value === '' ? null : event.target.value });
              }}
            />
          </label>
          <label className="flex h-9 items-center justify-between gap-2 border-t border-border/60 font-mono text-caption">
            state_class
            <select
              className={INPUT}
              value={row.stateClass ?? ''}
              onChange={(event) => {
                const next = ENTITY_STATE_CLASSES.find((each) => each === event.target.value);

                onChange({ ...row, stateClass: next ?? null });
              }}
            >
              <option value="">—</option>
              {ENTITY_STATE_CLASSES.map((each) => (
                <option key={each} value={each}>
                  {each}
                </option>
              ))}
            </select>
          </label>
        </Panel>

        <Panel title="Every entity">
          {(
            [
              ['Answers', 'isAvailable'],
              ['Sending', 'isSending'],
              ['Enabled', 'isEnabled'],
              ['Linked', 'isLinked'],
            ] as const
          ).map(([label, key]) => (
            <label
              key={key}
              className="flex h-9 items-center justify-between border-t border-border/60 font-mono text-caption"
            >
              {label}
              <Switch
                label={label}
                size="small"
                isOn={row[key]}
                onChange={(next) => {
                  onChange({ ...row, [key]: next });
                }}
              />
            </label>
          ))}
          <label className="flex h-9 items-center justify-between border-t border-border/60 font-mono text-caption">
            Device battery
            <span className="flex items-center gap-2">
              {row.battery === null ? null : (
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={row.battery}
                  className="w-24 accent-primary"
                  onChange={(event) => {
                    onChange({ ...row, battery: Number(event.target.value) });
                  }}
                />
              )}
              <Switch
                label="Device battery"
                size="small"
                isOn={row.battery !== null}
                onChange={(next) => {
                  onChange({ ...row, battery: next ? 76 : null });
                }}
              />
            </span>
          </label>
        </Panel>
      </div>

      <div className="sticky top-24 flex flex-col gap-3">
        <div className="relative flex min-h-[720px] items-start justify-center overflow-hidden rounded-[28px] border border-border bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] bg-size-[22px_22px] p-12">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-[-20%] left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]"
          />
          {closed ? (
            <button
              type="button"
              className="press relative mt-40 inline-flex h-10 cursor-pointer items-center gap-2 rounded-pill border border-border-strong bg-surface px-4 text-ui font-medium transition-colors hover:border-foreground-subtle"
              onClick={() => {
                setClosed(false);
              }}
            >
              <AppIcon id="rotate-ccw" size={15} />
              Open the dialog again
            </button>
          ) : (
            sheetOf(() => {
              setClosed(true);
            })
          )}
          <button
            type="button"
            className="press absolute top-4 right-4 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-pill border border-border-strong bg-surface px-3 text-caption font-medium transition-colors hover:border-foreground-subtle"
            onClick={() => {
              setDialog(true);
            }}
          >
            <AppIcon id="maximize-2" size={13} />
            Open as a dialog
          </button>
        </div>
        {isDialog ? (
          <Modal
            isOpen
            layout="bare"
            title={build.entity.name}
            onClose={() => {
              setDialog(false);
            }}
          >
            {sheetOf(() => {
              setDialog(false);
            })}
          </Modal>
        ) : null}
        {build.issues.length === 0 ? (
          <span className="inline-flex items-center gap-2 self-start rounded-pill border border-success/35 bg-success/10 px-3 py-1.5 text-caption text-success">
            <AppIcon id="check" size={14} />
            The contracts accept this state and these params
          </span>
        ) : (
          <ul className="flex flex-col gap-1 rounded-tile border border-danger/40 bg-danger/8 p-3 font-mono text-caption text-danger">
            {build.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The domain the page opens on: the one in the address, or the first.
 *
 * @returns The domain.
 */
function domainInAddress(): EntityDomain {
  const asked = globalThis.location.hash.slice(1);

  return DOMAINS.find((domain) => domain === asked) ?? DOMAINS[0] ?? 'light';
}

/**
 * The glyph a domain's dialog opens with, for the domain list.
 *
 * @param domain - The domain.
 * @returns Its glyph.
 */
function domainIcon(domain: EntityDomain): UiIconId {
  const [row] = initialRows(domain);

  if (row === undefined) {
    return 'circle-dot';
  }

  const build = buildRow(row, NOW);

  return sheetKindOf(build.entity, build.state).icon;
}

/**
 * The lab.
 *
 * @returns The page.
 */
function EntityLab() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [language, setLanguage] = useState<'en' | 'it'>('en');
  const [cache] = useState(labCache);
  const [domain, setDomain] = useState(domainInAddress);
  // Each domain keeps its variants while another is looked at.
  const [rowsOf, setRowsOf] = useState<Partial<Record<EntityDomain, readonly LabRow[]>>>({});
  const [variantOf, setVariantOf] = useState<Partial<Record<EntityDomain, number>>>({});
  const rows = rowsOf[domain] ?? initialRows(domain);
  const variant = Math.min(rows.length - 1, variantOf[domain] ?? 0);
  const row = rows[variant];
  const { oneOf, may } = DOMAIN_CAPABILITIES[domain];
  const at = DOMAINS.indexOf(domain);
  const icons = useMemo(
    () => new Map(DOMAINS.map((each) => [each, domainIcon(each)] as const)),
    [],
  );

  // The page is themed by the attribute the application sets on the root (RULES.md 15.2).
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  useEffect(() => {
    void applyLanguage(language);
  }, [language]);

  // The domain shown is kept in the address, so a reload stays on it.
  useEffect(() => {
    globalThis.history.replaceState(null, '', `#${domain}`);
  }, [domain]);

  /**
   * Replaces the domain's variants.
   *
   * @param next - The variants.
   */
  const setRows = (next: readonly LabRow[]): void => {
    setRowsOf({ ...rowsOf, [domain]: next });
  };

  /**
   * Moves to the domain before or after this one.
   *
   * @param by - Back one, or on one.
   */
  const step = (by: -1 | 1): void => {
    const next = DOMAINS[(at + by + DOMAINS.length) % DOMAINS.length];

    if (next !== undefined) {
      setDomain(next);
    }
  };

  return (
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <div className="min-h-screen bg-canvas text-foreground">
          <header className="sticky top-0 z-20 border-b border-border bg-canvas/85 backdrop-blur-xl">
            <div className="mx-auto flex max-w-[1320px] items-center gap-5 px-8 py-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-primary/35 bg-primary/12 text-primary">
                <AppIcon id="sparkles" size={19} />
              </span>
              <div className="flex shrink-0 flex-col">
                <span className="text-title font-medium">Entity lab</span>
                <span className="text-caption text-foreground-subtle">
                  Development only · built from the contracts
                </span>
              </div>
              <div className="ml-4 flex min-w-0 grow items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous domain"
                  className="press-scale flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-strong text-foreground-muted transition-colors hover:text-foreground"
                  onClick={() => {
                    step(-1);
                  }}
                >
                  <AppIcon id="chevron-left" size={16} />
                </button>
                <div className="w-64">
                  <SelectField
                    label="Domain"
                    isLabelHidden
                    options={DOMAINS.map((each) => ({
                      value: each,
                      label: each,
                      leading: (
                        <AppIcon
                          id={icons.get(each) ?? 'circle-dot'}
                          size={16}
                          className="text-foreground-muted"
                        />
                      ),
                    }))}
                    value={domain}
                    onChange={(value) => {
                      const next = DOMAINS.find((each) => each === value);

                      if (next !== undefined) {
                        setDomain(next);
                      }
                    }}
                  />
                </div>
                <button
                  type="button"
                  aria-label="Next domain"
                  className="press-scale flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-strong text-foreground-muted transition-colors hover:text-foreground"
                  onClick={() => {
                    step(1);
                  }}
                >
                  <AppIcon id="chevron-right" size={16} />
                </button>
                <span className="ml-2 font-mono text-caption text-foreground-subtle tabular">
                  {at + 1} / {DOMAINS.length}
                </span>
              </div>
              <Segmented
                label="Language"
                options={[
                  { value: 'en', label: 'EN' },
                  { value: 'it', label: 'IT' },
                ]}
                value={language}
                onChange={(value) => {
                  setLanguage(value === 'it' ? 'it' : 'en');
                }}
              />
              <Segmented
                label="Theme"
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
                value={theme}
                onChange={(value) => {
                  setTheme(value === 'light' ? 'light' : 'dark');
                }}
              />
            </div>
          </header>

          <main className="mx-auto flex max-w-[1320px] flex-col gap-6 px-8 py-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-2">
                <span className="font-mono text-label tracking-[0.08em] text-foreground-subtle uppercase">
                  Entity domain
                </span>
                <h1 className="text-display-sm font-medium tracking-[-0.02em]">{domain}</h1>
                <div className="flex flex-wrap items-center gap-1.5">
                  {oneOf.map((capability) => (
                    <span
                      key={capability}
                      className="rounded-pill border border-primary/40 bg-primary/10 px-2.5 py-0.5 font-mono text-[11px] text-primary"
                    >
                      {capability}
                    </span>
                  ))}
                  {may.map((capability) => (
                    <span
                      key={capability}
                      className="rounded-pill border border-border-strong px-2.5 py-0.5 font-mono text-[11px] text-foreground-muted"
                    >
                      + {capability}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {rows.length > 1 ? (
                  <Segmented
                    label="Variant"
                    options={rows.map((each, index) => ({
                      value: String(index),
                      label:
                        index < oneOf.length
                          ? (each.capabilities[0] ?? each.id)
                          : `Variant ${String(index + 1)}`,
                    }))}
                    value={String(variant)}
                    onChange={(value) => {
                      setVariantOf({ ...variantOf, [domain]: Number(value) });
                    }}
                  />
                ) : null}
                <button
                  type="button"
                  className="press inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-pill border border-border-strong px-3.5 text-caption font-medium transition-colors hover:border-foreground-subtle"
                  onClick={() => {
                    if (row !== undefined) {
                      setRows([...rows, { ...row, id: `${row.id}-${String(rows.length)}` }]);
                      setVariantOf({ ...variantOf, [domain]: rows.length });
                    }
                  }}
                >
                  <AppIcon id="copy" size={14} />
                  Copy as a variant
                </button>
              </div>
            </div>

            {row === undefined ? null : (
              <Variant
                key={row.id}
                row={row}
                onChange={(next) => {
                  setRowsOf((current) => ({
                    ...current,
                    [domain]: (current[domain] ?? initialRows(domain)).map((each) =>
                      each.id === next.id ? next : each,
                    ),
                  }));
                }}
              />
            )}
          </main>
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <EntityLab />
      <Toaster />
    </StrictMode>,
  );
}
