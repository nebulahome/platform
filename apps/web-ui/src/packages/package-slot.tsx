/**
 * Draws one thing a package adds - its page, its background, one of its cards, one of its entity
 * views - inside the interface (PACKAGES_DOCS.md 6.2).
 *
 * The interface gives only the frame; what is inside is the package's own, any React and any CSS.
 * The component is loaded from its own chunk the first time, and kept; it is drawn inside an
 * element marked `data-nebula-package="<id>"`, the one its stylesheet is scoped to, with a node of
 * that element for its portals; inside the package's scope, so its hooks speak for it; inside
 * `<Suspense>`, for a component that waits on something of its own; and inside an error boundary,
 * so a package that throws draws its own sentence and never takes the page down with it. The
 * boundary starts over with a new release: an update that fixes the error is given its chance at
 * once.
 */
import { useQuery } from '@tanstack/react-query';
import { Component, Suspense, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { InstalledPackage } from '@nebulahome/contracts';
import type {
  BackgroundProps,
  CardProps,
  EntityViewProps,
  PageProps,
} from '@nebulahome/package-sdk/ui';
import { cn } from '@nebulahome/ui';

import { translate } from '@/i18n/messages';
import { isApiError } from '@/lib/api-error';
import { toMessage } from '@/lib/error-message';
import { loadPackageComponent, type PackageComponentTarget } from '@/packages/loader';
import { PackageScope } from '@/packages/sdk-ui';

/** Which of the package's components, with what it is given. */
export type PackageSlotTarget =
  | { readonly kind: 'page'; readonly props: PageProps }
  | { readonly kind: 'background'; readonly props: BackgroundProps }
  | { readonly kind: 'card'; readonly props: CardProps }
  | { readonly kind: 'entityView'; readonly props: EntityViewProps };

/** What the slot needs. */
export type PackageSlotProps = {
  /** The package, at the release installed. */
  readonly found: Pick<InstalledPackage, 'id' | 'version' | 'build' | 'name' | 'ui'>;

  /** What to draw of it. */
  readonly target: PackageSlotTarget;

  /** What stands in while its component is being loaded. */
  readonly loading: ReactNode;

  /**
   * What stands in when it cannot be drawn: an import that failed, a component that is not
   * there, a component that threw.
   *
   * @param message - Why, in a sentence.
   * @returns What to draw.
   */
  readonly renderProblem: (message: string) => ReactNode;

  /** Classes for the package's element: `h-full` in a card. */
  readonly className?: string;
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
 * The component a target names, as the loader knows it.
 *
 * @param target - Which one.
 * @returns The loader's target.
 */
function componentTargetOf(target: PackageSlotTarget): PackageComponentTarget {
  switch (target.kind) {
    case 'page':
      return { kind: 'page' };
    case 'background':
      return { kind: 'background' };
    case 'card':
      return { kind: 'card', cardId: target.props.cardId };
    case 'entityView':
      return { kind: 'entityView', type: target.props.type };
  }
}

/**
 * What a target is called in a sentence.
 *
 * @param target - Which one.
 * @returns "a page", "a broker card", "a view of recording".
 */
function nameOf(target: PackageComponentTarget): string {
  switch (target.kind) {
    case 'page':
      return translate('packages.packageSlot.page', 'a page');
    case 'background':
      return translate('packages.packageSlot.background', 'a background');
    case 'card':
      return translate('packages.packageSlot.cardidCard', 'a {{cardId}} card', {
        cardId: target.cardId,
      });
    case 'entityView':
      return translate('packages.packageSlot.viewOfType', 'a view of {{type}}', {
        type: target.type,
      });
  }
}

/**
 * Renders the slot.
 *
 * @param props - See {@link PackageSlotProps}.
 * @returns The package's component, or what stands in for it.
 */
export function PackageSlot(props: PackageSlotProps) {
  const { t } = useTranslation();

  const { found, target, loading, renderProblem, className } = props;
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const which = componentTargetOf(target);
  const component = useQuery({
    queryKey: ['package-ui', found.id, found.build, which],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,

    /**
     * Loads the component.
     *
     * @returns It, held in an object so the cache keeps the function as it is; null when the
     *   package draws none by that name.
     */
    queryFn: async () => {
      const loaded = await loadPackageComponent(found, which);

      return loaded === null ? null : { Drawn: loaded };
    },
  });

  if (component.isPending) {
    return loading;
  }

  if (component.isError) {
    return renderProblem(problemOf(component.error));
  }

  if (component.data === null) {
    return renderProblem(
      t('packages.packageSlot.nameDoesNotDraw', '{{name}} does not draw {{which}}.', {
        name: found.name,
        which: nameOf(which),
      }),
    );
  }

  // The component's props are its target's: what the SDK types each loader with.
  const Drawn = component.data.Drawn as (props: object) => ReactNode;

  return (
    <div data-nebula-package={found.id} className={cn('relative min-w-0', className)}>
      <PackageScope
        value={{ id: found.id, version: found.version, name: found.name }}
        portal={portal}
      >
        <PackageBoundary key={found.build} renderProblem={renderProblem}>
          <Suspense fallback={loading}>
            <Drawn {...target.props} />
          </Suspense>
        </PackageBoundary>
      </PackageScope>
      <div ref={setPortal} />
    </div>
  );
}
