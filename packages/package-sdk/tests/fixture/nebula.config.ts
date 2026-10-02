// A package built by the SDK's own tests: a setting, a card, an entity type with a view, a page
// and a server, as an author would declare them.
import {
  defineCard,
  defineEntityType,
  definePackage,
  definePage,
  defineSettings,
  field,
} from '../../src/index.js';

export const settings = defineSettings({
  city: field.text({ label: 'City', default: 'Turin' }),
});

export const forecast = defineCard({
  id: 'forecast',
  name: 'Forecast',
  icon: 'cloud-sun',
  sizes: ['wide'],
  options: { days: field.number({ label: 'Days', default: 3 }) },
});

export const alert = defineEntityType({
  id: 'alert',
  name: 'Alert',
  icon: 'triangle-alert',
  state: { level: field.text({ label: 'Level' }) },
});

export default definePackage({
  id: 'weather',
  name: 'Weather',
  description: 'Forecasts for the SDK’s tests.',
  category: 'climate',
  logo: './logo.svg',
  platform: '^1.0.0',
  server: './src/server/index.ts',
  settings,
  cards: [forecast],
  entityTypes: [alert],
  ui: {
    page: definePage({ component: () => import('./src/ui/page.js') }),
    cards: { forecast: () => import('./src/ui/forecast-card.js').then((m) => m.ForecastCard) },
    entityViews: { alert: () => import('./src/ui/alert-view.js') },
  },
});
