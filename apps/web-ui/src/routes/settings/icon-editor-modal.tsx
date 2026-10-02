/**
 * Changing one icon of the catalogue, or adding one.
 *
 * What may change depends on where the icon came from. A built-in icon keeps its id and its
 * name - the drawing and the keywords are the owner's to change, and a changed drawing is an
 * override the original can be put back under. A custom icon is the owner's entirely.
 *
 * A drawing arrives as an SVG file and is read here, in the browser, with the same reader the
 * server runs - so what the preview shows is what will be kept, and a file the server would
 * refuse is refused before it is sent. The preview draws it inside the frame that will be
 * saved, under two dashed squares: the 24-unit box every icon lives in, and the 20-unit one
 * inside it that the shipped icons keep their strokes within. **Fit** measures the drawing and
 * frames it to that inner square, centred; the zoom and the nudges move the frame by hand when
 * a drawing is meant to sit off centre or run to the edge.
 */
import { useMutation } from '@tanstack/react-query';
import { useId, useRef, useState, type ChangeEvent } from 'react';

import type { IconFrame, IconNode, IconView } from '@nebulahome/contracts';
import { parseIconSvg, suggestIconId } from '@nebulahome/icons/svg';
import { AppIcon, Button, CatalogueIcon, cn, Modal, TextField } from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { createIcon, deleteIcon, updateIcon } from '@/library/api';

/** What the editor is for: a new icon, or one that exists. */
export type IconEditorTarget =
  { readonly mode: 'create' } | { readonly mode: 'edit'; readonly icon: IconView };

/** What the editor needs. */
export type IconEditorModalProps = {
  /** What is being edited. Null when the editor is shut. */
  readonly target: IconEditorTarget | null;

  /** Called to shut it. */
  readonly onClose: () => void;

  /** Called once the catalogue has changed. */
  readonly onSaved: () => void;
};

/** A drawing as uploaded and read: the file, its elements, and the frame to show it in. */
type Drawing = {
  readonly svg: string;
  readonly node: IconNode;
  readonly frame: IconFrame;
};

/** The box every icon lives in. */
const BOX = 24;

/** The square inside it that the shipped icons keep to. */
const INNER = 20;

/** How much one zoom step changes the frame. */
const ZOOM_STEP = 1.1;

/** How much one nudge moves the frame, as a share of it. */
const NUDGE = 1 / BOX;

/** How large the preview is drawn. */
const PREVIEW_SIZE = 160;

/**
 * The frame every built-in icon uses, for a drawing that names none.
 *
 * @returns The 24 box.
 */
function defaultFrame(): IconFrame {
  return { x: 0, y: 0, size: BOX };
}

/** A drawing's bounding box, in its own coordinates, as `getBBox` reports it. */
type Bounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Rounds a frame coordinate to what a person can read in the saved value.
 *
 * @param value - The coordinate.
 * @returns The same, to three decimals.
 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Frames a drawing so that its bounds fill the inner square, centred.
 *
 * @param bounds - The drawing's bounding box, in its own coordinates.
 * @returns The frame.
 */
function fitted(bounds: Bounds): IconFrame {
  const extent = Math.max(bounds.width, bounds.height);

  if (extent <= 0) {
    return defaultFrame();
  }

  const size = (extent * BOX) / INNER;

  return {
    x: round(bounds.x + bounds.width / 2 - size / 2),
    y: round(bounds.y + bounds.height / 2 - size / 2),
    size: round(size),
  };
}

/**
 * Splits the keywords field into what is sent.
 *
 * @param text - What was typed, comma-separated.
 * @returns The keywords, trimmed, without blanks.
 */
function keywordsOf(text: string): string[] {
  return text
    .split(',')
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword !== '')
    .slice(0, 20);
}

/** What the preview needs. */
type PreviewProps = {
  readonly node: IconNode;
  readonly frame: IconFrame;

  /** Changes with every upload, so the measuring element is mounted afresh and measured. */
  readonly measureKey: string;

  /** Takes the measuring element as it mounts, for Fit. */
  readonly onMeasure: (element: SVGGElement | null) => void;
};

