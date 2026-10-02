/**
 * What else in the house names this entity: the automations, scenes and aliases it takes part in.
 *
 * The question a person asks before renaming, moving or removing a thing - "what breaks if I touch
 * this?" - answered where they are looking at the thing. Each line is the way to what names it;
 * an automation says where it names the entity, since watching a sensor and switching a light are
 * different reasons to be careful. A kind of thing the person may not see is not listed at all,
 * so an empty panel never claims more than was looked at.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Badge, Panel } from '@nebulahome/ui';

import type { AutomationRole } from '@/library/entity-correlations';
import { useEntityCorrelations } from '@/routes/library/entity/use-entity-correlations';

/** Where an automation names the entity, in the words the line uses. */
const ROLE_WORDS: Readonly<Record<AutomationRole, string>> = {
  trigger: 'Starts it',
  condition: 'Checked',
  action: 'Commanded',
};

/** What one group of lines needs. */
type GroupProps = {
  readonly title: string;
  readonly children: ReactNode;
};

/**
 * One kind of thing, headed.
 *
 * @param props - See {@link GroupProps}.
 * @returns The group.
 */
function Group(props: GroupProps) {
  const { title, children } = props;

  return (
    <section aria-label={title} className="border-b border-border-soft px-4 py-3 last:border-b-0">
      <h3 className="mb-1.5 text-label text-foreground-subtle uppercase">{title}</h3>
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  );
}

/** What the panel needs. */
export type CorrelationsPanelProps = {
  /** The entity, by its address. */
  readonly entityId: string;
};

/**
 * Renders the panel.
 *
 * @param props - See {@link CorrelationsPanelProps}.
 * @returns The panel, or nothing for somebody who may see none of the three.
 */
export function CorrelationsPanel(props: CorrelationsPanelProps) {
  const { entityId } = props;
  const { correlations, canRead } = useEntityCorrelations(entityId);

  if (!canRead.automations && !canRead.scenes && !canRead.aliases) {
    return null;
  }

  const count =
    correlations === undefined
      ? undefined
      : correlations.automations.length + correlations.scenes.length + correlations.aliases.length;

  return (
    <Panel title={count === undefined || count === 0 ? 'Used by' : `Used by · ${String(count)}`}>
      {correlations === undefined ? (
        <p className="px-4 py-3.5 text-ui text-foreground-muted">Reading…</p>
      ) : count === 0 ? (
        <p className="px-4 py-3.5 text-ui text-foreground-muted">
          Not used by any automation, scene or alias.
        </p>
      ) : (
        <>
          {correlations.automations.length === 0 ? null : (
            <Group title="Automations">
              {correlations.automations.map((automation) => (
                <li key={automation.id} className="flex items-center justify-between gap-3">
                  <Link
                    to={`/automations/${automation.id}`}
                    className="truncate text-ui text-primary underline-offset-2 hover:underline"
                  >
                    {automation.name}
                  </Link>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {automation.isEnabled ? null : (
                      <Badge tone="neutral" size="small">
                        Off
                      </Badge>
                    )}
                    <span className="text-caption text-foreground-subtle">
                      {automation.roles.map((role) => ROLE_WORDS[role]).join(' · ')}
                    </span>
                  </span>
                </li>
              ))}
            </Group>
          )}

          {correlations.scenes.length === 0 ? null : (
            <Group title="Scenes">
              {correlations.scenes.map((scene) => (
                <li key={scene.id}>
                  <Link
                    to={`/scenes?q=${encodeURIComponent(scene.name)}`}
                    className="truncate text-ui text-primary underline-offset-2 hover:underline"
                  >
                    {scene.name}
                  </Link>
                </li>
              ))}
            </Group>
          )}

          {correlations.aliases.length === 0 ? null : (
            <Group title="Aliases">
              {correlations.aliases.map((alias) => (
                <li key={alias.id} className="flex items-center justify-between gap-3">
                  <Link
                    to={`/aliases/${alias.id}`}
                    className="truncate text-ui text-primary underline-offset-2 hover:underline"
                  >
                    {alias.name}
                  </Link>
                  <span className="shrink-0 text-caption text-foreground-subtle">
                    {alias.role === 'self' ? 'This entity' : 'Reads it'}
                  </span>
                </li>
              ))}
            </Group>
          )}
        </>
      )}
    </Panel>
  );
}
