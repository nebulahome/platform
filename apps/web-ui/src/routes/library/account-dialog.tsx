/**
 * Signing in to a vendor's account, one step at a time.
 *
 * The cloud decides how signing in goes, so this is a conversation rather than a form: the
 * vendor's own fields first (`account.json`), then whatever the hub answers - a question, such as
 * the code the cloud just emailed; a page of the cloud's to approve on, which is asked about
 * again on its own until it is; or the account, connected. A failure says why, under the field it
 * blames when it blames one, and the form keeps what was typed so only that is corrected.
 *
 * The flow itself lives in the hub, under the id each step carries; nothing typed here is kept in
 * the browser once the dialog shuts.
 */
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  AccountStep,
  IntegrationAccountView,
  IntegrationVendorView,
  JsonObject,
  SetupField,
  SetupGroup,
} from '@nebulahome/contracts';
import { AppIcon, Button, Modal } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { answerAccountSignIn, beginAccountSignIn, pollAccountSignIn } from '@/library/api';
import {
  errorsByField,
  initialDraft,
  serverIssuesOf,
  toValues,
  type DraftValue,
  type SetupDraft,
} from '@/library/setup-values';
import { SetupForm } from '@/routes/library/setup-form';

/** What the dialog needs. */
export type AccountDialogProps = {
  /** The vendor, with its account; the dialog is shut while it is null. */
  readonly vendor: IntegrationVendorView | null;

  /** The account signed in to again, whose name the form starts from; absent for a new one. */
  readonly again?: IntegrationAccountView;

  /** Called to shut it. */
  readonly onClose: () => void;

  /** Called once the account is connected. */
  readonly onConnected: (account: IntegrationAccountView) => void;
};

/** Where the conversation stands. */
type Stage =
  | { readonly kind: 'form' }
  | {
      readonly kind: 'ask';
      readonly flowId: string;
      readonly message: string;
      readonly group: SetupGroup;
    }
  | {
      readonly kind: 'link';
      readonly flowId: string;
      readonly message: string;
      readonly url: string;
      readonly code: string | undefined;
      readonly pollMs: number;
    }
  | { readonly kind: 'done'; readonly account: IntegrationAccountView };

/**
 * A group of fields, from a question's list.
 *
 * @param fields - What the question asks.
 * @returns The group the form is built from.
 */
const groupOf = (fields: readonly SetupField[]): SetupGroup => ({
  constants: {},
  fields: [...fields],
});

/**
 * Renders the dialog.
 *
 * Mounted fresh each time it opens - the page gives it a key - so it starts at the form.
 *
 * @param props - See {@link AccountDialogProps}.
 * @returns The dialog.
 */
