/**
 * The form a package's `setup.json` asks for, as state: what is typed, what is wrong, and a Save
 * that starts the package again with what was saved.
 *
 * The same grammar, the same helpers and the same checks as a vendor's setup: two groups, the
 * secrets kept unless something is typed over them, the server's word on what is wrong shown
 * under the field it names.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import type { ApiPackageDetail, InstalledPackage, JsonObject } from '@nebulahome/contracts';

import { toMessage } from '@/lib/error-message';
import {
  errorsByField,
  initialDraft,
  keptSecrets,
  serverIssuesOf,
  toValues,
  type DraftValue,
} from '@/library/setup-values';
import type { VendorSetup, VendorSetupDrafts, VendorSetupErrors } from '@/library/use-vendor-setup';
import { configurePackage } from '@/packages/api';

/** Nothing wrong. */
const NO_ERRORS: VendorSetupErrors = { transport: {}, options: {}, general: undefined };

/** A setup that asks nothing. */
const EMPTY_SETUP = {
  transport: { constants: {}, fields: [] },
  options: { constants: {}, fields: [] },
};

/**
 * Holds a package's settings form. Starts from what is saved; mount it afresh to start again.
 *
 * @param found - The package.
 * @param onSaved - Called once it is saved, with the package as it now stands.
 * @returns The form's state: the same shape a vendor's form has, so one set of fields draws both.
 */
export function usePackageSetup(
  found: ApiPackageDetail,
  onSaved: (saved: InstalledPackage) => void,
): VendorSetup {
  const setup = found.setup ?? EMPTY_SETUP;
  const saved: JsonObject = found.config;
  const mode = Object.keys(saved).length === 0 ? 'complete' : 'partial';
  const kept = {
    transport: keptSecrets(setup.transport, saved),
    options: keptSecrets(setup.options, saved),
  };
  const [drafts, setDrafts] = useState<VendorSetupDrafts>(() => ({
    transport: initialDraft(setup.transport, saved),
    options: initialDraft(setup.options, saved),
  }));
  const [errors, setErrors] = useState<VendorSetupErrors>(NO_ERRORS);

  const save = useMutation({
    /**
     * Writes the settings.
     *
     * @param body - The two groups, as read.
     * @param body.transportConfig - The first group.
     * @param body.options - The second.
     * @returns The package as it now stands.
     */
    mutationFn: async (body: { transportConfig: JsonObject; options: JsonObject }) =>
      configurePackage(found.id, body),

    onSuccess: onSaved,

    /**
     * Keeps the server's word on what is wrong, field by field where it named one.
     *
     * @param error - What the request threw.
     */
    onError: (error: unknown): void => {
      const issues = serverIssuesOf(error);

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
