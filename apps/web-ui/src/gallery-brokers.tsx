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
import { AddRemoteDialog } from '@/routes/library/broker-infrared/add-remote-dialog';
import { ImportDialog } from '@/routes/library/broker-infrared/import-dialog';
import { LearnDialog } from '@/routes/library/broker-infrared/learn-dialog';
import { InfraredRemotePage } from '@/routes/library/broker-infrared/remote-page';
import { InfraredBrokerPage } from '@/routes/library/broker-infrared-page';
import { SAMPLE_AREAS } from '@/testing/broker-samples';
import {
  INFRARED_SAMPLE_BLASTERS,
  INFRARED_SAMPLE_TV,
  INFRARED_SAMPLE_TV_ID,
  infraredLearnSample,
  infraredSampleCache,
  necSample,
} from '@/testing/infrared-samples';

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
    </>
  );
}
