/**
 * The gallery's sections for the newer brokers - Infrared, Serial, Bluetooth, Thread - and the
 * Matter additions: their real pages over the sample houses in `testing/*-samples.ts`, each tab
 * drawn as its page shows it, and their dialogs one button away. Development only.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

import { Button } from '@nebulahome/ui';

import { INFRARED_QUERY_KEYS } from '@/library/infrared-api';
import {
  AddProxyDialog,
  BluetoothSettingsDialog,
} from '@/routes/library/broker-bluetooth/bluetooth-dialogs';
import { BluetoothBrokerPage } from '@/routes/library/broker-bluetooth-page';
import { AddRemoteDialog } from '@/routes/library/broker-infrared/add-remote-dialog';
import { ImportDialog } from '@/routes/library/broker-infrared/import-dialog';
import { LearnDialog } from '@/routes/library/broker-infrared/learn-dialog';
import { InfraredRemotePage } from '@/routes/library/broker-infrared/remote-page';
import { InfraredBrokerPage } from '@/routes/library/broker-infrared-page';
import { AddMatterDialog } from '@/routes/library/broker-matter/add-dialog';
import { MatterSettingsDialog } from '@/routes/library/broker-matter/matter-settings-dialog';
import {
  ConsoleDialog,
  NetworkPortDialog,
  SerialSettingsDialog,
  UseWithDialog,
} from '@/routes/library/broker-serial/serial-dialogs';
import { SerialBrokerPage } from '@/routes/library/broker-serial-page';
import {
  Ipv6FixDialog,
  ThreadSettingsDialog,
  ThreadSetupDialog,
} from '@/routes/library/broker-thread/thread-dialogs';
import { ThreadBrokerPage } from '@/routes/library/broker-thread-page';
import { DeviceDialog } from '@/routes/library/device-dialog';
import { BLUETOOTH_SAMPLE_STATUS, bluetoothSampleCache } from '@/testing/bluetooth-samples';
import { SAMPLE_AREAS } from '@/testing/broker-samples';
import {
  INFRARED_SAMPLE_BLASTERS,
  INFRARED_SAMPLE_TV,
  INFRARED_SAMPLE_TV_ID,
  infraredLearnSample,
  infraredSampleCache,
  necSample,
} from '@/testing/infrared-samples';
import { matterNewDeviceSample, matterSampleCache } from '@/testing/matter-samples';
import {
  SERIAL_SAMPLE_FREE_ID,
  SERIAL_SAMPLE_PORTS,
  SERIAL_SAMPLE_STATUS,
  SERIAL_SAMPLE_VENDORS,
  serialSampleCache,
} from '@/testing/serial-samples';
import {
  THREAD_SAMPLE_BEFORE,
  THREAD_SAMPLE_IPV6,
  THREAD_SAMPLE_NO_HOST,
  THREAD_SAMPLE_STATUS,
  threadSampleCache,
} from '@/testing/thread-samples';

/** What a section needs. */
type SectionProps = {
  readonly title: string;
  readonly note: string;
  readonly children: ReactNode;
};

/**
 * One group of specimens, as the gallery draws them.
 *
 * @param props - See {@link SectionProps}.
 * @returns The section.
 */
function Section(props: SectionProps) {
  return (
    <section aria-label={props.title} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-headline-sm font-medium">{props.title}</h2>
        <p className="text-caption text-foreground-subtle">{props.note}</p>
      </div>
      <div className="flex flex-wrap items-start gap-4">{props.children}</div>
    </section>
  );
}

/**
 * A page of a broker over its sample cache, at an address.
 *
 * @param props - The cache, the address and the page.
 * @param props.cache - The sample cache.
 * @param props.at - The address, with its tab.
 * @param props.path - The route's pattern, for a page with parameters.
 * @param props.children - The page.
 * @returns The page.
 */
