/**
 * What `api` adds to every Fastify request.
 *
 * In a declaration file rather than inside `http/context.ts`, and the difference is not
 * cosmetic. A `declare module` block in an ordinary module is only visible to programs that
 * reach that module through an import, so type-aware linting of a file that reads
 * `request.traceId` without importing the hook that sets it sees a property that does not exist.
 * Declaration files are loaded into every program built from this tsconfig, which is the
 * guarantee these two properties need: they are put there by hooks, not by the code that reads
 * them.
 */
import type { Identity } from '@nebula-home/contracts';

declare module 'fastify' {
  /*
   * One incoming request.
   *
   * A module augmentation merges into an existing interface, which a type alias cannot do, so
   * this is the one place the shape RULES.md 3 otherwise avoids is the only shape available.
   */
  /* eslint-disable-next-line @typescript-eslint/consistent-type-definitions, jsdoc/require-jsdoc -- see above */
  interface FastifyRequest {
    /**
     * The id that ties this request to every log line and bus message it causes.
     *
     * Taken from the incoming `X-Trace-Id` when the caller supplied a well-formed one - `proxy`
     * and the browser client both do - so one identifier spans the whole chain rather than
     * restarting at each hop.
     */
    traceId: string;

    /**
     * Who the request is from.
     *
     * Undefined until the authentication hook has run, which is why every route that needs it
     * goes through `requireIdentity` instead of reading it directly.
     */
    identity?: Identity;
  }
}
