/**
 * Where a tracked thing is - a phone, a car, a tag - or where an event happened, as the canvas
 * draws it (`N-Entity-Geo-Variants`). Only a GPS source has a position: it gets the map, home
 * with its zone, the dot with its accuracy round it. A router or a Bluetooth source says only home
 * or away, and its network facts. An event is told by its distance from the house.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, cn } from '@nebulahome/ui';

import { paramsOf } from '@/library/entity-control';
import { durationText } from '@/library/history-stats';
import { BatteryRing, useSinceLine } from '@/routes/library/entity/sheet/parts/sheet-controls';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';

/** What the map needs. */
type MapProps = {
  /** Whether the dot is home. */
  readonly isHome: boolean;

  /** How far the dot is, as the map draws it: a fraction of the way to the corner. */
  readonly offset: readonly [number, number];

  /** The accuracy, in metres, for the circle round the dot. */
  readonly accuracy: number | null;

  /** The place's name, beside the dot. */
  readonly label: string | null;

  /** Whether the dot is an event's mark rather than a tracked thing. */
  readonly isEvent: boolean;
};

/**
 * The map: a few streets and blocks, home in its zone, and the dot.
 *
 * @param props - See {@link MapProps}.
 * @returns The map.
 */
function LocationMap(props: MapProps) {
  const { t } = useTranslation();
  const { isHome, offset, accuracy, label, isEvent } = props;
  const home = { x: 176, y: 100 };
  const dot = isHome
    ? { x: 206, y: 128 }
    : { x: home.x + offset[0] * 130, y: home.y + offset[1] * 70 };
  const ring = accuracy === null ? 0 : Math.max(8, Math.min(60, accuracy / 4));

  return (
    <div
      role="img"
      aria-label={t('entity.sheet.location.map', 'Map')}
      className="relative h-50 overflow-hidden rounded-card border border-border-strong bg-[#0f1324]"
    >
      <svg
        width="100%"
        height="200"
        viewBox="0 0 352 200"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        className="absolute inset-0"
      >
        <path d="M -10 60 L 360 92" stroke="#232947" strokeWidth={9} />
        <path d="M 120 -10 L 150 210" stroke="#232947" strokeWidth={9} />
        <path
          d="M -10 160 C 90 140, 200 175, 360 150"
          stroke="#1f2440"
          strokeWidth={6}
          fill="none"
        />
        <path d="M 250 -10 L 236 210" stroke="#1f2440" strokeWidth={6} />
        <path
          d="M 30 -10 C 60 80, 20 140, 70 210"
          stroke="#1a2a4a"
          strokeWidth={12}
          fill="none"
          opacity={0.9}
        />
        {[
          [160, 8, 70, 50],
          [160, 100, 66, 46],
          [260, 8, 84, 64],
          [262, 104, 82, 38],
          [84, 170, 40, 24],
          [160, 168, 60, 28],
          [262, 162, 82, 32],
          [80, 76, 30, 60],
        ].map(([x, y, width, height]) => (
          <rect
            key={`${String(x)}-${String(y)}`}
            x={x}
            y={y}
            width={width}
            height={height}
            rx={5}
            fill="#151a30"
          />
        ))}
        <circle
          cx={home.x}
          cy={home.y}
          r={62}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          className="fill-primary/10 stroke-primary/55"
        />
        {ring > 0 && !isEvent ? (
          <circle
            cx={dot.x}
            cy={dot.y}
            r={ring}
            strokeWidth={1.2}
            className="fill-cyan/12 stroke-cyan/45"
          />
        ) : null}
      </svg>
      <span
        className="absolute flex size-6.5 items-center justify-center rounded-chip border border-primary/60 bg-surface-high text-primary"
        // eslint-disable-next-line react/forbid-dom-props -- home on the map
        style={{ left: home.x - 13, top: home.y - 13 }}
      >
        <AppIcon id="house" size={14} />
      </span>
      <span
        className="absolute h-4.5 rounded-[5px] bg-canvas/70 px-1.5 text-[11px] leading-4.5 text-foreground-muted"
        // eslint-disable-next-line react/forbid-dom-props -- beside home
        style={{ left: home.x + 18, top: home.y - 9 }}
      >
        {t('entity.sheet.location.home', 'Home')}
      </span>
      {isEvent ? (
        <span
          className="absolute flex size-7 items-center justify-center rounded-full border-[1.5px] border-lamp bg-lamp/18 text-lamp"
          // eslint-disable-next-line react/forbid-dom-props -- the event on the map
          style={{ left: dot.x - 14, top: dot.y - 14 }}
        >
          <AppIcon id="activity" size={14} />
        </span>
      ) : (
        <span
          className="entity-track absolute size-4.5"
          // eslint-disable-next-line react/forbid-dom-props -- where the thing is
          style={{ left: dot.x - 9, top: dot.y - 9 }}
        >
          {/* A ring going out from it, now and again: this is where it is now. */}
          <span className="entity-ping absolute -inset-1.5 rounded-full border border-cyan" />
          <span className="absolute inset-0 rounded-full border-3 border-surface bg-cyan shadow-[0_0_0_1px_var(--color-cyan),0_0_0_7px_color-mix(in_oklab,var(--color-cyan)_18%,transparent)]" />
        </span>
      )}
      {label === null || isHome ? null : (
        <span
          className="absolute h-4.5 rounded-[5px] bg-canvas/75 px-1.5 text-[11px] leading-4.5 text-foreground"
          // eslint-disable-next-line react/forbid-dom-props -- beside the dot
          style={{ left: dot.x + 14, top: dot.y - 9 }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * A row of facts under the status: what it is, and its value in mono.
 *
 * @param props - The fact.
 * @param props.label - What it is.
 * @param props.value - Its value.
 * @returns The row.
 */
function Fact(props: { label: string; value: string }) {
  return (
    <div className="flex h-10 items-center justify-between gap-3 border-t border-border select-text">
      <span className="text-ui-sm text-foreground-muted">{props.label}</span>
      <span className="font-mono text-mono-caption text-foreground">{props.value}</span>
    </div>
  );
}

/**
 * The body of a tracker or an event.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function LocationBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, battery, now } = props;
  const since = useSinceLine(entity);
  const source = paramsOf(entity, 'location')?.source ?? 'gps';
  const location = state.location;

  if (location === undefined) {
    return null;
  }

  const zone = location.zone;
  const isHome = zone === 'home';
  const isEvent = source === 'event';
  const hasPosition = location.latitude !== undefined && location.longitude !== undefined;
  const updated = durationText(Math.max(0, now - (entity.lastUpdated?.getTime() ?? now)));
  const sourceWords: Readonly<Record<string, string>> = {
    gps: t('entity.sheet.location.gps', 'GPS'),
    router: t('entity.sheet.location.router', 'Router'),
    bluetooth: t('entity.sheet.location.bluetooth', 'Bluetooth'),
    bluetooth_le: t('entity.sheet.location.bluetoothLe', 'Bluetooth LE'),
    event: t('entity.sheet.location.feed', 'Feed'),
  };
  const word =
    zone === null
      ? '—'
      : isHome
        ? t('entity.sheet.location.home', 'Home')
        : zone === 'away'
          ? t('entity.sheet.location.away', 'Away')
          : zone;
  // Where the dot goes, from its position: a stable fraction, enough for a picture of a map.
  const offset: [number, number] = hasPosition
    ? [
        Math.sin((location.longitude ?? 0) * 997) * 0.9,
        -Math.abs(Math.cos((location.latitude ?? 0) * 991)) * 0.9,
      ]
    : [0.5, -0.5];

  if (isEvent) {
    return (
      <div className="flex grow flex-col gap-4.5 pt-1">
        <LocationMap isHome={false} offset={offset} accuracy={null} label={null} isEvent />
        <div className="flex flex-col gap-1.5">
          <span className="flex items-baseline gap-1.5 select-text">
            <span className="text-[48px] leading-none font-medium tracking-[-0.04em] tabular">
              {location.distanceKm === undefined ? '—' : Math.round(location.distanceKm)}
            </span>
            <span className="text-[18px] text-foreground-muted">
              {t('entity.sheet.location.kmAway', 'km away')}
            </span>
          </span>
          <span className="text-ui-sm text-foreground-subtle">
            {t('entity.sheet.location.reported', 'Reported {{ago}} ago', { ago: updated })}
          </span>
        </div>
        <div className="flex flex-col">
          <Fact
            label={t('entity.sheet.location.source', 'Source')}
            value={location.locationName ?? sourceWords[source] ?? source}
          />
          {hasPosition ? (
            <Fact
              label={t('entity.sheet.location.position', 'Position')}
              value={`${(location.latitude ?? 0).toFixed(2)}, ${(location.longitude ?? 0).toFixed(2)}`}
            />
          ) : null}
        </div>
      </div>
    );
  }

  const isNetwork = source !== 'gps';

  return (
    <div className="flex grow flex-col justify-center gap-4.5 pt-1">
      {hasPosition && !isNetwork ? (
        <LocationMap
          isHome={isHome}
          offset={offset}
          accuracy={location.accuracyMeters ?? null}
          label={location.locationName ?? null}
          isEvent={false}
        />
      ) : null}
      <div className="flex items-center gap-4">
        {isNetwork ? (
          <span
            className={cn(
              'flex size-15 shrink-0 items-center justify-center rounded-full border',
              isHome
                ? 'border-success/45 bg-success/10 text-success'
                : 'border-border-strong bg-surface-raised text-foreground-muted',
            )}
          >
            <AppIcon id={source === 'router' ? 'router' : 'radio-tower'} size={24} />
          </span>
        ) : (
          <BatteryRing level={battery} tone="cyan" icon="map-pin" />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <span
            key={word}
            className="entity-tick text-[24px] font-medium tracking-[-0.02em] select-text"
          >
            {word}
          </span>
          <span className="text-ui-sm text-foreground-subtle">
            {isNetwork && isHome
              ? t('entity.sheet.location.connectedSince', 'Connected {{since}}', {
                  since: since.charAt(0).toLowerCase() + since.slice(1),
                })
              : !isHome && location.locationName !== undefined
                ? t('entity.sheet.location.near', 'Near {{place}} · {{since}}', {
                    place: location.locationName,
                    since: since.charAt(0).toLowerCase() + since.slice(1),
                  })
                : since}
          </span>
        </div>
      </div>
      <div className="flex flex-col">
        {isNetwork ? (
          <>
            <Fact
              label={t('entity.sheet.location.source', 'Source')}
              value={sourceWords[source] ?? source}
            />
            {location.hostName === undefined ? null : (
              <Fact
                label={t('entity.sheet.location.hostName', 'Host name')}
                value={location.hostName}
              />
            )}
            {location.ipAddress === undefined ? null : (
              <Fact
                label={t('entity.sheet.location.ipAddress', 'IP address')}
                value={location.ipAddress}
              />
            )}
            {location.macAddress === undefined ? null : (
              <Fact
                label={t('entity.sheet.location.macAddress', 'MAC address')}
                value={location.macAddress}
              />
            )}
          </>
        ) : (
          <>
            {location.accuracyMeters === undefined ? null : (
              <Fact
                label={t('entity.sheet.location.accuracy', 'Accuracy')}
                value={t('entity.sheet.location.metres', '{{value}} m', {
                  value: Math.round(location.accuracyMeters),
                })}
              />
            )}
            <Fact
              label={t('entity.sheet.location.updated', 'Updated')}
              value={t('entity.sheet.location.ago', '{{ago}} ago', { ago: updated })}
            />
            <Fact
              label={t('entity.sheet.location.source', 'Source')}
              value={sourceWords[source] ?? source}
            />
          </>
        )}
      </div>
    </div>
  );
}
