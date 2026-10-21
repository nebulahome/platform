/**
 * The header of a package's page lends the package a place for its actions (`PageActions`, SDK
 * 1.3): the page draws its buttons there, and the header leaves out its own "Details" meanwhile.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { PageActionsProps } from '@nebulahome/package-sdk/ui';

/** Where a page's actions go, and how the header learns it has some. */
type PageActionsPlace = {
  readonly target: HTMLElement | null;
  readonly onChange: (delta: 1 | -1) => void;
};

/** The header's place; null on a card or an entity view. */
const PageActionsContext = createContext<PageActionsPlace | null>(null);

/**
 * Lends the children the header's place for their actions.
 *
 * @param props - The place, and the page.
 * @param props.value - The header's node and its count of actions.
 * @param props.children - The package's page.
 * @returns The provider.
 */
export function PageActionsProvider(props: {
  readonly value: PageActionsPlace;
  readonly children: ReactNode;
}) {
  return <PageActionsContext value={props.value}>{props.children}</PageActionsContext>;
}

/**
 * Draws a package's actions in the header of its page, inside its style scope; nothing elsewhere.
 *
 * @param props - What the header shows.
 * @param props.packageId - Whose scope the actions are drawn in.
 * @returns The portal, or nothing.
 */
export function PackagePageActions(props: PageActionsProps & { readonly packageId: string }) {
  const place = useContext(PageActionsContext);
  const onChange = place?.onChange;

  useEffect(() => {
    if (onChange === undefined) {
      return undefined;
    }

    onChange(1);

    return () => {
      onChange(-1);
    };
  }, [onChange]);

  if (place?.target == null) {
    return null;
  }

  return createPortal(
    <div data-nebula-package={props.packageId} className="flex items-center gap-2">
      {props.children}
    </div>,
    place.target,
  );
}
