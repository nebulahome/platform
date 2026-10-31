/**
 * The backgrounds of the running packages (PACKAGES_DOCS.md 4.5.1): each drawn for as long as
 * somebody is signed in, whatever page is open.
 *
 * A background is a package's component like its page, drawn in a {@link PackageSlot}: it goes when
 * its package stops, is turned off or removed, and starts over with a new release - the slot's
 * component is keyed by the release, so the old one is unmounted and its effects cleaned up before
 * the new one runs. It draws nothing where it stands; what it shows, it shows through `Floating`.
 * One that cannot be drawn draws nothing either: there is nowhere on the page to say so.
 */
import { PackageSlot } from '@/packages/package-slot';
import { useInstalledPackages } from '@/packages/use-packages';

/**
 * Renders the running packages' backgrounds.
 *
 * @returns Them, out of sight.
 */
export function PackageBackgrounds() {
  const { packages } = useInstalledPackages();

  return (
    <div hidden>
      {packages
        .filter((found) => found.state === 'running' && (found.ui?.background ?? null) !== null)
        .map((found) => (
          <PackageSlot
            key={found.id}
            found={found}
            target={{ kind: 'background', props: { packageId: found.id } }}
            loading={null}
            renderProblem={() => null}
          />
        ))}
    </div>
  );
}
