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
 * **Account** asks for the owner. The password floor is twelve characters and there are no
 * composition rules, which is the API's rule and not a relaxation of it: length is the axis that
 * costs an attacker anything, and demanding a symbol mostly produces the same word with an
 * exclamation mark after it.
 *
 * **Home** asks what the house is called, where it stands, its time zone and its units. The
 * position is required: sunrise and sunset, the sun's elevation, the weather and the solar
 * forecast all start from it, and it never leaves the machine. Both steps are one form and one
 * request at the end, so a setup abandoned half way leaves nothing behind.
 */
import { useState, type SubmitEventHandler } from 'react';
import { create } from 'zustand';

import { DEFAULT_LOCALE, matchSupportedLocale } from '@nebulahome/contracts';
import { AppIcon, Button, Note, Segmented, SelectField, TextField } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { HomeLocationPreview } from '@/components/home-location-preview';
import { PasswordField } from '@/components/password-field';
import { toMessage } from '@/lib/error-message';
import { parsePosition, type HousePosition } from '@/lib/house-position';
import { isPasswordAcceptable } from '@/lib/password-rules';
import { BROWSER_ZONE, timeZoneChoices } from '@/lib/time-zones';
import { useDevicePosition } from '@/lib/use-device-position';

/** The steps, as the indicator above the card names them. */
export const FIRST_RUN_STEPS = [{ name: 'Account' }, { name: 'Home' }] as const;

/** What each step's card says above its fields. */
export const FIRST_RUN_HEADINGS: readonly { readonly title: string; readonly subtitle: string }[] =
  [
    {
      title: 'Create your account',
      subtitle: 'This home has no accounts yet. The first one is yours.',
    },
    { title: 'Your home', subtitle: 'A name, where it is and how you measure things.' },
  ];

/** Which step the first run is on, shared with the frame that titles the card. */
export const useFirstRunStep = create<{
  readonly step: number;
  readonly setStep: (step: number) => void;
}>((set) => ({
  step: 0,
  /**
   * Moves to a step.
   *
   * @param step - Which, from 0.
   */
  setStep: (step) => {
    set({ step });
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

/** The zones, each with its offset, worked out once. */
const ZONE_CHOICES = timeZoneChoices();

/**
 * Renders the first-run form.
 *
 * @returns The form.
 */
export function FirstRunForm() {
  const createFirstOwner = useSession((state) => state.createFirstOwner);
  const step = useFirstRunStep((state) => state.step);
  const setStep = useFirstRunStep((state) => state.setStep);
  const device = useDevicePosition();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [isUsernameEdited, setUsernameEdited] = useState(false);
  const [password, setPassword] = useState('');

  const [homeName, setHomeName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [timeZone, setTimeZone] = useState(BROWSER_ZONE);
  const [units, setUnits] = useState(() => unitsFor(globalThis.navigator.language));

  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);

  const isAccountDone =
    displayName.trim() !== '' && username !== '' && isPasswordAcceptable(password);
  const parsed = parsePosition(latitude, longitude);
  const position: HousePosition | null = 'position' in parsed ? parsed.position : null;
  const isHomeDone = homeName.trim() !== '' && position !== null;

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
          username,
          displayName: displayName.trim(),
          password,

          // The browser knows both of these and the person should not have to be asked. They
          // are editable later in settings, which is where a wrong guess gets corrected.
          locale: matchSupportedLocale(globalThis.navigator.languages) ?? DEFAULT_LOCALE,
          timezone: BROWSER_ZONE,
          home: {
            name: homeName.trim(),
            latitude: position.latitude,
            longitude: position.longitude,
            timeZone,
            temperatureUnit: units === 'imperial' ? 'fahrenheit' : 'celsius',
          },
        });
        setStep(0);
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
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label="Your name"
              name="name"
              autoComplete="name"
              autoFocus
              required
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);

                if (!isUsernameEdited) {
                  setUsername(toUsername(event.target.value));
                }
              }}
            />
            <TextField
              label="Username"
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => {
                setUsernameEdited(true);
                setUsername(event.target.value);
              }}
              hint="Lower case letters, digits, dot, dash and underscore."
            />
          </div>

          <PasswordField
            label="Password"
            autoComplete="new-password"
            required
            value={password}
            onChange={setPassword}
          />

          <p className="flex items-center gap-2.5 rounded-inner bg-surface-raised px-3.5 py-3 text-ui-sm text-foreground-muted">
            <AppIcon id="lock" size={15} className="shrink-0 text-primary" />
            This first account is the owner: it can do everything, including adding the others.
          </p>
        </>
      ) : (
        <>
          {error === undefined ? null : <Note tone="danger">{error}</Note>}

          <TextField
            label="Name of the home"
            name="home-name"
            autoFocus
            required
            placeholder="The Rossi house"
            value={homeName}
            onChange={(event) => {
              setHomeName(event.target.value);
            }}
          />

          <div className="flex flex-col gap-2">
            <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <TextField
                label="Latitude"
                inputMode="decimal"
                className="font-mono"
                placeholder="45.4642"
                value={latitude}
                error={'problem' in parsed && latitude !== '' ? parsed.problem : undefined}
                onChange={(event) => {
                  setLatitude(event.target.value);
                }}
              />
              <TextField
                label="Longitude"
                inputMode="decimal"
                className="font-mono"
                placeholder="9.1900"
                value={longitude}
                onChange={(event) => {
                  setLongitude(event.target.value);
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
                    setLatitude(String(found.latitude));
                    setLongitude(String(found.longitude));
                  });
                }}
              >
                <AppIcon id="map-pin" size={15} />
                Use this device
              </Button>
            </div>
            {device.error === undefined && device.unavailableReason === undefined ? null : (
              <span className="text-caption text-foreground-subtle">
                {device.error ?? device.unavailableReason}
              </span>
            )}
            <HomeLocationPreview position={position} timeZone={timeZone} />
            <span className="text-caption text-foreground-subtle">
              Used for sunrise and sunset, weather and solar. It stays on this machine.
            </span>
          </div>

          <div className="grid items-start gap-5 sm:grid-cols-2">
            <SelectField
              label="Time zone"
              options={ZONE_CHOICES}
              value={timeZone}
              onChange={setTimeZone}
            />
            <div className="flex flex-col gap-2">
              <span className="text-caption font-medium text-foreground-muted">Units</span>
              <Segmented
                label="Units"
                options={[
                  { value: 'metric', label: 'Metric' },
                  { value: 'imperial', label: 'Imperial' },
                ]}
                value={units}
                onChange={setUnits}
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
            Back
          </Button>
        )}
        <Button type="submit" isBusy={isBusy} disabled={step === 0 ? !isAccountDone : !isHomeDone}>
          {step === 0 ? 'Continue' : 'Create my home'}
          <AppIcon id="arrow-right" size={15} />
        </Button>
      </div>
    </form>
  );
}
