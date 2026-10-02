import config from '@nebulahome/eslint-config/react';

export default [
  ...config,

  // A package the tests build, written as an author writes one.
  // and the published declarations, kept as the build wrote them.
  { ignores: ['tests/fixture/**', 'etc/**'] },

  // The public API is what authors' code is checked against and what the platform implements,
  // so it names nothing private: a type of `@nebulahome/contracts` in a public declaration would
  // make every internal change of the platform a change of the SDK. Only the build tooling - the
  // Vite plugin and the command, which bundle the manifest's schemas - and the tests may.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/generate/**', 'src/vite/**', 'src/cli/**', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nebulahome/*'],
              message:
                'The public API names no private package: write the type here, and keep it equal to the platform with a parity test.',
            },
            {
              group: ['../../*'],
              message:
                'Do not climb more than one level (RULES.md 7.2). Use the @/ path alias instead.',
            },
          ],
        },
      ],
    },
  },
];
