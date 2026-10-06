/**
 * What each role grants.
 *
 * Read-only, and honestly so. `role:manage` exists in the catalogue and nothing serves it yet -
 * there is no endpoint that changes what a role grants - so this shows the grants rather than
 * offering to edit them. A form that looked editable and refused on submit would be worse than
 * no form.
 *
 * The grants are grouped by resource rather than listed flat. Thirty keys in one column is a
 * list nobody reads; six groups of five is a shape, and the question people actually bring here
 * is "can a guest do anything with the locks", which is a question about a resource.
 *
 * `owner` is shown with every permission because that is what it holds: the application pins it
 * to the full set rather than storing grants, so a permission added in a later release belongs
 * to the owner without anybody remembering to grant it.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { PERMISSIONS } from '@nebulahome/contracts';
import { Badge, Panel, PanelNote } from '@nebulahome/ui';

import { ChevronIcon } from '@/components/icons';
import { toMessage } from '@/lib/error-message';
import { SETTINGS_QUERY_KEYS, fetchRoles } from '@/settings/api';

/** Every resource the catalogue names, in the order it declares them. */
const RESOURCES: readonly string[] = [
  ...new Set(PERMISSIONS.map((permission) => permission.resource)),
];

/** Each permission's description, by key. */
const DESCRIPTIONS: ReadonlyMap<string, string> = new Map(
  PERMISSIONS.map((permission) => [permission.key, permission.description]),
);

/**
 * Renders the roles panel.
 *
 * @returns The panel.
 */
export function RolesPanel() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const roles = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.roles,

    /**
     * Reads the roles.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every role and what it grants.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchRoles(signal),
  });

  return (
    <Panel title="What each role grants" className="overflow-hidden">
      {roles.isPending ? (
        <p className="px-4 py-4 text-ui text-foreground-subtle">Reading the roles…</p>
      ) : null}

      {roles.isError ? (
        <p role="alert" className="px-4 py-4 text-ui text-danger">
          {toMessage(roles.error)}
        </p>
      ) : null}

      {(roles.data ?? []).map((role) => {
        const isOpen = expanded === role.key;
        const held = new Set(role.permissions.map((grant) => grant.key));

        return (
          <div key={role.id} className="border-b border-border last:border-b-0">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => {
                setExpanded(isOpen ? null : role.key);
              }}
              className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-surface-raised/50"
            >
              <div className="flex min-w-0 grow flex-col gap-0.5">
                <span className="text-ui font-medium text-foreground">{role.name}</span>
                <span className="text-caption leading-snug text-foreground-subtle">
                  {role.description}
                </span>
              </div>

              <Badge>
                {role.userCount === 1 ? '1 person' : `${String(role.userCount)} people`}
              </Badge>

              <Badge tone={role.key === 'owner' ? 'accent' : 'neutral'}>
                {role.key === 'owner'
                  ? 'everything'
                  : `${String(held.size)} of ${String(PERMISSIONS.length)}`}
              </Badge>

              <ChevronIcon isOpen={isOpen} className="text-foreground-subtle" />
            </button>

            {isOpen ? (
              <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
                {RESOURCES.map((resource) => {
                  const inResource = PERMISSIONS.filter(
                    (permission) => permission.resource === resource,
                  );

                  return (
                    <div key={resource} className="flex flex-col gap-1.5">
                      <span className="font-mono text-label text-foreground-subtle uppercase">
                        {resource}
                      </span>

                      <ul className="flex flex-col gap-1">
                        {inResource.map((permission) => {
                          const isHeld = role.key === 'owner' || held.has(permission.key);

                          return (
                            <li
                              key={permission.key}
                              className={`flex items-baseline gap-2.5 text-caption ${
                                isHeld ? 'text-foreground' : 'text-foreground-disabled'
                              }`}
                            >
                              <span className="w-37.5 shrink-0 font-mono">{permission.key}</span>
                              <span className={isHeld ? 'text-foreground-subtle' : ''}>
                                {isHeld ? (DESCRIPTIONS.get(permission.key) ?? '') : 'not granted'}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}

      <PanelNote>
        Roles are read-only here. Changing what one grants needs an endpoint that does not exist yet
        — `role:manage` is in the permission catalogue and nothing serves it. A person can still be
        moved between roles from the table above.
      </PanelNote>
    </Panel>
  );
}
