/**
 * Adding a device by hand, or changing one: which model, the form its driver asks for, a Test,
 * and a Save.
 *
 * The vendor's drivers - served by the hub through the vendors list - say what may be picked
 * and which fields each pick brings; nothing here knows what an MQTT broker or a printer wants.
 * A vendor with one model to offer is not asked which: the choice is made silently and the form
 * is the driver's. What is typed is checked against the same schema the API runs, so a wrong
 * value is underlined before a round trip and the message is the one the server would have sent.
 *
 * **Test** opens the transport once with what is typed and reports the verdict in a sentence:
 * "Connected to mqtts://… as bblp", or "did not answer: ECONNREFUSED". It saves nothing. A secret
 * left blank while editing is filled from the one kept, so testing a changed address does not
 * mean typing the password again.
 *
 * **Save** writes the row and the hub is asked to match it at once; the row comes back with the
 * state the hub reported, and the page shows it. What takes effect takes effect now.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import {
  integrationIdSchema,
  modelChoicesOf,
  type IntegrationProbeReply,
  type IntegrationVendorView,
  type IntegrationView,
  type JsonObject,
  type ModelChoice,
} from '@nebula-home/contracts';
import { Button, Modal, Segmented, SelectField, TextField } from '@nebula-home/ui';

import { CheckIcon, WarningIcon } from '@/components/icons';
import { isApiError } from '@/lib/api-error';
import { toMessage } from '@/lib/error-message';
import { createIntegration, probeIntegration, updateIntegration } from '@/library/api';
import {
  errorsByField,
  initialDraft,
  keptSecrets,
  toValues,
  type DraftValue,
  type ServerIssue,
  type SetupDraft,
} from '@/library/setup-values';
import { SetupForm } from '@/routes/library/setup-form';

/** What the dialog is for: a new device of a vendor, or one that exists. */
export type IntegrationDialogTarget =
  | {
      readonly mode: 'create';
      readonly vendor: IntegrationVendorView;

      /** The ids already taken, so the one suggested is free. */
      readonly existingIds: readonly string[];
    }
  | {
      readonly mode: 'edit';
      readonly vendor: IntegrationVendorView;
      readonly integration: IntegrationView;
    };

/** What the dialog needs. */
export type IntegrationDialogProps = {
  /** What is being set up. Null when the dialog is shut. */
  readonly target: IntegrationDialogTarget | null;

  /** Called to shut it. */
  readonly onClose: () => void;

  /** Called once the row is written, with the integration as it now stands. */
  readonly onSaved: (integration: IntegrationView) => void;
};

/** What the form holds, for both groups. */
type Drafts = {
  readonly transport: SetupDraft;
  readonly options: SetupDraft;
};

/** What is wrong, per group and field, plus anything that names no field. */
type Errors = {
  readonly transport: Readonly<Record<string, string>>;
  readonly options: Readonly<Record<string, string>>;
  readonly general: string | undefined;
};

/** Nothing wrong. */
const NO_ERRORS: Errors = { transport: {}, options: {}, general: undefined };

/** The two documents a form produces, as the API takes them. */
type Values = {
  readonly transportConfig: JsonObject;
  readonly options: JsonObject;
};

/**
 * A model label as part of an id: lower case, dashes for anything that is not a letter or digit.
 *
 * @param model - As the bundle lists it: `A1 mini`, `1PM Mini Gen3`.
 * @returns `a1-mini`, `1pm-mini-gen3`.
 */
