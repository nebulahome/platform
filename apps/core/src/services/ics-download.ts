/**
 * Downloads a calendar's ICS address, within limits, and names what went wrong.
 *
 * The address is typed by a person and fetched by the hub, so it is held to a few rules: only
 * `http:` and `https:`, 20 seconds at most, 5 MB at most (read in chunks and cut off, never
 * buffered whole first), and the ETag / Last-Modified of the last success sent back so an unchanged
 * calendar costs a 304. The errors are the cards of CAL-ICS-States: a web page instead of a
 * calendar, a sign-in, an address that is gone, an address that does not answer.
 */
import type { CalendarIcsErrorCode } from '@nebulahome/contracts';

/** The longest a download may take. */
export const ICS_TIMEOUT_MS = 20_000;

/** The largest calendar read. */
export const ICS_MAX_BYTES = 5 * 1024 * 1024;

/** What the last success left, sent back to save the download when nothing changed. */
export type IcsValidators = {
  readonly etag: string | null;
  readonly lastModified: string | null;
};

/** What a download came to. */
export type IcsDownload =
  | { readonly kind: 'not_modified' }
  | {
      readonly kind: 'body';
      readonly text: string;
      readonly etag: string | null;
      readonly lastModified: string | null;
    }
  | { readonly kind: 'error'; readonly code: CalendarIcsErrorCode; readonly detail: string };

/**
 * Whether a text is a calendar file: it opens with `BEGIN:VCALENDAR`, a byte-order mark and
 * blank lines aside.
 *
 * @param text - The body.
 * @returns True for a calendar.
 */
export function looksLikeIcs(text: string): boolean {
  return /^\uFEFF?\s*BEGIN:VCALENDAR/iu.test(text.slice(0, 1024));
}

/**
 * Reads a body up to a limit.
 *
 * @param body - The stream.
 * @param limit - The most bytes kept.
 * @returns The text, or null when the body is larger.
 */
async function readCapped(body: ReadableStream<Uint8Array>, limit: number): Promise<string | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- a stream is read one chunk after the other
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > limit) {
      // eslint-disable-next-line no-await-in-loop -- the last turn: it returns
      await reader.cancel();

      return null;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Downloads an ICS address.
 *
 * @param address - The URL as typed.
 * @param validators - The last success's ETag and Last-Modified.
 * @param fetcher - `fetch`, replaceable in tests.
 * @returns The body, "not modified", or the error with what the server said.
 */
export async function downloadIcs(
  address: string,
  validators: IcsValidators,
  fetcher: typeof fetch = fetch,
): Promise<IcsDownload> {
  let url: URL;

  try {
    url = new URL(address.replace(/^webcal:/iu, 'https:'));
  } catch {
    return { kind: 'error', code: 'unreachable', detail: 'Not an address' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { kind: 'error', code: 'unreachable', detail: `${url.protocol} addresses are not read` };
  }

  const headers: Record<string, string> = { accept: 'text/calendar, */*;q=0.5' };

  if (validators.etag !== null) {
    headers['if-none-match'] = validators.etag;
  }

  if (validators.lastModified !== null) {
    headers['if-modified-since'] = validators.lastModified;
  }

  let response: Response;

  try {
    response = await fetcher(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(ICS_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';

    return {
      kind: 'error',
      code: 'unreachable',
      detail: timedOut ? `Timed out after ${String(ICS_TIMEOUT_MS / 1000)} s` : 'No answer',
    };
  }

  const status = `HTTP ${String(response.status)} ${response.statusText}`.trim();

  if (response.status === 304) {
    return { kind: 'not_modified' };
  }

  if (response.status === 401 || response.status === 403) {
    return { kind: 'error', code: 'needs_sign_in', detail: status };
  }

  if (response.status === 404 || response.status === 410) {
    return { kind: 'error', code: 'not_found', detail: status };
  }

  if (!response.ok || response.body === null) {
    return { kind: 'error', code: 'unreachable', detail: status };
  }

  const type = response.headers.get('content-type') ?? '';
  const text = await readCapped(response.body, ICS_MAX_BYTES);

  if (text === null) {
    return {
      kind: 'error',
      code: 'too_big',
      detail: `Over ${String(ICS_MAX_BYTES / 1024 / 1024)} MB`,
    };
  }

  if (!looksLikeIcs(text)) {
    return {
      kind: 'error',
      code: 'not_calendar',
      detail: `${status} · ${type.split(';')[0] ?? ''}`,
    };
  }

  return {
    kind: 'body',
    text,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  };
}
