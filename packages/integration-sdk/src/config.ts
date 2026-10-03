/**
 * What the command reads from its environment - and nothing else of the SDK reads it: on GitHub
 * Actions, where a release is being made, the repository it is made from, which `pack` checks is
 * the one the Community Hub imports the vendor from.
 */

/**
 * The GitHub repository a GitHub Actions run is for.
 *
 * @returns `<owner>/<name>`, or undefined outside a run.
 */
export function githubRepository(): string | undefined {
  const { GITHUB_ACTIONS: isActions, GITHUB_REPOSITORY: repository } = process.env;

  return isActions === 'true' ? repository : undefined;
}
