/**
 * The entity lab (`pnpm dev:entity`, development only): every domain the contracts define, one
 * row per way its entity may be, with its capabilities, params and state as switches and fields on
 * the left and the entity dialog drawn from them on the right.
 *
 * Nothing on this page lists a domain, a capability or a field: the domains are
 * `ENTITY_DOMAINS`, what each carries is `DOMAIN_CAPABILITIES`, each capability's fields are its
 * schemas. A domain or a capability added to the contracts appears here as it is.
 */
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
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
import { BUILTIN_UI_FRAME, BUILTIN_UI_NODES, cn, Segmented, Switch, Toaster } from '@nebulahome/ui';

import { applyLanguage } from '@/i18n/language';
import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { EntitySheet } from '@/routes/library/entity/sheet/entity-sheet';
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
    anArea('kitchen', 'room', 'ground'),
    anArea('office', 'room', 'ground'),
  ]);
  client.setQueryData(LIBRARY_QUERY_KEYS.tags, [aTag('evening'), aTag('cooking')]);
  client.setQueryData([...LIBRARY_QUERY_KEYS.icons, 'search', ''], icons);

  return client;
}

/** A small input's look. */
const INPUT =
  'h-7 min-w-0 rounded-chip border border-border-strong bg-surface-raised px-2 text-caption text-foreground';

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
              className="w-28 accent-primary"
            />
          ) : null}
          <input
            type="number"
            className={cn(INPUT, 'w-20')}
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
          className={cn(INPUT, 'w-44')}
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
                  'h-6 cursor-pointer rounded-pill border px-2 text-caption',
                  isOn
                    ? 'border-primary/50 bg-primary/12 text-primary'
                    : 'border-border-strong text-foreground-subtle',
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
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            className={cn(INPUT, 'w-7 cursor-pointer')}
            onClick={() => {
              resize(list.length - 1);
            }}
          >
            −
          </button>
          <span className="w-6 text-center font-mono text-caption tabular">{list.length}</span>
          <button
            type="button"
            className={cn(INPUT, 'w-7 cursor-pointer')}
            onClick={() => {
              resize(list.length + 1);
            }}
          >
            +
          </button>
        </span>
      );
    }
    case 'json': {
      return (
        <input
          className={cn(INPUT, 'w-44 font-mono')}
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
 * A capability's params or state: one line per field, with a switch for whether an optional one
 * is there and for whether a nullable one is null.
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
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] text-foreground-subtle uppercase">{title}</span>
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
          <div key={field.key} className="flex min-h-8 items-center justify-between gap-2">
            <label className="flex min-w-0 items-center gap-1.5">
              {isOptional ? (
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={isPresent}
                  onChange={(event) => {
                    set(event.target.checked ? firstValue(field) : undefined);
                  }}
                />
              ) : (
                <span
                  title={field.isRequired ? 'Required' : 'Has a default'}
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
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
                  <label className="flex items-center gap-1 font-mono text-[10px] text-foreground-subtle">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={value === null}
                      onChange={(event) => {
                        set(event.target.checked ? null : (firstValue(field) ?? 'Sample'));
                      }}
                    />
                    null
                  </label>
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

/** What one row needs. */
type RowProps = {
  readonly row: LabRow;
  readonly onChange: (row: LabRow) => void;
};

/**
 * One entity being tried: its switches and fields on the left, its dialog on the right.
 *
 * @param props - See {@link RowProps}.
 * @returns The row.
 */
function LabRowView(props: RowProps) {
  const { row, onChange } = props;
  const [range, setRange] = useState<SheetRange>('24h');
  const [busy, setBusy] = useState<ReadonlySet<CapabilityName>>(new Set());
  const [closed, setClosed] = useState(false);
  const [reportedAt, setReportedAt] = useState(NOW);
  const rowRef = useRef(row);
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
  const telemetry = labTelemetry(build.entity, range, window);
  const { oneOf, may } = DOMAIN_CAPABILITIES[row.domain];
  const classes = deviceClassesOf(row.domain);

  /**
   * Sends a command the way a device that obeys would answer it: a moment's wait, then the state.
   *
   * @param capability - The capability.
   * @param command - The command.
   */
  const send = (capability: CapabilityName, command: JsonObject): void => {
    setBusy((current) => new Set([...current, capability]));
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
      setBusy((current) => new Set([...current].filter((each) => each !== capability)));
    }, 700);
  };

  return (
    <div className="grid grid-cols-[360px_minmax(0,1fr)] gap-8 border-t border-border py-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-label text-foreground-subtle uppercase">
            Capabilities
          </span>
          {[...oneOf, ...may].map((capability) => {
            const isOn = row.capabilities.includes(capability);
            const isOneOf = oneOf.includes(capability);

            return (
              <label key={capability} className="flex h-7 items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-mono text-caption">
                  {capability}
                  <span
                    className={cn(
                      'rounded-chip border px-1.5 text-[10px] uppercase',
                      isOneOf
                        ? 'border-primary/45 text-primary'
                        : 'border-foreground-muted/45 text-foreground-muted',
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
                    className="accent-primary"
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
        </div>

        {row.capabilities.map((capability) => {
          const fields = capabilityFields(capability);

          return (
            <details
              key={capability}
              open
              className="flex flex-col gap-2 rounded-panel border border-border bg-surface p-3"
            >
              <summary className="cursor-pointer font-mono text-caption text-foreground-muted">
                {capability}
              </summary>
              <div className="mt-2 flex flex-col gap-3">
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

        <div className="flex flex-col gap-1.5 rounded-panel border border-border bg-surface p-3">
          <span className="font-mono text-[10px] text-foreground-subtle uppercase">Entity</span>
          <label className="flex h-8 items-center justify-between gap-2 font-mono text-caption">
            device_class
            {classes === null ? (
              <input
                className={cn(INPUT, 'w-44')}
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
          <label className="flex h-8 items-center justify-between gap-2 font-mono text-caption">
            unit
            <input
              className={cn(INPUT, 'w-24')}
              value={row.unit ?? ''}
              onChange={(event) => {
                onChange({ ...row, unit: event.target.value === '' ? null : event.target.value });
              }}
            />
          </label>
          <label className="flex h-8 items-center justify-between gap-2 font-mono text-caption">
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
        </div>

        <div className="flex flex-col gap-1 rounded-panel border border-border bg-surface p-3">
          <span className="font-mono text-[10px] text-foreground-subtle uppercase">
            Every entity
          </span>
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
              className="flex h-7 items-center justify-between font-mono text-caption"
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
          <label className="flex h-7 items-center justify-between font-mono text-caption">
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
        </div>
      </div>

      <div className="flex flex-col items-start gap-4">
        {closed ? (
          <button
            type="button"
            className="h-9 cursor-pointer rounded-pill border border-border-strong px-4 text-ui"
            onClick={() => {
              setClosed(false);
            }}
          >
            Open the dialog again
          </button>
        ) : (
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
            }}
            battery={row.battery}
            now={NOW}
            deviceName="Living room lamp"
            onClose={() => {
              setClosed(true);
            }}
            onSave={(change) => {
              onChange({
                ...row,
                ...(change.isEnabled === undefined ? {} : { isEnabled: change.isEnabled }),
              });
            }}
            onEnable={() => {
              onChange({ ...row, isEnabled: true });
            }}
          />
        )}
        {build.issues.length === 0 ? null : (
          <ul className="flex max-w-[400px] flex-col gap-1 rounded-tile border border-danger/40 bg-danger/8 p-3 font-mono text-caption text-danger">
            {build.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** What a domain's section needs. */
type DomainSectionProps = { readonly domain: EntityDomain };

/**
 * A domain: its name, what it carries, and its rows - one per must-have capability to start
 * with, and as many more as are added to compare.
 *
 * @param props - See {@link DomainSectionProps}.
 * @returns The section.
 */
function DomainSection(props: DomainSectionProps) {
  const { domain } = props;
  const [rows, setRows] = useState(() => initialRows(domain));
  const { oneOf, may } = DOMAIN_CAPABILITIES[domain];

  return (
    <section id={domain} className="scroll-mt-20 py-10">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-label text-foreground-subtle uppercase">
            Entity domain
          </span>
          <h2 className="text-display-sm font-medium">{domain}</h2>
          <span className="font-mono text-caption text-foreground-muted">
            {oneOf.join(' | ')}
            {may.length === 0 ? '' : ` + ${may.join(', ')}`}
          </span>
        </div>
        <button
          type="button"
          className="h-8 cursor-pointer rounded-pill border border-border-strong px-3 text-caption"
          onClick={() => {
            const last = rows.at(-1);

            if (last !== undefined) {
              setRows([...rows, { ...last, id: `${last.id}-${String(rows.length)}` }]);
            }
          }}
        >
          Add a variant
        </button>
      </div>
      {rows.map((row, index) => (
        <LabRowView
          key={row.id}
          row={row}
          onChange={(next) => {
            setRows(rows.map((each, at) => (at === index ? next : each)));
          }}
        />
      ))}
    </section>
  );
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

  // The page is themed by the attribute the application sets on the root (RULES.md 15.2).
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  useEffect(() => {
    void applyLanguage(language);
  }, [language]);

  return (
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <div className="min-h-screen bg-canvas text-foreground">
          <header className="sticky top-0 z-10 flex items-center gap-6 border-b border-border bg-canvas/90 px-8 py-3 backdrop-blur">
            <div className="flex shrink-0 flex-col">
              <span className="text-title font-medium">Entity lab</span>
              <span className="text-caption text-foreground-subtle">
                Development only · built from the contracts
              </span>
            </div>
            <nav className="flex min-w-0 grow flex-wrap gap-x-3 gap-y-1">
              {ENTITY_DOMAINS.map((domain) => (
                <a
                  key={domain}
                  href={`#${domain}`}
                  className="font-mono text-caption text-foreground-muted hover:text-foreground"
                >
                  {domain}
                </a>
              ))}
            </nav>
            <Segmented
              label="Language"
              size="compact"
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
              size="compact"
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
              value={theme}
              onChange={(value) => {
                setTheme(value === 'light' ? 'light' : 'dark');
              }}
            />
          </header>
          <main className="px-8">
            {ENTITY_DOMAINS.map((domain) => (
              <DomainSection key={domain} domain={domain} />
            ))}
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
