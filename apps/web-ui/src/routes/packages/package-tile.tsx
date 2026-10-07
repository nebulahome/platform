/**
 * One package in the grid, the way an integration is one in its own: who it is, where it stands,
 * and how much of the house has come in through it.
 *
 * The same card as a vendor's, so the two sections read alike: the logo top left, the marks top
 * right, the name and release, the counts at the foot. What is a package's own is the state -
 * a package is a process, and whether it runs is the first thing to know - and whether it is part
 * of the platform, which says it cannot be removed.
 */
import { Link } from 'react-router';

import type { ApiPackage, PackageState } from '@nebulahome/contracts';
import {
  AppIcon,
  Pill,
  Tile,
  TILE_FRAME,
  TileMark,
  type BadgeTone,
  type PillTone,
} from '@nebulahome/ui';

import { packageLogoUrl } from '@/packages/api';
import { VendorLogo } from '@/routes/library/vendor-card';

/** What each state reads as, and its colour. */
export const PACKAGE_STATE_OF: Readonly<
  Record<PackageState, { readonly label: string; readonly tone: BadgeTone }>
> = {
  installed: { label: 'Installed', tone: 'neutral' },
  starting: { label: 'Starting', tone: 'accent' },
  running: { label: 'Running', tone: 'success' },
  stopped: { label: 'Stopped', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
  disabled: { label: 'Disabled', tone: 'neutral' },
  'waiting-dependency': { label: 'Waiting', tone: 'warning' },
};

/**
 * The square that names a package: its logo, or a monogram in its colour.
 *
 * @param props - The package, and the side of the square.
 * @param props.found - The package.
 * @param props.size - The side, in pixels.
 * @returns The square.
 */
export function PackageLogo(props: {
  readonly found: Pick<ApiPackage, 'id' | 'name' | 'color' | 'hasLogo'>;
  readonly size: number;
}) {
  const { found, size } = props;
  const logo = packageLogoUrl(found);

  return (
    <VendorLogo
      vendor={{
        name: found.name,
        logoPadding: 0,
        ...(found.color === null ? {} : { color: found.color }),
        ...(logo === undefined ? {} : { logo }),
      }}
      size={size}
    />
  );
}

/**
 * The word after a figure.
 *
 * @param count - The figure.
 * @param one - The singular.
 * @param many - The plural.
 * @returns Whichever fits.
 */
function noun(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** The Pill tone of each state's badge tone. */
const PILL_TONES: Readonly<Partial<Record<BadgeTone, PillTone>>> = {
  neutral: 'neutral',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/** What the tile needs. */
export type PackageTileProps = {
  readonly found: ApiPackage;

  /** The newer release the index offers, when it does. */
  readonly update?: string | undefined;
};

/**
 * Renders one package's tile. The whole tile is the link to the package's page.
 *
 * @param props - See {@link PackageTileProps}.
 * @returns The tile.
 */
export function PackageTile(props: PackageTileProps) {
  const { found, update } = props;
  const state = PACKAGE_STATE_OF[found.state];
  const cards = found.ui?.cards.length ?? 0;
  const extras = [
    found.ui?.page === true ? 'a page' : null,
    cards === 0 ? null : cards === 1 ? 'a card' : `${String(cards)} cards`,
  ].filter((part) => part !== null);

  return (
    <li className="list-none">
      <Link
        to={`/packages/${encodeURIComponent(found.id)}`}
        aria-label={found.name}
        className={TILE_FRAME}
      >
        <Tile
          logo={<PackageLogo found={found} size={44} />}
          marks={
            !found.isSystem && update === undefined ? undefined : (
              <>
                {update === undefined ? null : (
                  <span
                    title={`Version ${update} is out`}
                    className="inline-flex h-6.5 items-center gap-1.5 rounded-chip bg-cyan/12 px-2 font-mono text-mono-caption text-cyan tabular"
                  >
                    <AppIcon id="circle-arrow-up" size={13} />
                    {update}
                  </span>
                )}
                {found.isSystem ? (
                  <TileMark title="Part of the platform">
                    <AppIcon id="lock" size={13} />
                  </TileMark>
                ) : null}
              </>
            )
          }
          name={found.name}
          footer={
            <>
              <Pill tone={PILL_TONES[state.tone] ?? 'neutral'}>{state.label}</Pill>
              <span>
                {[
                  `${String(found.deviceCount)} ${noun(found.deviceCount, 'device', 'devices')}`,
                  ...extras,
                ].join(' · ')}
              </span>
            </>
          }
        />
      </Link>
    </li>
  );
}
