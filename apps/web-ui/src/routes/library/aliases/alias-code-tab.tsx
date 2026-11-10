/**
 * The Code tab: the alias's one file of Python, shown when a part comes from code and editable in
 * developer mode with `alias:write` (the API refuses code changes otherwise; trials still run).
 *
 * The same interpreter `core` runs does the trials here, against the values of now or values
 * pretended in the Trial bar; a write over HTTP is never sent in a trial. A run draws its trace
 * in the code. Cases keep a trial's values and its result, and are run again on Save.
 */
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CODE_BUILTIN_GROUPS,
  CODE_BUILTINS,
  compile,
  formatCode,
  LANGUAGE_NOTES,
  runFunction,
  type AliasCase,
  type AliasDetail,
  type AliasPartDef,
  type AliasParts,
  type AliasView,
  type CheckResult,
  type CodeHost,
  type EntityScalar,
  type JsonObject,
  type JsonValue,
  type RunResult,
} from '@nebulahome/contracts';
import { AppIcon, Button, Menu, Note, TextField, toast, type MenuItem } from '@nebulahome/ui';

import { formatPartValue, PART_PREFIX, partValueOf } from '@/library/alias-model';
import { fetchAutomationHouse, fetchTelemetry, LIBRARY_QUERY_KEYS } from '@/library/api';
import { NO_READING, readingOf } from '@/library/entity-reading';
import type { AliasDraft } from '@/routes/library/aliases/alias-page';
import { Fold } from '@/routes/library/aliases/alias-side';
import { Ent, PyLine } from '@/routes/library/aliases/alias-text';
import { useEntityDirectory } from '@/routes/library/entity-picker/use-entity-directory';

const AliasCodeEditor = lazy(async () => import('@/routes/library/aliases/alias-code-editor'));

/** The house a trial runs in: its time zone and its position. */
type TrialHouse = {
  readonly timeZone: string;
  readonly position: { latitude: number; longitude: number } | null;
};

/** What a trial host reads beyond what is pretended. */
type HostSources = {
  /** The values pretended, by entity id or `part.<key>`. */
  readonly pretend: Readonly<Record<string, JsonValue>>;
  readonly entity: (entityId: string) => EntityScalar | null;
  readonly field: (entityId: string, field: string) => unknown;
  readonly part: (key: string) => unknown;
  readonly available: (entityId: string) => boolean;
  readonly nameOf: (entityId: string) => string | null;
  readonly unitOf: (entityId: string) => string | null;
  readonly now: () => number;
  readonly house: TrialHouse;
};

/**
 * A host for a trial: what is pretended first, then the house as it is now.
 *
 * @param sources - The pretended values and the house.
 * @returns The host.
 */
export function trialHost(sources: HostSources): CodeHost {
  const { pretend } = sources;

  return {
    /**
     * An entity's value: pretended, or as it is now.
     *
     * @param entityId - The entity.
     * @returns Its value, or null.
     */
    entity: (entityId) => {
      if (entityId in pretend) {
        const value = pretend[entityId];

        return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
          ? value
          : null;
      }

      return sources.entity(entityId);
    },
    /**
     * One field of an entity: pretended, or as it is now.
     *
     * @param entityId - The entity.
     * @param field - The field.
     * @returns The field's value, or null.
     */
    field: (entityId, field) => {
      const key = `${entityId}.${field}`;

      return key in pretend ? pretend[key] : sources.field(entityId, field);
    },
    /**
     * Another part's value: pretended, or as it is now.
     *
     * @param key - The part.
     * @returns Its value.
     */
    part: (key) => {
      const pretended = `part.${key}`;

      return pretended in pretend ? pretend[pretended] : sources.part(key);
    },
    /**
     * Whether an entity reports.
     *
     * @param entityId - The entity.
     * @returns True when it does.
     */
    available: (entityId) =>
      entityId in pretend ? pretend[entityId] !== null : sources.available(entityId),
    /**
     * When an entity last changed: not known in a trial.
     *
     * @returns Null: a trial does not know.
     */
    lastChanged: () => null,
    nameOf: sources.nameOf,
    unitOf: sources.unitOf,
    /**
     * The time the trial runs at.
     *
     * @returns Milliseconds since the epoch.
     */
    now: sources.now,
    timeZone: sources.house.timeZone,
    /**
     * Where the house is.
     *
     * @returns Its position, or null.
     */
    position: () => sources.house.position,
    /**
     * A summary of an entity's readings over the last minutes.
     *
     * @param kind - Which summary.
     * @param entityId - The entity.
     * @param minutes - How far back.
     * @returns The summary, or null when there are no readings.
     */
    history: async (kind, entityId, minutes) => {
      const to = new Date(sources.now());
      const from = new Date(to.getTime() - minutes * 60_000);
      const points = await fetchTelemetry({ entityId, from, to }, '1m');
      const values = points.map((point) => point.value);

      if (values.length === 0) {
        return null;
      }

      switch (kind) {
        case 'avg':
          return values.reduce((sum, value) => sum + value, 0) / values.length;
        case 'min':
          return Math.min(...values);
        case 'max':
          return Math.max(...values);
        case 'change':
          return (values.at(-1) ?? 0) - (values[0] ?? 0);
      }
    },
    /**
     * Sends a request from the browser.
     *
     * @param request - The request.
     * @returns The reply.
     */
    http: async (request) => {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === null ? {} : { body: request.body }),
        signal: AbortSignal.timeout(request.timeoutMs),
      });

      return {
        status: response.status,
        headers: Object.fromEntries(
          [...response.headers].map(([name, value]) => [name.toLowerCase(), value]),
        ),
        text: await response.text(),
      };
    },
  };
}

