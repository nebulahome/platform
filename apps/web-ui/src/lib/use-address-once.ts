/**
 * A one-time instruction in the address, such as `?add=1` (open the Add device dialog) or
 * `?hub=shelly` (search the Hub). The command palette links to pages this way. The instruction is
 * carried out once what it needs has loaded, then taken out of the address with `replace`, so a
 * reload or Back does not do it again.
 */
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Carries out a one-time instruction in the address.
 *
 * @param name - The search parameter.
 * @param isReady - Whether what it needs has loaded; until then the parameter waits.
 * @param act - What to do with its value; it may decide to do nothing.
 */
export function useAddressOnce(name: string, isReady: boolean, act: (value: string) => void): void {
  const [params, setParams] = useSearchParams();
  const value = params.get(name);
  // Done once per instruction: the router takes it out of the address in a transition, and doing
  // it again on every drawing until then would keep that transition from ever landing.
  const done = useRef<string | null>(null);

  // The address is outside React: read it once, then take the instruction out of it.
  useEffect(() => {
    if (value === null) {
      done.current = null;

      return;
    }

    if (!isReady || done.current === value) {
      return;
    }

    done.current = value;
    act(value);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);

        next.delete(name);

        return next;
      },
      { replace: true },
    );
  }, [name, value, isReady, act, setParams]);
}
