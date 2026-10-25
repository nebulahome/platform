/**
 * Changing one icon of the catalogue, or adding one (board N-Settings-Icon-Edit).
 *
 * What may change depends on where the icon came from. A built-in icon keeps its id and its
 * name - the drawing and the keywords are the owner's to change, and a changed drawing is an
 * override the original can be put back under. A custom icon is the owner's entirely, except its
 * id: made from the name when the icon is added, and fixed after, because devices point at it.
 *
 * A drawing arrives as an SVG file and is read here, in the browser, with the same reader the
 * server runs - so what the canvas shows is what will be kept, and a file the server would
 * refuse is refused before it is sent. The canvas draws it inside the frame that will be saved,
 * over the guides: the 24-unit grid, and the 20-unit square inside it that the shipped icons keep
 * their strokes within. An upload is fitted to that square, centred; Fit, the zoom and the arrow
 * keys move the frame by hand when a drawing is meant to sit off centre or run to the edge.
 *
 * The right column shows it where it will be used: at the four sizes the interface draws icons,
 * among the icons it will sit beside, and on an entity card.
 */
import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { IconFrame, IconNode, IconView } from '@nebulahome/contracts';
import { parseIconSvg, suggestIconId } from '@nebulahome/icons/svg';
import {
  AppIcon,
  Button,
  CatalogueIcon,
  cn,
  IconButton,
  Modal,
  Segmented,
  Switch,
  TextField,
} from '@nebulahome/ui';

import { toMessage } from '@/lib/error-message';
import { iconName } from '@/lib/icon-names';
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

  /** The square the file said it was drawn in. */
  readonly viewBox: IconFrame | null;

  /** The file's name and size, for the card under the canvas; absent for a reframed icon. */
  readonly file?: { readonly name: string; readonly bytes: number };
};

/** The box every icon lives in. */
const BOX = 24;

/** The square inside it that the shipped icons keep to. */
const INNER = 20;

/** How much one zoom step changes the frame. */
const ZOOM_STEP = 1.1;

/** How much one nudge moves the frame, as a share of it. */
const NUDGE = 1 / BOX;

/** How large the canvas draws it. */
const CANVAS_SIZE = 220;

/** The sizes the interface draws icons at. */
const IN_USE_SIZES = [16, 20, 24, 32] as const;

/** The dots of the grid: one in the middle of each unit of the box. */
const GRID = [...Array.from({ length: BOX * BOX }).keys()].map((index) => ({
  x: (index % BOX) + 0.5,
  y: Math.floor(index / BOX) + 0.5,
}));

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
 * Moves the frame towards or away from the drawing, keeping its middle where it is.
 *
 * @param frame - The frame.
 * @param factor - Above 1 shows more of the drawing's plane, so the drawing looks smaller.
 * @returns The new frame.
 */
function zoomed(frame: IconFrame, factor: number): IconFrame {
  const size = frame.size * factor;

  return {
    x: frame.x + (frame.size - size) / 2,
    y: frame.y + (frame.size - size) / 2,
    size,
  };
}

/**
 * Whether a drawing, shown in a frame, stays inside the guides.
 *
 * @param bounds - Its bounding box, in its own coordinates.
 * @param frame - The frame it is shown in.
 * @returns True when every part of it is inside the inner square.
 */
function isInsideGuides(bounds: Bounds, frame: IconFrame): boolean {
  const scale = BOX / frame.size;
  const margin = (BOX - INNER) / 2 - 0.01;
  const left = (bounds.x - frame.x) * scale;
  const top = (bounds.y - frame.y) * scale;

  return (
    left >= margin &&
    top >= margin &&
    left + bounds.width * scale <= BOX - margin &&
    top + bounds.height * scale <= BOX - margin
  );
}

/**
 * Splits typed keywords into the ones to keep.
 *
 * @param text - What was typed, comma-separated.
 * @returns The keywords, trimmed, without blanks.
 */
function keywordsOf(text: string): string[] {
  return text
    .split(',')
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword !== '');
}

