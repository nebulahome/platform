/**
 * The states an entity can be in, as the editor's dropdowns offer them.
 *
 * The tokens are the engine's (`stateTokenChoices` in contracts): what a trigger fires on and a
 * condition compares. The words are the reader's: a motion sensor's `on` reads "Detected", a
 * door's "Open", the way the entity's own row reads it.
 */
import { stateTokenChoices, STATE_TOKEN_UNAVAILABLE, type EntityView } from '@nebulahome/contracts';

import { text } from '@/i18n/messages';
import { humanise } from '@/lib/command-choices';
import { BINARY_WORDS, ON_OFF_WORDS } from '@/library/entity-reading';

/** One state a dropdown offers. */
export type StateChoice = {
  readonly value: string;
  readonly label: string;
};

/**
 * A state token in words, for an entity.
 *
 * @param token - The token.
 * @param entity - The entity, whose device class names its on and off.
 * @returns The words.
 */
export function stateLabel(token: string, entity: EntityView | undefined): string {
  if (token === STATE_TOKEN_UNAVAILABLE) {
    return 'Out of reach';
  }

  if (token === 'on' || token === 'off') {
    const words = BINARY_WORDS[entity?.deviceClass ?? ''] ?? ON_OFF_WORDS;

    return text(token === 'on' ? words[0] : words[1]);
  }

  return humanise(token);
}

/**
 * The states an entity can be in, or null when its state is open-ended - a number, a text - and
 * is typed instead.
 *
 * @param entity - The entity, or undefined while none is chosen.
 * @returns The choices, or null.
 */
export function stateChoices(entity: EntityView | undefined): StateChoice[] | null {
  if (entity === undefined) {
    return null;
  }

  const select = entity.capabilities.find((entry) => entry.capability === 'select');
  const options =
    select === undefined
      ? []
      : ((select.params['options'] as readonly { value?: unknown }[] | undefined) ?? [])
          .map((option) => option.value)
          .filter((value): value is string => typeof value === 'string');
  const tokens = stateTokenChoices(
    entity.capabilities.map((entry) => entry.capability),
    options,
  );

  return tokens.length === 0
    ? null
    : tokens.map((token) => ({ value: token, label: stateLabel(token, entity) }));
}
