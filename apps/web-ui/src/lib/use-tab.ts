/**
 * Which tab of a page is open, kept in the address as `?tab=`.
 *
 * In the address so that a tab can be linked to and comes back on reload, and so that the way
 * back is the browser's; replaced rather than pushed, because changing tabs is looking at the
 * same page, not going somewhere. The first tab is the page itself and is not written.
 */
import { useSearchParams } from 'react-router';

/**
 * Reads and sets the open tab.
 *
 * @param tabs - The page's tabs; the first is the one an address without `?tab=` opens.
 * @returns The open tab, and the setter.
 */
export function useTab<TTab extends string>(
  tabs: readonly [TTab, ...TTab[]],
): readonly [TTab, (tab: TTab) => void] {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab = tabs.find((each) => each === asked) ?? tabs[0];

  /**
   * Opens a tab.
   *
   * @param next - The tab.
   */
  const setTab = (next: TTab): void => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);

        if (next === tabs[0]) {
          updated.delete('tab');
        } else {
          updated.set('tab', next);
        }

        return updated;
      },
      { replace: true },
    );
  };

  return [tab, setTab];
}
