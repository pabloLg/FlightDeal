// Route price history as an area chart, built by hand (no chart library).
// The x axis is proportional to the real date, so the gaps between observed
// days stay visible; only observed days are plotted and the line never
// interpolates a value. The axes and labels are HTML overlays positioned with
// the same scale as the SVG, which is stretched to fill its box: that keeps
// dots and text undistorted at any width. Shared scales live here so the SVG
// geometry and the HTML markers can never drift apart.

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });

const fmtEur = (v: number) => `${v.toFixed(2)} EUR`;
const fmtTick = (v: number) => `${v.toFixed(0)} €`;

type Point = { date: string; min: number; observations?: number };

// Rounds the axis step to 1/2/5 × 10ⁿ so the tick labels read cleanly.
function niceStep(range: number, count: number): number {
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return mult * mag;
}

// First and last always shown; between them, at most a handful so the labels
// never collide on a wide range.
function labelIndexes(n: number): number[] {
  if (n <= 6) return Array.from({ length: n }, (_, i) => i);
  return [...new Set([0, Math.round((n - 1) * 0.25), Math.round((n - 1) * 0.5), Math.round((n - 1) * 0.75), n - 1])].sort(
    (a, b) => a - b,
  );
}

export function PriceArea({
  days,
  habitual,
  emptyText = "Hacen falta al menos dos días con observaciones para dibujar la evolución.",
  ariaLabel = "Evolución del mínimo diario observado, en EUR",
}: {
  days: Point[];
  /** Mean the badge compares against; drawn as a dashed reference line. */
  habitual: number | null;
  emptyText?: string;
  ariaLabel?: string;
}) {
  if (days.length < 2) {
    return (
      <p className="rounded-lg bg-sky px-3 py-3 text-xs text-muted-foreground">
        {emptyText}
      </p>
    );
  }

  const minVal = Math.min(...days.map((d) => d.min));
  const bestIdx = days.findIndex((d) => d.min === minVal);

  const domain = days.map((d) => d.min);
  if (habitual != null) domain.push(habitual);
  let lo = Math.min(...domain);
  let hi = Math.max(...domain);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const step = niceStep(hi - lo, 3);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }

  // Percentages inside the 0–100 viewBox; the vertical padding keeps markers
  // off the top and bottom edges.
  const yPct = (v: number) => 6 + ((hi - v) / (hi - lo)) * 88;

  const times = days.map((d) => Date.parse(`${d.date}T00:00:00Z`));
  const tMin = times[0];
  const tMax = times[times.length - 1];
  const xPct = (t: number) =>
    tMax === tMin ? 50 : 3 + ((t - tMin) / (tMax - tMin)) * 94;

  const pts = days.map((d, i) => ({ ...d, x: xPct(times[i]), y: yPct(d.min) }));
  const base = yPct(lo);
  const linePath = `M ${pts.map((p) => `${p.x},${p.y}`).join(" L ")}`;
  const areaPath = `M ${pts[0].x},${base} L ${pts
    .map((p) => `${p.x},${p.y}`)
    .join(" L ")} L ${pts[pts.length - 1].x},${base} Z`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <div className="relative h-52 w-14 shrink-0">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
              style={{ top: `${yPct(t)}%` }}
            >
              {fmtTick(t)}
            </span>
          ))}
        </div>

        <div className="relative h-52 flex-1">
          <svg
            className="absolute inset-0 h-full w-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={ariaLabel}
          >
            <defs>
              <linearGradient id="priceAreaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <line
                key={t}
                x1="0"
                x2="100"
                y1={yPct(t)}
                y2={yPct(t)}
                stroke="var(--border)"
                strokeWidth="1"
                strokeDasharray="3 4"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={areaPath} fill="url(#priceAreaFill)" />
            {habitual != null && (
              <line
                x1="0"
                x2="100"
                y1={yPct(habitual)}
                y2={yPct(habitual)}
                stroke="var(--muted-foreground)"
                strokeWidth="1.5"
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path
              d={linePath}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {pts.map((p) => (
              <line
                key={`rug-${p.date}`}
                x1={p.x}
                x2={p.x}
                y1="94"
                y2="100"
                stroke="var(--brand)"
                strokeWidth="2"
                strokeOpacity="0.55"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {pts.map((p, i) => (
            <span
              key={p.date}
              data-testid="price-area-point"
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card ${
                i === bestIdx ? "h-3 w-3 bg-brand-dark" : "h-2 w-2 bg-brand"
              }`}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              title={`${fmtDay(p.date)}: mínimo ${fmtEur(p.min)}${
                p.observations ? ` · ${p.observations} precios vistos` : ""
              }`}
            />
          ))}

          {habitual != null && (
            <span
              className="absolute right-0 -translate-y-1/2 rounded bg-card/80 px-1 text-[10px] text-muted-foreground"
              style={{ top: `${yPct(habitual)}%` }}
            >
              habitual
            </span>
          )}
        </div>
      </div>

      <div className="relative ml-16 h-4">
        {labelIndexes(days.length).map((i) => (
          <span
            key={days[i].date}
            className="absolute -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground"
            style={{ left: `${pts[i].x}%` }}
          >
            {fmtDay(days[i].date)}
          </span>
        ))}
      </div>

      <div className="ml-16 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-brand" aria-hidden /> mínimo
          observado
        </span>
        {habitual != null && (
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3 bg-muted-foreground" aria-hidden />{" "}
            habitual
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-dark" aria-hidden />{" "}
          mejor día
        </span>
      </div>
    </div>
  );
}
