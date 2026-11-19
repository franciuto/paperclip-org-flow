import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { POSE_FOR_STATE, type PersonView, type TaskView } from "../../shared/types.js";
import { CHIP_CODE_X, CHIP_H, CHIP_PAD_R, chipCodeRoom, chipCodeWidth } from "../chips.js";
import { clampPercent, poseUrl, statusLabel, taskCode, tint, truncateToWidth } from "../format.js";
import { CHIPS_TOP, DEPT_LABEL_INSET, DEPT_LABEL_Y, LABEL_FONT, NAME_Y, STATE_Y, TITLE_Y, type OrgLayout } from "../layout.js";
import { OTHERS_ID } from "../model.js";
import { rovingNext } from "../poll.js";
import { fitScale } from "../viewport.js";
import { FLIGHT_MS, type Flight } from "../presence.js";

export type Selection = { type: "task" | "person"; id: string };

const onActivate = (fn: () => void) => (ev: KeyboardEvent) => {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    ev.stopPropagation();
    fn();
  }
};

/** Status glyph centred on (0,0): empty circle, half, dot, slash, check. */
export function StatusGlyph({ status }: { status: string }) {
  return (
    <>
      <circle r={4.2} className="of-glyph" strokeDasharray={status === "backlog" ? "2 1.6" : undefined} />
      {status === "in_progress" && <path d="M0 -4.2 A4.2 4.2 0 0 1 0 4.2 Z" className="of-glyph-f" />}
      {status === "in_review" && <circle r={1.7} className="of-glyph-f" />}
      {status === "blocked" && <path d="M-3 3 L3 -3" className="of-glyph" />}
      {status === "done" && <path d="M-2.2 0 L-.6 1.8 L2.4 -1.6" className="of-glyph" />}
    </>
  );
}

function Effects() {
  return (
    <g className="of-fx" aria-hidden="true">
      <g className="of-zzz">
        <text x={20} y={-26} fontSize={10}>z</text>
        <text x={24} y={-32} fontSize={12}>z</text>
        <text x={28} y={-38} fontSize={14}>Z</text>
      </g>
      <g className="of-typing" transform="translate(22 -6)">
        <rect x={0} y={-7} width={26} height={14} rx={7} />
        <circle cx={6} cy={0} r={2} />
        <circle cx={13} cy={0} r={2} />
        <circle cx={20} cy={0} r={2} />
      </g>
      <g className="of-thought" transform="translate(22 -38)">
        <circle className="of-b" cx={-2} cy={16} r={2} />
        <circle className="of-b" cx={2} cy={10} r={3} />
        <ellipse cx={14} cy={0} rx={14} ry={9} />
        <circle className="of-d" cx={8} cy={0} r={1.8} />
        <circle className="of-d" cx={14} cy={0} r={1.8} />
        <circle className="of-d" cx={20} cy={0} r={1.8} />
      </g>
      <g className="of-bang" transform="translate(25 -36)">
        <circle r={8} />
        <text textAnchor="middle" dominantBaseline="central" y={0.5}>!</text>
      </g>
      <g className="of-huh" transform="translate(25 -36)">
        <circle r={8} />
        <text textAnchor="middle" dominantBaseline="central" y={0.5}>?</text>
      </g>
      <g className="of-spark">
        {[[-30, -34], [30, -36], [-36, -6], [36, -4], [0, -50], [-20, -48]].map(([x, y], i) => (
          <path key={i} d={`M${x} ${y! - 4} L${x! + 2} ${y} L${x} ${y! + 4} L${x! - 2} ${y} Z`} />
        ))}
      </g>
    </g>
  );
}

interface ChipProps {
  task: TaskView;
  x: number;
  y: number;
  w: number;
  color: string;
  groupTitle: string;
  selected: boolean;
  dim: boolean;
  onSelect: (s: Selection) => void;
  /** Roving tabindex: 0 only for the chart's current focus item. */
  tabIndex?: number;
  onFocusItem?: () => void;
}

