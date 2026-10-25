/**
 * The second factor.
 *
 * A row rather than a panel of its own: it sits with the name and the password under one Account
 * heading, because a person's authenticator is a fact about the same thing their password is.
 *
 * Enrolment is three steps and the middle one is the point: the secret is stored the moment you
 * ask for it, but nothing is enforced until you type a code back. An enrolment that started
 * enforcing at step one would lock out everyone who mistyped the setup, which is precisely the
 * population that needs to be able to get back in.
 *
 * The recovery codes are shown once and never again. The server keeps hashes, so there is no
 * second chance to display them and no honest way to pretend otherwise - which is why the dialog
 * refuses to be a passive thing you can click past without noticing.
 *
 * There is no QR code. Rendering one means a dependency, and typing a base32 secret into an
 * authenticator once is a smaller cost than a library on the page. The `otpauth://` URI is here
 * too, for anyone whose app takes a link.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Modal, Pill, TextField } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { copyText } from '@/lib/clipboard';
import { toMessage } from '@/lib/error-message';
import { SettingsRow } from '@/routes/settings/settings-ui';
import {
  beginTwoFactorEnrolment,
  confirmTwoFactorEnrolment,
  disableTwoFactor,
} from '@/settings/api';

/** Where enrolment has got to. */
type Stage =
  /** Nothing open. */
  | { readonly step: 'idle' }

  /** The secret exists and is waiting to be proved. */
  | { readonly step: 'enrolling'; readonly secret: string; readonly uri: string }

  /** It worked, and these are the codes. */
  | { readonly step: 'codes'; readonly codes: readonly string[] }

  /** Confirming that it should be turned off. */
  | { readonly step: 'disabling' };

/**
 * Renders the second-factor row and the dialogs behind it.
 *
 * @returns The row.
 */
