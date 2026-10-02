import './forecast.css';

import type { CardProps } from '../../../../src/ui/index.js';
import type { forecast } from '../../nebula.config.js';

export function ForecastCard({ options }: CardProps<typeof forecast>) {
  return <p className="forecast">{options.days} days</p>;
}
