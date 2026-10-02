/**
 * A package's dashboard card: drawn by the package while it runs, with its hooks speaking for
 * it; and, when it cannot be drawn, a card that says whose it is and why.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiPackage, DashboardPackageCard } from '@nebulahome/contracts';
import { usePackage, type PackageCardProps } from '@nebulahome/package-ui';

import { useSession } from '@/auth/session-store';
import type * as PackagesApi from '@/packages/api';
import { fetchPackages } from '@/packages/api';
import { importModule } from '@/packages/import-module';
import { aPackage } from '@/testing/package-fixtures';

import { PackageCard, packageCardSizeOf } from './package-card';

vi.mock('@/packages/import-module', () => ({ importModule: vi.fn() }));
vi.mock('@/packages/api', async (original) => ({
  ...(await original<typeof PackagesApi>()),
  fetchPackages: vi.fn(),
}));

/** The broker's card, as a layout keeps it. */
const CARD: DashboardPackageCard = {
  id: 'card-1',
  type: 'package',
  x: 0,
  y: 0,
  w: 2,
  h: 2,
  packageId: 'mqtt',
  cardId: 'broker',
  title: null,
  options: { topic: 'zigbee2mqtt/#' },
};

/**
 * The broker's card, as the package draws it: whose hooks it reaches, and what it was given.
 *
 * @param props - What the interface draws it with.
 * @returns The card's inside.
 */
function BrokerCard(props: PackageCardProps) {
  const found = usePackage();
  const topic = props.options['topic'];

  return (
    <p>
      {found.name} {props.size} {typeof topic === 'string' ? topic : ''}
    </p>
  );
}

/**
 * A card that throws.
 *
 * @throws {Error} Always.
 */
function BrokenCard(): never {
  throw new Error('the broker is on fire');
}

/**
 * Signs somebody in who may do what is given.
 *
 * @param permissions - Their permissions.
 */
function signIn(permissions: readonly string[]): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'member',
      permissions: permissions.map((key) => ({ key, scope: '*', effect: 'allow' as const })),
      avatarUrl: null,
      locale: 'it',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });
}

/**
 * Draws the card over the packages given.
 *
 * @param packages - What is installed.
 * @param card - The card.
 */
function renderCard(packages: ApiPackage[], card: DashboardPackageCard = CARD): void {
  vi.mocked(fetchPackages).mockResolvedValue(packages);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PackageCard card={card} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(importModule).mockReset();
  vi.mocked(fetchPackages).mockReset();
  signIn(['package:read']);
});

describe('PackageCard', () => {
  it("is drawn by its package, whose hooks speak for it, with the card's options and size", async () => {
    vi.mocked(importModule).mockResolvedValue({ default: { cards: { broker: BrokerCard } } });
    renderCard([aPackage({ version: '1.0.1' })]);

    expect(await screen.findByText('MQTT medium zigbee2mqtt/#')).toBeTruthy();
    expect(importModule).toHaveBeenCalledWith('/api/v1/packages/mqtt/ui/1.0.1/index.js');
  });

  it('keeps what a package that throws draws inside the card', async () => {
    vi.mocked(importModule).mockResolvedValue({ default: { cards: { broker: BrokenCard } } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderCard([aPackage({ version: '1.0.2' })]);

    expect(
      await screen.findByText('MQTT could not draw this card: the broker is on fire'),
    ).toBeTruthy();
  });

  it('says whose it is and why, when it cannot be drawn', async () => {
    renderCard([aPackage({ state: 'stopped' })]);

    expect(await screen.findByText('MQTT is stopped.')).toBeTruthy();
    expect(importModule).not.toHaveBeenCalled();
  });

  it('stays on the dashboard when its package is gone', async () => {
    renderCard([]);

    expect(
      await screen.findByText('A card of the mqtt package, which is not installed.'),
    ).toBeTruthy();
  });

  it('asks nothing of somebody whose role does not show packages', () => {
    signIn([]);
    renderCard([aPackage()]);

    expect(screen.getByText("A package's card, which your role does not show.")).toBeTruthy();
    expect(fetchPackages).not.toHaveBeenCalled();
  });
});

describe('packageCardSizeOf', () => {
  it("names the cells a card covers as its manifest's sizes", () => {
    expect(packageCardSizeOf({ w: 1, h: 1 })).toBe('small');
    expect(packageCardSizeOf({ w: 2, h: 1 })).toBe('wide');
    expect(packageCardSizeOf({ w: 2, h: 2 })).toBe('medium');
    expect(packageCardSizeOf({ w: 2, h: 3 })).toBe('large');
  });
});
