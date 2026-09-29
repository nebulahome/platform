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

import type { ApiPackage, PackageState } from '@nebula-home/contracts';
import { Badge, cn, type BadgeTone } from '@nebula-home/ui';

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
        className={cn(
          'flex h-41 flex-col rounded-panel border border-border face-card p-[18px]',
          'transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-card',
          'focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none',
        )}
      >
        <span className="flex items-start gap-1.5">
          <PackageLogo found={found} size={44} />
          <span className="grow" />
          <Badge tone={state.tone} size="small">
            {state.label}
          </Badge>
        </span>

        <span className="mt-4 flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] leading-tight font-medium text-foreground">
              {found.name}
            </span>
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
          </span>
          <span className="text-caption leading-tight text-foreground-subtle tabular">
            v{found.version}
            {update === undefined ? null : ` · v${update} out`}
          </span>
        </span>

        <span className="grow" />

        <span className="mt-3 flex items-baseline gap-1 text-ui leading-tight text-foreground-muted tabular">
          <span className="font-medium text-foreground">{found.deviceCount}</span>
          <span>{noun(found.deviceCount, 'device', 'devices')}</span>
          <span className="mx-1 text-foreground-subtle">·</span>
          <span className="font-medium text-foreground">{found.entityCount}</span>
          <span>{noun(found.entityCount, 'entity', 'entities')}</span>
        </span>
      </Link>
    </li>
  );
}
