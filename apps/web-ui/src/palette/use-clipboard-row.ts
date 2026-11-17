/**
 * An id just copied, offered as the command palette's first row (docs: command palette, 6.5): copy
 * an entity's id, press Ctrl+K, and the entity is there, already active.
 *
 * The text comes from the app's own Copy buttons first (`copyText` remembers the last one, in this
 * tab only), then from the system clipboard - only in a secure context, and only where the browser
 * already answers `granted` for reading it. Opening the palette never makes the browser ask: where
 * it would, the empty field ends with one quiet line offering to, once.
 *
 * Text that is not an id of this house is dropped as it is read: never shown, kept or sent. Once
 * the row has been opened, the same text is not offered again until something else is copied.
 */
import { useEffect, useMemo, useState } from 'react';

import { useSession } from '@/auth/session-store';
import { lastCopiedText } from '@/lib/clipboard';
import { itemOfClipboardId, parseClipboardId } from '@/palette/clipboard-id';
import type { PaletteItem } from '@/palette/palette-types';

/** The text whose row was opened last, in memory: not offered again. */
let consumed: string | null = null;

/** What the system clipboard allows. */
type SystemClipboard =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'prompt' }
  | { readonly kind: 'none' };

/** What the palette shows of the clipboard. */
export type ClipboardRow = {
  /** The item of the id copied, if it is one the person may see. */
  readonly item: PaletteItem | null;

  /** The id, as copied, for the group's heading. */
  readonly id: string | null;

  /** Whether to offer, once, to read the system clipboard. */
  readonly isAsking: boolean;

  /** Reads the clipboard from a click, which lets the browser ask; never offers again. */
  readonly allow: () => void;

  /** Never offers again. */
  readonly dismiss: () => void;

  /** Called when the row was opened: the same text is not offered again. */
  readonly consume: () => void;
};

/**
 * Where a person's answer to the offer is kept.
 *
 * @param userId - The person.
 * @returns The storage key.
 */
function askedKey(userId: string): string {
  return `nebula.palette.clipboard-asked.${userId}`;
}

/**
 * Whether the person has answered the offer already.
 *
 * @param userId - The person.
 * @returns True once answered; true too where storage is blocked, so it is not offered every time.
 */
function hasAnswered(userId: string): boolean {
  try {
    return globalThis.localStorage.getItem(askedKey(userId)) !== null;
  } catch {
    return true;
  }
}

/**
 * Keeps the answer to the offer.
 *
 * @param userId - The person.
 */
function answer(userId: string): void {
  try {
    globalThis.localStorage.setItem(askedKey(userId), '1');
  } catch {
    // Blocked storage: the offer simply comes back next time.
  }
}

/**
 * Reads the system clipboard, where that asks nothing of the browser.
 *
 * @returns Its text, that the browser would ask first, or nothing.
 */
async function readSystemClipboard(): Promise<SystemClipboard> {
  const { navigator } = globalThis;
  // A hub on plain http has no clipboard to read (the same guard as the Matter code field).
  const clipboard = globalThis.isSecureContext
    ? (navigator.clipboard as Clipboard | undefined)
    : undefined;

  if (typeof clipboard?.readText !== 'function') {
    return { kind: 'none' };
  }

  try {
    // Firefox and Safari do not know this permission, and throw: they ask on every read.
    const status = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });

    if (status.state === 'granted') {
      return { kind: 'text', text: await clipboard.readText() };
    }

    return status.state === 'prompt' ? { kind: 'prompt' } : { kind: 'none' };
  } catch {
    return { kind: 'none' };
  }
}

/**
 * Keeps clipboard text only when it is an id not offered already.
 *
 * @param text - What was read.
 * @returns The trimmed id, or null.
 */
function idOf(text: string | null): string | null {
  const found = text === null ? null : parseClipboardId(text);

  return found === null || found.id === consumed ? null : found.id;
}

/**
 * Reads the clipboard as the palette opens, and finds the item of the id in it.
 *
 * @param items - The palette's items, as far as the person may see.
 * @returns See {@link ClipboardRow}.
 */
export function useClipboardRow(items: readonly PaletteItem[]): ClipboardRow {
  const userId = useSession((state) => state.user?.id ?? '');
  const [id, setId] = useState(() => idOf(lastCopiedText()));
  const [isAsking, setAsking] = useState(false);
  const hasOwn = id !== null;

  useEffect(() => {
    if (hasOwn) {
      return undefined;
    }

    let isLive = true;

    void readSystemClipboard().then((read) => {
      if (!isLive) {
        return;
      }

      if (read.kind === 'text') {
        setId(idOf(read.text));
      } else if (read.kind === 'prompt' && !hasAnswered(userId)) {
        setAsking(true);
      }
    });

    return () => {
      isLive = false;
    };
  }, [hasOwn, userId]);

  const item = useMemo(() => {
    const found = id === null ? null : parseClipboardId(id);

    return found === null ? null : itemOfClipboardId(items, found);
  }, [id, items]);

  return {
    item,
    id: item === null ? null : id,
    isAsking,
    /** Reads the clipboard from the click, so the browser may ask. */
    allow: () => {
      answer(userId);
      setAsking(false);
      // From the click, so the browser may ask; whatever it answers, this is not offered again.
      void globalThis.navigator.clipboard.readText().then(
        (text) => {
          setId(idOf(text));
        },
        () => undefined,
      );
    },
    /** Never offers again. */
    dismiss: () => {
      answer(userId);
      setAsking(false);
    },
    /** Leaves this text out from now on. */
    consume: () => {
      consumed = id;
    },
  };
}
