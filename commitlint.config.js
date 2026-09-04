/**
 * Commit message rules, enforcing the Conventional Commits format required by RULES.md 17.2.
 *
 * The scope list is the set of workspace names: a commit that touches a service must say which
 * one, so that the generated changelog and `git log --grep` stay useful.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'core',
        'api',
        'proxy',
        'packet-manager',
        'logger',
        'web-ui',
        'contracts',
        'bus',
        'db',
        'config',
        'logging',
        'package-runtime',
        'ui',
        'infra',
        'deps',
        'repo',
      ],
    ],
    'scope-empty': [2, 'never'],
    'subject-case': [2, 'always', 'lower-case'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100],
  },
};
