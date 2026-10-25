/**
 * Nebula Home's releases on GitHub (docs/releases-and-updates.md 4): the newest stable one and
 * the newest of all, betas included, asked of the public API without a token - sixty calls an
 * hour per address, and the supervisor asks every six hours and on Check now.
 *
 * A beta is a version with a `-beta.K` suffix, a dev build one with `-alpha.K`, both marked
 * prerelease; drafts are never offered.
 */
import { z } from 'zod';

import { compareVersions, UpstreamError, type PlatformRelease } from '@nebulahome/contracts';

/** Where the releases are. */
const RELEASES_URL = 'https://api.github.com/repos/nebulahome/platform/releases?per_page=30';

/** One release, as GitHub answers. */
const githubReleaseSchema = z.looseObject({
  tag_name: z.string(),
  html_url: z.string(),
  body: z.string().nullish(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullish(),
});

/** A product release tag: `v2026.11.0`, `v2026.11.0-beta.1` or `v2026.11.0-alpha.3`. */
const TAG = /^v(\d+\.\d+\.\d+(?:-(?:alpha|beta)\.\d+)?)$/;

/** The newest of each channel: dev takes everything, beta betas and stables. */
export type PlatformReleases = {
  readonly stable: PlatformRelease | null;
  readonly beta: PlatformRelease | null;
  readonly dev: PlatformRelease | null;
};

/** What asking GitHub takes. */
export type GithubReleasesOptions = {
  readonly timeoutMs: number;

  /** Sent as the user agent, which GitHub requires: `NebulaHome/<version>`. */
  readonly userAgent: string;

  /** Replaced by a test. */
  readonly fetch?: typeof fetch;
};

/**
 * Picks the newest stable release and the newest of all from GitHub's answer.
 *
 * @param body - The answer.
 * @returns The two; null where there is none.
 */
export function newestReleases(body: unknown): PlatformReleases {
  const releases = z
    .array(githubReleaseSchema)
    .parse(body)
    .flatMap((release): (PlatformRelease & { isPrerelease: boolean; isAlpha: boolean })[] => {
      const version = TAG.exec(release.tag_name)?.[1];

      return release.draft || version === undefined || release.published_at == null
        ? []
        : [
            {
              version,
              notes: (release.body ?? '').slice(0, 65_536),
              url: release.html_url,
              publishedAt: new Date(release.published_at),
              isPrerelease: release.prerelease || version.includes('-'),
              isAlpha: version.includes('-alpha.'),
            },
          ];
    })
    .sort((left, right) => compareVersions(right.version, left.version));
  /**
   * Leaves out what only picking needed.
   *
   * @param release - A release, or undefined for none.
   * @returns It as the page has it, or null.
   */
  const strip = (release: (typeof releases)[number] | undefined): PlatformRelease | null =>
    release === undefined
      ? null
      : {
          version: release.version,
          notes: release.notes,
          url: release.url,
          publishedAt: release.publishedAt,
        };

  return {
    stable: strip(releases.find((release) => !release.isPrerelease)),
    beta: strip(releases.find((release) => !release.isAlpha)),
    dev: strip(releases[0]),
  };
}

/**
 * Asks GitHub for the releases.
 *
 * @param options - The timeout, the user agent, and a fetch to use instead of the global one.
 * @returns The newest of each channel.
 * @throws {UpstreamError} When GitHub cannot be reached or refuses - while the repository is
 * private, it answers 404.
 */
export async function fetchPlatformReleases(
  options: GithubReleasesOptions,
): Promise<PlatformReleases> {
  let response: Response;

  try {
    response = await (options.fetch ?? globalThis.fetch)(RELEASES_URL, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': options.userAgent,
      },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error: unknown) {
    throw new UpstreamError('GitHub cannot be reached', {
      details: { reason: error instanceof Error ? error.message : String(error) },
    });
  }

  if (!response.ok) {
    throw new UpstreamError(`GitHub answered ${String(response.status)}`, {
      details: { status: response.status },
    });
  }

  return newestReleases(await response.json());
}