export function Chip({ task, x, y, w, color, groupTitle, selected, dim, onSelect, tabIndex = 0, onFocusItem }: ChipProps) {
  const pct = clampPercent(task.progress);
  const code = taskCode(task);
  const label = `${code} · ${task.title} — ${statusLabel(task.status)}, ${pct}%${groupTitle ? ` · ${groupTitle}` : ""}`;
  const pick = () => onSelect({ type: "task", id: task.id });
  return (
    <g
      className={`of-chip${selected ? " of-csel" : ""}${dim ? " of-cdim" : ""}`}
      transform={`translate(${x} ${y})`}
      tabIndex={tabIndex}
      data-fkey={`t:${task.id}`}
      onFocus={onFocusItem}
      role="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={(ev) => {
        ev.stopPropagation();
        pick();
      }}
      onKeyDown={onActivate(pick)}
    >
      <title>{label}</title>
      <g className="of-in">
        <rect className="of-cbg" width={w} height={CHIP_H} rx={4} style={{ fill: tint(color, 14), stroke: color }} />
        <rect className="of-cfill" width={(w * pct) / 100} height={CHIP_H} rx={4} style={{ fill: tint(color, 46) }} />
        <g transform={`translate(9 ${CHIP_H / 2})`}>
          <StatusGlyph status={task.status} />
        </g>
        {/* Codes longer than the room are squeezed (textLength) so they never touch the percent. */}
        <text x={CHIP_CODE_X} y={12.6} {...(chipCodeWidth(code) > chipCodeRoom(w) ? { textLength: chipCodeRoom(w), lengthAdjust: "spacingAndGlyphs" } : {})}>{code}</text>
        <text className="of-pc" x={w - CHIP_PAD_R} y={12.6} textAnchor="end">{pct}%</text>
      </g>
    </g>
  );
}

interface FlightProps {
  flight: Flight;
  from: { x: number; y: number };
  to: { x: number; y: number };
  w: number;
  onDone: (key: string) => void;
}

/** A chip flying along a quadratic arc with a fading dotted trail (no arrows, no lines). */
function FlightAnim({ flight, from, to, w, onDone }: FlightProps) {
  const gRef = useRef<SVGGElement>(null);
  const dots = useRef<Array<SVGCircleElement | null>>([]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const C = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 44 - Math.abs(from.x - to.x) * 0.12 };
    const at = (k: number) => ({
      x: (1 - k) * (1 - k) * from.x + 2 * (1 - k) * k * C.x + k * k * to.x,
      y: (1 - k) * (1 - k) * from.y + 2 * (1 - k) * k * C.y + k * k * to.y,
    });
    let raf = 0;
    const step = () => {
      const k = (Date.now() - flight.start) / FLIGHT_MS;
      if (k >= 1) {
        doneRef.current(flight.key);
        return;
      }
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const p = at(Math.max(0, e));
      gRef.current?.setAttribute("transform", `translate(${p.x} ${p.y})`);
      const fade = k > 0.8 ? (1 - k) / 0.2 : 1;
      dots.current.forEach((d, j) => {
        if (!d) return;
        const q = at(Math.max(0, e - (j + 1) * 0.045));
        d.setAttribute("cx", String(q.x));
        d.setAttribute("cy", String(q.y));
        d.style.opacity = String((0.55 - j * 0.07) * fade);
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // The flight is immutable once launched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <g aria-hidden="true">
      <g>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle key={i} ref={(el) => { dots.current[i] = el; }} cx={from.x} cy={from.y} r={3.4 - i * 0.45} style={{ fill: flight.color, opacity: 0 }} />
        ))}
      </g>
      <g ref={gRef} className="of-fly" transform={`translate(${from.x} ${from.y})`}>
        <rect className="of-cbg" x={-w / 2} y={-CHIP_H / 2} width={w} height={CHIP_H} rx={4} style={{ fill: tint(flight.color, 42), stroke: flight.color }} />
        <text textAnchor="middle" y={3.4}>{flight.code}</text>
      </g>
    </g>
  );
}

export interface OrgChartProps {
  people: PersonView[];
  held: Map<string, TaskView[]>;
  groupColor: (groupId: string) => string;
  groupTitle: (groupId: string) => string;
  layout: OrgLayout;
  chipW: number;
  selected: Selection | null;
  focusGroup: string | null;
  touched: Set<string>;
  touchColor: string | null;
  flights: Flight[];
  onFlightDone: (key: string) => void;
  onSelect: (s: Selection) => void;
  ariaLabel: string;
}


