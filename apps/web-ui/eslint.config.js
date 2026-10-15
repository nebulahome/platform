import config from '@nebulahome/eslint-config/react';

export default [
  ...config,

  // Every word a person reads goes through the catalogue (RULES.md 1). The galleries are left
  // out: they are a developer's page of sample data, never shown to a house.
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.test.tsx', 'src/testing/**', 'src/gallery*.tsx'],
    rules: { 'nebula/no-untranslated-text': 'error' },
  },
];
