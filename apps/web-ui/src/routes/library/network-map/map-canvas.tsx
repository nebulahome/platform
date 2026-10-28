/**
 * The canvas the network maps are drawn on: Matter's fabric, Bluetooth's scanners and what they
 * hear, the Thread mesh.
 *
 * A dotted ground in a rounded box; points laid out by the map's own model, each drawn by the map
 * with its name on a dark label under it; straight links, styled by the map. Every point can be
 * dragged, and the map zoomed, fitted, and arranged back where the layout put it, gliding there;
 * nothing of it is kept, so a page opened again lays it out afresh. A point's card opens beside it
 * on hover, focus or click when the map draws one; a map that shows its selected point in a panel
 * of its own (Bluetooth) is told which point is selected instead. The legend sits bottom left,
 * the zoom bottom right (top right under a panel's corner), and what the map filters by top left.
 */
import '@xyflow/react/dist/base.css';

import {
  Background,
  BackgroundVariant,
  Handle,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, IconButton } from '@nebulahome/ui';

import { useReducedMotion } from '@/lib/use-reduced-motion';

/** How long a card stays once the pointer left, for it to reach the card. */
const CARD_GRACE_MS = 160;

/** How long after the map changes it is fitted to it: its points measured. */
const FIT_AFTER_MS = 60;

/** How long Arrange takes the points home. */
const ARRANGE_MS = 500;

/** How the map is fitted to its box. */
const FIT = { padding: 0.2, maxZoom: 1 } as const;

/** Where the links meet a point: its centre, unseen and not to be dragged from. */
const HANDLE =
  'top-1/2! left-1/2! size-px! min-h-0! min-w-0! -translate-1/2! border-0! opacity-0! pointer-events-none!';

/** A point of a map: an id, and its centre as the layout puts it. */
export type CanvasPoint = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
};

/** A link of a map, styled by the map. */
export type CanvasLink = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly style: CSSProperties;
};

/** The words a point is labelled with: its name, and a second line in a tone of its own. */
export type PointLabel = {
  readonly name: string;
  readonly line: string;
  readonly tone: string;
  readonly isStrong: boolean;
};

/** One line of the legend. */
export type LegendItem = {
  readonly label: string;
  readonly style: CSSProperties;
};

/** How a map draws its points. */
type Drawing = {
  readonly shapeOf: (point: CanvasPoint, isSelected: boolean) => ReactNode;
  readonly labelOf: (point: CanvasPoint) => ReactNode;
  readonly cardOf: ((point: CanvasPoint) => ReactNode) | undefined;
};

/** Which point's card is open on hover, and how a point opens and closes it. */
type CardControl = {
  readonly hovered: string | null;
  readonly show: (id: string) => void;
  readonly hide: () => void;
};

/** A point, as the map holds it. */
type PointNode = Node<{ readonly point: CanvasPoint }, 'point'>;

const MapContext = createContext<{ readonly card: CardControl; readonly drawing: Drawing } | null>(
  null,
);

/** The map's one kind of point, drawn by the map. */
const NODE_TYPES = { point: CanvasPointNode };

/** What the canvas needs. */
export type MapCanvasProps<TPoint extends CanvasPoint> = {
  readonly points: readonly TPoint[];
  readonly links: readonly CanvasLink[];

  /** A point's shape: a mark, a square, a circle. */
  readonly shapeOf: (point: TPoint, isSelected: boolean) => ReactNode;

  /** A point's label under it: an element, so the map's own component may use hooks. */
  readonly labelOf: (point: TPoint) => ReactNode;

  /** A point's card, opened beside it; none for a map that shows its selection in a panel. */
  readonly cardOf?: (point: TPoint) => ReactNode;

  /** Told which point is selected, or that none is. */
  readonly onSelect?: (id: string | null) => void;

  readonly legend: readonly LegendItem[];

  /** What the map is filtered by, top left. */
  readonly toolbar?: ReactNode;

  /** The selected point's panel, top right. */
  readonly panel?: ReactNode;

  /** What the map shows; the map is fitted again when it changes. */
  readonly layoutKey: string;

  /** The line shown over an empty map. */
  readonly emptyText: string;

  /** What the map is, to a screen reader. */
  readonly label: string;
};

/**
 * Renders the canvas.
 *
 * @param props - See {@link MapCanvasProps}.
 * @returns The map, its legend and its controls.
 */
export function MapCanvas<TPoint extends CanvasPoint>(props: MapCanvasProps<TPoint>) {
  return (
    <ReactFlowProvider>
      <CanvasView {...props} />
    </ReactFlowProvider>
  );
}

/**
 * The canvas, inside the map's provider.
 *
 * @param props - See {@link MapCanvasProps}.
 * @returns The map, its legend and its controls.
 */
