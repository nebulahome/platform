/**
 * Draws one thing a package adds - its page, one of its cards, one of its entity views - inside
 * the interface (PACKAGES.md 5).
 *
 * The package's module is imported the first time, and kept; its component is drawn inside the
 * package's scope, so its hooks speak for it, and inside an error boundary, so a package that
 * throws draws its own sentence and never takes the page down with it. The boundary starts over
 * with a new release: an update that fixes the error is given its chance at once.
 */
import { useQuery } from '@tanstack/react-query';
import { Component, type ReactNode } from 'react';

import type { InstalledPackage } from '@nebula-home/contracts';
import type {
  PackageCardProps,
  PackageEntityViewProps,
  PackageUiDefinition,
} from '@nebula-home/package-ui';

import { isApiError } from '@/lib/api-error';
import { toMessage } from '@/lib/error-message';
import { loadPackageUi } from '@/packages/loader';
import { PackageScope } from '@/packages/runtime';

/** Which of the package's components. */
export type PackageSlotTarget =
  | { readonly kind: 'page' }
  | { readonly kind: 'card'; readonly props: PackageCardProps }
  | { readonly kind: 'entityView'; readonly type: string; readonly props: PackageEntityViewProps };

/** What the slot needs. */
export type PackageSlotProps = {
  /** The package, at the release installed. */
  readonly found: Pick<InstalledPackage, 'id' | 'version' | 'name' | 'ui'>;

  /** What to draw of it. */
  readonly target: PackageSlotTarget;

  /** What stands in while its module is being imported. */
  readonly loading: ReactNode;

  /**
   * What stands in when it cannot be drawn: an import that failed, a component that is not
   * there, a component that threw.
   *
   * @param message - Why, in a sentence.
   * @returns What to draw.
   */
  readonly renderProblem: (message: string) => ReactNode;
};

/**
 * What went wrong, in the package's own words when it gave some.
 *
 * A package's error is its own sentence - "the broker is on fire" - and is shown as it is; one
 * from the API, a module that could not be fetched, reads as the interface says such things.
 *
 * @param error - What was thrown.
 * @returns The sentence.
 */
function problemOf(error: unknown): string {
  return error instanceof Error && error.message !== '' && !isApiError(error)
    ? error.message
    : toMessage(error);
}

/** What the boundary needs. */
type BoundaryProps = {
  readonly children: ReactNode;
  readonly renderProblem: (message: string) => ReactNode;
};

/** What the boundary holds: what the package threw, if it has. */
type BoundaryState = { readonly error: unknown };

/** Keeps a package's error inside its own box. */
class PackageBoundary extends Component<BoundaryProps, BoundaryState> {
  public override state: BoundaryState = { error: null };

  /**
   * Holds what was thrown.
   *
   * @param error - What the package's component threw.
   * @returns The state that draws it.
   */
  public static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  /**
   * Draws the package's component, or why it could not be.
   *
   * @returns The component, or the problem.
   */
  public override render(): ReactNode {
    const { error } = this.state;

    return error === null ? this.props.children : this.props.renderProblem(problemOf(error));
  }
}

/**
 * The component a target names, drawn, if the package has it.
 *
 * @param definition - What the package adds.
 * @param target - Which one.
 * @param packageId - Whose, for its page.
 * @returns The element; null when the package has none by that name.
 */
function draw(
  definition: PackageUiDefinition,
  target: PackageSlotTarget,
  packageId: string,
): ReactNode {
  switch (target.kind) {
    case 'page': {
      const Page = definition.page;

      return Page === undefined ? null : <Page packageId={packageId} />;
    }
    case 'card': {
      const Card = definition.cards?.[target.props.cardId];

      return Card === undefined ? null : <Card {...target.props} />;
    }
    case 'entityView': {
      const View = definition.entityViews?.[target.type];

      return View === undefined ? null : <View {...target.props} />;
    }
  }
}

/**
 * What a target is called in a sentence.
 *
 * @param target - Which one.
 * @returns "page", "the broker card", "the recording view".
 */
function nameOf(target: PackageSlotTarget): string {
  switch (target.kind) {
    case 'page':
      return 'a page';
    case 'card':
      return `a ${target.props.cardId} card`;
    case 'entityView':
      return `a view of ${target.type}`;
  }
}

/**
 * Renders the slot.
 *
 * @param props - See {@link PackageSlotProps}.
 * @returns The package's component, or what stands in for it.
 */
export function PackageSlot(props: PackageSlotProps) {
  const { found, target, loading, renderProblem } = props;
  const definition = useQuery({
    queryKey: ['package-ui', found.id, found.version],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,

    /**
     * Imports the package's module.
     *
     * @returns What it adds.
     */
    queryFn: async () => loadPackageUi(found),
  });

  if (definition.isPending) {
    return loading;
  }

  if (definition.isError) {
    return renderProblem(problemOf(definition.error));
  }

  const drawn = draw(definition.data, target, found.id);

  if (drawn === null) {
    return renderProblem(`${found.name} does not draw ${nameOf(target)}.`);
  }

  return (
    <PackageScope value={{ id: found.id, version: found.version, name: found.name }}>
      <PackageBoundary key={found.version} renderProblem={renderProblem}>
        {drawn}
      </PackageBoundary>
    </PackageScope>
  );
}
