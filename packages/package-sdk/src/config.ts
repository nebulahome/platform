/**
 * What the build tooling reads from its environment - and nothing else of the SDK reads it: on
 * GitHub Actions, where a release is being made, so `pack` can say where its archive will be
 * downloaded from; and `NODE_ENV`, which loading a config must leave as it found it.
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

/**
 * Runs something that may set `NODE_ENV` - Vite's `runnerImport` sets it to `development` when it
 * is not set - and puts it back as it was, so a production build that loads the config is still
 * one: its JSX for React's production runtime, its dependencies' production code.
 *
 * @param run - What to run.
 * @returns What it returned.
 */
export async function keepingNodeEnv<TResult>(run: () => Promise<TResult>): Promise<TResult> {
  const before = process.env['NODE_ENV'];

  try {
    return await run();
  } finally {
    if (before === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = before;
    }
  }
}
