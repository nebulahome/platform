/**
 * Where the interface lends a package its implementation of `/ui` and `/components`:
 * `globalThis.__nebula`, which the interface sets before it imports a package's module.
 *
 * Each module is there under its major version - `@nebulahome/package-sdk/ui@1` - so a package
 * built against SDK 2 never runs against an interface that implements 1. A member a package uses
 * that the interface lacks - a package built against a newer minor - is named when it is called,
 * with the SDK version it needs.
 */

import type { ComponentsHost } from './components/types.js';
import type { UiHost } from './ui/types.js';

/** The key of the interface's implementation of `/ui`. */
export const UI_MODULE = '@nebulahome/package-sdk/ui@1';

/** The key of the interface's implementation of `/components`. */
export const COMPONENTS_MODULE = '@nebulahome/package-sdk/components@1';

/** What the interface lends, by module. */
type Lent = {
  readonly [UI_MODULE]: UiHost;
  readonly [COMPONENTS_MODULE]: ComponentsHost;
};

/**
 * Says whether a value is a record.
 *
 * @param value - The value.
 * @returns True for a non-null object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * The SDK version the interface implements, as it says.
 *
 * @returns It, or undefined outside the interface.
 */
export function hostSdkVersion(): string | undefined {
  const nebula: unknown = Reflect.get(globalThis, '__nebula');
  const version = isRecord(nebula) ? nebula['sdk'] : undefined;

  return typeof version === 'string' ? version : undefined;
}

/**
 * One member of a module the interface lends, when it lends it.
 *
 * For a member with a way of its own to do without the interface - `useTranslation` says the
 * English - where {@link hostMember} would refuse.
 *
 * @param module - The module's key.
 * @param name - The member.
 * @returns The interface's implementation of it, or undefined when there is none.
 */
export function lentMember<TModule extends keyof Lent, TName extends keyof Lent[TModule] & string>(
  module: TModule,
  name: TName,
): Lent[TModule][TName] | undefined {
  const nebula: unknown = Reflect.get(globalThis, '__nebula');
  const modules = isRecord(nebula) ? nebula['modules'] : undefined;
  const lent = isRecord(modules) ? modules[module] : undefined;
  const member = isRecord(lent) ? lent[name] : undefined;

  /**
   * Says whether the member is there: a function, or a component React wrapped. What it is
   * beyond that the interface vouches for, its implementation being type-checked against the
   * SDK's declaration.
   *
   * @param value - The member.
   * @returns True when it can be called or drawn.
   */
  const isLent = (value: unknown): value is Lent[TModule][TName] =>
    typeof value === 'function' || (isRecord(value) && '$$typeof' in value);

  return isLent(member) ? member : undefined;
}

/**
 * One member of a module the interface lends.
 *
 * @param module - The module's key.
 * @param name - The member.
 * @param since - The SDK version that added it.
 * @returns The interface's implementation of it.
 * @throws {Error} When there is no interface, or it does not implement the member.
 */
export function hostMember<TModule extends keyof Lent, TName extends keyof Lent[TModule] & string>(
  module: TModule,
  name: TName,
  since: string,
): Lent[TModule][TName] {
  const member = lentMember(module, name);

  if (member !== undefined) {
    return member;
  }

  const version = hostSdkVersion();

  throw new Error(
    version === undefined
      ? `${name} is lent by the NebulaHome interface, and there is none here`
      : `${name} needs package SDK ${since}; this interface implements ${version}`,
  );
}
