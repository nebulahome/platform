/**
 * The language row: following the house is a choice of its own, and a choice is saved on the
 * account and read back, which is what switches the interface.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionUser } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { applyLanguage } from '@/i18n/language';
import { updateUser } from '@/settings/api';

import { LanguageRow } from './language-row';

vi.mock('@/settings/api', () => ({ updateUser: vi.fn().mockResolvedValue({}) }));

/** Somebody following an Italian house. */
const USER: SessionUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'mattia',
  displayName: 'Mattia',
  role: 'owner',
  permissions: [],
  avatarUrl: null,
  locale: null,
  houseLocale: 'it',
  timezone: 'Europe/Rome',
  isTwoFactorEnabled: false,
  mustChangePassword: false,
};

beforeEach(() => {
  vi.mocked(updateUser).mockClear();
  useSession.setState({ user: USER, refreshUser: vi.fn().mockResolvedValue(undefined) });
});

afterEach(async () => {
  await applyLanguage('en');
});

describe('LanguageRow', () => {
  it("names the house's language as the choice of following it", () => {
    render(<LanguageRow />, { wrapper: MemoryRouter });

    expect(screen.getByRole('combobox').textContent).toContain('House language (Italiano)');
  });

  it('saves a language of their own and reads the account back', async () => {
    const refreshUser = vi.fn().mockResolvedValue(undefined);

    useSession.setState({ refreshUser });
    render(<LanguageRow />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'English' }));

    await waitFor(() => {
      expect(refreshUser).toHaveBeenCalledTimes(1);
    });
    expect(updateUser).toHaveBeenCalledWith(USER.id, { locale: 'en' });
  });

  it('goes back to following the house with null', async () => {
    useSession.setState({ user: { ...USER, locale: 'en' } });
    render(<LanguageRow />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: /^House language/u }));

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith(USER.id, { locale: null });
    });
  });

  it('speaks Italian to somebody who reads Italian', async () => {
    await applyLanguage('it');
    render(<LanguageRow />, { wrapper: MemoryRouter });

    expect(screen.getAllByText('Lingua').length).toBeGreaterThan(0);
    expect(screen.getByRole('combobox').textContent).toContain('Lingua della casa (Italiano)');
  });
});
