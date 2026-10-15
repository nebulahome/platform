import config from '@nebulahome/eslint-config/react';

export default [
  ...config,

  // Every word a person reads goes through the interface's catalogue (RULES.md 1).
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.test.tsx'],
    rules: { 'nebula/no-untranslated-text': 'error' },
  },
];
