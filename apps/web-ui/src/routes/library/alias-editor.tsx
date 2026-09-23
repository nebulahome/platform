/**
 * Making an alias or changing one: calculated formula, or stored helper.
 *
 * A page rather than a dialog — same shell as the automation editor — because formula, sources
 * and the entity picker need room: on a wide window the formula is on the left and its sources on
 * the right, as the design lays them out, and the formula says what it reads now as it is typed. Create and edit share this screen; the only differences are
 * where the draft starts and which verb the save uses.
 *
 * The name is the only editable identity field. Under it, in caption, sits `alias.<objectId>`:
 * derived from the name on create, the saved address on edit. Enabled is not on the form: a
 * create is born enabled, and a save does not touch standing.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';

import {
  ALIAS_CALCULATED_CAPABILITIES,
  ALIAS_FALLBACK_POLICIES,
  ALIAS_STORED_DOMAINS,
  SENSOR_CLASS_LIST,
  aliasDependentSchema,
  findSensorUnit,
  getSensorClass,
  storedCapabilitiesForDomain,
  type AliasCapabilityInput,
  type AliasCreate,
  type AliasFallbackPolicy,
  type AliasStoredDomain,
  type AliasUpdate,
  type AliasView,
  type CapabilityName,
  type EntityView,
} from '@nebula-home/contracts';
import { Button, Panel, Segmented, SelectField, TextField } from '@nebula-home/ui';

import { isApiError } from '@/lib/api-error';
import { toMessage } from '@/lib/error-message';
import { readFormula, sourceColors, toSources, type SourceDraft } from '@/library/alias-sources';
import {
  createAlias,
  deleteAlias,
  fetchAliases,
  fetchEntities,
  LIBRARY_QUERY_KEYS,
  updateAlias,
} from '@/library/api';
import { toKey } from '@/library/automation-draft';
import { useLive } from '@/live/live-store';
import { AliasFormulaField } from '@/routes/library/alias-formula-field';
import { AliasSourcesPanel, nextRowKey } from '@/routes/library/alias-sources-panel';
import { ConfirmRemoval } from '@/routes/library/confirm-removal';

/** Calculated capabilities the form may pick. */
type CalculatedCapability = (typeof ALIAS_CALCULATED_CAPABILITIES)[number];

const CALCULATED_OPTIONS = ALIAS_CALCULATED_CAPABILITIES.map((capability) => ({
  value: capability,
  label: capability.replaceAll('_', ' '),
}));

const FALLBACK_OPTIONS = ALIAS_FALLBACK_POLICIES.map((policy) => ({
  value: policy,
  label: policy.replaceAll('_', ' '),
}));

const DOMAIN_OPTIONS = ALIAS_STORED_DOMAINS.map((domain) => ({
  value: domain,
  label: domain === 'media_player' ? 'media player' : domain === 'climate' ? 'climate' : domain,
}));

const DEVICE_CLASS_OPTIONS = [
  { value: '', label: 'None' },
  ...SENSOR_CLASS_LIST.map((entry) => ({ value: entry.id, label: entry.label })),
];

const LIGHT_OPTIONAL: readonly CapabilityName[] = ['level', 'color_hs', 'color_temp'];

/**
 * An object id from a name: lower case, underscores, starting with a letter.
 *
 * @param name - What the owner typed.
 * @returns A candidate that satisfies {@link aliasObjectIdSchema}, or blank.
 */
function toObjectId(name: string): string {
  const raw = toKey(name);

  if (/^[a-z][a-z0-9_]{0,63}$/u.test(raw)) {
    return raw;
  }

  const stripped = raw.replace(/^[^a-z]+/u, '');

  if (/^[a-z][a-z0-9_]{0,63}$/u.test(stripped)) {
    return stripped.slice(0, 64);
  }

  const padded = `a_${raw}`.replaceAll(/[^a-z0-9_]/gu, '').slice(0, 64);

  return /^[a-z][a-z0-9_]{0,63}$/u.test(padded) ? padded : 'alias';
}

/**
 * Capabilities a stored helper of this domain should declare from the form.
 *
 * @param domain - The behavioural domain.
 * @param lightExtras - Optional light capabilities that are on.
 * @returns Capability inputs for create/update.
 */