function SamplePage(props: {
  readonly cache: QueryClient;
  readonly at: string;
  readonly path?: string;
  readonly children: ReactNode;
}) {
  return (
    <QueryClientProvider client={props.cache}>
      <MemoryRouter initialEntries={[props.at]}>
        <div className="w-full">
          {props.path === undefined ? (
            props.children
          ) : (
            <Routes>
              <Route path={props.path} element={props.children} />
            </Routes>
          )}
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Buttons that each open one dialog over a sample cache.
 *
 * @param props - The cache and the dialogs.
 * @param props.cache - The sample cache.
 * @param props.names - Each dialog's button.
 * @param props.render - A dialog by its button's name, given how it closes.
 * @returns The buttons, and the dialog open.
 */
function DialogSamples(props: {
  readonly cache: QueryClient;
  readonly names: readonly string[];
  readonly render: (name: string, close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);

  /** Closes the dialog open. */
  const close = (): void => {
    setOpen(null);
  };

  return (
    <QueryClientProvider client={props.cache}>
      <MemoryRouter>
        <div className="flex flex-wrap gap-2">
          {props.names.map((name) => (
            <Button
              key={name}
              variant="ghost"
              data-open={name}
              onClick={() => {
                setOpen(name);
              }}
            >
              {name}
            </Button>
          ))}
        </div>
        {open === null ? null : props.render(open, close)}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** The Infrared broker's tabs. */
const INFRARED_TABS = ['overview', 'remotes', 'blasters'] as const;

/** The caches the Infrared samples read: a house with blasters, and one with none. */
const INFRARED_CACHE = infraredSampleCache();
const INFRARED_EMPTY_CACHE = infraredSampleCache(true);

/** A Flipper Zero file with two buttons, for Import. */
const FLIPPER_SAMPLE = [
  'Filetype: IR signals file',
  'Version: 1',
  '#',
  'name: Power',
  'type: parsed',
  'protocol: NECext',
  'address: 04 00 00 00',
  'command: 08 00 00 00',
  '#',
  'name: Vol_up',
].join('\n');

INFRARED_CACHE.setQueryData(['brokers', 'infrared', 'import', 'LG_TV.ir', FLIPPER_SAMPLE], {
  items: [
    ['Power', 0x08],
    ['Volume +', 0x02],
    ['Volume -', 0x03],
    ['Mute', 0x09],
    ['Input', 0x0b],
  ].map(([name, command]) => ({
    name: String(name),
    format: 'flipper' as const,
    code: necSample(0x04, Number(command)),
  })),
  problems: [
    { line: 41, text: 'type: raw', reason: 'A raw entry with no data line' },
    { line: 57, text: 'protocol: Kaseikyo', reason: 'Kaseikyo is not a protocol the house reads' },
  ],
});

for (const phase of ['listening', 'captured', 'failed', 'sweeping'] as const) {
  INFRARED_CACHE.setQueryData([...INFRARED_QUERY_KEYS.learn, `learn-${phase}`], {
    ...infraredLearnSample(phase),
    id: `learn-${phase}`,
  });
}

/** The Serial broker's tabs. */
const SERIAL_TABS = ['overview', 'ports', 'devices'] as const;

/** The caches the Serial samples read: a house with ports, and a container that sees none. */
const SERIAL_CACHE = serialSampleCache();
const SERIAL_EMPTY_CACHE = serialSampleCache(true);

/** Victron's VE.Direct, the integration whose serial driver the add dialog shows. */
const VICTRON = SERIAL_SAMPLE_VENDORS.find((vendor) => vendor.id === 'victron');

/** The free VE.Direct cable. */
const SERIAL_FREE =
  SERIAL_SAMPLE_PORTS.find((port) => port.id === SERIAL_SAMPLE_FREE_ID) ?? SERIAL_SAMPLE_PORTS[0];

/** What a VE.Direct cable says, a field a line, as the console shows it. */
const VE_DIRECT_LINES = ['PID	0xA389', 'FW	0161', 'V	13284', 'I	-240', 'SOC	874', 'Alarm	OFF'];

/** The Bluetooth broker's tabs. */
const BLUETOOTH_TABS = ['overview', 'devices', 'map', 'nearby', 'scanners'] as const;

/** The caches the Bluetooth samples read: a house with an adapter and proxies, and one with none. */
const BLUETOOTH_CACHE = bluetoothSampleCache();
const BLUETOOTH_EMPTY_CACHE = bluetoothSampleCache(true);

BLUETOOTH_CACHE.setQueryData(['brokers', 'bluetooth', 'job', 'proxy-job'], {
  id: 'proxy-job',
  state: 'running',
  startedAt: new Date('2026-10-27T10:00:00Z'),
  finishedAt: null,
  error: null,
  deviceId: 'shelly-office-plug',
  mode: 'passive',
  steps: [
    { id: 'installing', state: 'done', message: null },
    { id: 'started', state: 'done', message: null },
    { id: 'first-report', state: 'running', message: null },
  ],
});

/** The Thread broker's tabs. */
const THREAD_TABS = ['overview', 'devices', 'network', 'border-routers'] as const;

/** The caches the Thread samples read: set up, before setup, on a bridge, IPv6 to fix. */
const THREAD_CACHE = threadSampleCache();
const THREAD_BEFORE_CACHE = threadSampleCache(THREAD_SAMPLE_BEFORE);
const THREAD_NO_HOST_CACHE = threadSampleCache(THREAD_SAMPLE_NO_HOST);
const THREAD_IPV6_CACHE = threadSampleCache(THREAD_SAMPLE_IPV6);

/** The setup job half way: the radio answered, the network forming. */
const THREAD_SETTING_UP = {
  ...THREAD_SAMPLE_STATUS,
  setup: {
    id: 'setup-1',
    state: 'running' as const,
    startedAt: new Date('2026-10-27T10:00:00Z'),
    finishedAt: null,
    error: null,
    steps: [
      { id: 'border-router' as const, state: 'done' as const, message: 'OTBR 2026.10.0' },
      { id: 'radio' as const, state: 'done' as const, message: 'RCP SL-OPENTHREAD/2.4.4.0' },
      { id: 'network' as const, state: 'running' as const, message: null },
      { id: 'matter' as const, state: 'pending' as const, message: null },
    ],
  },
};

/** The cache Matter's new dialogs read. */
const MATTER_CACHE = matterSampleCache();

MATTER_CACHE.setQueryData(['brokers', 'matter', 'networks'], {
  wifi: { ssid: 'Casa-2.4G', hasPassword: true },
  thread: { networkName: 'NebulaHome-1A2B', channel: 15 },
});

/**
 * The newer brokers' sections.
 *
 * @returns The sections.
 */
export function BrokerGallery() {
  return (
    <>
      {INFRARED_TABS.map((tab) => (
        <Section
          key={tab}
          title={`Infrared · ${tab}`}
          note="The house's Infrared broker over sample data: three blasters - one offline - four remotes, one without a blaster."
        >
          <SamplePage cache={INFRARED_CACHE} at={`/brokers/infrared?tab=${tab}`}>
            <InfraredBrokerPage />
          </SamplePage>
        </Section>
      ))}
      <Section
        title="Infrared · no blaster"
        note="What a real house sees until a blaster integration exists: No hardware, Add remote disabled with why."
      >
        <SamplePage cache={INFRARED_EMPTY_CACHE} at="/brokers/infrared">
          <InfraredBrokerPage />
        </SamplePage>
      </Section>
      <Section
        title="Infrared · remote"
        note="The living room TV's keypad: twelve buttons in a three-column grid, the Learn tile after the last. Drag a tile onto an empty cell."
      >
        <SamplePage
          cache={INFRARED_CACHE}
          at={`/brokers/infrared/remotes/${INFRARED_SAMPLE_TV_ID}`}
          path="/brokers/infrared/remotes/:remoteId"
        >
          <InfraredRemotePage />
        </SamplePage>
      </Section>
      <Section
        title="Infrared · dialogs"
        note="Add remote's three steps, Learn at each phase, Import with a Flipper file read."
      >
        <DialogSamples
          cache={INFRARED_CACHE}
          names={[
            'Add remote',
            'Learn · ready',
            'Learn · listening',
            'Learn · captured',
            'Learn · failed',
            'Learn · sweeping',
            'Import',
          ]}
          render={(name, close) =>
            name === 'Add remote' ? (
              <AddRemoteDialog
                isOpen
                onClose={close}
                blasters={INFRARED_SAMPLE_BLASTERS}
                rooms={SAMPLE_AREAS}
                roomOf={(areaId) => SAMPLE_AREAS.find((area) => area.id === areaId)?.name ?? null}
              />
            ) : name === 'Import' ? (
              <ImportDialog
                isOpen
                onClose={close}
                remote={INFRARED_SAMPLE_TV}
                initialText={FLIPPER_SAMPLE}
                initialFileName="LG_TV.ir"
              />
            ) : (
              <LearnDialog
                isOpen
                onClose={close}
                remote={INFRARED_SAMPLE_TV}
                jobId={name === 'Learn · ready' ? undefined : `learn-${name.slice(8)}`}
              />
            )
          }
        />
      </Section>
      {SERIAL_TABS.map((tab) => (
        <Section
          key={tab}
          title={`Serial · ${tab}`}
          note="The house's Serial broker: the SkyConnect Thread holds, a zigbee2mqtt coordinator, a ser2net port, a free VE.Direct cable Victron recognises, an unplugged CH340."
        >
          <SamplePage cache={SERIAL_CACHE} at={`/brokers/serial?tab=${tab}`}>
            <SerialBrokerPage />
          </SamplePage>
        </Section>
      ))}
      <Section
        title="Serial · no access"
        note="The container sees no port: the compose snippet and the Docker Desktop way round."
      >
        <SamplePage cache={SERIAL_EMPTY_CACHE} at="/brokers/serial?tab=ports">
          <SerialBrokerPage />
        </SamplePage>
      </Section>
      <Section
        title="Serial · dialogs"
        note="Use with… on the free VE.Direct cable, a serial driver's add dialog, a network port, Settings, the Console."
      >
        <DialogSamples
          cache={SERIAL_CACHE}
          names={['Use with', 'Serial device', 'Network port', 'Serial settings', 'Console']}
          render={(name, close) =>
            name === 'Use with' && SERIAL_FREE !== undefined ? (
              <UseWithDialog
                port={SERIAL_FREE}
                vendors={SERIAL_SAMPLE_VENDORS}
                onClose={close}
                onThread={close}
                onDevice={close}
              />
            ) : name === 'Serial device' && VICTRON !== undefined ? (
              <DeviceDialog
                target={{ mode: 'create', vendor: VICTRON, existingIds: [] }}
                onClose={close}
                onSaved={close}
              />
            ) : name === 'Network port' ? (
              <NetworkPortDialog onClose={close} />
            ) : name === 'Serial settings' ? (
              <SerialSettingsDialog
                status={SERIAL_SAMPLE_STATUS}
                ports={SERIAL_SAMPLE_PORTS.map((port, index) =>
                  index === 4 ? { ...port, isIgnored: true } : port,
                )}
                onClose={close}
              />
            ) : SERIAL_FREE === undefined ? null : (
              <ConsoleDialog
                port={SERIAL_FREE}
                onClose={close}
                sample={VE_DIRECT_LINES.map((text, index) => ({
                  seq: index + 1,
                  at: new Date(Date.parse('2026-10-27T10:41:02.118Z') + index),
                  direction: 'in' as const,
                  data: [...new TextEncoder().encode(text)]
                    .map((byte) => byte.toString(16).padStart(2, '0'))
                    .join(''),
                }))}
              />
            )
          }
        />
      </Section>
      {BLUETOOTH_TABS.map((tab) => (
        <Section
          key={tab}
          title={`Bluetooth · ${tab}`}
          note="The house's Bluetooth: this server's Intel adapter, three Shelly proxies - one with an outdated script - six devices, two found and what is heard nearby."
        >
          <SamplePage cache={BLUETOOTH_CACHE} at={`/brokers/bluetooth?tab=${tab}`}>
            <BluetoothBrokerPage holdsLease={false} openAddress="A4:C1:38:5E:91:0B" />
          </SamplePage>
        </Section>
      ))}
      <Section
        title="Bluetooth · no adapter"
        note="Docker Desktop: no adapter and no proxy yet, the way to a proxy and the D-Bus to mount on Linux."
      >
        <SamplePage cache={BLUETOOTH_EMPTY_CACHE} at="/brokers/bluetooth">
          <BluetoothBrokerPage holdsLease={false} />
        </SamplePage>
      </Section>
      <Section
        title="Bluetooth · dialogs"
        note="Add proxy's pick (with search, the ineligible greyed with why) and its progress; Settings."
      >
        <DialogSamples
          cache={BLUETOOTH_CACHE}
          names={['Add proxy', 'Add proxy · progress', 'Bluetooth settings']}
          render={(name, close) =>
            name === 'Bluetooth settings' ? (
              <BluetoothSettingsDialog status={BLUETOOTH_SAMPLE_STATUS} onClose={close} />
            ) : (
              <AddProxyDialog
                onClose={close}
                defaultMode="passive"
                roomOf={(areaId) => SAMPLE_AREAS.find((area) => area.id === areaId)?.name ?? null}
                {...(name === 'Add proxy' ? {} : { jobId: 'proxy-job' })}
              />
            )
          }
        />
      </Section>
      {THREAD_TABS.map((tab) => (
        <Section
          key={tab}
          title={`Thread · ${tab}`}
          note="The house's Thread network: the platform's border router on a SkyConnect, leader of NebulaHome-1A2B, three routers, end devices and an unknown node; a HomePod on this network, a Nest Hub on another."
        >
          <SamplePage cache={THREAD_CACHE} at={`/brokers/thread?tab=${tab}`}>
            <ThreadBrokerPage />
          </SamplePage>
        </Section>
      ))}
      <Section
        title="Thread · before setup"
        note="No tabs and no hero actions: the panel that says Thread needs a radio, Set up, and what it needs."
      >
        <SamplePage cache={THREAD_BEFORE_CACHE} at="/brokers/thread">
          <ThreadBrokerPage />
        </SamplePage>
      </Section>
      <Section
        title="Thread · no host"
        note="On a bridge network: the warning, and Set up disabled with why."
      >
        <SamplePage cache={THREAD_NO_HOST_CACHE} at="/brokers/thread">
          <ThreadBrokerPage />
        </SamplePage>
      </Section>
      <Section
        title="Thread · ipv6"
        note="The host does not take the border router's routes: the Border router card warns, with How to fix."
      >
        <SamplePage cache={THREAD_IPV6_CACHE} at="/brokers/thread">
          <ThreadBrokerPage />
        </SamplePage>
      </Section>
      <Section
        title="Thread · dialogs"
        note="Set up (radio, network, starting), Settings, How to fix."
      >
        <DialogSamples
          cache={THREAD_CACHE}
          names={['Set up', 'Set up · starting', 'Thread settings', 'How to fix']}
          render={(name, close) =>
            name === 'Set up' ? (
              <ThreadSetupDialog status={THREAD_SAMPLE_BEFORE} onClose={close} />
            ) : name === 'Set up · starting' ? (
              <ThreadSetupDialog status={THREAD_SETTING_UP} onClose={close} />
            ) : name === 'Thread settings' ? (
              <ThreadSettingsDialog status={THREAD_SAMPLE_STATUS} onClose={close} />
            ) : (
              <Ipv6FixDialog status={THREAD_SAMPLE_IPV6} onClose={close} />
            )
          }
        />
      </Section>
      <Section
        title="Matter · new devices"
        note="Add device's choice (New device off when the adapter cannot connect), a new device's code, its pairing, the stops on Thread and Wi-Fi, and Settings' networks."
      >
        <DialogSamples
          cache={MATTER_CACHE}
          names={[
            'Add · choice',
            'Add · no Bluetooth',
            'Add · pairing',
            'Add · needs Thread',
            'Add · needs Wi-Fi',
            'Matter settings',
          ]}
          render={(name, close) =>
            name === 'Matter settings' ? (
              <MatterSettingsDialog onClose={close} />
            ) : (
              <AddMatterDialog
                isOpen
                onClose={close}
                ble={
                  name === 'Add · no Bluetooth'
                    ? { isAvailable: false, reason: 'desktop' }
                    : { isAvailable: true, reason: null }
                }
                job={
                  name === 'Add · pairing'
                    ? matterNewDeviceSample()
                    : name === 'Add · needs Thread'
                      ? matterNewDeviceSample('needs-thread')
                      : name === 'Add · needs Wi-Fi'
                        ? matterNewDeviceSample('needs-wifi')
                        : null
                }
              />
            )
          }
        />
      </Section>
    </>
  );
}
