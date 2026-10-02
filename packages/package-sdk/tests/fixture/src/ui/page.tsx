import { usePackage } from '../../../../src/ui/index.js';

export default function WeatherPage() {
  const { name } = usePackage();

  return <h1>page-component-marker {name}</h1>;
}
