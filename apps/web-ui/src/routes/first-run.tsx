/* eslint-disable jsx-a11y/no-autofocus -- Each step exists to be typed into: its first field is
   above the fold and there is nothing else to do on the page. Focusing it saves everyone a
   keystroke, and a screen reader announces the label as focus lands, which is the harm the rule
   guards against. */
/**
 * The first-boot screen, in two steps (boards N-Setup-1 and N-Setup-2).
 *
 * Shown when the installation has no accounts at all, which is the one moment this form can
 * exist: the API closes the endpoint behind it. Nothing here is a default. A shipped
 * administrator password is how appliances end up on the public internet with `admin`/`admin`,
 * and the whole point of this screen is that nobody ever has one to change.
 *
 * **Account** asks for the owner, and the language of the house. The screen opens in the
 * browser's language when the interface speaks it, else English, and the Language field starts
 * there; picking another switches the screen at once, and the one chosen becomes the house's - the
 * sign-in screen's, and everybody's who never picks their own. The password floor is twelve
 * characters and there are no composition rules, which is the API's rule and not a relaxation of
 * it: length is the axis that costs an attacker anything, and demanding a symbol mostly produces
 * the same word with an exclamation mark after it.
 *
 * **Home** asks what the house is called, where it stands, its time zone and its units. The
 * position is required: sunrise and sunset, the sun's elevation, the weather and the solar
 * forecast all start from it, and it never leaves the machine. Both steps are one form and one
 * request at the end, so a setup abandoned half way leaves nothing behind.
 *
 * What has been typed is kept in the step's store rather than in the form, because changing the
 * language draws the form again from nothing.
 */
import { type SubmitEventHandler, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';

import { LOCALE_NAMES, SUPPORTED_LOCALES, isSupportedLocale } from '@nebulahome/contracts';
import { AppIcon, Button, Note, Segmented, SelectField, TextField } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { HomeLocationPreview } from '@/components/home-location-preview';
import { PasswordField } from '@/components/password-field';
import { defineMessage, text, type Message } from '@/i18n/messages';
import { toMessage } from '@/lib/error-message';
import { parsePosition, type HousePosition } from '@/lib/house-position';
import { isPasswordAcceptable } from '@/lib/password-rules';
import { BROWSER_ZONE, timeZoneChoices } from '@/lib/time-zones';
import { useDevicePosition } from '@/lib/use-device-position';

/** The steps, as the indicator above the card names them. */
const STEP_NAMES: readonly Message[] = [
  defineMessage('firstRun.steps.account', 'Account'),
  defineMessage('firstRun.steps.home', 'Home'),
];

/** What each step's card says above its fields. */
const STEP_HEADINGS: readonly { readonly title: Message; readonly subtitle: Message }[] = [
  {
    title: defineMessage('firstRun.account.title', 'Create your account'),
    subtitle: defineMessage(
      'firstRun.account.subtitle',
      'This home has no accounts yet. The first one is yours.',
    ),
  },
  {
    title: defineMessage('firstRun.home.title', 'Your home'),
    subtitle: defineMessage(
      'firstRun.home.subtitle',
      'A name, where it is and how you measure things.',
    ),
  },
];

/** How many steps there are. */
export const FIRST_RUN_STEP_COUNT = STEP_NAMES.length;

/**
 * The steps, named in the language spoken now.
 *
 * @returns One entry per step.
 */
export function firstRunSteps(): readonly { readonly name: string }[] {
  return STEP_NAMES.map((name) => ({ name: text(name) }));
}

/**
 * What a step's card says, in the language spoken now.
 *
 * @param step - Which, from 0.
 * @returns Its title and the line under it, or undefined for a step that does not exist.
 */
export function firstRunHeading(
  step: number,
): { readonly title: string; readonly subtitle: string } | undefined {
  const heading = STEP_HEADINGS[step];

  return heading === undefined
    ? undefined
    : { title: text(heading.title), subtitle: text(heading.subtitle) };
}

/**
 * The units a browser's language suggests: the United States and a few others measure in
 * Fahrenheit.
 *
 * @param language - The browser's language tag.
 * @returns Imperial for those, metric for the rest.
 */
export function unitsFor(language: string): 'metric' | 'imperial' {
  return ['en-US', 'en-LR', 'my-MM'].includes(language) ? 'imperial' : 'metric';
}

/** What has been typed so far. */
export type FirstRunDraft = {
  readonly displayName: string;
  readonly username: string;
  readonly isUsernameEdited: boolean;
  readonly password: string;
  readonly homeName: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly timeZone: string;
  readonly units: 'metric' | 'imperial';
};

/**
 * An empty form, with what the browser can suggest.
 *
 * @returns The draft.
 */
export function emptyFirstRunDraft(): FirstRunDraft {
  return {
    displayName: '',
    username: '',
    isUsernameEdited: false,
    password: '',
    homeName: '',
    latitude: '',
    longitude: '',
    timeZone: BROWSER_ZONE,
    units: unitsFor(globalThis.navigator.language),
  };
}

/** Which step the first run is on and what has been typed, shared with the frame. */
export const useFirstRunStep = create<{
  readonly step: number;
  readonly draft: FirstRunDraft;
  readonly setStep: (step: number) => void;
  readonly edit: (changes: Partial<FirstRunDraft>) => void;
  readonly reset: () => void;
}>((set) => ({
  step: 0,
  draft: emptyFirstRunDraft(),

  /**
   * Moves to a step.
   *
   * @param step - Which, from 0.
   */
  setStep: (step) => {
    set({ step });
  },

  /**
   * Keeps what was typed.
   *
   * @param changes - The fields that changed.
   */
  edit: (changes) => {
    set((state) => ({ draft: { ...state.draft, ...changes } }));
  },

  /** Forgets everything typed, the password first among it. */
  reset: () => {
    set({ step: 0, draft: emptyFirstRunDraft() });
  },
}));

/**
 * Suggests a username from the name someone typed.
 *
 * A convenience, not a constraint: the field stays editable, and the suggestion stops the moment
 * the person edits it themselves.
 *
 * @param displayName - What they typed as their name.
 * @returns A username that satisfies the API's pattern.
 */
export function toUsername(displayName: string): string {
  return displayName
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[̀-ͯ]/g, '')
    .replaceAll(/[^a-z0-9._-]+/g, '.')
    .replaceAll(/^[.]+|[.]+$/g, '')
    .slice(0, 64);
}

