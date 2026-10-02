// Parked outside the workspace (see README.md): its dependencies are not installed, so nothing of
// it is linted until it is migrated and moved back. Its configuration then was:
//   import config from '@nebulahome/eslint-config/react';
//   export default [...config, { ignores: ['ui/**'] }];
export default [{ ignores: ['**/*'] }];
