import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationAccountView, IntegrationVendorView } from '@nebula-home/contracts';

import {
  answerAccountSignIn,
  beginAccountSignIn,
  deleteDevice,
  signOutOfAccount,
} from '@/library/api';
import { aDevice } from '@/testing/fixtures';
import { VENDORS } from '@/testing/printer-fixtures';

import { VendorAccounts } from './vendor-accounts';

vi.mock('@/library/api', () => ({
  beginAccountSignIn: vi.fn(),
  answerAccountSignIn: vi.fn(),
  pollAccountSignIn: vi.fn(),
  signOutOfAccount: vi.fn(),
  deleteDevice: vi.fn(),
  LIBRARY_QUERY_KEYS: { vendors: ['library', 'vendors'], devices: ['library', 'devices'] },
}));

/** An account, signed in. */
const SIGNED_IN: IntegrationAccountView = {
  vendorId: 'ecovacs',
  id: 'uid-42',
  label: 'owner@example.com',
  status: 'connected',
  lastError: null,
  connectedAt: new Date('2026-09-28T10:00:00.000Z'),
  updatedAt: new Date('2026-09-28T10:00:00.000Z'),
};

/**
 * ECOVACS, as its page is served, with the accounts given.
 *
 * @param accounts - Its accounts.
 * @returns The vendor.
 * @throws {Error} When the fixtures lost the vendor it is built from.
 */
function ecovacs(accounts: IntegrationAccountView[] = []): IntegrationVendorView {
  const base = VENDORS[0];

  if (base === undefined) {
    throw new Error('no fixture');
  }

  return {
    ...base,
    id: 'ecovacs',
    name: 'Ecovacs',
    adoption: 'automatic',
    account: {
      name: 'ECOVACS HOME account',
      fields: {
        constants: {},
        fields: [
          {
            key: 'email',
            type: 'text',
            label: 'Email',
            isRequired: true,
            maxLength: 256,
          },
          { key: 'password', type: 'secret', label: 'Password', isRequired: true, maxLength: 256 },
        ],
      },
      identity: 'email',
    },
    accounts,
    needsAccount: !accounts.some((account) => account.status === 'connected'),
  };
}

/**
 * The last of several elements: the dialog's button, after the panel's of the same name.
 *
 * @param elements - The elements, in document order.
 * @returns The last.
 * @throws {Error} When there is none.
 */
function last(elements: readonly HTMLElement[]): HTMLElement {
  const element = elements.at(-1);

  if (element === undefined) {
    throw new Error('none found');
  }

  return element;
}

/**
 * Draws the panel.
 *
 * @param vendor - The vendor.
 * @param devices - Its devices.
 */
function renderPanel(vendor: IntegrationVendorView, devices = [aDevice()]): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <VendorAccounts vendor={vendor} devices={devices} canConfigure />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(beginAccountSignIn).mockReset();
  vi.mocked(answerAccountSignIn).mockReset();
  vi.mocked(signOutOfAccount).mockReset();
  vi.mocked(deleteDevice).mockReset();
});

describe('VendorAccounts', () => {
  it('says no account is signed in yet, and signs in through the code the cloud emails', async () => {
    vi.mocked(beginAccountSignIn).mockResolvedValue({
      kind: 'ask',
      flowId: '8f0e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
      message: 'ECOVACS emailed a code to ow…@example.com',
      fields: [{ key: 'code', type: 'text', label: 'Code', isRequired: true, maxLength: 16 }],
    });
    vi.mocked(answerAccountSignIn).mockResolvedValue({ kind: 'connected', account: SIGNED_IN });
    renderPanel(ecovacs());

    expect(screen.getByText(/No ECOVACS HOME account signed in yet/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.change(await screen.findByLabelText(/Email/u), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Password/u), { target: { value: 'hunter2' } });
    fireEvent.click(last(screen.getAllByRole('button', { name: 'Sign in' })));

    expect(await screen.findByText('ECOVACS emailed a code to ow…@example.com')).toBeTruthy();
    expect(beginAccountSignIn).toHaveBeenCalledWith('ecovacs', {
      email: 'owner@example.com',
      password: 'hunter2',
    });

    fireEvent.change(screen.getByLabelText(/Code/u), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/Signed in as owner@example.com/u)).toBeTruthy();
    expect(answerAccountSignIn).toHaveBeenCalledWith(
      'ecovacs',
      '8f0e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
      { code: '123456' },
    );
  });

  it('puts a failure under the field it blames, keeping what was typed', async () => {
    vi.mocked(beginAccountSignIn).mockResolvedValue({
      kind: 'failed',
      message: 'ECOVACS does not know this password',
      field: 'password',
    });
    renderPanel(ecovacs());

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.change(await screen.findByLabelText(/Email/u), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Password/u), { target: { value: 'wrong' } });
    fireEvent.click(last(screen.getAllByRole('button', { name: 'Sign in' })));

    expect(await screen.findByText('ECOVACS does not know this password')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/Email/u).value).toBe('owner@example.com');
  });

  it('lists an account that needs signing in again, with why and the way to', () => {
    renderPanel(
      ecovacs([{ ...SIGNED_IN, status: 'needs-sign-in', lastError: 'ECOVACS wants a new code' }]),
    );

    expect(screen.getByText('owner@example.com')).toBeTruthy();
    expect(screen.getByText('ECOVACS wants a new code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeTruthy();
  });

  it('removes an account and, when asked, the devices that came with it', async () => {
    vi.mocked(signOutOfAccount).mockResolvedValue({ wasSignedIn: true });
    vi.mocked(deleteDevice).mockResolvedValue();
    const mower = aDevice({ id: 'ecovacs-goat', transportConfig: { account: 'uid-42' } });
    const other = aDevice({ id: 'ecovacs-other', transportConfig: { account: 'uid-7' } });

    renderPanel(ecovacs([SIGNED_IN]), [mower, other]);

    expect(screen.getByText(/1 device/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(last(await screen.findAllByRole('button', { name: 'Remove' })));

    await waitFor(() => {
      expect(signOutOfAccount).toHaveBeenCalledWith('ecovacs', 'uid-42');
    });
    expect(deleteDevice).toHaveBeenCalledWith('ecovacs-goat');
    expect(deleteDevice).not.toHaveBeenCalledWith('ecovacs-other');
  });
});