/** The languages the house may speak, each by its own name. */
const LANGUAGE_CHOICES = SUPPORTED_LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_NAMES[locale],
}));

/**
 * Renders the first-run form.
 *
 * @returns The form.
 */
export function FirstRunForm() {
  const { t } = useTranslation();
  const createFirstOwner = useSession((state) => state.createFirstOwner);
  const language = useSession((state) => state.language);
  const chooseSetupLanguage = useSession((state) => state.chooseSetupLanguage);
  const step = useFirstRunStep((state) => state.step);
  const setStep = useFirstRunStep((state) => state.setStep);
  const draft = useFirstRunStep((state) => state.draft);
  const edit = useFirstRunStep((state) => state.edit);
  const reset = useFirstRunStep((state) => state.reset);
  const device = useDevicePosition();
  const [zoneChoices] = useState(timeZoneChoices);

  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);

  const isAccountDone =
    draft.displayName.trim() !== '' &&
    draft.username !== '' &&
    isPasswordAcceptable(draft.password);
  const parsed = parsePosition(draft.latitude, draft.longitude);
  const position: HousePosition | null = 'position' in parsed ? parsed.position : null;
  const isHomeDone = draft.homeName.trim() !== '' && position !== null;

  /**
   * Continues to the Home step, or creates the account and the home.
   *
   * @param event - The submit event, whose default navigation is prevented.
   */
  const onSubmit: SubmitEventHandler<HTMLFormElement> = (event): void => {
    event.preventDefault();

    if (step === 0) {
      if (isAccountDone) {
        setStep(1);
      }

      return;
    }

    if (!isHomeDone) {
      return;
    }

    setError(undefined);
    setBusy(true);

    void (async (): Promise<void> => {
      try {
        await createFirstOwner({
          username: draft.username,
          displayName: draft.displayName.trim(),
          password: draft.password,

          // The language the setup was read in is the house's.
          locale: language,

          // The browser knows this and the person should not have to be asked. It is editable
          // later in settings, which is where a wrong guess gets corrected.
          timezone: BROWSER_ZONE,
          home: {
            name: draft.homeName.trim(),
            latitude: position.latitude,
            longitude: position.longitude,
            timeZone: draft.timeZone,
            temperatureUnit: draft.units === 'imperial' ? 'fahrenheit' : 'celsius',
          },
        });
        reset();
      } catch (cause: unknown) {
        setError(toMessage(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      {step === 0 ? (
        <>
          <SelectField
            label={t('firstRun.account.language', 'Language')}
            hint={t(
              'firstRun.account.languageHint',
              'What the house speaks. Everyone can choose their own later.',
            )}
            options={LANGUAGE_CHOICES}
            value={language}
            onChange={(value) => {
              if (isSupportedLocale(value)) {
                chooseSetupLanguage(value);
              }
            }}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label={t('firstRun.account.name', 'Your name')}
              name="name"
              autoComplete="name"
              autoFocus
              required
              value={draft.displayName}
              onChange={(event) => {
                edit({
                  displayName: event.target.value,
                  ...(draft.isUsernameEdited ? {} : { username: toUsername(event.target.value) }),
                });
              }}
            />
            <TextField
              label={t('firstRun.account.username', 'Username')}
              name="username"
              autoComplete="username"
              required
              value={draft.username}
              onChange={(event) => {
                edit({ username: event.target.value, isUsernameEdited: true });
              }}
              hint={t(
                'firstRun.account.usernameHint',
                'Lower case letters, digits, dot, dash and underscore.',
              )}
            />
          </div>

          <PasswordField
            label={t('firstRun.account.password', 'Password')}
            autoComplete="new-password"
            required
            value={draft.password}
            onChange={(password) => {
              edit({ password });
            }}
          />

          <p className="flex items-center gap-2.5 rounded-inner bg-surface-raised px-3.5 py-3 text-ui-sm text-foreground-muted">
            <AppIcon id="lock" size={15} className="shrink-0 text-primary" />
            {t(
              'firstRun.account.ownerNote',
              'This first account is the owner: it can do everything, including adding the others.',
            )}
          </p>
        </>
      ) : (
        <>
          {error === undefined ? null : <Note tone="danger">{error}</Note>}

          <TextField
            label={t('firstRun.home.name', 'Name of the home')}
            name="home-name"
            autoFocus
            required
            placeholder={t('firstRun.home.namePlaceholder', 'The Rossi house')}
            value={draft.homeName}
            onChange={(event) => {
              edit({ homeName: event.target.value });
            }}
          />

          <div className="flex flex-col gap-2">
            <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <TextField
                label={t('firstRun.home.latitude', 'Latitude')}
                inputMode="decimal"
                className="font-mono"
                placeholder="45.4642"
                value={draft.latitude}
                error={'problem' in parsed && draft.latitude !== '' ? parsed.problem : undefined}
                onChange={(event) => {
                  edit({ latitude: event.target.value });
                }}
              />
              <TextField
                label={t('firstRun.home.longitude', 'Longitude')}
                inputMode="decimal"
                className="font-mono"
                placeholder="9.1900"
                value={draft.longitude}
                onChange={(event) => {
                  edit({ longitude: event.target.value });
                }}
              />
              <Button
                variant="ghost"
                className="sm:mt-6.5"
                isBusy={device.isAsking}
                disabled={device.unavailableReason !== undefined}
                title={device.unavailableReason}
                onClick={() => {
                  device.ask((found) => {
                    edit({ latitude: String(found.latitude), longitude: String(found.longitude) });
                  });
                }}
              >
                <AppIcon id="map-pin" size={15} />
                {t('firstRun.home.useDevice', 'Use this device')}
              </Button>
            </div>
            {device.error === undefined && device.unavailableReason === undefined ? null : (
              <span className="text-caption text-foreground-subtle">
                {device.error ?? device.unavailableReason}
              </span>
            )}
            <HomeLocationPreview position={position} timeZone={draft.timeZone} />
            <span className="text-caption text-foreground-subtle">
              {t(
                'firstRun.home.positionNote',
                'Used for sunrise and sunset, weather and solar. It stays on this machine.',
              )}
            </span>
          </div>

          <div className="grid items-start gap-5 sm:grid-cols-2">
            <SelectField
              label={t('firstRun.home.timeZone', 'Time zone')}
              options={zoneChoices}
              value={draft.timeZone}
              onChange={(timeZone) => {
                edit({ timeZone });
              }}
            />
            <div className="flex flex-col gap-2">
              <span className="text-caption font-medium text-foreground-muted">
                {t('firstRun.home.units', 'Units')}
              </span>
              <Segmented
                label={t('firstRun.home.units', 'Units')}
                options={[
                  { value: 'metric', label: t('firstRun.home.metric', 'Metric') },
                  { value: 'imperial', label: t('firstRun.home.imperial', 'Imperial') },
                ]}
                value={draft.units}
                onChange={(units) => {
                  edit({ units });
                }}
              />
            </div>
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
        {step === 0 ? (
          <span />
        ) : (
          <Button
            variant="bare"
            onClick={() => {
              setStep(0);
            }}
          >
            <AppIcon id="chevron-left" size={15} />
            {t('firstRun.back', 'Back')}
          </Button>
        )}
        <Button type="submit" isBusy={isBusy} disabled={step === 0 ? !isAccountDone : !isHomeDone}>
          {step === 0 ? t('firstRun.continue', 'Continue') : t('firstRun.create', 'Create my home')}
          <AppIcon id="arrow-right" size={15} />
        </Button>
      </div>
    </form>
  );
}
