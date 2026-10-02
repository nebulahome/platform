/**
 * Between the form and the API: what a control holds, and what the bundle asks for.
 *
 * A control holds text or a switch. The bundle asks for numbers, lists and choices, and says
 * which fields may be left out. This module converts one into the other in both directions and
 * runs the same value schema the API runs, so the message under a field is the message the server
 * would have sent - only sooner, and without a round trip.
 *
 * Pure. Nothing here renders or fetches, which is what lets it be tested with a table of inputs.
 */
import {
  isFieldShown,
  setupValueSchema,
  type JsonObject,
  type JsonValue,
  type SetupField,
  type SetupGroup,
  type SetupValueMode,
} from '@nebulahome/contracts';

import { isApiError } from '@/lib/api-error';

/** What one control holds: text for everything but a switch. */
export type DraftValue = string | boolean;

/** What the form holds for one group, by field key. */
export type SetupDraft = Record<string, DraftValue>;

/** The outcome of reading a draft: the values to send, and what stopped a field from being one. */
export type DraftReading = {
  readonly values: JsonObject;
  readonly errors: Record<string, string>;
};

/** One issue as the API reports it under `details.issues`. */
export type ServerIssue = {
  readonly path: string;
  readonly message: string;
};

/**
 * What a control shows for a stored value.
 *
 * @param field - The declaration.
 * @param stored - What the row holds for it, if anything.
 * @returns Text or a switch position. A secret is always blank: the row holds a marker, never
 * the value, and the form says separately that one is kept.
 */
function shown(field: SetupField, stored: JsonValue | undefined): DraftValue {
  switch (field.type) {
    case 'secret':
      return '';
    case 'boolean':
      return typeof stored === 'boolean' ? stored : (field.default ?? false);
    case 'list':
      return Array.isArray(stored) ? stored.map(String).join(', ') : '';
    case 'number':
      return typeof stored === 'number' ? String(stored) : String(field.default ?? '');
    case 'text':
    case 'choice':
      return typeof stored === 'string' ? stored : (field.default ?? '');
  }
}

/**
 * The draft a form starts from.
 *
 * @param group - The declaration.
 * @param stored - The row's document when editing; nothing when creating.
 * @returns One entry per field: what the row holds, else the declared default, else blank.
 */
export function initialDraft(group: SetupGroup, stored?: JsonObject): SetupDraft {
  const draft: SetupDraft = {};

  for (const field of group.fields) {
    draft[field.key] = shown(field, stored?.[field.key]);
  }

  return draft;
}

/**
 * The secret fields a row already holds a value for.
 *
 * @param group - The declaration.
 * @param stored - The row's document, in which a kept secret reads `{ "$sealed": true }`.
 * @returns Their keys, so the form can say "saved - leave blank to keep".
 */
export function keptSecrets(group: SetupGroup, stored: JsonObject | undefined): string[] {
  return group.fields
    .filter((field) => field.type === 'secret')
    .map((field) => field.key)
    .filter((key) => {
      const value = stored?.[key];

      return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        value['$sealed'] === true
      );
    });
}

/**
 * One typed value, as the API takes it.
 *
 * @param field - The declaration.
 * @param draft - What the control holds.
 * @returns The value, undefined for a blank the field may leave out, or a message when the text
 * cannot become the type the field asks for.
 */
function typed(field: SetupField, draft: DraftValue): { value?: JsonValue; error?: string } {
  if (field.type === 'boolean') {
    return { value: draft === true };
  }

  const text = typeof draft === 'string' ? draft.trim() : '';

  if (text === '') {
    return {};
  }

  switch (field.type) {
    case 'number': {
      const number = Number(text);

      return Number.isFinite(number) ? { value: number } : { error: 'Must be a number' };
    }
    case 'list':
      return {
        value: text
          .split(/[\n,]/u)
          .map((item) => item.trim())
          .filter((item) => item !== ''),
      };
    case 'text':
    case 'secret':
    case 'choice':
      return { value: text };
  }
}

/**
 * Reads a draft into the values to send, checking them the way the API will.
 *
 * @param group - The declaration.
 * @param draft - What the form holds.
 * @param mode - `complete` for a new instance, `partial` for a change - where a blank secret
 * means "keep the one saved" and is left out rather than sent empty.
 * @returns The values that passed and, per field, the first thing wrong with the ones that did
 * not. When any field has an error the values are not to be sent. A field an earlier choice rules
 * out is neither read nor sent: what it held stays in the draft, for when the choice changes back.
 */
export function toValues(group: SetupGroup, draft: SetupDraft, mode: SetupValueMode): DraftReading {
  const candidate: JsonObject = {};
  const errors: Record<string, string> = {};

  for (const field of group.fields) {
    if (!isFieldShown(group, field, draft)) {
      continue;
    }

    const { value, error } = typed(field, draft[field.key] ?? '');

    if (error !== undefined) {
      errors[field.key] = error;
    } else if (value !== undefined) {
      candidate[field.key] = value;
    }
  }

  const result = setupValueSchema(group, mode).safeParse(candidate);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path.map(String)[0];

      if (key !== undefined && !(key in errors)) {
        errors[key] = issue.message;
      }
    }

    return { values: candidate, errors };
  }

  return { values: result.data, errors };
}

/**
 * The server's issues for one group, by field.
 *
 * @param issues - What the API put under `details.issues`.
 * @param groupName - The prefix the API gave the group: `transportConfig` or `options` for a
 * device or a vendor, `values` or `answers` for an account's sign-in.
 * @returns The first message for each field the issues name. An issue on the group itself - an
 * unknown key, say - names no control and is left for the form's general message.
 */
export function errorsByField(
  issues: readonly ServerIssue[],
  groupName: 'transportConfig' | 'options' | 'values' | 'answers',
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of issues) {
    const [group, key] = issue.path.split('.');

    if (group === groupName && key !== undefined && key !== '' && !(key in errors)) {
      errors[key] = issue.message;
    }
  }

  return errors;
}

/**
 * The issues a `400` carried, if it carried any.
 *
 * @param error - What the request threw.
 * @returns The issues, or none for any other failure.
 */
export function serverIssuesOf(error: unknown): ServerIssue[] {
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