/**
 * The preview: the drawing in its frame, under the guides.
 *
 * @param props - See {@link PreviewProps}.
 * @returns The preview.
 */
function Preview(props: PreviewProps) {
  const { node, frame, measureKey, onMeasure } = props;

  return (
    <div className="relative mx-auto size-40 rounded-field border border-border face-sunk text-foreground">
      <CatalogueIcon
        node={node}
        frame={frame}
        size={PREVIEW_SIZE}
        className="absolute inset-0"
        data-testid="icon-preview"
      />
      {/* The guides: the box, and the inner square the shipped icons keep to. */}
      <svg
        viewBox={`0 0 ${String(BOX)} ${String(BOX)}`}
        width={PREVIEW_SIZE}
        height={PREVIEW_SIZE}
        className="pointer-events-none absolute inset-0 text-primary/60"
        aria-hidden="true"
      >
        <rect
          x="0.25"
          y="0.25"
          width={BOX - 0.5}
          height={BOX - 0.5}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.25"
          strokeDasharray="0.75 0.75"
        />
        <rect
          x={(BOX - INNER) / 2}
          y={(BOX - INNER) / 2}
          width={INNER}
          height={INNER}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.25"
          strokeDasharray="0.75 0.75"
        />
      </svg>
      {/* Hidden and unframed: what Fit measures, in the drawing's own coordinates. */}
      <svg className="absolute size-0 overflow-hidden" aria-hidden="true">
        <g key={measureKey} ref={onMeasure}>
          {node.map(([tag, attrs], index) => {
            const Tag = tag;

            // Position is identity in a drawing: the elements are never reordered.
            // eslint-disable-next-line react/no-array-index-key
            return <Tag key={index} {...attrs} />;
          })}
        </g>
      </svg>
    </div>
  );
}

/**
 * Renders the editor.
 *
 * Mounted fresh each time it opens - the panel gives it a key - so every piece of state below
 * starts from the target.
 *
 * @param props - See {@link IconEditorModalProps}.
 * @returns The dialog.
 */
