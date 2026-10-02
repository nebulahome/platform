/**
 * What the broker adds to the interface: its page, and the "MQTT broker" card.
 */
import './styles.css';

import { definePackageUi } from '@nebulahome/package-ui';

import { BrokerCard } from './broker-card.js';
import { BrokerPage } from './broker-page.js';

// The interface imports the module's default export (PACKAGES.md 5).
// eslint-disable-next-line import-x/no-default-export
export default definePackageUi({ page: BrokerPage, cards: { broker: BrokerCard } });
