import { usePackage, useTranslation } from '../../../../src/ui/index.js';

export default function WeatherPage() {
  const { name } = usePackage();
  const { t } = useTranslation();

  return <h1>page-component-marker {t('page.title', 'The weather of {{name}}', { name })}</h1>;
}
