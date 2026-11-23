/**
 * The people of the house, ticked or not: who a dashboard is shown to, who edits a calendar.
 *
 * A list of checkboxes rather than a picker that adds chips: a household is a handful of people,
 * and seeing all of them at once - with who is already ticked - is the whole decision. The person
 * choosing is marked as themselves. Some may be ticked for good (the owner always edits): they
 * show their tick, cannot be unticked, and say why at the right.
 */
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn } from '@nebulahome/ui';

import { Avatar } from '@/components/avatar';

/** Someone the field lists. */
export type Person = {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly avatarUrl: string | null;
};

/** What the field needs. */
export type PeopleFieldProps<TPerson extends Person> = {
  /** What the list is for: "Shown to", "Editors". */
  readonly legend: ReactNode;

  /** Everyone in the house. */
  readonly people: readonly TPerson[];

  /** Who is ticked now, the locked ones left out. */
  readonly value: readonly string[];

  /** Called with who is ticked after a tick, the locked ones left out. */
  readonly onChange: (userIds: readonly string[]) => void;

  /** The person choosing, marked as "you". */
  readonly selfId: string | undefined;

  /** Whether the people are still being read. */
  readonly isPending: boolean;

  /** The line under the list, from everyone ticked (the locked ones too). */
  readonly summary: (userIds: readonly string[]) => ReactNode;

  /** People ticked for good, with why: "Always · owner". */
  readonly locked?: ReadonlyMap<string, string>;

  /** For someone who may look but not change: every box shows, none can be pressed. */
  readonly isReadOnly?: boolean;

  /** What a row says at the right when it is not locked: the person's role. */
  readonly trail?: (person: TPerson) => ReactNode;
};

/** Nobody locked. */
const NOBODY: ReadonlyMap<string, string> = new Map();

/**
 * Renders the field.
 *
 * @param props - See {@link PeopleFieldProps}.
 * @returns The field.
 */
export function PeopleField<TPerson extends Person>(props: PeopleFieldProps<TPerson>) {
  const { t } = useTranslation();
  const idPrefix = useId();

  const {
    legend,
    people,
    value,
    onChange,
    selfId,
    isPending,
    summary,
    locked = NOBODY,
    isReadOnly = false,
    trail,
  } = props;
  const chosen = new Set(value);

  /**
   * Ticks a person, or unticks them.
   *
   * @param userId - Who.
   */
  const toggle = (userId: string): void => {
    onChange(chosen.has(userId) ? value.filter((id) => id !== userId) : [...value, userId]);
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-caption font-medium text-foreground-muted">{legend}</legend>

      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-field border border-border bg-surface-high p-2">
        {isPending ? (
          <p className="px-2 py-1.5 text-caption text-foreground-subtle">
            {t('peopleField.reading', 'Reading…')}
          </p>
        ) : people.length === 0 ? (
          <p className="px-2 py-1.5 text-caption text-foreground-subtle">
            {t('peopleField.nobody', 'Nobody to show it to.')}
          </p>
        ) : (
          people.map((person) => {
            const why = locked.get(person.id);
            const isFixed = isReadOnly || why !== undefined;

            return (
              <label
                key={person.id}
                htmlFor={`${idPrefix}-${person.id}`}
                className={cn(
                  'flex items-center gap-2.5 rounded-chip px-2 py-1.5',
                  isFixed ? 'cursor-default' : 'cursor-pointer hover:bg-surface-raised',
                )}
              >
                <input
                  id={`${idPrefix}-${person.id}`}
                  type="checkbox"
                  checked={why !== undefined || chosen.has(person.id)}
                  disabled={isFixed}
                  onChange={() => {
                    toggle(person.id);
                  }}
                  className="accent-primary"
                />
                <Avatar
                  displayName={person.displayName}
                  avatarUrl={person.avatarUrl}
                  isAccented={person.id === selfId}
                />
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate text-ui text-foreground">
                    {person.displayName}
                    {person.id === selfId ? (
                      <span className="text-foreground-subtle">
                        {' '}
                        {t('peopleField.you', '(you)')}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate font-mono text-caption text-foreground-subtle">
                    {person.username}
                  </span>
                </span>
                {why === undefined ? (
                  trail === undefined ? null : (
                    <span className="shrink-0 text-caption text-foreground-subtle">
                      {trail(person)}
                    </span>
                  )
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-caption text-foreground-subtle">
                    <AppIcon id="lock" size={12} />
                    {why}
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>

      <p className="text-caption text-foreground-subtle">
        {summary([...locked.keys(), ...value.filter((id) => !locked.has(id))])}
      </p>
    </fieldset>
  );
}