export function AccountDialog(props: AccountDialogProps) {
  const { t } = useTranslation();

  const { vendor, again, onClose, onConnected } = props;
  const account = vendor?.account ?? null;
  const fields = account?.fields ?? { constants: {}, fields: [] };
  const vendorId = vendor?.id ?? '';

  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  const [draft, setDraft] = useState<SetupDraft>(() => ({
    ...initialDraft(fields),
    ...(again === undefined || account === null ? {} : { [account.identity]: again.label }),
  }));
  const [answers, setAnswers] = useState<SetupDraft>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * Moves on to what the hub answered.
   *
   * @param step - Its answer.
   */
  const follow = (step: AccountStep): void => {
    setProblem(null);

    switch (step.kind) {
      case 'connected': {
        setStage({ kind: 'done', account: step.account });
        onConnected(step.account);
        break;
      }

      case 'ask': {
        setAnswers(initialDraft(groupOf(step.fields)));
        setErrors({});
        setStage({
          kind: 'ask',
          flowId: step.flowId,
          message: step.message,
          group: groupOf(step.fields),
        });
        break;
      }

      case 'link': {
        setStage({
          kind: 'link',
          flowId: step.flowId,
          message: step.message,
          url: step.url,
          code: step.code,
          pollMs: step.pollMs,
        });
        break;
      }

      case 'failed': {
        // Back to the form, which still holds what was typed: only what is wrong is corrected.
        const isAboutAField =
          step.field !== undefined && fields.fields.some((field) => field.key === step.field);

        setStage({ kind: 'form' });
        setErrors(isAboutAField && step.field !== undefined ? { [step.field]: step.message } : {});
        setProblem(isAboutAField ? null : step.message);
        break;
      }
    }
  };

  const send = useMutation({
    /**
     * Sends the form, or the answers to a question.
     *
     * @param values - What was typed.
     * @returns The hub's answer.
     */
    mutationFn: async (values: JsonObject): Promise<AccountStep> =>
      stage.kind === 'ask'
        ? answerAccountSignIn(vendorId, stage.flowId, values)
        : beginAccountSignIn(vendorId, values),
    onSuccess: follow,

    /**
     * Puts the server's word under the fields it names, or under the form.
     *
     * @param error - What the request threw.
     */
    onError: (error: unknown): void => {
      const issues = serverIssuesOf(error);
      const byField = errorsByField(issues, stage.kind === 'ask' ? 'answers' : 'values');

      setErrors(byField);
      setProblem(Object.keys(byField).length > 0 ? null : toMessage(error));

      if (stage.kind === 'ask' && Object.keys(byField).length === 0) {
        // The flow is over - forgotten, or answered twice: sign in again from the form.
        setStage({ kind: 'form' });
      }
    },
  });

  // While the owner approves on the cloud's page, the hub is asked again on its own. A timer is
  // something outside React to synchronise with (RULES.md 15.2).
  const linkFlow = stage.kind === 'link' ? stage.flowId : null;
  const linkEvery = stage.kind === 'link' ? stage.pollMs : 0;

  useEffect(() => {
    if (linkFlow === null) {
      return undefined;
    }

    let isCurrent = true;
    const timer = setTimeout(() => {
      pollAccountSignIn(vendorId, linkFlow)
        .then((step) => {
          if (isCurrent) {
            follow(step);
          }
        })
        .catch((error: unknown) => {
          if (isCurrent) {
            setStage({ kind: 'form' });
            setProblem(toMessage(error));
          }
        });
    }, linkEvery);

    return (): void => {
      isCurrent = false;
      clearTimeout(timer);
    };
    // `follow` reads only state setters and props that do not change while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [linkFlow, linkEvery, vendorId]);

  /** Reads what is on screen and sends it, when nothing is wrong. */
  const submit = (): void => {
    const group = stage.kind === 'ask' ? stage.group : fields;
    const reading = toValues(group, stage.kind === 'ask' ? answers : draft, 'complete');

    setErrors(reading.errors);
    setProblem(null);

    if (Object.keys(reading.errors).length === 0) {
      send.mutate(reading.values);
    }
  };

  /**
   * Changes one field of what is on screen.
   *
   * @param key - The field.
   * @param value - What it now holds.
   */
  const change = (key: string, value: DraftValue): void => {
    if (stage.kind === 'ask') {
      setAnswers((current) => ({ ...current, [key]: value }));
    } else {
      setDraft((current) => ({ ...current, [key]: value }));
    }
  };

  const name = account?.name ?? 'account';

  return (
    <Modal
      isOpen={vendor !== null}
      onClose={onClose}
      title={
        again === undefined
          ? t('library.accountDialog.signInToYour', 'Sign in to your {{name}}', { name })
          : t('library.accountDialog.signInToLabel', 'Sign in to {{label}} again', {
              label: again.label,
            })
      }
      {...(account?.help === undefined ? {} : { description: account.help })}
      footer={
        stage.kind === 'done' ? (
          <Button onClick={onClose}>{t('common.done', 'Done')}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            {stage.kind === 'link' ? null : (
              <Button isBusy={send.isPending} disabled={send.isPending} onClick={submit}>
                {stage.kind === 'ask'
                  ? t('common.confirm', 'Confirm')
                  : t('library.accountDialog.signIn', 'Sign in')}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {stage.kind === 'form' ? (
          <SetupForm group={fields} draft={draft} errors={errors} kept={[]} onChange={change} />
        ) : null}

        {stage.kind === 'ask' ? (
          <>
            <p className="flex items-start gap-2.5 text-ui leading-relaxed text-foreground">
              <AppIcon id="info" size={16} className="mt-0.5 shrink-0 text-primary" />
              {stage.message}
            </p>
            <SetupForm
              group={stage.group}
              draft={answers}
              errors={errors}
              kept={[]}
              onChange={change}
            />
          </>
        ) : null}

        {stage.kind === 'link' ? (
          <div className="flex flex-col gap-3">
            <p className="text-ui leading-relaxed text-foreground">{stage.message}</p>
            {stage.code === undefined ? null : (
              <p className="self-start rounded-field border border-border bg-surface-raised px-3 py-2 font-mono text-title tracking-widest text-foreground">
                {stage.code}
              </p>
            )}
            <a
              href={stage.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 self-start text-ui text-primary underline-offset-2 hover:underline"
            >
              {t('library.accountDialog.openThePage', 'Open the page')}
              <AppIcon id="external-link" size={14} />
            </a>
            <p role="status" className="flex items-center gap-2 text-caption text-foreground-muted">
              <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-primary" />
              {t('library.accountDialog.waitingForItTo', 'Waiting for it to be approved…')}
            </p>
          </div>
        ) : null}

        {stage.kind === 'done' ? (
          <p role="status" className="flex items-center gap-2.5 text-ui text-foreground">
            <AppIcon id="check" size={16} className="text-success" />
            {t(
              'library.accountDialog.signedInAsLabel',
              'Signed in as {{label}}. The devices on it are added in a moment.',
              { label: stage.account.label },
            )}
          </p>
        ) : null}

        {problem === null ? null : (
          <p role="alert" className="text-ui text-danger">
            {problem}
          </p>
        )}
      </div>
    </Modal>
  );
}