export function TwoFactorRow() {
  const { t } = useTranslation();
  const isEnabled = useSession((state) => state.user?.isTwoFactorEnabled ?? false);
  const refreshUser = useSession((state) => state.refreshUser);
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);
  const [isCopied, setCopied] = useState(false);

  /**
   * Closes whatever is open.
   */
  const close = (): void => {
    setStage({ step: 'idle' });
    setCode('');
    setError(undefined);
    setCopied(false);
  };

  /**
   * Asks the server for a secret and opens the enrolment dialog.
   */
  const begin = (): void => {
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        const { secret, uri } = await beginTwoFactorEnrolment();

        setStage({ step: 'enrolling', secret, uri });
      } catch (cause: unknown) {
        setError(toMessage(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  /**
   * Proves the authenticator was set up correctly.
   */
  const confirm = (): void => {
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        const { recoveryCodes } = await confirmTwoFactorEnrolment(code);

        await refreshUser();
        setCode('');
        setStage({ step: 'codes', codes: recoveryCodes });
      } catch (cause: unknown) {
        setError(toMessage(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  /**
   * Turns the second factor off.
   */
  const turnOff = (): void => {
    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        await disableTwoFactor();
        await refreshUser();
        close();
      } catch (cause: unknown) {
        setError(toMessage(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <SettingsRow
        searchId="two-factor"
        title={t('settings.twoFactor.title', 'Authenticator app')}
        note={
          isEnabled
            ? t(
                'settings.twoFactor.onNote',
                'A code from your authenticator is required at every sign-in.',
              )
            : t(
                'settings.twoFactor.offNote',
                'A password on its own is one secret. A second factor is the one that survives it leaking.',
              )
        }
        control={
          <div className="flex shrink-0 items-center gap-2.5">
            {isEnabled ? (
              <Pill tone="success">{t('common.on', 'On')}</Pill>
            ) : (
              <Pill tone="warning">{t('common.off', 'Off')}</Pill>
            )}

            {isEnabled ? (
              <Button
                variant="danger"
                onClick={() => {
                  setError(undefined);
                  setStage({ step: 'disabling' });
                }}
              >
                {t('settings.twoFactor.turnOff', 'Turn off')}
              </Button>
            ) : (
              <Button variant="ghost" isBusy={isBusy} onClick={begin}>
                {t('settings.twoFactor.setUp', 'Set up')}
              </Button>
            )}
          </div>
        }
      >
        {stage.step === 'idle' && error !== undefined ? (
          <span role="alert" className="text-ui text-danger">
            {error}
          </span>
        ) : null}
      </SettingsRow>

      <Modal
        isOpen={stage.step === 'enrolling'}
        onClose={close}
        title={t('settings.twoFactor.enrolTitle', 'Set up your authenticator')}
        // The shared secret is on screen and is not shown again.
        closesOnBackdrop={false}
        description={t(
          'settings.twoFactor.enrolNote',
          'Add this secret to your authenticator app, then type the code it shows to prove it worked.',
        )}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button isBusy={isBusy} disabled={code.length < 6} onClick={confirm}>
              {t('common.confirm', 'Confirm')}
            </Button>
          </>
        }
      >
        {stage.step === 'enrolling' ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-caption font-medium text-foreground-muted">
                {t('settings.twoFactor.secret', 'Secret')}
              </span>
              <div className="flex items-center gap-2">
                <code className="grow rounded-field border border-border bg-surface-high px-3 py-2.5 font-mono text-ui break-all text-foreground">
                  {stage.secret}
                </code>
                <Button
                  variant="ghost"
                  className="h-9 shrink-0 px-3 text-ui"
                  onClick={() => {
                    void copyText(stage.secret).then(setCopied);
                  }}
                >
                  {isCopied ? t('common.copied', 'Copied') : t('common.copy', 'Copy')}
                </Button>
              </div>
              <span className="text-caption break-all text-foreground-subtle">{stage.uri}</span>
            </div>

            <TextField
              label={t('settings.twoFactor.code', 'Code from the app')}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
              {...(error === undefined ? {} : { error })}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={stage.step === 'codes'}
        onClose={close}
        title={t('settings.twoFactor.codesTitle', 'Your recovery codes')}
        // Shown once, and the only way back into an account whose phone is gone.
        closesOnBackdrop={false}
        description={t(
          'settings.twoFactor.codesNote',
          'Each one signs you in once, if you lose the authenticator. They are shown here and nowhere else — the server keeps only hashes.',
        )}
        footer={
          <Button onClick={close}>{t('settings.twoFactor.saved', 'I have saved them')}</Button>
        }
      >
        {stage.step === 'codes' ? (
          <div className="flex flex-col gap-3">
            <ul className="grid grid-cols-2 gap-1.5 rounded-field border border-border bg-surface-high p-3">
              {stage.codes.map((recovery) => (
                <li key={recovery} className="font-mono text-ui text-foreground">
                  {recovery}
                </li>
              ))}
            </ul>

            <Button
              variant="ghost"
              onClick={() => {
                void copyText(stage.codes.join('\n')).then(setCopied);
              }}
            >
              {isCopied ? t('common.copied', 'Copied') : t('common.copyAll', 'Copy all')}
            </Button>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={stage.step === 'disabling'}
        onClose={close}
        title={t('settings.twoFactor.disableTitle', 'Turn off two-factor authentication?')}
        description={t(
          'settings.twoFactor.disableNote',
          'Your account goes back to being protected by its password alone, and the recovery codes stop working.',
        )}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {t('settings.twoFactor.keepOn', 'Keep it on')}
            </Button>
            <Button variant="danger" isBusy={isBusy} onClick={turnOff}>
              {t('settings.twoFactor.turnItOff', 'Turn it off')}
            </Button>
          </>
        }
      >
        {error === undefined ? (
          <span className="sr-only">{t('common.nothingWrong', 'Nothing has gone wrong.')}</span>
        ) : (
          <span role="alert" className="text-ui text-danger">
            {error}
          </span>
        )}
      </Modal>
    </>
  );
}
