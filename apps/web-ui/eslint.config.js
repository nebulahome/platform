import config from '@nebulahome/eslint-config/react';

export default [
  ...config,

  // Every word a person reads goes through the catalogue (RULES.md 1), folder by folder as each
  // one moves to it.
  {
    files: [
      'src/components/**/*.tsx',
      'src/lib/**/*.tsx',
      'src/live/**/*.tsx',
      'src/routes/*.tsx',
      'src/routes/settings/account-panel.tsx',
      'src/routes/settings/language-row.tsx',
    ],
    ignores: ['src/**/*.test.tsx'],
    rules: { 'nebula/no-untranslated-text': 'error' },
  },
];