function storedCapabilities(
  domain: AliasStoredDomain,
  lightExtras: ReadonlySet<CapabilityName>,
): AliasCapabilityInput[] {
  const allowed = storedCapabilitiesForDomain(domain);

  if (domain === 'switch') {
    return [{ capability: 'on_off', params: {} }];
  }

  if (domain === 'light') {
    return [
      { capability: 'on_off', params: {} },
      ...LIGHT_OPTIONAL.filter((name) => allowed.has(name) && lightExtras.has(name)).map(
        (capability) => ({ capability, params: {} }),
      ),
    ];
  }

  if (domain === 'sensor') {
    return [{ capability: 'sensor_numeric', params: {} }];
  }

  if (domain === 'cover') {
    return [{ capability: 'cover', params: {} }];
  }

  if (domain === 'lock') {
    return [{ capability: 'lock', params: {} }];
  }

  if (domain === 'climate') {
    return [{ capability: 'thermostat', params: {} }];
  }

  return [{ capability: 'media_player', params: {} }];
}

/**
 * Optional light capabilities already on an alias.
 *
 * @param alias - The alias being edited.
 * @returns The extras that are declared.
 */
function lightExtrasOf(alias: AliasView | undefined): Set<CapabilityName> {
  const next = new Set<CapabilityName>();

  for (const name of alias?.capabilities ?? []) {
    if (LIGHT_OPTIONAL.includes(name)) {
      next.add(name);
    }
  }

  return next;
}

/**
 * Unit options for the chosen device class.
 *
 * @param deviceClass - The class id, or blank.
 * @returns Select options; empty when there is no class.
 */
function unitOptionsFor(deviceClass: string): { value: string; label: string }[] {
  const entry = getSensorClass(deviceClass);

  if (entry === undefined) {
    return [];
  }

  return entry.units.map((unit) => ({
    value: unit.id,
    label: unit.symbol === unit.id ? unit.symbol : `${unit.symbol} (${unit.id})`,
  }));
}

/**
 * Seeds sources from an existing alias.
 *
 * @param alias - The alias being edited, when there is one.
 * @returns The draft rows.
 */
function sourcesFrom(alias: AliasView | undefined): SourceDraft[] {
  if (alias === undefined || alias.sources.length === 0) {
    return [{ rowKey: nextRowKey(), variableName: 't1', entityId: '' }];
  }

  return alias.sources.map((source) => ({
    rowKey: nextRowKey(),
    variableName: source.variableName,
    entityId: source.entityId,
  }));
}

/**
 * Says why a deletion failed, naming the aliases that still read this one when the API says.
 *
 * The refusal is a conflict whose details list the readers - to somebody who may see aliases;
 * to anybody else it carries no names, and the API's own sentence is all there is to show.
 *
 * @param error - What the deletion threw.
 * @returns The sentence to show.
 */
export function removalMessage(error: unknown): string {
  const dependents = isApiError(error)
    ? z.array(aliasDependentSchema).safeParse(error.details['dependents'])
    : undefined;

  if (dependents?.success !== true || dependents.data.length === 0) {
    return toMessage(error);
  }

  const names = dependents.data.map((dependent) => dependent.name).join(', ');

  return `Other aliases still read this one: ${names}. Change their formulas first.`;
}

/**
 * Renders the alias editor.
 *
 * @returns The page.
 */
