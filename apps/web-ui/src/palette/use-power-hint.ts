/**
 * What Tab says on an entity that switches on and off: what it will do, not what the entity is -
 * "Turn off" while it is on. Read from the live state, so the words change as the entity reports.
 */
import { useTranslation } from 'react-i18next';

import type { EntityView } from '@nebulahome/contracts';

import { capabilityStateOf } from '@/library/entity-control';
import { useLive } from '@/live/live-store';

/**
 * Whether an entity is on, and what Tab would do to it.
 *
 * @param entity - The entity; none for a row that is not one.
 * @returns Whether it is on, and the words.
 */
export function usePowerHint(entity: EntityView | undefined): {
  readonly isOn: boolean;
  readonly hint: string;
} {
  const { t } = useTranslation();
  const live = useLive((state) =>
    entity === undefined ? undefined : state.readings[entity.entityId],
  );
  const isOn = entity !== undefined && capabilityStateOf(entity, live).on_off?.isOn === true;

  return {
    isOn,
    hint: isOn ? t('palette.hint.turnOff', 'Turn off') : t('palette.hint.turnOn', 'Turn on'),
  };
}
