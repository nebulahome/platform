/**
 * The colour each HTTP method is drawn in, wherever one is shown: the HTTP request block, the
 * webhooks and their calls (boards N-Blocks-Actions, N-Settings-Webhooks).
 */
export const METHOD_TONES: Readonly<Record<string, string>> = {
  GET: 'text-tag-green',
  POST: 'text-tag-indigo',
  PUT: 'text-tag-amber',
  PATCH: 'text-tag-violet',
  DELETE: 'text-tag-red',
  HEAD: 'text-foreground-muted',
};
