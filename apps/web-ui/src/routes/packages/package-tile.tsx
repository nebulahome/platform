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
import { Badge, Tile, TILE_FRAME, TileStat, type BadgeTone } from '@nebulahome/ui';

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
            <Badge tone={state.tone} size="small">
              {state.label}
            </Badge>
          }
          name={found.name}
          badges={
            <>
              {found.isSystem ? (
                <Badge tone="neutral" size="small">
                  System
                </Badge>
              ) : null}
              {update === undefined ? null : (
                <Badge tone="accent" size="small">
                  Update
                </Badge>
              )}
            </>
          }
          version={`v${found.version}${update === undefined ? '' : ` · v${update} out`}`}
          stats={
            <>
              <TileStat
                value={found.deviceCount}
                label={noun(found.deviceCount, 'device', 'devices')}
              />
              <span className="text-foreground-subtle">·</span>
              <TileStat
                value={found.entityCount}
                label={noun(found.entityCount, 'entity', 'entities')}
              />
            </>
          }
        />
      </Link>
    </li>
  );
}
