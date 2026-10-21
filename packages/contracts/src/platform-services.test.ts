import { describe, expect, it } from 'vitest';

import { isPlatformService, MQTT_BROKER_SERVICE } from './platform-services.js';

describe('isPlatformService', () => {
  it('knows the services the platform runs itself', () => {
    expect(isPlatformService(MQTT_BROKER_SERVICE)).toBe(true);
    expect(isPlatformService('object-detection')).toBe(false);
  });
});
