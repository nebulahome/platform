/**
 * The form a vendor's own `setup.json` asks for - an API key, an account - as state: what is
 * typed, what is wrong, and the save.
 *
 * Held apart from where the form is drawn, because it is drawn in two places: the vendor page's
 * Configuration tab, inline, and the dialog a container's row opens. Both are built from the same
 * helpers as the device form, because the vendor's declaration has the same grammar.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import type { IntegrationVendorView, JsonObject } from '@nebulahome/contracts';

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

/** What the form holds, for both groups. */
export type VendorSetupDrafts = {
  readonly transport: SetupDraft;
  readonly options: SetupDraft;
};

/** What is wrong, per group and field, plus anything that names no field. */
export type VendorSetupErrors = {
  readonly transport: Readonly<Record<string, string>>;
  readonly options: Readonly<Record<string, string>>;
  readonly general: string | undefined;
};

/** Nothing wrong. */
const NO_ERRORS: VendorSetupErrors = { transport: {}, options: {}, general: undefined };

/** The two documents the form produces, as the API takes them. */
type Values = {
  readonly transportConfig: JsonObject;
  readonly options: JsonObject;
};

/** The form's state, and what it can do. */
export type VendorSetup = {
  /** What the vendor declares: the two groups of fields. */
  readonly setup: IntegrationVendorView['setup'];
  readonly drafts: VendorSetupDrafts;
  readonly errors: VendorSetupErrors;

  /** The secrets already stored, kept unless typed over. */
  readonly kept: {
    readonly transport: ReturnType<typeof keptSecrets>;
    readonly options: ReturnType<typeof keptSecrets>;
  };

  /**
   * Changes one field of one group.
   *
   * @param group - Which group.
   * @returns The change handler the form calls.
   */
  readonly change: (group: 'transport' | 'options') => (key: string, value: DraftValue) => void;

  /** Reads both drafts and saves them when nothing is wrong. */
  readonly submit: () => void;

  /** Whether a save is under way. */
  readonly isSaving: boolean;
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
 * Holds a vendor's settings form.
 *
 * Starts from what the vendor holds; mount it afresh - with a key - to start again.
 *
 * @param vendor - The vendor, or null while there is none.
 * @param onSaved - Called once the settings are written, with the vendor as it now stands.
 * @returns See {@link VendorSetup}.
 */
export function useVendorSetup(
  vendor: IntegrationVendorView | null,
  onSaved: (vendor: IntegrationVendorView) => void,
): VendorSetup {
  const setup = vendor?.setup ?? {
    transport: { constants: {}, fields: [] },
    options: { constants: {}, fields: [] },
  };
  const mode = vendor?.isConfigured === true ? 'partial' : 'complete';
  const kept = {
    transport: keptSecrets(setup.transport, vendor?.transportConfig),
    options: keptSecrets(setup.options, vendor?.options),
  };

  const [drafts, setDrafts] = useState<VendorSetupDrafts>(() => ({
    transport: initialDraft(setup.transport, vendor?.transportConfig),
    options: initialDraft(setup.options, vendor?.options),
  }));
  const [errors, setErrors] = useState<VendorSetupErrors>(NO_ERRORS);

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

  return {
    setup,
    drafts,
    errors,
    kept,
    isSaving: save.isPending,

    /**
     * Changes one field of one group.
     *
     * @param group - Which group.
     * @returns The change handler the form calls.
     */
    change:
      (group: 'transport' | 'options') =>
      (key: string, value: DraftValue): void => {
        save.reset();
        setDrafts((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
      },

    /** Reads both drafts and saves them when nothing is wrong. */
    submit: (): void => {
      const transport = toValues(setup.transport, drafts.transport, mode);
      const options = toValues(setup.options, drafts.options, mode);

      setErrors({ transport: transport.errors, options: options.errors, general: undefined });

      if (Object.keys(transport.errors).length === 0 && Object.keys(options.errors).length === 0) {
        save.mutate({ transportConfig: transport.values, options: options.values });
      }
    },
  };
}
