/**
 * The MQTT broker's page and the brokers' cards, drawn from a cache already holding the broker: the
 * strip and how to connect on Overview, a device removed from the house offered back, and a client's
 * password shown once.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MqttDevice, MqttStatus } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { BROKER_QUERY_KEYS } from '@/library/brokers-api';
import { SAMPLE_OWNER } from '@/testing/backup-samples';

import { MqttBrokerPage } from './broker-mqtt-page';
import { BrokersPage } from './brokers-page';

vi.mock('@/library/brokers-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  addMqttClient: vi.fn(async (request: { username: string }) =>
    Promise.resolve({ username: request.username, password: 'once-only' }),
  ),
}));

/** Where the broker stands. */
const STATUS: MqttStatus = {
  state: 'running',
  error: null,
  port: 1883,
  startedAt: new Date(),
  settings: { allowAnonymous: false, isDiscoveryEnabled: true, discoveryPrefix: 'homeassistant' },
  clientsOnline: 2,
  messagesPerSecond: 0.4,
  discovery: { announced: 3, mapped: 1, devices: 2, skipped: [] },
};

/** A plug the broker hears, removed from the house. */
const PLUG: MqttDevice = {
  identity: {
    deviceKey: 'C82B96',
    source: 'announced',
    name: 'Desk lamp',
    manufacturer: 'Itead',
    model: 'Sonoff S26',
    modelId: null,
    swVersion: '14.2.0',
    hwVersion: null,
    serialNumber: null,
    identifiers: ['C82B96'],
    macAddresses: [],
    viaDevice: null,
    originName: 'Tasmota',
    originSwVersion: null,
    components: ['switch'],
  },
  entityCount: 1,
  deviceId: null,
  kind: null,
  claimedBy: [],
  isRemoved: true,
};

/**
 * A cache holding the broker.
 *
 * @returns It.
 */
function cache(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } },
  });

  client.setQueryData(BROKER_QUERY_KEYS.mqttStatus, STATUS);
  client.setQueryData(BROKER_QUERY_KEYS.mqttDevices, [PLUG]);
  client.setQueryData(BROKER_QUERY_KEYS.mqttClients, { items: [], anonymous: [] });
  client.setQueryData(BROKER_QUERY_KEYS.mqttMappings, []);
  client.setQueryData(BROKER_QUERY_KEYS.brokers, [
    { id: 'matter', state: 'running', devices: { total: 6, online: 5, linked: 1 } },
    { id: 'mqtt', state: 'failed', devices: { total: 2, online: 2, linked: 0 } },
  ]);

  return client;
}

/**
 * Draws a page over the cache.
 *
 * @param page - The page.
 */
function renderPage(page: React.ReactNode): void {
  render(
    <QueryClientProvider client={cache()}>
      <MemoryRouter initialEntries={['/brokers/mqtt']}>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSession.setState({ status: 'signed-in', user: SAMPLE_OWNER });
});

describe('MqttBrokerPage', () => {
  it('says how the broker stands, and how a device connects to it', () => {
    renderPage(<MqttBrokerPage />);

    expect(screen.getAllByText('TCP 1883').length).toBeGreaterThan(0);
    expect(screen.getByText('2 online')).toBeTruthy();
    expect(screen.getByText('2 devices')).toBeTruthy();
    expect(screen.getByText('3 announced · 1 mapped')).toBeTruthy();
    expect(screen.getByText(/^mosquitto_pub -h /u)).toBeTruthy();
  });

  it('offers back a device removed from the house', () => {
    renderPage(<MqttBrokerPage />);
    fireEvent.click(screen.getByRole('tab', { name: /Devices/u }));

    expect(screen.getByText('Desk lamp')).toBeTruthy();
    expect(screen.getByText('Itead · Sonoff S26 · Tasmota · 1 entity')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add back' })).toBeTruthy();
  });

  it('shows a new client’s password once', async () => {
    renderPage(<MqttBrokerPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add client' }));

    const dialog = screen.getByRole('dialog', { name: 'Add a client' });

    fireEvent.change(within(dialog).getByLabelText('Username'), { target: { value: 'Plug' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    const made = await screen.findByRole('dialog', { name: 'plug can connect' });

    expect(within(made).getByText('once-only')).toBeTruthy();
  });
});

describe('BrokersPage', () => {
  it('draws a card for each broker, how it stands and its devices', () => {
    renderPage(<BrokersPage />);

    expect(screen.getByRole('link', { name: 'Matter' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'MQTT' }).getAttribute('href')).toBe('/brokers/mqtt');
    expect(screen.getByText('6 devices')).toBeTruthy();
    expect(screen.getByText('2 devices')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
  });
});