export function OrgChart(props: OrgChartProps) {
  const { people, held, layout, chipW, selected, focusGroup, touched, touchColor, flights, onSelect } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Roving tabindex: the chart is ONE tab stop; arrow keys / Home / End move between people and
  // their chips in reading order (person, then its chips, then the next person).
  const focusKeys: string[] = [];
  for (const id of layout.ids) {
    focusKeys.push(`p:${id}`);
    const n = layout.nodes[id];
    for (const t of (held.get(id) ?? []).slice(0, n?.chips.slots.length ?? 0)) focusKeys.push(`t:${t.id}`);
  }
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const current = activeKey && focusKeys.includes(activeKey) ? activeKey : focusKeys[0] ?? null;
  const tabFor = (key: string) => (key === current ? 0 : -1);
  const onChartKey = (ev: KeyboardEvent) => {
    const from = (ev.target as Element | null)?.closest?.("[data-fkey]")?.getAttribute("data-fkey") ?? current;
    const next = rovingNext(focusKeys, from, ev.key);
    if (!next) return;
    ev.preventDefault();
    setActiveKey(next);
    const el = svgRef.current?.querySelector(`[data-fkey="${next.replace(/"/g, '\\"')}"]`) as (SVGElement & { focus(): void }) | null;
    el?.focus();
  };
  // Box size (width and height): the chart is scaled to fit both ("contain").
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const avail = box.w;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Quantised to 2% steps so small layout changes (a chip row appearing) don't make it twitch.
  const fit = fitScale(layout.width, layout.height, box.w - 4, box.h - 4);
  const scale = avail ? Math.floor(fit.scale * 50) / 50 : 1;

  // When the chart is wider than its box (phones), start scrolled to the top of the org.
  const centred = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !avail || centred.current) return;
    centred.current = true;
    if (layout.width * scale <= avail) return;
    const top = layout.ids.map((id) => layout.nodes[id]!).filter((n) => n.depth === 0);
    if (!top.length) return;
    const cx = (Math.min(...top.map((n) => n.x)) + Math.max(...top.map((n) => n.x))) / 2;
    el.scrollLeft = Math.max(0, cx * scale - avail / 2);
  }, [avail, layout, scale]);
  const W = Math.round(layout.width * scale);
  const H = Math.round(layout.height * scale);
  const byId = new Map(people.map((p) => [p.id, p]));
  const chipAnchor = (id: string) => {
    const n = layout.nodes[id];
    return n ? { x: n.x, y: n.y + CHIPS_TOP + CHIP_H / 2 } : null;
  };

  return (
    <>
    <div className="of-scroll" ref={scrollRef}>
      <svg ref={svgRef} className="of-org" width={W} height={H} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={`${props.ariaLabel}. Usa le frecce per spostarti tra persone e task, Invio per i dettagli.`} onKeyDown={onChartKey}>
        <g aria-hidden="true">
          {layout.boxes.map((b) => (
            <g key={b.id} className="of-dept">
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={16} />
              <text x={b.x + DEPT_LABEL_INSET} y={b.y + DEPT_LABEL_Y}>
                {b.name}
                <tspan className="of-dept-n">{` · ${b.count}`}</tspan>
              </text>
            </g>
          ))}
        </g>
        <g aria-hidden="true">
          {layout.edges.map((e) => (
            <path key={e.key} d={e.d} className={`of-edge${e.dashed ? " of-dashed" : ""}`} />
          ))}
        </g>
        <g>
          {layout.ids.map((id) => {
            const n = layout.nodes[id]!;
            const p = byId.get(id);
            if (!p) return null;
            const tasks = held.get(id) ?? [];
            const isSel = selected?.type === "person" && selected.id === id;
            const isTouched = selected?.type === "task" && touched.has(id);
            const dimmed = !!focusGroup && !tasks.some((t) => t.groupId === focusGroup) && !isTouched;
            const pose = POSE_FOR_STATE[p.state] ?? "idle";
            const label = truncateToWidth(p.stateLabel, n.width - 6, LABEL_FONT);
            const nodeLabel = `${p.name}${p.title ? `, ${p.title}` : ""}: ${p.stateLabel}. ${tasks.length === 1 ? "1 task in mano" : `${tasks.length} task in mano`}`;
            const pick = () => onSelect({ type: "person", id });
            const half = n.width / 2;
            const clipId = `of-clip-${uid}-${layout.ids.indexOf(id)}`;
            return (
              <g key={id} className={`of-node-wrap${dimmed ? " of-dimmed" : ""}`} transform={`translate(${n.x} ${n.y})`}>
                <g
                  className={`of-node${isSel ? " of-sel" : ""}${isTouched ? " of-touched" : ""}`}
                  data-state={p.state}
                  tabIndex={tabFor(`p:${id}`)}
                  data-fkey={`p:${id}`}
                  onFocus={() => setActiveKey(`p:${id}`)}
                  role="button"
                  aria-label={nodeLabel}
                  aria-pressed={isSel}
                  onClick={pick}
                  onKeyDown={onActivate(pick)}
                  style={isTouched && touchColor ? ({ ["--of-tc" as string]: touchColor } as CSSProperties) : undefined}
                >
                  <title>{`${p.name}${p.title ? ` · ${p.title}` : ""}`}</title>
                  <rect className="of-hit" x={-half} y={-52} width={n.width} height={122} />
                  <rect className="of-focus" x={-half + 1} y={-53} width={n.width - 2} height={124} rx={10} />
                  <circle className="of-halo-bg" cx={0} cy={-12} r={33} />
                  <circle className="of-halo" cx={0} cy={-12} r={33} />
                  <g className="of-bob">
                    {p.kind === "user" ? (
                      <>
                        <circle className="of-user-av" cx={0} cy={-12} r={25} />
                        <circle className="of-user-ic" cx={0} cy={-18} r={7} />
                        <path className="of-user-ic" d="M-12.5 2 C-10.5 -8.5 10.5 -8.5 12.5 2 Z" />
                      </>
                    ) : p.customAvatarUrl ? (
                      <>
                        <clipPath id={clipId}>
                          <circle cx={0} cy={-12} r={28} />
                        </clipPath>
                        <image href={p.customAvatarUrl} x={-28} y={-40} width={56} height={56} clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid slice" />
                      </>
                    ) : p.paletteId ? (
                      <image href={poseUrl(p.paletteId, pose)} x={-32} y={-44} width={64} height={64} />
                    ) : (
                      <>
                        <circle className="of-user-av" cx={0} cy={-12} r={25} />
                        <text className="of-nm" textAnchor="middle" y={-7}>{p.id === OTHERS_ID ? "···" : p.name.slice(0, 2).toUpperCase()}</text>
                      </>
                    )}
                  </g>
                  <Effects />
                  {tasks.length > 0 && (
                    <g className="of-badge" transform="translate(-27 -36)" aria-hidden="true">
                      <circle r={8.5} />
                      <text textAnchor="middle" dominantBaseline="central">{tasks.length > 99 ? "99+" : tasks.length}</text>
                    </g>
                  )}
                  <text className="of-nm" textAnchor="middle" y={NAME_Y}>{n.name}</text>
                  {n.title ? <text className="of-ttl" textAnchor="middle" y={TITLE_Y}>{n.title}</text> : null}
                  <text className="of-stl" textAnchor="middle" y={n.title ? STATE_Y : TITLE_Y}>{label}</text>
                </g>
                {tasks.length > 0 && (
                  <g transform={`translate(0 ${CHIPS_TOP})`}>
                    {n.chips.slots.map((slot, i) => {
                      const t = tasks[i];
                      if (!t) return null;
                      return (
                        <Chip
                          key={t.id}
                          task={t}
                          x={slot.x}
                          y={slot.y}
                          w={chipW}
                          color={props.groupColor(t.groupId)}
                          groupTitle={props.groupTitle(t.groupId)}
                          selected={selected?.type === "task" && selected.id === t.id}
                          dim={!!focusGroup && t.groupId !== focusGroup}
                          onSelect={onSelect}
                          tabIndex={tabFor(`t:${t.id}`)}
                          onFocusItem={() => setActiveKey(`t:${t.id}`)}
                        />
                      );
                    })}
                    {n.chips.more && (
                      <text className="of-more" x={n.chips.more.x + 4} y={n.chips.more.y + 12.5}>
                        {`+${n.chips.more.count} altri`}
                      </text>
                    )}
                  </g>
                )}
              </g>
            );
          })}
        </g>
        <g>
          {flights.map((f) => {
            const a = chipAnchor(f.fromId);
            const b = chipAnchor(f.toId);
            if (!a || !b) return <NoFlight key={f.key} k={f.key} onDone={props.onFlightDone} />;
            return <FlightAnim key={f.key} flight={f} from={a} to={b} w={chipW} onDone={props.onFlightDone} />;
          })}
        </g>
      </svg>
    </div>
    {avail > 0 && layout.width * scale > avail + 4 && <p className="of-scrollhint">Scorri di lato per vedere tutto l'organigramma</p>}
    </>
  );
}

function NoFlight({ k, onDone }: { k: string; onDone: (key: string) => void }) {
  useEffect(() => onDone(k), [k, onDone]);
  return null;
}
