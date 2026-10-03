import config from '@nebulahome/eslint-config';

export default [
  ...config,

  // An integration the tests build, written as an author writes one, and the published
  // declarations, kept as the build wrote them.
  { ignores: ['tests/fixture/**', 'etc/**', 'schemas/**'] },
];
