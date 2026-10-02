import config from '@nebulahome/eslint-config';

export default [
  ...config,

  // This package is the platform's single reader of `process.env` (RULES.md 11), so the rule
  // that forbids it everywhere else is lifted here and nowhere else.
  {
    files: ['src/**/*.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
];
