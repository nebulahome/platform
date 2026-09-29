/**
 * Imports a package's module from its address: the one line tests put a module of their own in
 * place of, since a browser under test has no server to import from.
 */

/**
 * Imports a module.
 *
 * @param url - Its address, same-origin.
 * @returns What it exports.
 */
export async function importModule(url: string): Promise<Record<string, unknown>> {
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}
