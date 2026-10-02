import { defineServer } from '../../../../src/server/index.js';
import { alert, settings } from '../../nebula.config.js';

export default defineServer({
  settings,
  start(ctx) {
    const alerts = ctx.custom(alert);

    alerts.report(alerts.entityId('today'), { level: `calm in ${ctx.settings.city}` });

    return undefined;
  },
});
