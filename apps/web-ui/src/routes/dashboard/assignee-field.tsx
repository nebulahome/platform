/**
 * Who a dashboard is shown to: every account in the house, ticked or not.
 *
 * A list of checkboxes rather than a picker that adds chips: a household is a handful of people,
 * and seeing all of them at once - with who already has the dashboard ticked - is the whole
 * decision. The person choosing is marked as themselves, since assigning one to yourself is how a
 * dashboard reaches your own Dashboards page.
 */
import type { DashboardAssignee } from '@nebula-home/contracts';

import { Avatar } from '@/components/avatar';

/** What the field needs. */
export type AssigneeFieldProps = {
  /** Everyone it can be shown to. */
  readonly people: readonly DashboardAssignee[];

  /** Who it is shown to now. */
  readonly value: readonly string[];

  /** Called with who it is shown to after a tick. */
  readonly onChange: (userIds: readonly string[]) => void;

  /** The person choosing, marked as "you". */
  readonly selfId: string | undefined;

  /** Whether the people are still being read. */
  readonly isPending: boolean;
};

/**
 * Renders the field.
 *
 * @param props - See {@link AssigneeFieldProps}.
 * @returns The field.
 */
export function AssigneeField(props: AssigneeFieldProps) {
  const { people, value, onChange, selfId, isPending } = props;
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
      <legend className="mb-2 text-caption font-medium text-foreground-muted">Shown to</legend>

      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-field border border-border bg-groove p-2">
        {isPending ? (
          <p className="px-2 py-1.5 text-caption text-foreground-subtle">Reading…</p>
        ) : people.length === 0 ? (
          <p className="px-2 py-1.5 text-caption text-foreground-subtle">Nobody to show it to.</p>
        ) : (
          people.map((person) => (
            <label
              key={person.id}
              htmlFor={`dashboard-assignee-${person.id}`}
              className="flex cursor-pointer items-center gap-2.5 rounded-chip px-2 py-1.5 hover:bg-surface-raised"
            >
              <input
                id={`dashboard-assignee-${person.id}`}
                type="checkbox"
                checked={chosen.has(person.id)}
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
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-ui text-foreground">
                  {person.displayName}
                  {person.id === selfId ? (
                    <span className="text-foreground-subtle"> (you)</span>
                  ) : null}
                </span>
                <span className="truncate font-mono text-caption text-foreground-subtle">
                  {person.username}
                </span>
              </span>
            </label>
          ))
        )}
      </div>

      <p className="text-caption text-foreground-subtle">
        {value.length === 0
          ? 'Nobody sees it yet.'
          : `${String(value.length)} ${value.length === 1 ? 'person sees' : 'people see'} it on their Dashboards page.`}
      </p>
    </fieldset>
  );
}
