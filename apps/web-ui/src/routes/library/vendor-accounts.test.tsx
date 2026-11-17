import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  entityIdSchema,
  type DeviceRemoval,
  type IntegrationAccountView,
  type IntegrationVendorView,
} from '@nebulahome/contracts';

import {
  answerAccountSignIn,
  beginAccountSignIn,
  deleteDevice,
  previewDeviceRemoval,
  signOutOfAccount,
} from '@/library/api';
import { aDevice } from '@/testing/fixtures';
import { VENDORS } from '@/testing/printer-fixtures';

import { VendorAccounts } from './vendor-accounts';

vi.mock('@/library/api', async (importOriginal) => ({
  // The query keys, and what the removal preview's modules read at load.
  ...(await importOriginal<object>()),
  beginAccountSignIn: vi.fn(),
  answerAccountSignIn: vi.fn(),
  pollAccountSignIn: vi.fn(),
  signOutOfAccount: vi.fn(),
  deleteDevice: vi.fn(),
  previewDeviceRemoval: vi.fn(),
  fetchDevices: vi.fn(() => Promise.resolve([])),
  fetchIcons: vi.fn(() => Promise.resolve([])),
  fetchVendors: vi.fn(() => Promise.resolve([])),
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
function last<TElement extends HTMLElement>(elements: readonly TElement[]): TElement {
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
      <MemoryRouter>
        <VendorAccounts vendor={vendor} devices={devices} canConfigure />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A removal that takes only what was asked and stops nothing. */
const NOTHING_ELSE: DeviceRemoval = {
  devices: [],
  usedBy: { automations: [], scenes: [], dashboards: [], aliases: [] },
  blockedBy: { aliases: [] },
};

beforeEach(() => {
  vi.mocked(beginAccountSignIn).mockReset();
  vi.mocked(answerAccountSignIn).mockReset();
  vi.mocked(signOutOfAccount).mockReset();
  vi.mocked(deleteDevice).mockReset();
  vi.mocked(previewDeviceRemoval).mockReset().mockResolvedValue(NOTHING_ELSE);
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
    // Once what the removal takes has been read.
    await waitFor(() => {
      expect(
        last(screen.getAllByRole<HTMLButtonElement>('button', { name: 'Remove' })).disabled,
      ).toBe(false);
    });
    fireEvent.click(last(screen.getAllByRole('button', { name: 'Remove' })));

    await waitFor(() => {
      expect(signOutOfAccount).toHaveBeenCalledWith('ecovacs', 'uid-42');
    });
    expect(deleteDevice).toHaveBeenCalledWith('ecovacs-goat');
    expect(deleteDevice).not.toHaveBeenCalledWith('ecovacs-other');
  });

  it('removes a parent and leaves its parts to the server, saying what stops working', async () => {
    vi.mocked(signOutOfAccount).mockResolvedValue({ wasSignedIn: true });
    vi.mocked(deleteDevice).mockResolvedValue();
    vi.mocked(previewDeviceRemoval).mockResolvedValue({
      ...NOTHING_ELSE,
      usedBy: { ...NOTHING_ELSE.usedBy, scenes: [{ id: 'scene-1', name: 'Evening' }] },
    });
    const station = aDevice({
      id: 'ecovacs-station',
      transportConfig: { account: 'uid-42' },
      childIds: ['ecovacs-dock'],
    });
    const dock = aDevice({
      id: 'ecovacs-dock',
      transportConfig: { account: 'uid-42' },
      parentId: 'ecovacs-station',
    });

    renderPanel(ecovacs([SIGNED_IN]), [station, dock]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText(/Stops working until pointed elsewhere · 1/u)).toBeTruthy();
    expect(previewDeviceRemoval).toHaveBeenCalledWith(
      ['ecovacs-station', 'ecovacs-dock'],
      expect.anything(),
    );

    fireEvent.click(last(screen.getAllByRole('button', { name: 'Remove' })));

    await waitFor(() => {
      expect(signOutOfAccount).toHaveBeenCalledWith('ecovacs', 'uid-42');
    });
    expect(deleteDevice).toHaveBeenCalledTimes(1);
    expect(deleteDevice).toHaveBeenCalledWith('ecovacs-station');
  });

  it('holds the removal back while an alias reads one of the devices', async () => {
    vi.mocked(previewDeviceRemoval).mockResolvedValue({
      ...NOTHING_ELSE,
      blockedBy: {
        aliases: [
          {
            id: 'alias-1',
            name: 'House battery',
            reads: [
              {
                entityId: entityIdSchema.parse('sensor.goat_battery'),
                name: 'Battery',
                deviceName: 'GOAT',
              },
            ],
          },
        ],
      },
    });
    const mower = aDevice({ id: 'ecovacs-goat', transportConfig: { account: 'uid-42' } });

    renderPanel(ecovacs([SIGNED_IN]), [mower]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('House battery')).toBeTruthy();
    expect(
      last(screen.getAllByRole<HTMLButtonElement>('button', { name: 'Remove' })).disabled,
    ).toBe(true);
  });
});