export function IconEditorModal(props: IconEditorModalProps) {
  const { target, onClose, onSaved } = props;
  const existing = target?.mode === 'edit' ? target.icon : undefined;
  const isBuiltin = existing?.origin === 'builtin';

  const [name, setName] = useState(existing?.name ?? '');
  const [id, setId] = useState(existing?.id ?? '');
  const [isIdEdited, setIdEdited] = useState(existing !== undefined);
  const [keywords, setKeywords] = useState(existing?.keywords.join(', ') ?? '');
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const measure = useRef<SVGGElement | null>(null);
  const isFitPending = useRef(false);
  const fileId = useId();

  const shownNode = drawing?.node ?? existing?.node ?? [];
  const shownFrame = drawing?.frame ?? existing?.frame ?? defaultFrame();
  const hasDrawing = drawing !== null || existing !== undefined;

  /**
   * Measures the drawing and frames it to the guides.
   *
   * @param node - The elements to measure; the hidden copy is what is measured.
   * @param fallback - What to answer when nothing can be measured.
   * @returns The fitted frame, or the fallback.
   */
  const fit = (node: IconNode, fallback: IconFrame): IconFrame => {
    const element = measure.current;

    if (element === null || node.length === 0 || typeof element.getBBox !== 'function') {
      return fallback;
    }

    return fitted(element.getBBox());
  };

  /**
   * Takes the measuring element as it mounts, and fits a fresh upload once it is there.
   *
   * A callback ref rather than an effect: the measurement needs the element in the document,
   * and the element is in the document exactly when React hands it over.
   *
   * @param element - The hidden copy of the drawing, or null as it leaves.
   */
  const onMeasure = (element: SVGGElement | null): void => {
    measure.current = element;

    if (element !== null && isFitPending.current) {
      isFitPending.current = false;
      setDrawing((current) =>
        current === null ? null : { ...current, frame: fit(current.node, current.frame) },
      );
    }
  };

  /**
   * Reads an uploaded file into a drawing, framed to the guides.
   *
   * @param event - The file input's change.
   */
  const onUpload = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];

    if (file === undefined) {
      return;
    }

    try {
      const svg = await file.text();
      const parsed = parseIconSvg(svg);

      // Shown first in the file's own frame; the fit follows as soon as the hidden copy is in
      // the document to be measured.
      isFitPending.current = true;
      setDrawing({ svg, node: parsed.node, frame: parsed.viewBox ?? defaultFrame() });
      setError(undefined);
    } catch (failure: unknown) {
      setError(toMessage(failure));
    }
  };

  /**
   * Moves the frame.
   *
   * @param change - What to do to it.
   */
  const reframe = (change: (frame: IconFrame) => IconFrame): void => {
    setDrawing((current) =>
      current === null
        ? existing === undefined
          ? null
          : { svg: '', node: existing.node, frame: change(existing.frame) }
        : { ...current, frame: change(current.frame) },
    );
  };

  const save = useMutation({
    /**
     * Writes the icon.
     *
     * @returns A promise that settles once it is written.
     */
    mutationFn: async (): Promise<void> => {
      const trimmed = name.trim();
      const words = keywordsOf(keywords);

      if (existing === undefined) {
        if (drawing === null) {
          throw new Error('Upload a drawing first.');
        }

        await createIcon({
          id,
          name: trimmed,
          keywords: words,
          svg: drawing.svg,
          frame: drawing.frame,
        });

        return;
      }

      const redrawn =
        drawing === null
          ? {}
          : drawing.svg === ''
            ? { frame: drawing.frame, svg: undefined }
            : { svg: drawing.svg, frame: drawing.frame };

      await updateIcon(existing.id, {
        ...(isBuiltin ? {} : { name: trimmed, ...(id === existing.id ? {} : { id }) }),
        keywords: words,
        ...(redrawn.svg === undefined ? {} : { svg: redrawn.svg, frame: redrawn.frame }),
      });
    },
    onSuccess: onSaved,
    /**
     * Shows what went wrong.
     *
     * @param failure - What the request threw.
     */
    onError: (failure: unknown): void => {
      setError(toMessage(failure));
    },
  });

  const remove = useMutation({
    /**
     * Removes the icon, or the override.
     *
     * @returns A promise that settles once it is gone.
     */
    mutationFn: async (): Promise<void> => {
      if (existing !== undefined) {
        await deleteIcon(existing.id);
      }
    },
    onSuccess: onSaved,
    /**
     * Shows what went wrong - a custom icon a device still points at, most likely.
     *
     * @param failure - What the request threw.
     */
    onError: (failure: unknown): void => {
      setError(toMessage(failure));
    },
  });

  const isBusy = save.isPending || remove.isPending;
  const title =
    existing === undefined ? 'New icon' : isBuiltin ? `Redraw ${existing.name}` : existing.name;

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      title={title}
      description={
        isBuiltin
          ? 'A built-in icon keeps its id and its name. Give it a new drawing, or new words to find it by.'
          : 'An icon of your own. Everything about it is yours to change.'
      }
      size="large"
      footer={
        <>
          {existing !== undefined && (existing.isOverridden || !isBuiltin) ? (
            <Button
              variant="danger"
              isBusy={remove.isPending}
              disabled={isBusy}
              onClick={() => {
                remove.mutate();
              }}
            >
              {isBuiltin ? 'Reset to default' : 'Delete'}
            </Button>
          ) : null}
          <span className="grow" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            isBusy={save.isPending}
            disabled={isBusy || name.trim() === '' || id === '' || !hasDrawing}
            onClick={() => {
              save.mutate();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="flex flex-col gap-4">
          <TextField
            label="Name"
            size="medium"
            value={name}
            readOnly={isBuiltin}
            hint={isBuiltin ? 'Fixed for a built-in icon.' : undefined}
            onChange={(event) => {
              setName(event.target.value);

              if (!isIdEdited) {
                setId(suggestIconId(event.target.value));
              }
            }}
          />
          <TextField
            label="Id"
            size="medium"
            value={id}
            readOnly={isBuiltin}
            hint={
              isBuiltin
                ? 'Fixed for a built-in icon.'
                : 'Lowercase letters, digits and dashes. Devices point at it.'
            }
            onChange={(event) => {
              setId(event.target.value);
              setIdEdited(true);
            }}
          />
          <TextField
            label="Keywords"
            size="medium"
            value={keywords}
            placeholder="heating, boiler, hot water"
            hint="Comma-separated. What the search finds the icon by, beside its name."
            onChange={(event) => {
              setKeywords(event.target.value);
            }}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={fileId} className="text-caption font-medium text-foreground">
              Drawing
            </label>
            <input
              id={fileId}
              type="file"
              accept=".svg,image/svg+xml"
              className="text-ui text-foreground-muted file:mr-3 file:rounded-field file:border file:border-border-strong file:bg-surface-raised file:px-3 file:py-1.5 file:text-ui file:text-foreground"
              onChange={(event) => {
                void onUpload(event);
              }}
            />
            <span className="text-caption text-foreground-subtle">
              An SVG of shapes: paths, circles, lines. It takes the colour of the text beside it.
            </span>
          </div>

          {error === undefined ? null : (
            <p role="alert" className="text-ui text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-3">
          {hasDrawing ? (
            <Preview
              node={shownNode}
              frame={shownFrame}
              measureKey={drawing?.svg ?? existing?.id ?? ''}
              onMeasure={onMeasure}
            />
          ) : (
            <div className="flex size-40 items-center justify-center rounded-field border border-dashed border-border-strong text-caption text-foreground-subtle">
              Upload a drawing
            </div>
          )}

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="compact"
              disabled={!hasDrawing}
              title="Fit the drawing to the guides"
              onClick={() => {
                reframe((frame) => fit(shownNode, frame));
              }}
            >
              <AppIcon id="maximize" size={14} />
              Fit
            </Button>
            <Button
              variant="ghost"
              size="compact"
              disabled={!hasDrawing}
              aria-label="Zoom in"
              onClick={() => {
                reframe((frame) => {
                  const size = frame.size / ZOOM_STEP;

                  return {
                    x: frame.x + (frame.size - size) / 2,
                    y: frame.y + (frame.size - size) / 2,
                    size,
                  };
                });
              }}
            >
              +
            </Button>
            <Button
              variant="ghost"
              size="compact"
              disabled={!hasDrawing}
              aria-label="Zoom out"
              onClick={() => {
                reframe((frame) => {
                  const size = frame.size * ZOOM_STEP;

                  return {
                    x: frame.x + (frame.size - size) / 2,
                    y: frame.y + (frame.size - size) / 2,
                    size,
                  };
                });
              }}
            >
              −
            </Button>
          </div>
          <div className={cn('grid grid-cols-3 gap-1', hasDrawing ? undefined : 'opacity-50')}>
            <span />
            <Button
              variant="ghost"
              size="compact"
              disabled={!hasDrawing}
              aria-label="Nudge up"
              onClick={() => {
                reframe((frame) => ({ ...frame, y: frame.y + frame.size * NUDGE }));
              }}
            >
              ↑
            </Button>
            <span />
            <Button
              variant="ghost"
              size="compact"
              disabled={!hasDrawing}
              aria-label="Nudge left"
              onClick={() => {
                reframe((frame) => ({ ...frame, x: frame.x + frame.size * NUDGE }));
              }}
            >
              ←
            </Button>
            <Button
              variant="ghost"
              size="compact"
              disabled={!hasDrawing}
              aria-label="Nudge down"
              onClick={() => {
                reframe((frame) => ({ ...frame, y: frame.y - frame.size * NUDGE }));
              }}
            >
              ↓
            </Button>
            <Button
              variant="ghost"
              size="compact"
              disabled={!hasDrawing}
              aria-label="Nudge right"
              onClick={() => {
                reframe((frame) => ({ ...frame, x: frame.x - frame.size * NUDGE }));
              }}
            >
              →
            </Button>
          </div>

          {/* The icon at the size the interface draws it, beside three it will sit among. */}
          <div className="flex items-center gap-3 text-foreground-muted">
            <AppIcon id="lock" />
            <AppIcon id="settings" />
            <CatalogueIcon node={shownNode} frame={shownFrame} className="text-foreground" />
            <AppIcon id="wrench" />
            <AppIcon id="globe" />
          </div>
        </div>
      </div>
    </Modal>
  );
}
