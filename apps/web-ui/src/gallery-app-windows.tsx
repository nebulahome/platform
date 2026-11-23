/**
 * The gallery's app windows: a page beside a rail with a floating player in its bottom-right
 * corner, and buttons that open sample pages in windows, to drag to the spots, resize, reload, hide
 * as tabs beside the player, and push past the limit of five, without signing in. The sample pages
 * are this dev server's own; with no session, no cookie is laid. Development only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';

import { Button, toast } from '@nebulahome/ui';

import { AppWindowsLayer } from '@/app-windows/app-windows-layer';
import { useAppWindows } from '@/app-windows/app-windows-store';
import { ingressSession } from '@/app-windows/session';
import { FloatingLayer } from '@/packages/floating/floating-layer';
import { FloatingWindow } from '@/packages/floating/floating-window';

/** No session in the gallery: there is no cookie to lay, and the sample pages need none. */
ingressSession.open = async (): Promise<void> => {
  // Nothing to do.
};

/** The gallery's own cache: the integrations it asks for are not there, so each falls back. */
const CACHE = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Sample pages: the dev server's own, standing in for containers' pages. */
const SAMPLES = [
  { name: 'zigbee2mqtt', title: 'Zigbee2MQTT', path: '/palette.html' },
  { name: 'esphome', title: 'ESPHome', path: '/calendar-lab.html' },
  { name: 'zwave', title: 'Z-Wave JS UI', path: '/palette.html?zwave' },
  { name: 'frigate', title: 'Frigate', path: '/palette.html?frigate' },
  { name: 'go2rtc', title: 'go2rtc', path: '/palette.html?go2rtc' },
  { name: 'node-red', title: 'Node-RED', path: '/palette.html?node-red' },
];

/** Cards on the sample page, for the glass to blur. */
const PAGE_CARDS = ['bg-surface-raised', 'bg-primary/40', 'bg-surface-high', 'bg-media/40'];

/**
 * Renders the app windows' sample.
 *
 * @returns The sample.
 */
export function AppWindowsSample() {
  const [isPlayerOpen, setPlayerOpen] = useState(true);

  return (
    <QueryClientProvider client={CACHE}>
      <MemoryRouter>
        <div className="flex w-full flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((sample) => (
              <Button
                key={sample.name}
                size="compact"
                variant="ghost"
                onClick={() => {
                  useAppWindows.getState().open({ ...sample, vendorId: sample.name });
                }}
              >
                Open {sample.title}
              </Button>
            ))}
            <Button
              size="compact"
              variant="ghost"
              disabled={isPlayerOpen}
              onClick={() => {
                setPlayerOpen(true);
              }}
            >
              Reopen the player
            </Button>
            <Button
              size="compact"
              variant="ghost"
              onClick={() => {
                toast.info({ title: 'Automation ran', message: 'Evening · 6 lights, 2 blinds.' });
              }}
            >
              Show a toast
            </Button>
          </div>

          <div
            data-app-windows-demo=""
            className="flex h-180 w-full overflow-hidden rounded-panel border border-border bg-canvas"
          >
            <div className="flex shrink-0 py-4 pl-4">
              <div className="w-16 rounded-dialog border border-border-strong bg-surface shadow-rail" />
            </div>
            <div className="relative flex min-w-0 grow">
              <FloatingLayer>
                <div className="grid grow grid-cols-4 content-start gap-3 p-6">
                  {[...PAGE_CARDS, ...PAGE_CARDS].map((color, index) => (
                    // The cards are the same few colours over again; their place is their key.
                    // eslint-disable-next-line react/no-array-index-key -- see above.
                    <div key={index} className={`h-40 rounded-card ${color}`} />
                  ))}
                </div>
                <AppWindowsLayer />
                <FloatingWindow
                  packageId="demo.music"
                  open={isPlayerOpen}
                  label="Now playing"
                  onClose={() => {
                    setPlayerOpen(false);
                  }}
                  renderContent={() => (
                    <div className="flex h-[168px] w-[398px] flex-col justify-center gap-1 px-4">
                      <p className="text-ui font-medium">Midnight City</p>
                      <p className="text-caption text-foreground-subtle">M83 · Living room</p>
                    </div>
                  )}
                />
              </FloatingLayer>
            </div>
          </div>
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