function CanvasView<TPoint extends CanvasPoint>(props: MapCanvasProps<TPoint>) {
  const { t } = useTranslation();
  const { points, links, legend, toolbar, panel, layoutKey, emptyText, onSelect } = props;
  const { fitView, zoomIn, zoomOut } = useReactFlow();

  /**
   * The map's points, where they were dragged to kept, the new ones where the layout puts them.
   *
   * @param before - The points as they are.
   * @returns The points.
   */
  const pointsOf = (before: readonly PointNode[]): PointNode[] => {
    const was = new Map(before.map((node) => [node.id, node]));

    return points.map((point) => ({
      id: point.id,
      type: 'point',
      position: was.get(point.id)?.position ?? { x: point.x, y: point.y },
      selected: was.get(point.id)?.selected ?? false,
      data: { point },
    }));
  };

  const [nodes, setNodes, onNodesChange] = useNodesState<PointNode>(pointsOf([]));
  const isReduced = useReducedMotion();

  /**
   * Takes every point back where the layout puts it, whatever was dragged: gliding there, the
   * links following, unless motion is reduced.
   */
  const arrange = (): void => {
    const from = new Map(nodes.map((node) => [node.id, node.position]));
    const home = pointsOf([]);
    const started = performance.now();

    /**
     * Draws one frame of the way home.
     *
     * @param now - The frame's time.
     */
    const frame = (now: number): void => {
      const done = isReduced ? 1 : Math.min((now - started) / ARRANGE_MS, 1);
      // Ease in and out.
      const eased = done < 0.5 ? 2 * done * done : 1 - (-2 * done + 2) ** 2 / 2;

      setNodes(
        home.map((node) => {
          const start = from.get(node.id) ?? node.position;

          return {
            ...node,
            position: {
              x: start.x + (node.position.x - start.x) * eased,
              y: start.y + (node.position.y - start.y) * eased,
            },
          };
        }),
      );

      if (done < 1) {
        requestAnimationFrame(frame);
      } else {
        setTimeout(() => {
          void fitView({ ...FIT, duration: 300 });
        }, FIT_AFTER_MS);
      }
    };

    requestAnimationFrame(frame);
  };

  useEffect(() => {
    setNodes(pointsOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- laid out again when the map changes
  }, [points, setNodes]);

  // Another set of points shown: the map is fitted to it once they are the ones drawn, and they
  // have been measured - a moment later.
  const fitted = useRef(layoutKey);

  useEffect(() => {
    const isDrawn =
      nodes.length === points.length && nodes.every((node, index) => node.id === points[index]?.id);

    if (fitted.current === layoutKey || !isDrawn) {
      return;
    }

    fitted.current = layoutKey;
    setTimeout(() => {
      void fitView({ ...FIT, duration: 300 });
    }, FIT_AFTER_MS);
  }, [nodes, points, layoutKey, fitView]);

  const edges = useMemo(
    (): Edge[] =>
      links.map((link) => ({
        id: link.id,
        source: link.source,
        target: link.target,
        type: 'straight',
        style: link.style,
        selectable: false,
        focusable: false,
      })),
    [links],
  );

  const [hovered, setHovered] = useState<string | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const card = useMemo(
    (): CardControl => ({
      hovered,

      /**
       * Opens a point's card.
       *
       * @param id - The point.
       */
      show: (id) => {
        clearTimeout(closing.current);
        setHovered(id);
      },

      /** Closes the card a moment later, unless the pointer reaches it. */
      hide: () => {
        clearTimeout(closing.current);
        closing.current = setTimeout(() => {
          setHovered(null);
        }, CARD_GRACE_MS);
      },
    }),
    [hovered],
  );
  const drawing = useMemo(
    (): Drawing => ({
      shapeOf: props.shapeOf as Drawing['shapeOf'],
      labelOf: props.labelOf as Drawing['labelOf'],
      cardOf: props.cardOf as Drawing['cardOf'],
    }),
    [props.shapeOf, props.labelOf, props.cardOf],
  );
  const context = useMemo(() => ({ card, drawing }), [card, drawing]);

  useEffect(
    () => () => {
      clearTimeout(closing.current);
    },
    [],
  );

  return (
    <div className="relative h-[min(680px,75vh)] overflow-hidden rounded-panel border border-border bg-canvas">
      <MapContext.Provider value={context}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeMouseEnter={(event, node) => {
            card.show(node.id);
          }}
          onNodeMouseLeave={() => {
            card.hide();
          }}
          onSelectionChange={({ nodes: selected }) => {
            onSelect?.(selected[0]?.id ?? null);
          }}
          nodeOrigin={[0.5, 0.5]}
          nodesConnectable={false}
          selectNodesOnDrag={false}
          edgesFocusable={false}
          fitView
          fitViewOptions={FIT}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          aria-label={props.label}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1.2}
            color="var(--color-border)"
            bgColor="var(--color-canvas)"
          />
        </ReactFlow>
      </MapContext.Provider>
      {points.length <= 1 ? (
        <p className="pointer-events-none absolute inset-x-6 top-6 text-center text-ui text-foreground-subtle">
          {emptyText}
        </p>
      ) : null}
      <ul className="absolute bottom-3.5 left-4 hidden flex-wrap items-center gap-x-4.5 gap-y-1 rounded-field border border-border bg-surface px-3 py-2 sm:flex">
        {legend.map((item) => (
          <li
            key={item.label}
            className="flex items-center gap-2 text-caption text-foreground-muted"
          >
            <svg aria-hidden="true" width="26" height="8" className="shrink-0">
              <line
                x1="1"
                y1="4"
                x2="25"
                y2="4"
                /* eslint-disable-next-line react/forbid-dom-props -- the link's own look. */
                style={{ ...item.style, opacity: 1 }}
              />
            </svg>
            {item.label}
          </li>
        ))}
      </ul>
      {toolbar === undefined ? null : (
        <div className="absolute top-3.5 left-3.5 z-10">{toolbar}</div>
      )}
      {panel === undefined || panel === null ? null : (
        <div className="absolute top-3.5 right-16 z-10 w-[min(300px,calc(100%-6rem))]">{panel}</div>
      )}
      <div
        className={cn(
          'absolute right-3.5 flex flex-col gap-1 rounded-tile border border-border-strong bg-surface-raised p-1',
          panel === undefined ? 'bottom-3.5' : 'top-3.5',
        )}
      >
        <IconButton
          label={t('brokers.matter.map.zoomIn', 'Zoom in')}
          title={t('brokers.matter.map.zoomIn', 'Zoom in')}
          onClick={() => {
            void zoomIn({ duration: 200 });
          }}
        >
          <AppIcon id="plus" size={16} />
        </IconButton>
        <IconButton
          label={t('brokers.matter.map.zoomOut', 'Zoom out')}
          title={t('brokers.matter.map.zoomOut', 'Zoom out')}
          onClick={() => {
            void zoomOut({ duration: 200 });
          }}
        >
          <AppIcon id="minus" size={16} />
        </IconButton>
        <IconButton
          label={t('brokers.matter.map.arrange', 'Arrange')}
          title={t('brokers.matter.map.arrange', 'Arrange')}
          onClick={() => {
            arrange();
          }}
        >
          <AppIcon id="layout-grid" size={16} />
        </IconButton>
        <IconButton
          label={t('brokers.matter.map.fit', 'Fit')}
          title={t('brokers.matter.map.fit', 'Fit')}
          onClick={() => {
            void fitView({ ...FIT, duration: 300 });
          }}
        >
          <AppIcon id="maximize" size={16} />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * One point of the map, drawn by the map, with its label under it and its card beside it.
 *
 * @param props - The point, and whether it is selected.
 * @returns The point.
 */
function CanvasPointNode(props: NodeProps<PointNode>) {
  const { data, selected, positionAbsoluteX } = props;
  const { point } = data;
  const context = useContext(MapContext);

  // The card opens on the side with room: the map's box cuts off what passes its edge.
  const isOnRight = useStore(
    (state) => positionAbsoluteX * state.transform[2] + state.transform[0] > state.width / 2,
  );

  if (context === null) {
    return null;
  }

  const { card, drawing } = context;
  const content = drawing.cardOf?.(point) ?? null;
  const isOpen = content !== null && (selected || card.hovered === point.id);

  return (
    <div className="relative">
      <Handle type="target" position={Position.Top} isConnectable={false} className={HANDLE} />
      <Handle type="source" position={Position.Top} isConnectable={false} className={HANDLE} />
      {drawing.shapeOf(point, selected)}
      {drawing.labelOf(point)}
      <NodeToolbar
        isVisible={isOpen}
        position={isOnRight ? Position.Left : Position.Right}
        offset={18}
      >
        <div
          role="tooltip"
          className="flex w-75 flex-col gap-2.5 rounded-inner border border-border-strong bg-surface-high px-4 py-3.5 shadow-[0_24px_50px_-16px_rgb(0_0_0/0.95)]"
          onMouseEnter={() => {
            card.show(point.id);
          }}
          onMouseLeave={card.hide}
        >
          {content}
        </div>
      </NodeToolbar>
    </div>
  );
}

/**
 * The label under a point: its name, and its second line in its tone.
 *
 * @param props - The words.
 * @param props.label - What the map says of the point.
 * @returns The label.
 */
export function MapLabel(props: { readonly label: PointLabel }) {
  const { label } = props;

  return (
    <span className="pointer-events-none absolute top-full left-1/2 mt-2 flex -translate-x-1/2 flex-col items-center rounded-[7px] bg-canvas/88 px-1.75 py-0.5 whitespace-nowrap">
      <span
        className={cn('text-ui-sm text-foreground', label.isStrong ? 'font-medium' : 'font-normal')}
      >
        {label.name}
      </span>
      {label.line === '' ? null : (
        <span className={cn('text-label tracking-normal', label.tone)}>{label.line}</span>
      )}
    </span>
  );
}

/**
 * One line of a point's card or panel.
 *
 * @param props - What it says.
 * @param props.label - The fact.
 * @param props.children - Its value.
 * @param props.isMuted - Whether the value is one the house does not have.
 * @returns The line.
 */
export function CardRow(props: {
  readonly label: string;
  readonly children: ReactNode;
  readonly isMuted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 text-caption">
      <span className="text-foreground-muted">{props.label}</span>
      <span
        className={cn(
          'text-right font-mono',
          props.isMuted === true ? 'text-foreground-muted' : 'text-foreground',
        )}
      >
        {props.children}
      </span>
    </div>
  );
}
