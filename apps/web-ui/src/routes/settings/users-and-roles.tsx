/**
 * Who has an account, and what each role lets them do.
 *
 * Two panels rather than two pages, because the questions people bring here are the same
 * question from either end: "what can Giulia do" is answered by her role, and "what does admin
 * mean" is answered by who holds it.
 */
import { PeoplePanel } from '@/routes/settings/people-panel';
import { RolesPanel } from '@/routes/settings/roles-panel';

/**
 * Renders the users and roles page.
 *
 * @returns The page.
 */
export function UsersAndRoles() {
  return (
    <>
      <PeoplePanel />
      <RolesPanel />
    </>
  );
}
