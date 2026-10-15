/**
 * The first run: the account, then the home, sent as one request at the end. The position is not
 * optional - the sun, the weather and the solar forecast start from it - and the Home step says
 * where the house is as it is typed.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSession } from '@/auth/session-store';
import { applyLanguage } from '@/i18n/language';

import { FirstRunForm, unitsFor, useFirstRunStep } from './first-run';

/** A password long enough for the rule, for a form that never sends it anywhere. */
const LONG_ENOUGH = 'correct horse battery';

/**
 * Types into a field found by its label.
 *
 * @param label - The label.
 * @param value - What to type.
 */
function type(label: string | RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/**
 * Fills the Account step and continues.
 */
function passAccount(): void {
  type('Your name', 'Mattia Carli');
  type(/^Password/u, LONG_ENOUGH);
  fireEvent.click(screen.getByRole('button', { name: /Continue/u }));
}

beforeEach(() => {
  useFirstRunStep.getState().reset();
  useSession.setState({ createFirstOwner: vi.fn().mockResolvedValue(undefined) });
});

describe('FirstRunForm', () => {
  it('asks for the account first, and continues once it would be accepted', () => {
    render(<FirstRunForm />);

    const next = screen.getByRole('button', { name: /Continue/u });

    expect(next.hasAttribute('disabled')).toBe(true);

    type('Your name', 'Mattia Carli');

    expect(screen.getByLabelText('Username')).toHaveProperty('value', 'mattia.carli');

    type(/^Password/u, LONG_ENOUGH);
    fireEvent.click(next);

    expect(useFirstRunStep.getState().step).toBe(1);
    expect(screen.getByLabelText('Name of the home')).toBeTruthy();
  });

  it('will not create the home without a name and a position', () => {
    render(<FirstRunForm />);
    passAccount();

    const create = screen.getByRole('button', { name: /Create my home/u });

    type('Name of the home', 'Casa Carli');
    expect(create.hasAttribute('disabled')).toBe(true);

    type('Latitude', '45.4642');
    expect(create.hasAttribute('disabled')).toBe(true);

    type('Longitude', '9.19');
    expect(create.hasAttribute('disabled')).toBe(false);
  });

  it('says what is wrong with a latitude that cannot be one', () => {
    render(<FirstRunForm />);
    passAccount();

    type('Latitude', '145');
    type('Longitude', '9');

    expect(screen.getByText(/latitude must be a number between -90 and 90/u)).toBeTruthy();
  });

  it('shows where the home is, with no position until one is typed', () => {
    render(<FirstRunForm />);
    passAccount();

    expect(screen.getByText('No position yet')).toBeTruthy();

    type('Latitude', '45.4642');
    type('Longitude', '9.19');

    expect(screen.getByText('45.46° N · 9.19° E')).toBeTruthy();
  });

  it('sends the account and the home as one request', async () => {
    const createFirstOwner = vi.fn().mockResolvedValue(undefined);

    useSession.setState({ createFirstOwner });
    render(<FirstRunForm />);
    passAccount();
    type('Name of the home', ' Casa Carli ');
    type('Latitude', '-33.8688');
    type('Longitude', '151.2093');
    fireEvent.click(screen.getByRole('radio', { name: 'Imperial' }));
    fireEvent.click(screen.getByRole('button', { name: /Create my home/u }));

    await waitFor(() => {
      expect(createFirstOwner).toHaveBeenCalledTimes(1);
    });
    expect(createFirstOwner.mock.calls[0]?.[0]).toMatchObject({
      username: 'mattia.carli',
      displayName: 'Mattia Carli',
      home: {
        name: 'Casa Carli',
        latitude: -33.8688,
        longitude: 151.2093,
        temperatureUnit: 'fahrenheit',
      },
    });
  });

  it('keeps what was typed when going back to the account', () => {
    render(<FirstRunForm />);
    passAccount();
    type('Name of the home', 'Casa Carli');
    fireEvent.click(screen.getByRole('button', { name: /Back/u }));

    expect(screen.getByLabelText('Your name')).toHaveProperty('value', 'Mattia Carli');

    fireEvent.click(screen.getByRole('button', { name: /Continue/u }));

    expect(screen.getByLabelText('Name of the home')).toHaveProperty('value', 'Casa Carli');
  });

  it('says why the device cannot be asked where the page is not secure', () => {
    render(<FirstRunForm />);
    passAccount();

    // jsdom is not a secure context, like a hub opened over plain http on the network.
    expect(screen.getByRole('button', { name: /Use this device/u }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText(/only over HTTPS or on this machine/u)).toBeTruthy();
  });
});

describe('the language of the house', () => {
  afterEach(async () => {
    useSession.setState({ language: 'en' });
    await applyLanguage('en');
  });

  it('switches the setup when another is picked, keeps what was typed, and sends it', async () => {
    const createFirstOwner = vi.fn().mockResolvedValue(undefined);

    useSession.setState({ createFirstOwner, language: 'en' });

    const { rerender } = render(<FirstRunForm />);

    type('Your name', 'Mattia Carli');
    fireEvent.click(screen.getByRole('combobox', { name: /^Language/u }));
    fireEvent.click(screen.getByRole('option', { name: 'Italiano' }));

    expect(useSession.getState().language).toBe('it');

    // The frame draws the form again, keyed by the language, once the catalogue is in.
    await applyLanguage('it');
    rerender(<FirstRunForm key="it" />);

    expect(screen.getByLabelText('Il tuo nome')).toHaveProperty('value', 'Mattia Carli');

    type(/^Password/u, LONG_ENOUGH);
    fireEvent.click(screen.getByRole('button', { name: /Continua/u }));
    type('Nome della casa', 'Casa Carli');
    type('Latitudine', '45.4642');
    type('Longitudine', '9.19');
    fireEvent.click(screen.getByRole('button', { name: /Crea la mia casa/u }));

    await waitFor(() => {
      expect(createFirstOwner).toHaveBeenCalledTimes(1);
    });
    expect(createFirstOwner.mock.calls[0]?.[0]).toMatchObject({ locale: 'it' });
  });
});

describe('unitsFor', () => {
  it('suggests Fahrenheit where the browser speaks American English', () => {
    expect(unitsFor('en-US')).toBe('imperial');
    expect(unitsFor('en-GB')).toBe('metric');
    expect(unitsFor('it-IT')).toBe('metric');
  });
});