function slug(model: string): string {
  return model
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

/**
 * An id for a new device of this vendor and model that nobody has yet.
 *
 * `bambu-lab-x1c` for the first, `bambu-lab-x1c-2` for the next: the id is what every entity
 * of the instance carries as its source, so two cannot share one.
 *
 * @param vendorId - The vendor.
 * @param model - The model picked.
 * @param taken - The ids already in use.
 * @returns A free id.
 */
function suggestId(vendorId: string, model: string, taken: readonly string[]): string {
  const base = `${vendorId}-${slug(model)}`;
  let candidate = base;

  for (let n = 2; taken.includes(candidate); n += 1) {
    candidate = `${base}-${String(n)}`;
  }

  return candidate;
}

/**
 * The choice an existing instance was made with, or the first the vendor offers.
 *
 * @param choices - What the vendor offers.
 * @param existing - The instance being edited, when there is one.
 * @returns The choice, or undefined for a vendor that offers nothing.
 */
function initialChoice(
  choices: readonly ModelChoice[],
  existing: IntegrationView | undefined,
): ModelChoice | undefined {
  if (existing === undefined) {
    return choices[0];
  }

  return (
    choices.find((choice) => choice.kind === existing.kind && choice.model === existing.model) ??
    choices.find((choice) => choice.kind === existing.kind) ??
    choices[0]
  );
}

/**
 * The drafts a dialog starts from.
 *
 * @param vendor - The vendor whose driver's form is shown.
 * @param choice - Which driver, through the model picked.
 * @param stored - The row being edited, when there is one.
 * @returns One draft per group.
 */
function draftsFor(
  vendor: IntegrationVendorView,
  choice: ModelChoice | undefined,
  stored: IntegrationView | undefined,
): Drafts {
  const driver = vendor.drivers.find((each) => each.id === choice?.kind);

  if (driver === undefined) {
    return { transport: {}, options: {} };
  }

  return {
    transport: initialDraft(driver.setup.transport, stored?.transportConfig),
    options: initialDraft(driver.setup.options, stored?.options),
  };
}

/**
 * The issues a `400` carried, if it carried any.
 *
 * @param error - What the request threw.
 * @returns The issues, or none for any other failure.
 */
function issuesOf(error: unknown): ServerIssue[] {
  if (!isApiError(error) || error.code !== 'VALIDATION') {
    return [];
  }

  const issues = error.details['issues'];

  return Array.isArray(issues)
    ? issues.filter(
        (issue): issue is ServerIssue =>
          typeof issue === 'object' &&
          issue !== null &&
          typeof (issue as { path?: unknown }).path === 'string' &&
          typeof (issue as { message?: unknown }).message === 'string',
      )
    : [];
}

/**
 * Renders the dialog.
 *
 * Mounted fresh each time it opens - the page gives it a key - so every piece of state below
 * starts from the target and the fields are the person's from then on.
 *
 * @param props - See {@link IntegrationDialogProps}.
 * @returns The dialog.
 */
export function IntegrationDialog(props: IntegrationDialogProps) {
  const { target, onClose, onSaved } = props;

  const vendor = target?.vendor;
  const existing = target?.mode === 'edit' ? target.integration : undefined;
  const taken = target?.mode === 'create' ? target.existingIds : [];
  const choices = vendor === undefined ? [] : modelChoicesOf(vendor);

  const [choice, setChoice] = useState<ModelChoice | undefined>(() =>
    initialChoice(choices, existing),
  );
  const driver = vendor?.drivers.find((each) => each.id === choice?.kind);

  const [id, setId] = useState(
    () =>
      existing?.id ??
      (vendor === undefined || choice === undefined
        ? ''
        : suggestId(vendor.id, choice.model, taken)),
  );
  const [isIdEdited, setIdEdited] = useState(false);
  const [isEnabled, setEnabled] = useState(existing?.isEnabled ?? true);
  const [drafts, setDrafts] = useState<Drafts>(() =>
    vendor === undefined ? { transport: {}, options: {} } : draftsFor(vendor, choice, existing),
  );
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [verdict, setVerdict] = useState<IntegrationProbeReply | null>(null);

  const mode = existing === undefined ? 'complete' : 'partial';
  const kept = {
    transport: keptSecrets(
      driver?.setup.transport ?? { constants: {}, fields: [] },
      existing?.transportConfig,
    ),
    options: keptSecrets(driver?.setup.options ?? { constants: {}, fields: [] }, existing?.options),
  };

  /**
   * Reads both drafts, remembering what is wrong with them.
   *
   * @returns The values to send, or null when a field stopped them.
   */
  const read = (): Values | null => {
    if (driver === undefined) {
      return null;
    }

    const transport = toValues(driver.setup.transport, drafts.transport, mode);
    const options = toValues(driver.setup.options, drafts.options, mode);
    const isIdValid = existing !== undefined || integrationIdSchema.safeParse(id).success;

    setErrors({
      transport: transport.errors,
      options: options.errors,
      general: isIdValid
        ? undefined
        : 'The id must be lowercase letters, digits and dashes, starting with a letter.',
    });

    const isClean =
      isIdValid &&
      Object.keys(transport.errors).length === 0 &&
      Object.keys(options.errors).length === 0;

    return isClean ? { transportConfig: transport.values, options: options.values } : null;
  };

  /**
   * Keeps the server's word on what is wrong, field by field where it named one.
   *
   * @param error - What the request threw.
   */
  const remember = (error: unknown): void => {
    const issues = issuesOf(error);

    setErrors({
      transport: errorsByField(issues, 'transportConfig'),
      options: errorsByField(issues, 'options'),
      general:
        issues.length > 0 && issues.every((issue) => issue.path.includes('.'))
          ? undefined
          : toMessage(error),
    });
  };

  const probe = useMutation({
    /**
     * Tries what is typed.
     *
     * @param values - The two documents, as read.
     * @returns The verdict.
     */
    mutationFn: async (values: Values) =>
      probeIntegration({
        kind: choice?.kind ?? '',
        transportConfig: values.transportConfig,
        ...(existing === undefined ? {} : { integrationId: existing.id }),
      }),
    /**
     * Shows the verdict.
     *
     * @param reply - What the hub said.
     */
    onSuccess: (reply): void => {
      setVerdict(reply);
    },
    onError: remember,
  });

  const save = useMutation({
    /**
     * Writes the row.
     *
     * @param values - The two documents, as read.
     * @returns The integration as it now stands.
     */
    mutationFn: async (values: Values) =>
      existing === undefined
        ? createIntegration({
            id,
            kind: choice?.kind ?? '',
            model: choice?.model ?? '',
            isEnabled,
            ...values,
          })
        : updateIntegration(existing.id, {
            isEnabled,
            ...(choice === undefined ? {} : { model: choice.model }),
            ...values,
          }),
    /**
     * Hands the written row back to the page.
     *
     * @param integration - As it now stands.
     */
    onSuccess: (integration): void => {
      onSaved(integration);
    },
    onError: remember,
  });

  const isBusy = probe.isPending || save.isPending;

  /**
   * Changes one field of one group, and forgets the last verdict: it was about other values.
   *
   * @param group - Which group.
   * @returns The change handler the form calls.
   */
  const change =
    (group: 'transport' | 'options') =>
    (key: string, value: DraftValue): void => {
      setDrafts((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
      setVerdict(null);
    };

  /**
   * Picks another model, and with it perhaps another driver and another form.
   *
   * @param value - The option chosen: the kind and the model, joined.
   */
  const pick = (value: string): void => {
    const next = choices.find((each) => `${each.kind} ${each.model}` === value);

    if (next === undefined || vendor === undefined) {
      return;
    }

    setChoice(next);
    setVerdict(null);

    if (next.kind !== choice?.kind) {
      // Another driver is another form: what was typed for the old one names fields the new
      // one does not have.
      setDrafts(draftsFor(vendor, next, existing));
      setErrors(NO_ERRORS);
    }

    if (existing === undefined && !isIdEdited) {
      setId(suggestId(vendor.id, next.model, taken));
    }
  };

  const title = existing === undefined ? 'Add a device' : `Configure ${existing.id}`;
  const description =
    driver === undefined
      ? 'Which model, and what it needs to be reached.'
      : `${driver.name}, over ${driver.transport}. Test tries the address before anything is saved.`;

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button
            variant="ghost"
            isBusy={probe.isPending}
            disabled={isBusy || driver === undefined}
            onClick={() => {
              const values = read();

              if (values !== null) {
                probe.mutate(values);
              }
            }}
          >
            Test
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            isBusy={save.isPending}
            disabled={isBusy || driver === undefined}
            onClick={() => {
              const values = read();

              if (values !== null) {
                save.mutate(values);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {choices.length > 1 ? (
          <SelectField
            label="Model"
            options={choices.map((each) => ({
              value: `${each.kind} ${each.model}`,
              label: each.model,
            }))}
            value={choice === undefined ? '' : `${choice.kind} ${choice.model}`}
            hint={
              vendor !== undefined && vendor.drivers.length > 1 && driver !== undefined
                ? `Driven as ${driver.name}.`
                : undefined
            }
            onChange={pick}
          />
        ) : null}

        {existing === undefined ? (
          <TextField
            label="Id"
            size="medium"
            hint="Lowercase letters, digits and dashes. It is what every entity of this device carries as its source."
            value={id}
            required
            onChange={(event) => {
              setId(event.target.value);
              setIdEdited(true);
            }}
          />
        ) : driver === undefined ? (
          <p role="alert" className="text-ui text-danger">
            The hub no longer has the driver {existing.kind}, so its fields cannot be shown.
          </p>
        ) : null}

        {driver === undefined ? null : (
          <>
            <SetupForm
              group={driver.setup.transport}
              draft={drafts.transport}
              errors={errors.transport}
              kept={kept.transport}
              onChange={change('transport')}
            />
            <SetupForm
              group={driver.setup.options}
              draft={drafts.options}
              errors={errors.options}
              kept={kept.options}
              onChange={change('options')}
            />
          </>
        )}

        {existing === undefined ? null : (
          <Segmented
            label="Running"
            options={[
              { value: 'on', label: 'Enabled' },
              { value: 'off', label: 'Disabled' },
            ]}
            value={isEnabled ? 'on' : 'off'}
            onChange={(value) => {
              setEnabled(value === 'on');
            }}
          />
        )}

        {verdict === null ? null : verdict.isReachable ? (
          <p role="status" className="flex items-start gap-2 text-ui text-success">
            <CheckIcon width="16" height="16" className="mt-0.5 shrink-0" />
            <span>{verdict.detail}</span>
          </p>
        ) : (
          <p role="alert" className="flex items-start gap-2 text-ui text-danger">
            <WarningIcon width="16" height="16" className="mt-0.5 shrink-0" />
            <span>{verdict.detail}</span>
          </p>
        )}

        {errors.general === undefined ? null : (
          <p role="alert" className="text-ui text-danger">
            {errors.general}
          </p>
        )}
      </div>
    </Modal>
  );
}