/** A case run, as Save and the Cases bar show it. */
export type CaseRun = {
  readonly id: string;
  readonly name: string;
  readonly isPassing: boolean;

  /** "expected X, got Y", or the error. */
  readonly message: string;
};

/**
 * A value as Python writes it.
 *
 * @param value - The value.
 * @returns For example `"heat"`, `True`, `None`.
 */
function pythonOf(value: JsonValue | undefined): string {
  if (value === null || value === undefined) {
    return 'None';
  }

  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }

  return JSON.stringify(value);
}

/**
 * A value typed in the Trial bar: JSON, or Python's True, False and None.
 *
 * @param text - What was typed.
 * @returns The value; the text itself when it is neither.
 */
function readTyped(text: string): JsonValue {
  const trimmed = text.trim();
  const python: Record<string, JsonValue> = { True: true, False: false, None: null };

  if (trimmed in python) {
    return python[trimmed] ?? null;
  }

  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return trimmed;
  }
}

/**
 * Runs one case of the code, alone: only what it pretends is there.
 *
 * @param code - The code.
 * @param entry - The case.
 * @param memory - The mem, when the case has none.
 * @returns How it went.
 */
export async function runCase(
  code: string,
  entry: AliasCase,
  memory: JsonObject,
): Promise<CaseRun> {
  const compiled = compile(code);

  if (!compiled.ok) {
    return {
      id: entry.id,
      name: entry.name,
      isPassing: false,
      message: compiled.problems[0]?.message ?? '',
    };
  }

  const result = await runFunction(compiled.program, entry.function, {
    host: trialHost({
      pretend: entry.inputs,
      /**
       * An entity's value: pretended, or as it is now.
       *
       * @returns Its value, or null.
       */
      entity: () => null,
      /**
       * One field of an entity: pretended, or as it is now.
       *
       * @returns The field's value, or null.
       */
      field: () => null,
      /**
       * Another part's value: pretended, or as it is now.
       *
       * @returns Its value.
       */
      part: () => null,
      /**
       * Whether an entity reports.
       *
       * @returns True when it does.
       */
      available: () => false,
      /**
       * An entity's name.
       *
       * @returns The name, or null.
       */
      nameOf: () => null,
      /**
       * An entity's unit.
       *
       * @returns The unit, or null.
       */
      unitOf: () => null,
      /**
       * The case's time, or now.
       *
       * @returns Milliseconds since the epoch.
       */
      now: () => entry.now?.getTime() ?? Date.now(),
      house: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, position: null },
    }),
    mem: Object.keys(entry.mem).length > 0 ? entry.mem : memory,
    trace: false,
    trial: true,
  });

  if (result.kind !== 'value') {
    return {
      id: entry.id,
      name: entry.name,
      isPassing: false,
      message: result.error?.message ?? result.kind,
    };
  }

  const isPassing = JSON.stringify(result.value) === JSON.stringify(entry.expected);

  return {
    id: entry.id,
    name: entry.name,
    isPassing,
    message: isPassing ? '' : `expected ${pythonOf(entry.expected)}, got ${pythonOf(result.value)}`,
  };
}

/**
 * The cases that fail, for Save to ask first.
 *
 * @param code - The code.
 * @param cases - The cases.
 * @param memory - The alias's mem.
 * @returns The failing runs.
 */
export async function failingCases(
  code: string,
  cases: readonly AliasCase[],
  memory: JsonObject,
): Promise<CaseRun[]> {
  const runs = await Promise.all(cases.map(async (entry) => runCase(code, entry, memory)));

  return runs.filter((run) => !run.isPassing);
}

