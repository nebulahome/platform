/**
 * Setting a vendor up: the form its own `setup.json` asks for - an API key, an account - and a
 * Save.
 *
 * What is typed here is shared by every device of the vendor, and the hub puts it under each
 * one when it starts; the device form never asks for it again. The same helpers build and check
 * this form as build the device form, because the vendor's declaration has the same grammar.
 *
 * No Test: there is no one device to open a connection to. Whether the key works is found out
 * by the first device added, which is where a wrong key says so.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import type { IntegrationVendorView, JsonObject } from '@nebulahome/contracts';
import { Button, Modal } from '@nebulahome/ui';

import { isApiError } from '@/lib/api-error';
import { toMessage } from '@/lib/error-message';
import { updateVendorConfig } from '@/library/api';
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

/** What the dialog needs. */
export type VendorSetupDialogProps = {
  /** The vendor being set up. Null when the dialog is shut. */
  readonly vendor: IntegrationVendorView | null;

  /** Called to shut it. */
  readonly onClose: () => void;

  /** Called once the settings are written, with the vendor as it now stands. */
  readonly onSaved: (vendor: IntegrationVendorView) => void;
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

/** The two documents the form produces, as the API takes them. */
type Values = {
  readonly transportConfig: JsonObject;
  readonly options: JsonObject;
};

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
 * Mounted fresh each time it opens - the page gives it a key - so the fields start from what
 * the vendor holds and are the person's from then on.
 *
 * @param props - See {@link VendorSetupDialogProps}.
 * @returns The dialog.
 */
export function VendorSetupDialog(props: VendorSetupDialogProps) {
  const { vendor, onClose, onSaved } = props;

  const setup = vendor?.setup ?? {
    transport: { constants: {}, fields: [] },
    options: { constants: {}, fields: [] },
  };
  const mode = vendor?.isConfigured === true ? 'partial' : 'complete';
  const kept = {
    transport: keptSecrets(setup.transport, vendor?.transportConfig),
    options: keptSecrets(setup.options, vendor?.options),
  };

  const [drafts, setDrafts] = useState<Drafts>(() => ({
    transport: initialDraft(setup.transport, vendor?.transportConfig),
    options: initialDraft(setup.options, vendor?.options),
  }));
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);

  const save = useMutation({
    /**
     * Writes the settings.
     *
     * @param values - The two documents, as read.
     * @returns The vendor as it now stands.
     */
    mutationFn: async (values: Values) => updateVendorConfig(vendor?.id ?? '', values),
    /**
     * Hands the vendor back to the page.
     *
     * @param saved - As it now stands.
     */
    onSuccess: (saved): void => {
      onSaved(saved);
    },
    /**
     * Keeps the server's word on what is wrong, field by field where it named one.
     *
     * @param error - What the request threw.
     */
    onError: (error: unknown): void => {
      const issues = issuesOf(error);

      setErrors({
        transport: errorsByField(issues, 'transportConfig'),
        options: errorsByField(issues, 'options'),
        general:
          issues.length > 0 && issues.every((issue) => issue.path.includes('.'))
            ? undefined
            : toMessage(error),
      });
    },
  });

  /**
   * Changes one field of one group.
   *
   * @param group - Which group.
   * @returns The change handler the form calls.
   */
  const change =
    (group: 'transport' | 'options') =>
    (key: string, value: DraftValue): void => {
      setDrafts((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
    };

  /**
   * Reads both drafts and saves them when nothing is wrong.
   */
  const submit = (): void => {
    const transport = toValues(setup.transport, drafts.transport, mode);
    const options = toValues(setup.options, drafts.options, mode);

    setErrors({ transport: transport.errors, options: options.errors, general: undefined });

    if (Object.keys(transport.errors).length === 0 && Object.keys(options.errors).length === 0) {
      save.mutate({ transportConfig: transport.values, options: options.values });
    }
  };

  return (
    <Modal
      isOpen={vendor !== null}
      onClose={onClose}
      title={`Set up ${vendor?.name ?? ''}`}
      description="What every device of this vendor shares. Each device is asked only for its own address."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button isBusy={save.isPending} disabled={save.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SetupForm
          group={setup.transport}
          draft={drafts.transport}
          errors={errors.transport}
          kept={kept.transport}
          onChange={change('transport')}
        />
        <SetupForm
          group={setup.options}
          draft={drafts.options}
          errors={errors.options}
          kept={kept.options}
          onChange={change('options')}
        />

        {errors.general === undefined ? null : (
          <p role="alert" className="text-ui text-danger">
            {errors.general}
          </p>
        )}
      </div>
    </Modal>
  );
}
