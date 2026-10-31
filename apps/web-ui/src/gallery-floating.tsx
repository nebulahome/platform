/**
 * The gallery's floating windows: a page beside a rail, with two packages' windows in its corners
 * to drag, throw, tuck past the right edge, close and step with the arrow keys without signing in,
 * and a toast to make room for. Development only.
 */
import { useState } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';

import { Button, cn, toast } from '@nebulahome/ui';

import { FloatingLayer } from '@/packages/floating/floating-layer';
import { FloatingWindow } from '@/packages/floating/floating-window';
import { packageAppPath } from '@/packages/package-paths';

/** The sample player's package. */
const PLAYER_ID = 'demo.player';

/** Cards on the sample page, for the windows' glass to blur. */
const PAGE_CARDS = ['bg-surface-raised', 'bg-primary/40', 'bg-surface-high', 'bg-tag-pink/40'];

/**
 * What a sample package draws in its window: a title, and a button that counts its presses, so a
 * drag that ends over it can be seen not to press it. Padded by itself, as the frame draws none.
 *
 * @param props - What it says.
 * @param props.title - Its title.
 * @param props.action - Its button's label.
 * @returns The content.
 */
function SampleContent(props: { readonly title: string; readonly action: string }) {
  const { title, action } = props;
  const [presses, setPresses] = useState(0);

  return (
    <div className="flex w-56 flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5 pr-6">
        <p className="text-ui font-medium">{title}</p>
        <p className="text-caption text-foreground-subtle">Pressed {presses} times</p>
      </div>
      <Button
        size="compact"
        variant="ghost"
        onClick={() => {
          setPresses((count) => count + 1);
        }}
      >
        {action}
      </Button>
    </div>
  );
}

/**
 * The page and its rail, inside the router the windows read their address from.
 *
 * @returns The sample.
 */
function FloatingPage() {
  const [isRailWide, setRailWide] = useState(true);
  const [isPlayerOpen, setPlayerOpen] = useState(true);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isOnPlayerPage = pathname === packageAppPath(PLAYER_ID);

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="compact"
          variant="ghost"
          onClick={() => {
            setRailWide((isWide) => !isWide);
          }}
        >
          {isRailWide ? 'Narrow the rail' : 'Widen the rail'}
        </Button>
        <Button
          size="compact"
          variant="ghost"
          onClick={() => {
            void navigate(isOnPlayerPage ? '/' : packageAppPath(PLAYER_ID));
          }}
        >
          {isOnPlayerPage ? 'Leave the player’s page' : 'Open the player’s page'}
        </Button>
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
            toast.info({ title: 'Playing on Downstairs', message: 'Midnight City, by M83.' });
          }}
        >
          Show a toast
        </Button>
      </div>

      <div
        data-floating-demo=""
        className="flex h-120 w-full overflow-hidden rounded-panel border border-border bg-canvas"
      >
        <div
          className={cn(
            'shrink-0 border-r border-border bg-rail transition-[width] duration-300',
            isRailWide ? 'w-60' : 'w-18',
          )}
        />
        <div className="relative flex min-w-0 grow">
          <FloatingLayer>
            <div className="flex grow flex-col gap-4 p-6">
              <p className="font-mono text-caption text-foreground-subtle">{pathname}</p>
              <div className="grid grid-cols-4 gap-3">
                {PAGE_CARDS.map((color) => (
                  <div key={color} className={cn('h-28 rounded-card', color)} />
                ))}
              </div>
            </div>
            <FloatingWindow
              packageId={PLAYER_ID}
              open={isPlayerOpen}
              label="Now playing"
              onClose={() => {
                setPlayerOpen(false);
              }}
              renderContent={() => <SampleContent title="Now playing" action="Pause" />}
            />
            <FloatingWindow
              packageId="demo.timer"
              open
              label="Kitchen timer"
              renderContent={() => <SampleContent title="Kitchen timer" action="Add a minute" />}
            />
          </FloatingLayer>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the floating windows' sample.
 *
 * @returns The sample.
 */
export function FloatingSample() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <FloatingPage />
    </MemoryRouter>
  );
}
