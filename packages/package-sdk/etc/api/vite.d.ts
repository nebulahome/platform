import { LogLevel, Plugin } from "vite";
//#region src/generate/problems.d.ts
/**
 * What is wrong with a package's declaration, every problem at once and each with where it is,
 * so an author fixes them in one pass rather than one build at a time.
 */
/** Thrown when a declaration does not hold together. */
export declare class PackageConfigError extends Error {
  /** Every problem, one line each: `cards[0].options.days: …`. */
  readonly problems: readonly string[];
  /**
   * Gathers the problems.
   *
   * @param problems - Each problem, with where it is.
   */
  constructor(problems: readonly string[]);
}
//#endregion
//#region src/generate/manifest.d.ts
/** What a release holds, generated. */
type GeneratedPackage = {
  /** `nebula.package.json`, as the platform reads it. */
  readonly manifest: Readonly<Record<string, unknown>>;
  /** `setup.json`, or null for a package with no settings. */
  readonly setup: Readonly<Record<string, unknown>> | null;
  /** Files of the declaration to copy into the release: from the config's folder, to the release. */
  readonly copies: readonly {
    readonly from: string;
    readonly to: string;
  }[];
  /** The server's entry module, from the config's folder, or null. */
  readonly server: string | null;
  /** Whether the package draws anything: a page, cards or entity views. */
  readonly hasUi: boolean;
};
//#endregion
//#region src/vite/build.d.ts
/** What building takes. */
type BuildOptions = {
  /** The package's folder: the working directory when not said. */
  readonly root?: string;
  /** How much Vite says. */
  readonly logLevel?: LogLevel;
};
/** A package, checked: its declaration and what it generates, before anything is built. */
type CheckedPackage = {
  readonly root: string;
  readonly configPath: string;
  readonly outDir: string;
  readonly definition: unknown;
  readonly packageJson: Readonly<Record<string, unknown>>;
  readonly generated: GeneratedPackage;
};
/**
 * Checks a package without building it: its declaration against the platform's schemas, and the
 * files it names.
 *
 * @param options - Where the package is.
 * @returns The package, checked.
 * @throws {PackageConfigError} With every problem, when it does not hold together.
 */
export declare function checkPackage(options?: BuildOptions): Promise<CheckedPackage>;
/**
 * Builds a package's release into its `outDir`: checked, both halves built, the manifest written.
 *
 * @param options - Where the package is, and how much Vite says.
 * @returns The package, as released.
 * @throws {PackageConfigError} With every problem, when it does not hold together.
 */
export declare function buildPackage(options?: BuildOptions): Promise<CheckedPackage>;
//#endregion
//#region src/vite/plugin.d.ts
/** What `nebula()` takes. */
type NebulaOptions = {
  /** The package's declaration, relative to the root: `nebula.config.ts` when not said. */
  readonly config?: string;
  /** Where the release is staged: `dist` when not said. */
  readonly outDir?: string;
};
/**
 * The plugin that builds a package's interface and server.
 *
 * @param options - Where its config is, and where the release goes.
 * @returns The plugin.
 */
export declare function nebula(options?: NebulaOptions): Plugin;
//#endregion
export type { BuildOptions, CheckedPackage, NebulaOptions };