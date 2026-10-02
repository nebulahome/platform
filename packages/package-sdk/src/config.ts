/**
 * What the `nebulahome-package` command reads from its environment - and nothing else of the SDK
 * reads it: on GitHub Actions, where a release is being made, so `pack` can say where its archive
 * will be downloaded from.
 */

/** Where a GitHub Actions run says it is. */
export type GithubEnvironment = {
  readonly serverUrl: string;
  readonly repository: string;
  readonly refName: string;
};

/**
 * The GitHub Actions run the command is in.
 *
 * @returns Its server, repository and tag, or undefined outside one.
 */
export function githubEnvironment(): GithubEnvironment | undefined {
  const {
    GITHUB_SERVER_URL: serverUrl,
    GITHUB_REPOSITORY: repository,
    GITHUB_REF_NAME: refName,
  } = process.env;

  return serverUrl === undefined || repository === undefined || refName === undefined
    ? undefined
    : { serverUrl, repository, refName };
}