/**
 * The house the trials run in.
 *
 * @returns Its time zone and position, the browser's zone while unknown.
 */
function useTrialHouse(): TrialHouse {
  const house = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.aliases, 'house'],
    /**
     * Reads the house's zone and position.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the read.
     * @returns The house.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAutomationHouse(signal),
    retry: false,
  });

  return (
    house.data ?? { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, position: null }
  );
}

/** What the tab needs. */
type AliasCodeTabProps = {
  readonly alias: AliasView;
  readonly draft: AliasDraft;
  readonly defs: readonly AliasPartDef[];
  readonly check: CheckResult;
  readonly state: unknown;

  /** Whether the code can be changed: developer mode and `alias:write`. */
  readonly canEdit: boolean;
  readonly canWrite: boolean;
  readonly isEdited: boolean;

  /** The function to open at. */
  readonly functionName: string | null;
  readonly onChange: (change: Partial<AliasDraft>) => void;
  readonly onSave: () => void;
};

/**
 * The Code tab.
 *
 * @param props - See {@link AliasCodeTabProps}.
 * @returns The tab.
 */
export function AliasCodeTab(props: AliasCodeTabProps) {
  const { t } = useTranslation();
  const {
    alias,
    draft,
    defs,
    check,
    state,
    canEdit,
    canWrite,
    isEdited,
    functionName,
    onChange,
    onSave,
  } = props;
  const { entities, readings } = useEntityDirectory(false);
  const house = useTrialHouse();
  const lastError = alias.lastError;
  const [pretend, setPretend] = useState<Record<string, JsonValue>>(() =>
    lastError?.function === null || lastError === null ? {} : { ...lastError.inputs },
  );
  const [result, setResult] = useState<(RunResult & { readonly function: string }) | null>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [runs, setRuns] = useState<ReadonlyMap<string, CaseRun>>(new Map());
  const byId = new Map(entities.map((entity) => [entity.entityId as string, entity]));
  const codeParts = defs.filter((def) => draft.parts[def.key]?.from === 'code');
  const first = codeParts[0];
  const firstConfig = first === undefined ? undefined : draft.parts[first.key];
  const current =
    functionName ??
    result?.function ??
    (firstConfig?.from === 'code' ? firstConfig.function : null);

  /**
   * An entity's scalar now.
   *
   * @param entityId - The entity.
   * @returns Its value, or null.
   */
  const scalarOf = (entityId: string): EntityScalar | null => {
    const entity = byId.get(entityId);
    const live = readings[entityId];

    if (entity === undefined || !(live?.isAvailable ?? entity.isAvailable)) {
      return null;
    }

    const value = (live?.state ?? entity.state) as Record<
      string,
      Record<string, unknown> | undefined
    >;

    for (const capability of Object.values(value)) {
      for (const field of ['value', 'isOn', 'option', 'mode', 'state', 'activity']) {
        const scalar = capability?.[field];

        if (
          typeof scalar === 'number' ||
          typeof scalar === 'boolean' ||
          typeof scalar === 'string'
        ) {
          return scalar;
        }
      }
    }

    return null;
  };

  /**
   * A part's value now.
   *
   * @param key - The part.
   * @returns Its value.
   */
  const partNow = (key: string): unknown => {
    const def = defs.find((each) => each.key === key);

    return def === undefined ? null : (partValueOf(def, state) ?? null);
  };

  const inputs = [
    ...check.reads.entityIds.map((id) => ({ key: id, now: scalarOf(id) })),
    ...check.reads.parts.map((key) => ({ key: `part.${key}`, now: partNow(key) as JsonValue })),
  ];

  const host = trialHost({
    pretend,
    entity: scalarOf,
    /**
     * One field of an entity: pretended, or as it is now.
     *
     * @param entityId - The entity.
     * @param field - The field.
     * @returns The field's value, or null.
     */
    field: (entityId, field) => {
      const entity = byId.get(entityId);
      const live = (readings[entityId]?.state ?? entity?.state) as
        Record<string, Record<string, unknown>> | undefined;

      return Object.values(live ?? {}).find((capability) => field in capability)?.[field] ?? null;
    },
    part: partNow,
    /**
     * Whether an entity reports.
     *
     * @param entityId - The entity.
     * @returns True when it does.
     */
    available: (entityId) => scalarOf(entityId) !== null,
    /**
     * An entity's name.
     *
     * @param entityId - The entity.
     * @returns The name, or null.
     */
    nameOf: (entityId) => byId.get(entityId)?.name ?? null,
    /**
     * An entity's unit.
     *
     * @param entityId - The entity.
     * @returns The unit, or null.
     */
    unitOf: (entityId) => byId.get(entityId)?.unitOfMeasurement ?? null,
    now: Date.now,
    house,
  });

  /**
   * Runs a function in a trial and draws its trace.
   *
   * @param name - The function.
   */
  const run = (name: string): void => {
    const compiled = compile(draft.code);

    if (!compiled.ok) {
      toast.error({
        title: t('library.aliasCode.cannotRun', 'It cannot run'),
        message: compiled.problems[0]?.message ?? '',
      });
      return;
    }

    void runFunction(compiled.program, name, {
      host,
      mem: alias.memory,
      trace: true,
      trial: true,
    }).then((ran) => {
      setResult({ ...ran, function: name });
    });
  };

  /** Runs every case and keeps how each went. */
  const runAll = (): void => {
    void Promise.all(
      draft.cases.map(async (entry) => runCase(draft.code, entry, alias.memory)),
    ).then((done) => {
      setRuns(new Map(done.map((each) => [each.id, each])));
    });
  };

  /** Keeps the trial as a case: its values and its result. */
  const keepCase = (): void => {
    if (result?.kind !== 'value') {
      return;
    }

    const taken = new Set(draft.cases.map((each) => each.id));
    let number = draft.cases.length + 1;

    while (taken.has(`case-${String(number)}`)) {
      number += 1;
    }

    const id = `case-${String(number)}`;
    const entry: AliasCase = {
      id,
      name: t('library.aliasCode.caseName', 'Case {{count}}', { count: draft.cases.length + 1 }),
      function: result.function,
      inputs: Object.fromEntries(
        inputs.map((input) => [input.key, pretend[input.key] ?? input.now]),
      ),
      now: null,
      mem: alias.memory,
      expected: result.value,
      fromFailureAt: lastError === null ? null : lastError.since,
    };

    onChange({ cases: [...draft.cases, entry] });
  };

  const passing = draft.cases.filter((entry) => runs.get(entry.id)?.isPassing === true).length;
  const failingLine = lastError?.line ?? null;
  const nullInput = Object.entries(lastError?.inputs ?? {}).find(
    ([, value]) => value === null,
  )?.[0];
  const assignment =
    nullInput === undefined
      ? undefined
      : draft.code
          .split('\n')
          .findIndex((line) =>
            new RegExp(
              `^\\s+[a-z_][a-z0-9_]*\\s*=\\s*${nullInput.replace('.', '\\.')}\\s*$`,
              'u',
            ).test(line),
          );
  const assignedLine =
    assignment === undefined || assignment < 0 ? undefined : draft.code.split('\n')[assignment];
  const variable =
    assignedLine === undefined ? undefined : /^\s+([a-z_][a-z0-9_]*)/u.exec(assignedLine)?.[1];

  /** Puts `if x is None: return None` under the assignment that read the silent input. */
  const insertCheck = (): void => {
    if (
      assignment === undefined ||
      assignment < 0 ||
      variable === undefined ||
      assignedLine === undefined
    ) {
      return;
    }

    const indent = /^\s*/u.exec(assignedLine)?.[0] ?? '    ';
    const lines = draft.code.split('\n');

    lines.splice(assignment + 1, 0, `${indent}if ${variable} is None:`, `${indent}    return None`);
    onChange({ code: lines.join('\n') });
  };

  const isFailing = result !== null && result.kind !== 'value';

  return (
    <div className="flex flex-col gap-4">
      {canWrite && !canEdit ? (
        <Note tone="accent">
          {t(
            'library.aliasCode.readOnly',
            'This alias keeps running. Turn on developer mode in Settings › Software to edit its code.',
          )}
        </Note>
      ) : null}
      {/* Not overflow-hidden: the menu of a case opens past the bottom edge. */}
      <div className="flex flex-col rounded-panel border border-border bg-[color-mix(in_oklab,var(--color-canvas)_74%,black)]">
        <div className="flex items-center gap-2.5 rounded-t-panel border-b border-border bg-canvas px-4 py-2">
          <AppIcon id="braces" size={14} className="text-foreground-subtle" />
          <span className="text-ui-sm font-medium text-foreground">
            {t('library.aliasPage.code', 'Code')}
          </span>
          {isEdited ? (
            <span
              title={t('library.aliasCode.unsaved', 'Unsaved')}
              className="size-2 rounded-full bg-warning"
            />
          ) : null}
          <span className="text-caption text-foreground-subtle">
            {t('library.aliasCode.subset', 'Python · subset')}
          </span>
          <span className="grow" />
          {canEdit ? (
            <Button
              variant="bare"
              size="compact"
              onClick={() => {
                onChange({ code: formatCode(draft.code) });
              }}
            >
              <AppIcon id="text-align-start" size={13} />
              {t('library.aliasCode.format', 'Format')}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-canvas/60 px-4 py-2.5">
          <span className="mr-1 text-caption text-foreground-subtle">
            {t('library.aliasCode.trial', 'Trial')}
          </span>
          {inputs.length === 0 ? (
            <span className="text-caption text-foreground-subtle">
              {t('library.aliasCode.noInputs', 'It reads nothing')}
            </span>
          ) : null}
          {inputs.map((input) => {
            const isChanged = input.key in pretend;
            const shown = pythonOf(isChanged ? pretend[input.key] : input.now);

            return (
              <span
                key={input.key}
                className={`flex items-center gap-2 rounded-pill border py-0.5 pr-1 pl-2.5 ${
                  isChanged ? 'border-warning/50 bg-warning/[0.06]' : 'border-border bg-surface'
                }`}
              >
                <span className="font-mono text-mono-caption">
                  {input.key.startsWith('part.') ? (
                    <>
                      <span className="text-foreground-muted">{PART_PREFIX}</span>
                      <span className="text-violet">{input.key.slice(5)}</span>
                    </>
                  ) : (
                    <Ent id={input.key} />
                  )}
                </span>
                <input
                  aria-label={t('library.aliasCode.pretend', 'Value of {{name}} for the trial', {
                    name: input.key,
                  })}
                  className="w-20 rounded-pill bg-canvas px-2 py-0.5 text-caption text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                  value={shown}
                  onChange={(event) => {
                    setPretend({ ...pretend, [input.key]: readTyped(event.target.value) });
                  }}
                />
                {isChanged ? (
                  <button
                    type="button"
                    aria-label={t('library.aliasCode.backToNow', 'Back to the value now')}
                    className="text-foreground-subtle transition-colors hover:text-foreground"
                    onClick={() => {
                      const next = { ...pretend };
                      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- a pretended value is dropped by its key
                      delete next[input.key];
                      setPretend(next);
                    }}
                  >
                    <AppIcon id="rotate-ccw" size={12} />
                  </button>
                ) : null}
              </span>
            );
          })}
          <span className="grow" />
          {current === null ? null : (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                run(current);
              }}
            >
              <AppIcon id="play" size={13} />
              {current}()
              <span className="font-mono text-label text-foreground-subtle">
                {t('library.aliasCode.ctrlEnter', 'Ctrl ↵')}
              </span>
            </Button>
          )}
          {result === null ? null : (
            <span
              className={`flex items-center gap-2 rounded-pill border px-3 py-1 text-ui-sm ${
                isFailing
                  ? 'border-danger/40 bg-danger/[0.08]'
                  : 'border-success/40 bg-success/[0.08]'
              }`}
            >
              <span className="text-foreground-subtle">
                {t('library.aliasCode.result', 'Result')}
              </span>
              <span className="font-mono font-semibold text-foreground">
                {result.kind === 'value' ? pythonOf(result.value) : result.kind}
              </span>
            </span>
          )}
        </div>

        <Suspense fallback={<div className="h-80" />}>
          <AliasCodeEditor
            label={t('library.aliasPage.code', 'Code')}
            value={draft.code}
            onChange={(code) => {
              onChange({ code });
              setResult(null);
            }}
            isReadOnly={!canEdit}
            problems={check.problems}
            entities={entities.map((entity) => ({ id: entity.entityId, name: entity.name }))}
            parts={Object.keys(draft.parts)}
            describe={(word) => {
              const entity = byId.get(word);

              if (entity !== undefined) {
                return {
                  title: word,
                  body: `${entity.name}\n${readingOf(entity, readings[word]).text} · ${pythonOf(scalarOf(word))} here`,
                };
              }

              const builtin = CODE_BUILTINS.find((entry) => entry.name === word);

              return builtin === undefined
                ? null
                : { title: builtin.signature, body: `${builtin.summary}\n${builtin.example}` };
            }}
            trace={result?.trace ?? null}
            onRun={run}
            onSave={onSave}
            onCursor={(line, column) => {
              setCursor({ line, column });
            }}
            focus={functionName}
          />
        </Suspense>

        {result?.prints.length === undefined || result.prints.length === 0 ? null : (
          <div className="flex flex-col gap-0.5 border-t border-border bg-canvas px-4 py-2 font-mono text-mono-caption text-foreground-muted">
            {result.prints.map((line) => (
              <span key={`${String(line.line)}:${line.text}`}>
                <span className="text-foreground-subtle">{line.line} · </span>
                {line.text}
              </span>
            ))}
          </div>
        )}

        {lastError !== null && lastError.line !== null ? (
          <div className="flex items-start gap-3 border-t border-border bg-canvas px-4 py-3.5">
            <AppIcon id="octagon-alert" size={16} className="mt-0.5 shrink-0 text-danger" />
            <span className="flex min-w-0 grow flex-col gap-1">
              <span className="text-ui-sm text-foreground">
                {t('library.aliasPage.errorAtLine', '{{message}} · line {{line}}', {
                  message: lastError.message,
                  line: lastError.line,
                })}
              </span>
              {nullInput === undefined ? null : (
                <span className="text-caption text-foreground-subtle">
                  <span className="font-mono">
                    <Ent id={nullInput} />
                  </span>{' '}
                  {t('library.aliasCode.silent', 'was None')}
                </span>
              )}
              {variable === undefined ? null : (
                <span className="mt-1 self-start rounded-[8px] border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px]">
                  <PyLine text={`if ${variable} is None:`} /> <PyLine text="return None" />
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  setPretend({ ...lastError.inputs });

                  if (lastError.function !== null) {
                    run(lastError.function);
                  }
                }}
              >
                <AppIcon id="rotate-ccw" size={13} />
                {t('library.aliasCode.replay', 'Replay')}
              </Button>
              {variable === undefined || !canEdit ? null : (
                <Button variant="ghost" size="compact" onClick={insertCheck}>
                  <AppIcon id="plus" size={13} />
                  {t('library.aliasCode.insertCheck', 'Insert the check')}
                </Button>
              )}
            </span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-canvas px-4 py-2.5">
          <span className="mr-1 text-caption text-foreground-subtle">
            {runs.size === 0
              ? t('library.aliasCode.cases', 'Cases · {{count}}', { count: draft.cases.length })
              : t('library.aliasCode.casesPassing', 'Cases · {{passing}} of {{count}}', {
                  passing,
                  count: draft.cases.length,
                })}
          </span>
          {draft.cases.map((entry) => {
            const ran = runs.get(entry.id);
            const items: MenuItem[] = [
              {
                label: t('library.aliasCode.loadCase', 'Load into the trial'),
                icon: 'upload',
                /** Load into the trial. */
                onSelect: () => {
                  setPretend({ ...entry.inputs });
                  run(entry.function);
                },
              },
              ...(canEdit && result?.kind === 'value'
                ? [
                    {
                      label: t('library.aliasCode.updateExpected', 'Update expected'),
                      icon: 'check' as const,
                      /** Update expected. */
                      onSelect: () => {
                        onChange({
                          cases: draft.cases.map((each) =>
                            each.id === entry.id ? { ...each, expected: result.value } : each,
                          ),
                        });
                      },
                    },
                  ]
                : []),
              ...(canEdit
                ? [
                    {
                      label: t('common.delete', 'Delete'),
                      icon: 'trash-2' as const,
                      tone: 'danger' as const,
                      /** Delete. */
                      onSelect: () => {
                        onChange({ cases: draft.cases.filter((each) => each.id !== entry.id) });
                      },
                    },
                  ]
                : []),
            ];

            return (
              <Menu
                key={entry.id}
                items={items}
                align="start"
                trigger={({ isOpen, toggle, buttonRef }) => (
                  <button
                    ref={buttonRef}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    title={ran?.message}
                    onClick={toggle}
                    className={`flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-caption ${
                      ran !== undefined && !ran.isPassing
                        ? 'border-danger/40 bg-danger/[0.06] text-danger'
                        : 'border-border text-foreground-muted'
                    }`}
                  >
                    <AppIcon
                      id={
                        ran === undefined ? 'circle' : ran.isPassing ? 'circle-check' : 'circle-x'
                      }
                      size={12}
                      className={
                        ran === undefined
                          ? 'text-foreground-subtle'
                          : ran.isPassing
                            ? 'text-success'
                            : 'text-danger'
                      }
                    />
                    {entry.name}
                  </button>
                )}
              />
            );
          })}
          <span className="grow" />
          {draft.cases.length === 0 ? null : (
            <Button variant="bare" size="compact" onClick={runAll}>
              <AppIcon id="play" size={13} />
              {t('library.aliasCode.runCases', 'Run the cases')}
            </Button>
          )}
          {canEdit ? (
            <Button
              variant="bare"
              size="compact"
              disabled={result?.kind !== 'value'}
              onClick={keepCase}
            >
              <AppIcon id="plus" size={13} />
              {t('library.aliasCode.trialAsCase', 'Trial as a case')}
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-4 rounded-b-panel border-t border-border bg-canvas px-3 py-1.5 font-mono text-label text-foreground-subtle">
          {check.problems.length > 0 ? (
            <span className="flex items-center gap-1.5 text-danger">
              <AppIcon id="triangle-alert" size={12} />
              {t('library.aliasCode.problemAt', {
                count: check.problems.length,
                line: check.problems[0]?.line ?? 1,
                defaultValue_one: '{{count}} problem · line {{line}}',
                defaultValue_other: '{{count}} problems · line {{line}}',
              })}
            </span>
          ) : result?.trace === undefined ? (
            <span className="flex items-center gap-1.5 text-success">
              <AppIcon id="check" size={12} />
              {t('library.aliasCode.noProblems', 'No problems')}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-success">
              <span className="size-1.5 rounded-full bg-success" />
              {t('library.aliasCode.path', 'Path · lines {{lines}}', {
                lines: result.trace.executedLines.slice(0, 12).join(', '),
              })}
            </span>
          )}
          {result === null ? null : (
            <span>{t('library.aliasCode.duration', '{{ms}} ms', { ms: result.cpuMs })}</span>
          )}
          <span>{t('library.aliasCode.position', 'Ln {{line}}, Col {{column}}', cursor)}</span>
          <span className="grow" />
          {failingLine === null ? null : (
            <span className="text-danger">
              {t('library.aliasCode.failingAt', 'Failing at line {{line}}', { line: failingLine })}
            </span>
          )}
          {isEdited ? (
            <span className="text-warning">{t('library.aliasCode.unsaved', 'Unsaved')}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * A heading of the Docs fold.
 *
 * @param props - The words.
 * @param props.children - The words.
 * @returns The heading.
 */
function DocsHead(props: { readonly children: ReactNode }) {
  return (
    <span className="pb-1 font-mono text-label text-foreground-subtle uppercase">
      {props.children}
    </span>
  );
}

/**
 * One name and its value.
 *
 * @param props - The name and the value.
 * @param props.name - The name.
 * @param props.value - The value.
 * @returns The row.
 */
function DocsValue(props: { readonly name: ReactNode; readonly value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 font-mono text-[12px]">
      <span className="min-w-0 truncate">{props.name}</span>
      <span className="shrink-0 text-foreground-muted">{props.value}</span>
    </div>
  );
}

/** What the code's folds need. */
type CodeSideFoldsProps = {
  readonly code: string;
  readonly check: CheckResult;
  readonly inputs: AliasDetail['inputs'];
  readonly parts: AliasParts;
  readonly defs: readonly AliasPartDef[];
  readonly state: unknown;
  readonly memory: JsonObject;
  readonly functionName: string | null;
  readonly canEdit: boolean;
  readonly onInsert: (snippet: string) => void;
};

/**
 * The folds the Code tab adds to the side card: Docs and Functions.
 *
 * @param props - See {@link CodeSideFoldsProps}.
 * @returns The folds.
 */
export function CodeSideFolds(props: CodeSideFoldsProps) {
  const { t } = useTranslation();
  const { check, inputs, parts, defs, state, memory, functionName, canEdit, onInsert } = props;
  const { entities, readings } = useEntityDirectory(false);
  const [query, setQuery] = useState('');
  const byId = new Map(entities.map((entity) => [entity.entityId as string, entity]));
  const wanted = query.trim().toLowerCase();
  const bound = Object.values(parts).find((part) => part.from === 'code');
  const shown = functionName ?? (bound?.from === 'code' ? bound.function : null);
  const fn = check.functions.find((each) => each.name === shown);
  const notes = LANGUAGE_NOTES.filter(
    (note) => wanted === '' || note.toLowerCase().includes(wanted),
  );
  const builtins = CODE_BUILTINS.filter(
    (entry) =>
      wanted === '' ||
      entry.name.toLowerCase().includes(wanted) ||
      entry.summary.toLowerCase().includes(wanted),
  );

  return (
    <>
      <Fold title={t('library.aliasCode.docs', 'Docs')} isOpen>
        <div className="flex flex-col gap-4">
          <TextField
            label={t('library.aliasCode.searchDocs', 'Search the docs')}
            isLabelHidden
            size="compact"
            placeholder={t('library.aliases.search', 'Search')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          {wanted === '' ? (
            <>
              <div className="flex flex-col">
                <DocsHead>{t('library.aliasPage.inputs', 'Inputs')}</DocsHead>
                {inputs.length === 0 ? (
                  <span className="text-caption text-foreground-subtle">—</span>
                ) : (
                  inputs.map((input) => {
                    const entity = byId.get(input.entityId);

                    return (
                      <DocsValue
                        key={input.entityId}
                        name={<Ent id={input.entityId} isMissing={!input.isPresent} />}
                        value={
                          entity === undefined
                            ? NO_READING
                            : readingOf(entity, readings[input.entityId]).text
                        }
                      />
                    );
                  })
                )}
              </div>
              <div className="flex flex-col">
                <DocsHead>{t('library.aliasPage.parts', 'Parts')}</DocsHead>
                {defs
                  .filter((def) => parts[def.key] !== undefined)
                  .map((def) => (
                    <DocsValue
                      key={def.key}
                      name={
                        <>
                          <span className="text-foreground-muted">{PART_PREFIX}</span>
                          <span className="text-violet">{def.key}</span>
                        </>
                      }
                      value={formatPartValue(def, partValueOf(def, state))}
                    />
                  ))}
              </div>
              {fn === undefined ? null : (
                <div className="flex flex-col gap-1.5">
                  <DocsHead>
                    {t('library.aliasCode.returnValues', 'Return values · {{name}}()', {
                      name: fn.name,
                    })}
                  </DocsHead>
                  <span className="flex flex-wrap gap-1">
                    {fn.literalReturns.map((value) => (
                      <span
                        key={String(value)}
                        className="rounded-[5px] border border-border bg-canvas px-1.5 font-mono text-mono-caption text-success"
                      >
                        {pythonOf(value)}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {Object.keys(memory).length === 0 ? null : (
                <div className="flex flex-col">
                  <DocsHead>{t('library.aliasCode.memory', 'Memory · mem')}</DocsHead>
                  {Object.entries(memory).map(([key, value]) => (
                    <DocsValue
                      key={key}
                      name={`mem["${key}"]`}
                      value={JSON.stringify(value).slice(0, 40)}
                    />
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <DocsHead>{t('library.aliasCode.entityAccess', 'Entity access')}</DocsHead>
                <pre className="m-0 rounded-[8px] border border-border bg-canvas px-2.5 py-2 font-mono text-[12px] leading-[19px] whitespace-pre">
                  <PyLine text="room = sensor.office_temperature" />
                  {'\n'}
                  <PyLine text="if room is None:" />
                  {'\n'}
                  <PyLine text="    return None" />
                </pre>
              </div>
            </>
          ) : null}
          {wanted === '' || notes.length === 0 ? null : (
            <div className="flex flex-col gap-1.5">
              <DocsHead>{t('library.aliasCode.language', 'Language')}</DocsHead>
              {notes.map((note) => (
                <p key={note} className="text-caption text-foreground-muted">
                  {note}
                </p>
              ))}
            </div>
          )}
          {wanted === '' ? null : (
            <BuiltinList entries={builtins} canEdit={canEdit} onInsert={onInsert} />
          )}
        </div>
      </Fold>
      <Fold
        title={t('library.aliasCode.functions', 'Functions')}
        meta={String(CODE_BUILTINS.length)}
      >
        <div className="flex flex-col gap-4">
          {CODE_BUILTIN_GROUPS.map((group) => (
            <div key={group} className="flex flex-col gap-1.5">
              <DocsHead>{group}</DocsHead>
              <BuiltinList
                entries={CODE_BUILTINS.filter((entry) => entry.group === group)}
                canEdit={canEdit}
                onInsert={onInsert}
              />
            </div>
          ))}
        </div>
      </Fold>
    </>
  );
}

/**
 * Builtins, each with its signature, line, example and Insert.
 *
 * @param props - The builtins and what Insert does.
 * @param props.entries - The builtins.
 * @param props.canEdit - Whether Insert is offered.
 * @param props.onInsert - Inserts an example.
 * @returns The list.
 */
function BuiltinList(props: {
  readonly entries: readonly (typeof CODE_BUILTINS)[number][];
  readonly canEdit: boolean;
  readonly onInsert: (snippet: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2.5">
      {props.entries.map((entry) => (
        <div key={entry.name} className="flex flex-col gap-0.5">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[12px] text-primary-hover">
              {entry.signature}
            </span>
            {props.canEdit ? (
              <Button
                variant="bare"
                size="compact"
                onClick={() => {
                  props.onInsert(`    ${entry.example}`);
                }}
              >
                {t('library.aliasCode.insert', 'Insert')}
              </Button>
            ) : null}
          </span>
          <span className="text-caption text-foreground-muted">{entry.summary}</span>
          <span className="font-mono text-mono-caption text-foreground-subtle">
            <PyLine text={entry.example} />
          </span>
        </div>
      ))}
    </div>
  );
}