/**
 * A file's size as the card under the canvas says it.
 *
 * @param bytes - How large it is.
 * @returns `1.2 kB`, or `640 B`.
 */
function fileSize(bytes: number): string {
  return bytes < 1000 ? `${String(bytes)} B` : `${(bytes / 1000).toFixed(1)} kB`;
}

/**
 * A mono label over a block of the dialog.
 *
 * @param props - The label and the block.
 * @param props.label - What the block is.
 * @param props.children - The block.
 * @returns The section.
 */
function Block(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-mono text-label text-foreground-subtle uppercase">{props.label}</h3>
      {props.children}
    </section>
  );
}

/**
 * One check the drawing passes or fails, under the canvas.
 *
 * @param props - The check.
 * @param props.isMet - Whether it passes.
 * @param props.children - What it says.
 * @returns The chip.
 */
function Check(props: { readonly isMet: boolean; readonly children: ReactNode }) {
  return (
    <span className="inline-flex h-6.5 items-center gap-1.5 rounded-pill border border-border-strong bg-surface-raised px-2.5 text-caption whitespace-nowrap text-foreground-muted">
      <AppIcon
        id={props.isMet ? 'check' : 'triangle-alert'}
        size={13}
        className={props.isMet ? 'text-success' : 'text-warning'}
      />
      {props.children}
    </span>
  );
}

/** What the canvas needs. */
type CanvasProps = {
  readonly node: IconNode;
  readonly frame: IconFrame;
  readonly hasDrawing: boolean;

  /** Changes with every upload, so the measuring element is mounted afresh and measured. */
  readonly measureKey: string;

  /** Takes the measuring element as it mounts, for Fit. */
  readonly onMeasure: (element: SVGGElement | null) => void;

  /** Moves the frame; absent while there is nothing to move. */
  readonly onReframe: ((change: (frame: IconFrame) => IconFrame) => void) | undefined;

  /** Fits the drawing to the guides. */
  readonly onFit: () => void;

  /** Opens the file chooser. */
  readonly onUpload: () => void;
};

/**
 * The canvas: the drawing in its frame, over the grid and the guides.
 *
 * @param props - See {@link CanvasProps}.
 * @returns The canvas.
 */
