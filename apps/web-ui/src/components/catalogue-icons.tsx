/**
 * The catalogue's word on the interface's own icons, once somebody is signed in.
 *
 * Every icon the chrome draws is bundled, so the sign-in page has its lock before anybody has
 * signed in. After that the catalogue is asked once for exactly those ids, and whichever the
 * owner has drawn afresh in Settings replaces the bundled drawing everywhere - the sidebar's
 * cog included. Nothing is asked while signed out: the catalogue needs a credential, and the
 * bundled drawings are what it would answer for an icon nobody has changed.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { IconOverridesProvider, UI_ICON_IDS, type IconOverrides } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { fetchIcons, LIBRARY_QUERY_KEYS } from '@/library/api';

/** No overrides: every icon bundled. */
const NONE: IconOverrides = new Map();

/** What the provider needs. */
export type CatalogueIconsProps = {
  readonly children: ReactNode;
};

/**
 * Asks the catalogue about the interface's icons and hands the answer down.
 *
 * @param props - What the icons apply to.
 * @returns The provider.
 */
export function CatalogueIcons(props: CatalogueIconsProps) {
  const isSignedIn = useSession((state) => state.status) === 'signed-in';

  const overrides = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.icons, 'interface'],
    /**
     * Reads the interface's icons, keeping only the ones the owner has changed.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the application goes away.
     * @returns The changed icons, by id.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<IconOverrides> => {
      const icons = await fetchIcons({ ids: UI_ICON_IDS }, signal);

      return new Map(
        icons
          .filter((icon) => icon.isOverridden)
          .map((icon) => [icon.id, { node: icon.node, frame: icon.frame }]),
      );
    },
    enabled: isSignedIn,
    staleTime: Number.POSITIVE_INFINITY,
  });

  return (
    <IconOverridesProvider value={overrides.data ?? NONE}>{props.children}</IconOverridesProvider>
  );
}