export function AliasEditor() {
  const { aliasId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const readings = useLive((state) => state.readings);
  const isNew = aliasId === undefined;

  const existing = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.aliases,
    enabled: !isNew,
    /**
     * Reads every alias, so the one being edited can be found in it.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every alias.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchAliases(signal),
  });

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    /**
     * Reads every entity, so a source row can show the chosen name.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Every entity.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchEntities(signal),
  });

  const loaded = existing.data?.find((one) => one.id === aliasId);
  const [draftReady, setDraftReady] = useState(isNew);
  const [kind, setKind] = useState<'calculated' | 'stored'>('calculated');
  const [name, setName] = useState('');
  const [objectId, setObjectId] = useState('');
  const [capability, setCapability] = useState<CalculatedCapability>('sensor_numeric');
  const [expression, setExpression] = useState('');
  const [sources, setSources] = useState<SourceDraft[]>(() => sourcesFrom(undefined));
  const [unitOfMeasurement, setUnit] = useState('');
  const [deviceClass, setDeviceClass] = useState('');
  const [fallbackPolicy, setFallback] = useState<AliasFallbackPolicy>('unavailable');
  const [debounceMs, setDebounceMs] = useState(0);
  const [domain, setDomain] = useState<AliasStoredDomain>('switch');
  const [lightExtras, setLightExtras] = useState(() => new Set<CapabilityName>());
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [step, setStep] = useState('');
  const [isConfirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Seed once from the loaded alias (RULES.md 15.2 — derived during render, not an effect).
  if (!isNew && !draftReady && loaded !== undefined) {
    setKind(loaded.kind);
    setName(loaded.name);
    setObjectId(loaded.entityId.split('.')[1] ?? '');
    setCapability(
      ALIAS_CALCULATED_CAPABILITIES.find((entry) => entry === loaded.capability) ??
        'sensor_numeric',
    );
    setExpression(loaded.expression);
    setSources(sourcesFrom(loaded));
    setUnit(loaded.unitOfMeasurement ?? '');
    setDeviceClass(loaded.deviceClass ?? '');
    setFallback(loaded.fallbackPolicy);
    setDebounceMs(loaded.debounceMs);
    setDomain(ALIAS_STORED_DOMAINS.find((entry) => entry === loaded.domain) ?? 'switch');
    setLightExtras(lightExtrasOf(loaded));
    setMin(loaded.min === null ? '' : String(loaded.min));
    setMax(loaded.max === null ? '' : String(loaded.max));
    setStep(loaded.step === null ? '' : String(loaded.step));
    setDraftReady(true);
  }

  /** Reads aliases and entities again after a write. */
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.aliases }),
      queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEYS.entities }),
    ]);
  };

  const save = useMutation({
    /**
     * Makes the alias, or sends what changed on it.
     *
     * @returns The alias as it now stands.
     */
    mutationFn: async (): Promise<AliasView> => {
      const trimmedName = name.trim();
      const trimmedId = objectId.trim();

      if (isNew) {
        if (kind === 'calculated') {
          const nextSources = toSources(sources);

          if (nextSources === null || nextSources.length === 0) {
            throw new Error('Every source needs a variable name and an entity.');
          }

          const body: AliasCreate = {
            kind: 'calculated',
            objectId: trimmedId,
            name: trimmedName,
            capability,
            expression: expression.trim(),
            sources: nextSources,
            debounceMs,
            fallbackPolicy,
            isEnabled: true,
            ...(unitOfMeasurement.trim() === ''
              ? {}
              : { unitOfMeasurement: unitOfMeasurement.trim() }),
            ...(deviceClass.trim() === '' ? {} : { deviceClass: deviceClass.trim() }),
          };

          return createAlias(body);
        }

        const body: AliasCreate = {
          kind: 'stored',
          objectId: trimmedId,
          name: trimmedName,
          domain,
          capabilities: storedCapabilities(domain, lightExtras),
          isEnabled: true,
          ...(domain === 'sensor' && unitOfMeasurement.trim() !== ''
            ? { unitOfMeasurement: unitOfMeasurement.trim() }
            : {}),
          ...(domain === 'sensor' && min.trim() !== '' ? { min: Number(min) } : {}),
          ...(domain === 'sensor' && max.trim() !== '' ? { max: Number(max) } : {}),
          ...(domain === 'sensor' && step.trim() !== '' ? { step: Number(step) } : {}),
        };

        const created = await createAlias(body);

        if (domain === 'sensor' && deviceClass.trim() !== '') {
          return updateAlias(created.id, { deviceClass: deviceClass.trim() });
        }

        return created;
      }

      if (loaded === undefined) {
        throw new Error('No alias has that address.');
      }

      if (loaded.kind === 'calculated') {
        const nextSources = toSources(sources);

        if (nextSources === null || nextSources.length === 0) {
          throw new Error('Every source needs a variable name and an entity.');
        }

        const change: AliasUpdate = {
          name: trimmedName,
          expression: expression.trim(),
          sources: nextSources,
          debounceMs,
          fallbackPolicy,
          unitOfMeasurement: unitOfMeasurement.trim() === '' ? null : unitOfMeasurement.trim(),
          deviceClass: deviceClass.trim() === '' ? null : deviceClass.trim(),
        };

        return updateAlias(loaded.id, change);
      }

      const change: AliasUpdate = {
        name: trimmedName,
        capabilities: storedCapabilities(domain, lightExtras),
        ...(domain === 'sensor'
          ? {
              unitOfMeasurement: unitOfMeasurement.trim() === '' ? null : unitOfMeasurement.trim(),
              deviceClass: deviceClass.trim() === '' ? null : deviceClass.trim(),
              min: min.trim() === '' ? null : Number(min),
              max: max.trim() === '' ? null : Number(max),
              step: step.trim() === '' ? null : Number(step),
            }
          : {}),
      };

      return updateAlias(loaded.id, change);
    },

    /** Returns to the collection once every list has it. */
    onSuccess: async () => {
      await refresh();
      await navigate('/aliases');
    },

    /**
     * Shows why the save failed.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setProblem(toMessage(error));
    },
  });

  const removal = useMutation({
    /** Deletes the alias. */
    mutationFn: async (): Promise<void> => {
      if (loaded !== undefined) {
        await deleteAlias(loaded.id);
      }
    },

    /** Returns to the collection once every list has let go of it. */
    onSuccess: async () => {
      await refresh();
      await navigate('/aliases');
    },

    /**
     * Shows why the deletion failed.
     *
     * @param error - What went wrong.
     */
    onError: (error: unknown) => {
      setConfirming(false);
      setProblem(removalMessage(error));
    },
  });

  if (!isNew && !draftReady) {
    return (
      <Shell title="Alias">
        <p className="text-ui text-foreground-muted">
          {existing.isPending ? 'Reading…' : 'No alias has that address.'}
        </p>
      </Shell>
    );
  }

  const isBusy = save.isPending || removal.isPending;
  const mode = loaded?.kind ?? kind;
  const isCalculated = mode === 'calculated';
  const showMeasure =
    (isCalculated && capability === 'sensor_numeric') || (!isCalculated && domain === 'sensor');
  const unitOptions = unitOptionsFor(deviceClass);
  const entityById: ReadonlyMap<string, EntityView> = new Map(
    (entities.data ?? []).map((entity) => [entity.entityId, entity]),
  );
  const addressCaption = isNew
    ? `alias.${objectId === '' ? '…' : objectId}`
    : (loaded?.entityId ?? `alias.${objectId}`);
  const colors = sourceColors(sources);
  const classEntry = getSensorClass(deviceClass);
  const formula = readFormula(expression, sources, entityById, readings, {
    capability,
    unit:
      classEntry === undefined || unitOfMeasurement === ''
        ? unitOfMeasurement
        : (findSensorUnit(classEntry, unitOfMeasurement)?.symbol ?? unitOfMeasurement),
  });

  /** Saves, unless the required fields are blank. */
  const submit = (): void => {
    if (name.trim() === '') {
      setProblem('The name cannot be blank.');

      return;
    }

    if (isNew && objectId.trim() === '') {
      setProblem('The object id cannot be blank.');

      return;
    }

    if (isCalculated && expression.trim() === '') {
      setProblem('The formula cannot be blank.');

      return;
    }

    setProblem(null);
    save.mutate();
  };

  /**
   * Turns an optional light capability on or off.
   *
   * @param capabilityName - Which optional capability.
   * @param isOn - Whether it should be declared.
   */
  const setLightExtra = (capabilityName: CapabilityName, isOn: boolean): void => {
    setLightExtras((current) => {
      const next = new Set(current);

      if (isOn) {
        next.add(capabilityName);
      } else {
        next.delete(capabilityName);
      }

      return next;
    });
  };

  /**
   * Sets the device class and the unit that class stores in.
   *
   * A blank class clears the unit. Otherwise the canonical unit is selected, or the first unit
   * when the class has no canonical one.
   *
   * @param next - The class id, or blank.
   */
  const changeDeviceClass = (next: string): void => {
    setDeviceClass(next);

    const entry = getSensorClass(next);

    if (entry === undefined) {
      setUnit('');
      return;
    }

    setUnit(entry.canonicalUnit ?? entry.units[0]?.id ?? '');
  };

  return (
    <Shell
      title={isNew ? 'New alias' : name === '' ? (loaded?.name ?? 'Alias') : name}
      action={
        isConfirming && loaded !== undefined ? (
          <ConfirmRemoval
            question={`Delete ${loaded.name}? Automations that name ${loaded.entityId} will break.`}
            label="Delete"
            isBusy={removal.isPending}
            onCancel={() => {
              setConfirming(false);
            }}
            onConfirm={() => {
              removal.mutate();
            }}
          />
        ) : (
          <span className="flex items-center gap-2">
            {loaded === undefined ? null : (
              <Button
                variant="danger"
                size="compact"
                disabled={isBusy}
                onClick={() => {
                  setProblem(null);
                  setConfirming(true);
                }}
              >
                Delete
              </Button>
            )}
            <Button
              variant="ghost"
              size="compact"
              disabled={isBusy}
              onClick={() => {
                void navigate('/aliases');
              }}
            >
              Cancel
            </Button>
            <Button
              size="compact"
              isBusy={save.isPending}
              disabled={removal.isPending}
              onClick={submit}
            >
              {isNew ? 'Create' : 'Save'}
            </Button>
          </span>
        )
      }
    >
      {problem === null ? null : (
        <Panel title="Not saved">
          <p role="alert" className="px-4 py-3.5 text-ui text-danger">
            {problem}
          </p>
        </Panel>
      )}

      {save.error === null || problem !== null ? null : (
        <Panel title="The server refused it">
          <p className="px-4 py-3.5 text-ui text-danger">{toMessage(save.error)}</p>
        </Panel>
      )}

      <div
        className={
          isCalculated
            ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]'
            : 'grid items-start gap-4'
        }
      >
        <Panel title="What it is">
          <div className="flex flex-col gap-4 p-4">
            {isNew ? (
              <Segmented
                label="Kind"
                options={[
                  { value: 'calculated', label: 'Calculated' },
                  { value: 'stored', label: 'Stored' },
                ]}
                value={kind}
                onChange={(value) => {
                  setKind(value === 'stored' ? 'stored' : 'calculated');
                  setProblem(null);
                }}
              />
            ) : null}

            <div className="flex flex-col gap-1">
              <TextField
                label="Name"
                size="medium"
                value={name}
                required
                autoComplete="off"
                onChange={(event) => {
                  const next = event.target.value;

                  setName(next);

                  if (isNew) {
                    setObjectId(toObjectId(next));
                  }
                }}
              />
              <p className="font-mono text-caption text-foreground-subtle">{addressCaption}</p>
            </div>

            {isCalculated ? (
              <>
                <SelectField
                  label="Capability"
                  size="medium"
                  options={CALCULATED_OPTIONS}
                  value={capability}
                  disabled={!isNew}
                  onChange={(value) => {
                    setCapability(
                      ALIAS_CALCULATED_CAPABILITIES.find((entry) => entry === value) ??
                        'sensor_numeric',
                    );
                  }}
                />

                <AliasFormulaField
                  value={expression}
                  required
                  sources={sources.map((source) => ({
                    variableName: source.variableName,
                    color: colors.get(source.rowKey) ?? 'indigo',
                  }))}
                  {...(formula.tone === 'problem'
                    ? { error: formula.text }
                    : { hint: formula.text })}
                  onChange={setExpression}
                />

                {showMeasure ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      label="Device class"
                      size="medium"
                      options={DEVICE_CLASS_OPTIONS}
                      value={deviceClass}
                      onChange={changeDeviceClass}
                    />
                    <SelectField
                      label="Unit"
                      size="medium"
                      options={
                        unitOptions.length === 0
                          ? [{ value: '', label: 'Choose a class first' }]
                          : [{ value: '', label: 'None' }, ...unitOptions]
                      }
                      value={unitOfMeasurement}
                      disabled={unitOptions.length === 0}
                      onChange={setUnit}
                    />
                    <SelectField
                      label="Fallback"
                      size="medium"
                      options={FALLBACK_OPTIONS}
                      value={fallbackPolicy}
                      onChange={(value) => {
                        setFallback(
                          ALIAS_FALLBACK_POLICIES.find((entry) => entry === value) ?? 'unavailable',
                        );
                      }}
                    />
                    <TextField
                      label="Debounce (ms)"
                      size="medium"
                      type="number"
                      min={0}
                      value={String(debounceMs)}
                      onChange={(event) => {
                        setDebounceMs(Math.max(0, Number(event.target.value) || 0));
                      }}
                    />
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      label="Fallback"
                      size="medium"
                      options={FALLBACK_OPTIONS}
                      value={fallbackPolicy}
                      onChange={(value) => {
                        setFallback(
                          ALIAS_FALLBACK_POLICIES.find((entry) => entry === value) ?? 'unavailable',
                        );
                      }}
                    />
                    <TextField
                      label="Debounce (ms)"
                      size="medium"
                      type="number"
                      min={0}
                      value={String(debounceMs)}
                      onChange={(event) => {
                        setDebounceMs(Math.max(0, Number(event.target.value) || 0));
                      }}
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <SelectField
                  label="Domain"
                  size="medium"
                  options={DOMAIN_OPTIONS}
                  value={domain}
                  disabled={!isNew}
                  onChange={(value) => {
                    setDomain(ALIAS_STORED_DOMAINS.find((entry) => entry === value) ?? 'switch');
                    setLightExtras(new Set());
                  }}
                />

                {domain === 'light' ? (
                  <div className="flex flex-col gap-3">
                    <span className="text-caption text-foreground-muted">
                      Lights always carry on/off. Add optional capabilities below.
                    </span>
                    {LIGHT_OPTIONAL.map((extra) => (
                      <Segmented
                        key={extra}
                        label={extra.replaceAll('_', ' ')}
                        size="compact"
                        options={[
                          { value: 'off', label: 'Off' },
                          { value: 'on', label: 'On' },
                        ]}
                        value={lightExtras.has(extra) ? 'on' : 'off'}
                        onChange={(value) => {
                          setLightExtra(extra, value === 'on');
                        }}
                      />
                    ))}
                  </div>
                ) : null}

                {domain === 'sensor' ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      label="Device class"
                      size="medium"
                      options={DEVICE_CLASS_OPTIONS}
                      value={deviceClass}
                      onChange={changeDeviceClass}
                    />
                    <SelectField
                      label="Unit"
                      size="medium"
                      options={
                        unitOptions.length === 0
                          ? [{ value: '', label: 'Choose a class first' }]
                          : [{ value: '', label: 'None' }, ...unitOptions]
                      }
                      value={unitOfMeasurement}
                      disabled={unitOptions.length === 0}
                      onChange={setUnit}
                    />
                    <TextField
                      label="Min"
                      size="medium"
                      type="number"
                      value={min}
                      onChange={(event) => {
                        setMin(event.target.value);
                      }}
                    />
                    <TextField
                      label="Max"
                      size="medium"
                      type="number"
                      value={max}
                      onChange={(event) => {
                        setMax(event.target.value);
                      }}
                    />
                    <TextField
                      label="Step"
                      size="medium"
                      type="number"
                      min={0}
                      step="any"
                      value={step}
                      onChange={(event) => {
                        setStep(event.target.value);
                      }}
                    />
                  </div>
                ) : null}

                {domain === 'switch' ||
                domain === 'cover' ||
                domain === 'lock' ||
                domain === 'climate' ||
                domain === 'media_player' ? (
                  <p className="text-caption text-foreground-muted">
                    Capabilities: {[...storedCapabilitiesForDomain(domain)].join(', ')}.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </Panel>

        {isCalculated ? (
          <AliasSourcesPanel
            sources={sources}
            colors={colors}
            onChange={setSources}
            selfId={loaded?.entityId ?? null}
          />
        ) : null}
      </div>
    </Shell>
  );
}

/** What the editor's frame needs. */
type ShellProps = {
  /** The heading. */
  readonly title: string;

  /** Controls in the header. */
  readonly action?: React.ReactNode;

  /** The body. */
  readonly children: React.ReactNode;
};

/**
 * The editor's frame, which is the library page's frame without the collection states.
 *
 * The heading reads `Aliases / New alias`, the way the automation editor reads
 * `Automations / New automation`: where you are and the way back are the same three words, and
 * the first of them is a link.
 *
 * @param props - See {@link ShellProps}.
 * @returns The frame.
 */
function Shell(props: ShellProps) {
  const { title, action, children } = props;

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex h-17 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
        <h1 className="flex min-w-0 items-center gap-2 text-head tracking-tight">
          <Link
            to="/aliases"
            className="shrink-0 text-foreground-muted transition-colors hover:text-foreground"
          >
            Aliases
          </Link>
          <span aria-hidden="true" className="font-light text-foreground-subtle">
            /
          </span>
          <span className="truncate font-semibold">{title}</span>
        </h1>
        {action}
      </header>

      <div className="min-h-0 grow overflow-y-auto p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
