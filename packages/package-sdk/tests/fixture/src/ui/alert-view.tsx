import type { EntityViewProps } from '../../../../src/ui/index.js';
import type { alert } from '../../nebula.config.js';

export default function AlertView({ entityId }: EntityViewProps<typeof alert>) {
  return <p>{entityId}</p>;
}
