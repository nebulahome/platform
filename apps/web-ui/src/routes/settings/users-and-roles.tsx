/**
 * Who has an account, and what each role lets them do.
 *
 * As the board draws it: two tabs, Users and Roles, each with how many there are. The questions
 * people bring here are the same question from either end - "what can Giulia do" is answered by
 * her role, and "what does admin mean" is answered by who holds it - so the two sit on one page,
 * a tab apart, and the address remembers which is open.
 */
import { useQuery } from '@tanstack/react-query';

import { TabPanel, Tabs } from '@nebulahome/ui';

import { useTab } from '@/lib/use-tab';
import { PeoplePanel } from '@/routes/settings/people-panel';
import { RolesPanel } from '@/routes/settings/roles-panel';
import { fetchRoles, fetchUsers, SETTINGS_QUERY_KEYS } from '@/settings/api';

/** The tabs of the page; the first is the page itself. */
const TABS = ['users', 'roles'] as const;

/** One tab. */
type UsersTab = (typeof TABS)[number];

/**
 * Renders the users and roles page.
 *
 * @returns The page.
 */
export function UsersAndRoles() {
  const [tab, setTab] = useTab<UsersTab>(TABS);

  // The same lists, under the same keys, as the panels read: the counts cost nothing.
  const users = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.users,

    /**
     * Reads the people, for how many there are.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns The people.
     */
    queryFn: async ({ signal }) => fetchUsers(signal),
  });
  const roles = useQuery({
    queryKey: SETTINGS_QUERY_KEYS.roles,

    /**
     * Reads the roles, for how many there are.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns The roles.
     */
    queryFn: async ({ signal }) => fetchRoles(signal),
  });

  return (
    <div className="flex flex-col gap-5">
      <Tabs
        label="Users and roles"
        idPrefix="users-roles"
        value={tab}
        onChange={setTab}
        items={[
          {
            id: 'users',
            label: 'Users',
            ...(users.data === undefined ? {} : { count: users.data.length }),
          },
          {
            id: 'roles',
            label: 'Roles',
            ...(roles.data === undefined ? {} : { count: roles.data.length }),
          },
        ]}
      />
      {tab === 'users' ? (
        <TabPanel idPrefix="users-roles" id="users">
          <PeoplePanel />
        </TabPanel>
      ) : (
        <TabPanel idPrefix="users-roles" id="roles">
          <RolesPanel />
        </TabPanel>
      )}
    </div>
  );
}