function Canvas(props: CanvasProps) {
  const { t } = useTranslation();
  const { node, frame, hasDrawing, measureKey, onMeasure, onReframe, onFit, onUpload } = props;
  const [guides, setGuides] = useState<'guides' | 'clean'>('guides');

  /**
   * Nudges the frame with the arrow keys.
   *
   * @param event - The key press.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = frame.size * NUDGE;
    const [dx, dy] =
      event.key === 'ArrowUp'
        ? [0, step]
        : event.key === 'ArrowDown'
          ? [0, -step]
          : event.key === 'ArrowLeft'
            ? [step, 0]
            : event.key === 'ArrowRight'
              ? [-step, 0]
              : [0, 0];

    if ((dx !== 0 || dy !== 0) && onReframe !== undefined) {
      event.preventDefault();
      onReframe((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    }
  };

  return (
    // The canvas takes the arrow keys, which move the drawing inside its frame: focusable and
    // listening on purpose, with its label saying so.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={hasDrawing ? 0 : -1}
      role="group"
      aria-label={t('settings.icons.canvas', 'Drawing; the arrow keys move it')}
      onKeyDown={onKeyDown}
      className="group relative flex h-75 items-center justify-center overflow-hidden rounded-inner border border-border bg-rail bg-radial-[80%_80%_at_50%_40%] from-primary/8 to-transparent to-70% text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {guides === 'guides' ? (
        <svg
          viewBox={`0 0 ${String(BOX)} ${String(BOX)}`}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="pointer-events-none absolute text-primary"
          aria-hidden="true"
        >
          {GRID.map((dot) => (
            <circle
              key={`${String(dot.x)}-${String(dot.y)}`}
              cx={dot.x}
              cy={dot.y}
              r="0.06"
              className="fill-foreground-subtle/45"
            />
          ))}
          <rect
            x={(BOX - INNER) / 2}
            y={(BOX - INNER) / 2}
            width={INNER}
            height={INNER}
            rx="1"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeWidth="0.06"
            strokeDasharray="0.4 0.3"
          />
          <circle
            cx={BOX / 2}
            cy={BOX / 2}
            r={INNER / 2}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="0.06"
          />
        </svg>
      ) : null}

      {hasDrawing ? (
        <CatalogueIcon
          node={node}
          frame={frame}
          size={CANVAS_SIZE}
          className="relative transition-[opacity] duration-200"
          data-testid="icon-preview"
        />
      ) : (
        <button
          type="button"
          onClick={onUpload}
          className="relative flex flex-col items-center gap-2 rounded-tile px-4 py-3 text-ui text-foreground-muted transition-colors hover:text-foreground"
        >
          <AppIcon id="upload" size={22} />
          {t('settings.icons.upload', 'Upload a drawing')}
        </button>
      )}

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

      <span className="absolute bottom-2.5 left-3 font-mono text-label text-foreground-subtle">
        {`${String(BOX)} × ${String(BOX)}`}
      </span>

      <Segmented
        label={t('settings.icons.guides', 'Guides')}
        size="compact"
        options={[
          { value: 'guides', label: t('settings.icons.guides', 'Guides') },
          { value: 'clean', label: t('settings.icons.clean', 'Clean') },
        ]}
        value={guides}
        onChange={setGuides}
        className="absolute top-2.5 right-2.5 bg-surface"
      />

      {onReframe === undefined ? null : (
        <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          <IconButton
            variant="raised"
            size="small"
            label={t('settings.icons.zoomOut', 'Zoom out')}
            onClick={() => {
              onReframe((current) => zoomed(current, ZOOM_STEP));
            }}
          >
            <AppIcon id="minus" size={13} />
          </IconButton>
          <IconButton
            variant="raised"
            size="small"
            label={t('settings.icons.zoomIn', 'Zoom in')}
            onClick={() => {
              onReframe((current) => zoomed(current, 1 / ZOOM_STEP));
            }}
          >
            <AppIcon id="plus" size={13} />
          </IconButton>
          <IconButton
            variant="raised"
            size="small"
            label={t('settings.icons.fitTitle', 'Fit the drawing to the guides')}
            onClick={onFit}
          >
            <AppIcon id="maximize" size={13} />
          </IconButton>
        </div>
      )}
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
  const { t } = useTranslation();
  const { target, onClose, onSaved } = props;
  const existing = target?.mode === 'edit' ? target.icon : undefined;
  const isBuiltin = existing?.origin === 'builtin';

  const [name, setName] = useState(existing?.name ?? '');
  const [keywords, setKeywords] = useState<readonly string[]>(existing?.keywords ?? []);
  const [draft, setDraft] = useState('');
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [isSampleOn, setSampleOn] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const measure = useRef<SVGGElement | null>(null);
  const isFitPending = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const id = existing?.id ?? suggestIconId(name);
  const shownNode = drawing?.node ?? existing?.node ?? [];
  const shownFrame = drawing?.frame ?? existing?.frame ?? defaultFrame();
  const hasDrawing = drawing !== null || existing !== undefined;
  const shownName = isBuiltin ? iconName(existing.id, name) : name;
  const viewBox = drawing === null ? (existing?.frame ?? null) : drawing.viewBox;
  const strokes = shownNode.flatMap(([, attrs]) => attrs['stroke-width'] ?? []);
  const isFilled = shownNode.some(([, attrs]) => attrs['fill'] === 'currentColor');

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
   * Takes the measuring element as it mounts, records its bounds, and fits a fresh upload.
   *
   * A callback ref rather than an effect: the measurement needs the element in the document,
   * and the element is in the document exactly when React hands it over.
   *
   * @param element - The hidden copy of the drawing, or null as it leaves.
   */
  const onMeasure = (element: SVGGElement | null): void => {
    measure.current = element;

    if (element === null || typeof element.getBBox !== 'function') {
      return;
    }

    const box = element.getBBox();

    // The ref is handed over again on every render, so only a different box is news.
    setBounds((current) =>
      current?.x === box.x &&
      current.y === box.y &&
      current.width === box.width &&
      current.height === box.height
        ? current
        : { x: box.x, y: box.y, width: box.width, height: box.height },
    );

    if (isFitPending.current) {
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
      setDrawing({
        svg,
        node: parsed.node,
        frame: parsed.viewBox ?? defaultFrame(),
        viewBox: parsed.viewBox,
        file: { name: file.name, bytes: file.size },
      });
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
          : {
              svg: '',
              node: existing.node,
              frame: change(existing.frame),
              viewBox: existing.frame,
            }
        : { ...current, frame: change(current.frame) },
    );
  };

  /**
   * Turns what is typed in the keywords field into chips at each comma.
   *
   * @param text - The field's text.
   */
  const onDraft = (text: string): void => {
    const parts = text.split(',');
    const done = keywordsOf(parts.slice(0, -1).join(','));

    if (done.length > 0) {
      setKeywords((current) => [...new Set([...current, ...done])].slice(0, 20));
    }

    setDraft(parts.at(-1) ?? '');
  };

  const save = useMutation({
    /**
     * Writes the icon.
     *
     * @returns A promise that settles once it is written.
     */
    mutationFn: async (): Promise<void> => {
      const trimmed = name.trim();
      const words = [...new Set([...keywords, ...keywordsOf(draft)])].slice(0, 20);

      if (existing === undefined) {
        if (drawing === null) {
          throw new Error(t('settings.icons.uploadFirst', 'Upload a drawing first.'));
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

      await updateIcon(existing.id, {
        ...(isBuiltin ? {} : { name: trimmed }),
        keywords: words,
        ...(drawing === null || drawing.svg === ''
          ? {}
          : { svg: drawing.svg, frame: drawing.frame }),
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
    existing === undefined
      ? t('settings.icons.new', 'New icon')
      : iconName(existing.id, existing.name);
  const description =
    existing === undefined
      ? t('settings.icons.newLine', 'Custom · not saved yet')
      : isBuiltin
        ? t('settings.icons.builtinLine', 'Built in · {{id}}', { id: existing.id })
        : t('settings.icons.customLine', 'Custom · {{id}}', { id: existing.id });

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      layout="card"
      size="xlarge"
      lead={
        <span className="flex size-10 shrink-0 items-center justify-center rounded-tile bg-primary/14 text-primary">
          {hasDrawing ? (
            <CatalogueIcon node={shownNode} frame={shownFrame} size={20} />
          ) : (
            <AppIcon id="image" size={20} />
          )}
        </span>
      }
      title={title}
      description={description}
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
              {isBuiltin
                ? t('settings.icons.reset', 'Reset to default')
                : t('common.delete', 'Delete')}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex items-center gap-2">
            <Button variant="bare" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              isBusy={save.isPending}
              disabled={isBusy || name.trim() === '' || id === '' || !hasDrawing}
              onClick={() => {
                save.mutate();
              }}
            >
              <AppIcon id="check" size={16} />
              {existing === undefined
                ? t('settings.icons.create', 'Create icon')
                : t('common.save', 'Save')}
            </Button>
          </span>
        </>
      }
    >
      <div className="flex flex-wrap gap-x-7 gap-y-6">
        <div className="flex min-w-0 flex-[1_1_340px] flex-col">
          <Block label={t('settings.icons.drawing', 'Drawing')}>
            <Canvas
              node={shownNode}
              frame={shownFrame}
              hasDrawing={hasDrawing}
              measureKey={drawing?.svg ?? existing?.id ?? ''}
              onMeasure={onMeasure}
              onReframe={hasDrawing ? reframe : undefined}
              onFit={() => {
                reframe((frame) => fit(shownNode, frame));
              }}
              onUpload={() => fileInput.current?.click()}
            />

            <div className="flex items-center gap-3 rounded-tile border border-border bg-surface py-2.5 pr-2.5 pl-3.5">
              <AppIcon id="file" size={16} className="shrink-0 text-primary" />
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="truncate text-ui text-foreground">
                  {drawing?.file?.name ??
                    (existing === undefined
                      ? t('settings.icons.noFile', 'No drawing yet')
                      : t('settings.icons.fileName', '{{id}}.svg', { id: existing.id }))}
                </span>
                <span className="text-caption text-foreground-subtle">
                  {drawing?.file === undefined
                    ? existing === undefined
                      ? t(
                          'settings.icons.drawingHint',
                          'An SVG of shapes: paths, circles, lines. It takes the colour of the text beside it.',
                        )
                      : t('settings.icons.inCatalogue', 'In the catalogue')
                    : t('settings.icons.addedNow', '{{size}} · added just now', {
                        size: fileSize(drawing.file.bytes),
                      })}
                </span>
              </span>
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  fileInput.current?.click();
                }}
              >
                {hasDrawing
                  ? t('settings.icons.replace', 'Replace')
                  : t('settings.icons.uploadButton', 'Upload')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".svg,image/svg+xml"
                aria-label={t('settings.icons.drawing', 'Drawing')}
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  void onUpload(event);
                }}
              />
            </div>

            {hasDrawing ? (
              <div className="flex flex-wrap gap-1.5">
                <Check isMet={viewBox?.size === BOX}>
                  {viewBox === null
                    ? t('settings.icons.noViewBox', 'No view box')
                    : t('settings.icons.viewBox', '{{size}} × {{size}} view box', {
                        size: round(viewBox.size),
                      })}
                </Check>
                <Check isMet={strokes.length === 0}>
                  {strokes.length === 0
                    ? t('settings.icons.stroke', 'Stroke 1.75')
                    : t('settings.icons.ownStroke', 'Its own stroke {{width}}', {
                        width: strokes[0],
                      })}
                </Check>
                <Check isMet={!isFilled}>
                  {isFilled
                    ? t('settings.icons.fills', 'Has fills')
                    : t('settings.icons.noFills', 'No fills')}
                </Check>
                {bounds === null ? null : (
                  <Check isMet={isInsideGuides(bounds, shownFrame)}>
                    {isInsideGuides(bounds, shownFrame)
                      ? t('settings.icons.insideGuides', 'Inside the guides')
                      : t('settings.icons.pastGuides', 'Past the guides')}
                  </Check>
                )}
              </div>
            ) : null}
          </Block>
        </div>

        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-5.5">
          <Block label={t('settings.icons.details', 'Details')}>
            <div className="grid grid-cols-2 gap-3.5">
              <TextField
                label={t('settings.icons.name', 'Name')}
                value={shownName}
                readOnly={isBuiltin}
                hint={
                  isBuiltin
                    ? t('settings.icons.fixed', 'Fixed for a built-in icon.')
                    : t('settings.icons.nameHint', 'Shown in the icon picker.')
                }
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
              <div className="flex min-w-0 flex-col gap-1.75">
                <label htmlFor="icon-id" className="text-caption font-medium text-foreground-muted">
                  {t('settings.icons.id', 'ID')}
                </label>
                <span className="flex h-control-field min-w-0 items-center gap-2 rounded-field border border-border-strong bg-rail px-3">
                  <AppIcon id="lock" size={14} className="shrink-0 text-foreground-subtle" />
                  <input
                    id="icon-id"
                    value={id}
                    readOnly
                    className="min-w-0 grow bg-transparent font-mono text-ui-sm text-foreground-muted outline-none"
                  />
                </span>
                <span className="text-caption leading-snug text-foreground-subtle">
                  {isBuiltin
                    ? t('settings.icons.fixed', 'Fixed for a built-in icon.')
                    : t('settings.icons.idHint', 'Made from the name. Devices point at it.')}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.75">
              <label
                htmlFor="icon-keywords"
                className="text-caption font-medium text-foreground-muted"
              >
                {t('settings.icons.keywords', 'Keywords')}
              </label>
              <div className="flex min-h-9.5 flex-wrap items-center gap-1.5 rounded-field border border-border-strong bg-surface-raised px-2 py-1.25 transition-colors focus-within:border-primary">
                {keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="inline-flex h-6.5 animate-rise items-center gap-1 rounded-pill bg-surface-high pr-1.5 pl-2.5 text-ui-sm text-foreground"
                  >
                    {keyword}
                    <button
                      type="button"
                      aria-label={t('settings.icons.removeKeyword', 'Remove {{keyword}}', {
                        keyword,
                      })}
                      className="flex size-4.5 items-center justify-center rounded-pill text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground"
                      onClick={() => {
                        setKeywords(keywords.filter((other) => other !== keyword));
                      }}
                    >
                      <AppIcon id="x" size={12} />
                    </button>
                  </span>
                ))}
                <input
                  id="icon-keywords"
                  value={draft}
                  placeholder={t('settings.icons.addKeyword', 'Add…')}
                  className="min-w-15 flex-[1_1_60px] bg-transparent text-ui-sm text-foreground outline-none placeholder:text-foreground-subtle"
                  onChange={(event) => {
                    onDraft(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && draft.trim() !== '') {
                      event.preventDefault();
                      onDraft(`${draft},`);
                    }

                    if (event.key === 'Backspace' && draft === '' && keywords.length > 0) {
                      setKeywords(keywords.slice(0, -1));
                    }
                  }}
                />
              </div>
              <span className="text-caption leading-snug text-foreground-subtle">
                {t('settings.icons.keywordsHint', 'The search finds it by these.')}
              </span>
            </div>
          </Block>

          <Block label={t('settings.icons.inUse', 'In use')}>
            <div className="flex gap-2.5">
              {IN_USE_SIZES.map((size) => (
                <div key={size} className="flex flex-col items-center gap-2">
                  <span className="flex size-13 items-center justify-center rounded-tile border border-border bg-rail text-foreground">
                    {hasDrawing ? (
                      <CatalogueIcon node={shownNode} frame={shownFrame} size={size} />
                    ) : null}
                  </span>
                  <span className="font-mono text-label text-foreground-subtle">{size}</span>
                </div>
              ))}
            </div>

            {/* Among the icons it will sit beside, at the size a toolbar draws them. */}
            <div className="flex items-center justify-between gap-1.5 rounded-tile border border-border bg-rail px-3.5 py-2.5 text-foreground-muted">
              <AppIcon id="lightbulb" size={22} />
              <AppIcon id="thermometer" size={22} />
              <span className="flex rounded-chip bg-primary/14 p-1.5 text-foreground">
                {hasDrawing ? (
                  <CatalogueIcon node={shownNode} frame={shownFrame} size={22} />
                ) : (
                  <span className="size-5.5" />
                )}
              </span>
              <AppIcon id="power" size={22} />
              <AppIcon id="house" size={22} />
              <AppIcon id="sun" size={22} />
            </div>

            <div className="flex items-center gap-3 rounded-tile border border-border bg-surface px-3 py-2.5">
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-field transition-colors duration-200',
                  isSampleOn
                    ? 'bg-warning/14 text-warning'
                    : 'bg-surface-raised text-foreground-subtle',
                )}
              >
                {hasDrawing ? (
                  <CatalogueIcon node={shownNode} frame={shownFrame} size={18} />
                ) : null}
              </span>
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="truncate text-ui text-foreground">
                  {shownName.trim() === '' ? t('settings.icons.new', 'New icon') : shownName}
                </span>
                <span className="text-caption text-foreground-subtle">
                  {isSampleOn ? t('common.on', 'On') : t('common.off', 'Off')}
                </span>
              </span>
              <Switch
                label={t('settings.icons.sample', 'A device with this icon')}
                isOn={isSampleOn}
                onChange={setSampleOn}
              />
            </div>
          </Block>

          {error === undefined ? null : (
            <p role="alert" className="text-ui text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
