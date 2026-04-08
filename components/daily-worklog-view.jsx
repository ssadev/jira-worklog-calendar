"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PieChart, Pie, Cell, Sector } from "recharts";

// ─── Theme (mirrors main app) ────────────────────────────────────────────────
const T = {
  bg: "#0c0c14",
  surface: "#14141f",
  surface2: "#1c1c2c",
  border: "#2e2e46",
  border2: "#3a3a58",
  text: "#eeeef8",
  textSub: "#a8a8c8",
  textMuted: "#6868a0",
  textDim: "#40406a",
  accent: "#8b7fff",
  accentBr: "#a99bff",
  green: "#4ade80",
  red: "#f87171",
};

// Colors cycled per unique issue key
const PALETTE = [
  "#8b7fff",
  "#4ade80",
  "#60a5fa",
  "#fb923c",
  "#f472b6",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#e879f9",
  "#2dd4bf",
];

// ─── Clock config ────────────────────────────────────────────────────────────
const CLOCK_START_HOUR = 9;   // 9 am
const CLOCK_TOTAL_HOURS = 12; // 9 am → 9 pm
const TARGET_SECONDS = 8 * 3600;

const TICK_LABELS = [
  { label: "9am", angleDeg: 0 },
  { label: "12", angleDeg: 90 },
  { label: "3pm", angleDeg: 180 },
  { label: "6pm", angleDeg: 270 },
];

// ─── Responsive hook ──────────────────────────────────────────────────────────
function useIsDesktop(breakpoint = 768) {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    setIsDesktop(mq.matches);
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isDesktop;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(seconds, full = false) {
  if (!seconds) return full ? "0h" : "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function toDS(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return toDS(d);
}

function isValidDayStr(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, mo, d] = s.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

function normalizeDomain(domain) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\.atlassian\.net\/?$/i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function parseStoredCreds(raw) {
  try {
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.domain || !p?.email || !p?.token || !p?.accountId) return null;
    return {
      domain: normalizeDomain(p.domain),
      email: String(p.email),
      token: String(p.token),
      accountId: String(p.accountId),
      displayName: String(p.displayName || ""),
    };
  } catch {
    return null;
  }
}

async function fetchMonthData(creds, dayStr) {
  const [year, month] = dayStr.split("-").map(Number);
  const res = await fetch("/api/jira/worklogs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      domain: creds.domain,
      email: creds.email,
      token: creds.token,
      accountId: creds.accountId,
      year,
      month: month - 1,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body; // full { "YYYY-MM-DD": Entry[] } map
}

// ─── SVG Clock helpers ────────────────────────────────────────────────────────
function polarXY(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const span = endDeg - startDeg;
  // For near-full-circle arcs, draw two half-arcs to avoid SVG arc ambiguity
  if (span >= 359.99) {
    const mid = startDeg + 180;
    const s = polarXY(cx, cy, r, startDeg);
    const m = polarXY(cx, cy, r, mid);
    return `M ${s.x} ${s.y} A ${r} ${r} 0 1 1 ${m.x} ${m.y} A ${r} ${r} 0 1 1 ${s.x} ${s.y}`;
  }
  const s = polarXY(cx, cy, r, startDeg);
  const e = polarXY(cx, cy, r, endDeg);
  const large = span > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

// Convert a worklog's startedAt ISO string → angle on the clock face
function startedToAngle(startedAt) {
  if (!startedAt) return null;
  const d = new Date(startedAt);
  if (isNaN(d)) return null;
  const hours = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  const offset = hours - CLOCK_START_HOUR;
  const clamped = Math.max(0, Math.min(CLOCK_TOTAL_HOURS, offset));
  return (clamped / CLOCK_TOTAL_HOURS) * 360;
}

function secondsToAngle(seconds) {
  return (seconds / (CLOCK_TOTAL_HOURS * 3600)) * 360;
}

// ─── Gap detection ────────────────────────────────────────────────────────────
function findGaps(entries) {
  const WORK_START = CLOCK_START_HOUR * 3600;
  const WORK_END = (CLOCK_START_HOUR + 9) * 3600; // 9am to 6pm

  const intervals = entries
    .map((e) => {
      if (!e.startedAt) return null;
      const d = new Date(e.startedAt);
      if (isNaN(d)) return null;
      const start = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      const end = start + e.timeSpentSeconds;
      return { start: Math.max(start, WORK_START), end: Math.min(end, WORK_END) };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  if (intervals.length === 0) return [];

  const merged = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i].start <= last.end) {
      last.end = Math.max(last.end, intervals[i].end);
    } else {
      merged.push({ ...intervals[i] });
    }
  }

  const gaps = [];
  let cursor = WORK_START;
  for (const { start, end } of merged) {
    if (start > cursor) gaps.push({ startSec: cursor, endSec: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < WORK_END) gaps.push({ startSec: cursor, endSec: WORK_END });

  return gaps;
}

function secToTimeStr(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const period = h >= 12 ? "pm" : "am";
  const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}

function fmtTimeRange(startedAt, timeSpentSeconds) {
  if (!startedAt) return null;
  const start = new Date(startedAt);
  if (isNaN(start)) return null;
  const end = new Date(start.getTime() + timeSpentSeconds * 1000);
  const fmt12 = (d) => {
    const h = d.getHours();
    const m = d.getMinutes();
    const period = h >= 12 ? "pm" : "am";
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${displayH}:${String(m).padStart(2, "0")}${period}`;
  };
  return `${fmt12(start)} – ${fmt12(end)}`;
}

// ─── Arc builder with greedy lane assignment ──────────────────────────────────
// Each entry becomes ONE arc path. Overlapping entries get separate radial
// lanes so they render as clean parallel strips with no sub-segment artifacts.
const MIN_ARC_ANGLE = 3; // Minimum arc span in degrees so short worklogs stay visible

function buildClockArcs(entries, colorMap) {
  const arcs = entries
    .map((e, entryIndex) => {
      const startAngle = startedToAngle(e.startedAt);
      if (startAngle === null) return null;
      const spanAngle = secondsToAngle(e.timeSpentSeconds);
      // Enforce minimum visible arc span
      const effectiveSpan = Math.max(spanAngle, MIN_ARC_ANGLE);
      const endAngle = Math.min(startAngle + effectiveSpan, 360);
      if (endAngle - startAngle < 0.1) return null; // skip truly degenerate arcs
      return { startAngle, endAngle, color: colorMap[e.issueKey], entryIndex, lane: 0 };
    })
    .filter(Boolean);

  if (arcs.length === 0) return [];

  // Greedy interval coloring — assign lowest available lane per arc
  const sorted = [...arcs].sort((a, b) => a.startAngle - b.startAngle);
  const laneEnds = []; // laneEnds[k] = endAngle of the last arc placed in lane k

  for (const arc of sorted) {
    // Use strict < so arcs that exactly touch don't get pushed to a new lane
    let lane = laneEnds.findIndex((end) => end < arc.startAngle + 0.5);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = arc.endAngle;
    arc.lane = lane;
  }

  const totalLanes = Math.max(1, laneEnds.length);
  return arcs.map((a) => ({ ...a, totalLanes }));
}

// ─── Recharts-based Clock ─────────────────────────────────────────────────────
// Custom sector shape with built-in click/hover handlers (Recharts v3 Pie onClick doesn't fire)
function InteractiveSector(props) {
  const {
    cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill,
    payload, cornerRadius: cr,
  } = props;

  if (!payload || payload.type === "gap") {
    return (
      <Sector
        cx={cx} cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill="transparent"
        stroke="none"
        cornerRadius={cr}
      />
    );
  }

  const isActive = payload.isActive;
  return (
    <Sector
      cx={cx} cy={cy}
      innerRadius={isActive ? innerRadius - 2 : innerRadius}
      outerRadius={isActive ? outerRadius + 2 : outerRadius}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      stroke="none"
      cornerRadius={cr}
      opacity={payload.opacity}
      style={{ cursor: "pointer", transition: "opacity 0.18s" }}
      onClick={(e) => {
        e.stopPropagation();
        if (payload.onSelect) payload.onSelect();
      }}
      onMouseEnter={() => { if (payload.onHover) payload.onHover(); }}
      onMouseLeave={() => { if (payload.onUnhover) payload.onUnhover(); }}
    />
  );
}

// Convert our clock angles (0°=9am, clockwise) to Recharts angles (90°=top, counter-clockwise)
// Our 0° (9am) = top of clock = Recharts 90°
// Our angle increases clockwise, Recharts increases counter-clockwise
// So: rechartsAngle = 90 - ourAngle
function toRechartsAngle(ourAngle) {
  return 90 - ourAngle;
}

// Build pie data for a single lane — fill gaps with transparent entries
function buildLanePieData(laneArcs, selectedIndex, hoveredIndex, onSelect, onHover, onUnhover) {
  const sorted = [...laneArcs].sort((a, b) => a.startAngle - b.startAngle);
  const data = [];
  let cursor = 0;

  for (const arc of sorted) {
    // Gap before this arc
    if (arc.startAngle > cursor + 0.1) {
      data.push({ value: arc.startAngle - cursor, type: "gap" });
    }
    // The worklog arc
    const isActive = arc.entryIndex === selectedIndex || arc.entryIndex === hoveredIndex;
    const hasFocus = selectedIndex !== null || hoveredIndex !== null;
    const ei = arc.entryIndex;
    data.push({
      value: arc.endAngle - arc.startAngle,
      type: "worklog",
      fill: arc.color,
      entryIndex: ei,
      opacity: isActive ? 1 : hasFocus ? 0.3 : 0.9,
      isActive,
      onSelect: () => onSelect(ei === selectedIndex ? null : ei),
      onHover: () => onHover(ei),
      onUnhover,
    });
    cursor = arc.endAngle;
  }

  // Gap after last arc to complete the circle
  if (cursor < 359.9) {
    data.push({ value: 360 - cursor, type: "gap" });
  }

  return data;
}

function ClockSVG({ entries, totalSeconds, size = 290, selectedIndex, onSelectEntry }) {
  const CX = size / 2;
  const CY = size / 2;
  const scale = size / 300;

  // Ring geometry
  const RING_OUTER = 123 * scale;
  const RING_INNER = 93 * scale;
  const RING_W = RING_OUTER - RING_INNER;
  const BAND_GAP = 2 * scale;
  const LABEL_R = 136 * scale;
  const TICK_IN = RING_INNER - 1 * scale;
  const TICK_OUT = RING_OUTER + 4 * scale;
  const HOUR_DOT_R = RING_OUTER + 2 * scale;

  const [hoveredIndex, setHoveredIndex] = useState(null);

  const colorMap = useMemo(() => {
    const map = {};
    let idx = 0;
    [...entries]
      .sort((a, b) => (a.startedAt || "").localeCompare(b.startedAt || ""))
      .forEach((e) => {
        if (!map[e.issueKey]) {
          map[e.issueKey] = PALETTE[idx % PALETTE.length];
          idx++;
        }
      });
    return map;
  }, [entries]);

  const arcs = useMemo(
    () => buildClockArcs(entries, colorMap),
    [entries, colorMap]
  );

  // Group arcs by lane
  const lanes = useMemo(() => {
    const groups = {};
    for (const arc of arcs) {
      if (!groups[arc.lane]) groups[arc.lane] = [];
      groups[arc.lane].push(arc);
    }
    const totalLanes = Math.max(1, Object.keys(groups).length);
    const laneWidth = Math.max(4 * scale, (RING_W - BAND_GAP * (totalLanes - 1)) / totalLanes);

    return Object.entries(groups).map(([lane, laneArcs]) => {
      const l = Number(lane);
      const outer = RING_OUTER - l * (laneWidth + BAND_GAP);
      const inner = outer - laneWidth;
      return { lane: l, arcs: laneArcs, outer, inner };
    });
  }, [arcs, RING_W, RING_OUTER, BAND_GAP, scale]);

  const progressPct = Math.min(totalSeconds / TARGET_SECONDS, 1);
  const BAR_W = 72 * scale;
  const BAR_H = 3 * scale;
  const BAR_X = CX - BAR_W / 2;
  const BAR_Y = CY + 18 * scale;

  const majorAngles = new Set(TICK_LABELS.map((t) => t.angleDeg));
  const minorDots = Array.from({ length: 12 }, (_, i) => i * 30).filter(
    (a) => !majorAngles.has(a)
  );

  // Recharts: startAngle=90 (top), endAngle=-270 (full clockwise circle)
  const CHART_START = 90;
  const CHART_END = -270;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {/* Recharts PieChart for arcs */}
      <PieChart width={size} height={size} style={{ position: "absolute", top: 0, left: 0, outline: "none" }} accessibilityLayer={false}>
        {/* Background track ring */}
        <Pie
          data={[{ value: 1 }]}
          cx={CX} cy={CY}
          innerRadius={RING_INNER}
          outerRadius={RING_OUTER}
          startAngle={CHART_START}
          endAngle={CHART_END}
          fill={T.surface2}
          stroke="none"
          isAnimationActive={false}
          dataKey="value"
        />

        {/* Worklog arcs — one Pie ring per overlap lane */}
        {lanes.map(({ lane, arcs: laneArcs, outer, inner }) => {
          const pieData = buildLanePieData(
            laneArcs, selectedIndex, hoveredIndex,
            onSelectEntry, setHoveredIndex, () => setHoveredIndex(null)
          );

          return (
            <Pie
              key={lane}
              data={pieData}
              cx={CX} cy={CY}
              innerRadius={inner}
              outerRadius={outer}
              startAngle={CHART_START}
              endAngle={CHART_END}
              stroke="none"
              cornerRadius={6}
              isAnimationActive={false}
              dataKey="value"
              activeIndex={-1}
              shape={<InteractiveSector />}
            >
              {pieData.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.type === "gap" ? "transparent" : d.fill}
                />
              ))}
            </Pie>
          );
        })}
      </PieChart>

      {/* SVG overlay for ticks, labels, center text */}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      >
        {/* Minor hour dots */}
        {minorDots.map((angle) => {
          const p = polarXY(CX, CY, HOUR_DOT_R, angle);
          return <circle key={angle} cx={p.x} cy={p.y} r={1.5 * scale} fill={T.textDim} opacity={0.6} />;
        })}

        {/* Major hour ticks + labels */}
        {TICK_LABELS.map(({ label, angleDeg }) => {
          const inner = polarXY(CX, CY, TICK_IN, angleDeg);
          const outer = polarXY(CX, CY, TICK_OUT, angleDeg);
          const lp = polarXY(CX, CY, LABEL_R, angleDeg);
          return (
            <g key={label}>
              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={T.textDim} strokeWidth={1.5 * scale} />
              <text
                x={lp.x} y={lp.y}
                textAnchor="middle" dominantBaseline="middle"
                fill={T.textMuted}
                fontSize={8.5 * scale}
                fontFamily="'DM Mono', monospace"
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Center: total logged */}
        <text
          x={CX} y={CY - 22 * scale}
          textAnchor="middle" dominantBaseline="middle"
          fill={T.text}
          fontSize={28 * scale}
          fontWeight={700}
          fontFamily="'Syne', sans-serif"
          letterSpacing={-0.5}
        >
          {fmt(totalSeconds, true)}
        </text>

        {/* Center: subtitle */}
        <text
          x={CX} y={CY + 2 * scale}
          textAnchor="middle" dominantBaseline="middle"
          fill={T.textMuted}
          fontSize={9.5 * scale}
          fontFamily="'DM Mono', monospace"
          letterSpacing={0.3}
        >
          logged today
        </text>

        {/* Progress bar */}
        <rect x={BAR_X} y={BAR_Y} width={BAR_W} height={BAR_H} rx={BAR_H / 2} fill={T.surface2} />
        <rect x={BAR_X} y={BAR_Y} width={BAR_W * progressPct} height={BAR_H} rx={BAR_H / 2} fill={T.green} />

        {/* Progress label */}
        <text
          x={CX} y={BAR_Y + 13 * scale}
          textAnchor="middle" dominantBaseline="middle"
          fill={T.textDim}
          fontSize={8.5 * scale}
          fontFamily="'DM Mono', monospace"
        >
          {Math.round(progressPct * 100)}% · target {fmt(TARGET_SECONDS, true)}
        </text>
      </svg>
    </div>
  );
}

// ─── Worklog list item ────────────────────────────────────────────────────────
function WorklogItem({ entry, color, isSelected, itemRef }) {
  const timeRange = fmtTimeRange(entry.startedAt, entry.timeSpentSeconds);

  return (
    <div
      ref={itemRef}
      style={{
        background: isSelected ? `${color}14` : T.surface2,
        border: `1px solid ${isSelected ? color + "70" : T.border}`,
        borderRadius: 8,
        padding: "11px 13px",
        borderLeft: `3px solid ${color}`,
        transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s",
        boxShadow: isSelected ? `0 0 0 1px ${color}30, 0 4px 16px ${color}18` : "none",
      }}
    >
      {/* Top row: issue key + time range + duration */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 5,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color,
            fontFamily: "'DM Mono', monospace",
            letterSpacing: "0.05em",
          }}
        >
          {entry.issueKey}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {timeRange && (
            <span
              style={{
                fontSize: 10,
                color: T.textMuted,
                fontFamily: "'DM Mono', monospace",
                letterSpacing: "0.02em",
              }}
            >
              {timeRange}
            </span>
          )}
          <span
            style={{
              fontSize: 12,
              color: T.text,
              fontWeight: 600,
              fontFamily: "'DM Mono', monospace",
              background: `${color}18`,
              border: `1px solid ${color}40`,
              borderRadius: 4,
              padding: "1px 6px",
            }}
          >
            {fmt(entry.timeSpentSeconds, true)}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.45 }}>
        {entry.issueSummary}
      </div>

      {entry.comment ? (
        <div
          style={{
            fontSize: 10,
            color: T.textMuted,
            marginTop: 6,
            lineHeight: 1.5,
            borderLeft: `2px solid ${T.border2}`,
            paddingLeft: 8,
            fontStyle: "italic",
          }}
        >
          {entry.comment}
        </div>
      ) : null}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DailyWorklogView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDesktop = useIsDesktop(768);

  const rawDay = searchParams.get("day");
  const today = toDS(new Date());
  const day = isValidDayStr(rawDay) ? rawDay : today;

  const [creds, setCreds] = useState(null);
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [monthData, setMonthData] = useState({});
  const [fetchedMonths, setFetchedMonths] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const raw = typeof window !== "undefined" ? localStorage.getItem("jira-worklog-creds") : null;
    setCreds(parseStoredCreds(raw));
    setCredsLoaded(true);
  }, []);

  useEffect(() => {
    if (credsLoaded && !creds) {
      router.replace("/");
    }
  }, [credsLoaded, creds, router]);

  const monthKey = day.slice(0, 7);

  const fetchMonth = useCallback(
    async (mk, credsArg) => {
      if (fetchedMonths.has(mk)) return;
      setLoading(true);
      setError(null);
      try {
        const byDate = await fetchMonthData(credsArg, `${mk}-01`);
        setMonthData((prev) => ({ ...prev, ...byDate }));
        setFetchedMonths((prev) => new Set([...prev, mk]));
      } catch (err) {
        setError(err.message || "Failed to load worklogs.");
      } finally {
        setLoading(false);
      }
    },
    [fetchedMonths]
  );

  useEffect(() => {
    if (!creds) return;
    fetchMonth(monthKey, creds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey, creds]);

  const navigateDay = useCallback(
    (newDay) => {
      router.push(`/daily-worklog?day=${newDay}`);
    },
    [router]
  );

  const entries = useMemo(() => monthData[day] || [], [monthData, day]);
  const dayDate = useMemo(() => new Date(`${day}T12:00:00`), [day]);
  const totalSeconds = useMemo(
    () => entries.reduce((s, e) => s + e.timeSpentSeconds, 0),
    [entries]
  );

  const colorMap = useMemo(() => {
    const map = {};
    let idx = 0;
    [...entries]
      .sort((a, b) => (a.startedAt || "").localeCompare(b.startedAt || ""))
      .forEach((e) => {
        if (!map[e.issueKey]) {
          map[e.issueKey] = PALETTE[idx % PALETTE.length];
          idx++;
        }
      });
    return map;
  }, [entries]);

  const gaps = useMemo(() => findGaps(entries), [entries]);
  const isToday = day === today;

  const [selectedIndex, setSelectedIndex] = useState(null);
  const entryRefs = useRef({});

  // Reset selection when day changes
  useEffect(() => { setSelectedIndex(null); }, [day]);

  // Scroll selected entry into view
  useEffect(() => {
    if (selectedIndex === null) return;
    const el = entryRefs.current[selectedIndex];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedIndex]);

  if (!credsLoaded) return null;
  if (credsLoaded && !creds) return null;

  const prevDay = addDays(day, -1);
  const nextDay = addDays(day, 1);
  const isNextFuture = nextDay > today;

  const weekday = dayDate.toLocaleDateString("en-US", { weekday: "long" });
  const dateLabel = dayDate.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  const clockSize = isDesktop ? 380 : 290;

  // ── Worklog list content (shared between layouts) ──────────────────────────
  const worklogListContent = (
    <>
      {/* Section heading */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: T.textMuted,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingBottom: 10,
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        Worklogs
        <span style={{ color: T.textDim, fontWeight: 400 }}>—</span>
        <span style={{ color: T.textSub, fontWeight: 400 }}>{dateLabel}</span>
        {entries.length > 0 && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10,
              color: T.textDim,
              fontWeight: 400,
            }}
          >
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
        )}
      </div>

      {error ? (
        <div
          style={{
            background: "rgba(248,113,113,0.08)",
            border: `1px solid rgba(248,113,113,0.25)`,
            borderRadius: 8,
            padding: "12px 14px",
            fontSize: 12,
            color: T.red,
          }}
        >
          {error}
        </div>
      ) : loading ? (
        <div style={{ color: T.textDim, fontSize: 12, padding: "20px 0", textAlign: "center" }}>
          Fetching worklogs…
        </div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: "center", color: T.textDim, fontSize: 12, padding: "32px 0" }}>
          No worklogs for this day.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entries.map((entry, i) => (
            <WorklogItem
              key={`${entry.issueKey}-${i}`}
              entry={entry}
              color={colorMap[entry.issueKey]}
              isSelected={selectedIndex === i}
              itemRef={(el) => { entryRefs.current[i] = el; }}
            />
          ))}

          {/* Unlogged gap indicators */}
          {gaps.map((gap, i) => {
            const durSec = gap.endSec - gap.startSec;
            return (
              <div
                key={`gap-${i}`}
                style={{
                  background: "transparent",
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  padding: "9px 13px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  opacity: 0.55,
                }}
              >
                <span style={{ fontSize: 11, color: T.textMuted }}>
                  {fmt(durSec, true)} unlogged
                </span>
                <span style={{ fontSize: 10, color: T.textDim, fontFamily: "'DM Mono', monospace" }}>
                  {secToTimeStr(gap.startSec)} – {secToTimeStr(gap.endSec)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: T.bg,
        fontFamily: "'DM Mono', 'Courier New', monospace",
        color: T.text,
      }}
    >
      {/* ── Page wrapper ──────────────────────────────────────────────────── */}
      <div
        style={{
          maxWidth: isDesktop ? 1100 : 480,
          margin: "0 auto",
          padding: isDesktop ? "28px 40px 60px" : "18px 20px 48px",
        }}
      >
        {/* ── Top bar: back + date navigation ──────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: isDesktop ? 40 : 20,
            gap: 16,
          }}
        >
          {/* Back link */}
          <button
            onClick={() => router.push("/")}
            style={{
              background: "none",
              border: "none",
              color: T.textMuted,
              cursor: "pointer",
              fontSize: 12,
              padding: "4px 0",
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontFamily: "inherit",
              flexShrink: 0,
            }}
          >
            ← Calendar
          </button>

          {/* Date navigation */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flex: isDesktop ? "unset" : 1,
              justifyContent: "center",
            }}
          >
            <button
              onClick={() => navigateDay(prevDay)}
              style={navBtnStyle}
              aria-label="Previous day"
            >
              ‹
            </button>

            <div style={{ textAlign: "center", minWidth: isDesktop ? 220 : 0 }}>
              <div
                style={{
                  fontFamily: "'Syne', sans-serif",
                  fontWeight: 700,
                  fontSize: isDesktop ? 20 : 16,
                  color: T.text,
                  letterSpacing: 0.2,
                }}
              >
                {weekday} · {dateLabel}
              </div>
              {isToday && (
                <div
                  style={{
                    display: "inline-block",
                    marginTop: 4,
                    fontSize: 10,
                    color: T.accent,
                    background: "rgba(139,127,255,0.12)",
                    border: `1px solid rgba(139,127,255,0.3)`,
                    borderRadius: 20,
                    padding: "2px 10px",
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                  }}
                >
                  Today
                </div>
              )}
            </div>

            <button
              onClick={() => navigateDay(nextDay)}
              disabled={isNextFuture}
              style={{ ...navBtnStyle, opacity: isNextFuture ? 0.25 : 1 }}
              aria-label="Next day"
            >
              ›
            </button>
          </div>

          {/* Spacer on desktop so date stays centered */}
          {isDesktop && <div style={{ width: 80, flexShrink: 0 }} />}
        </div>

        {/* ── Body: desktop = two columns, mobile = stacked ─────────────────── */}
        {isDesktop ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `${clockSize + 40}px 1fr`,
              gap: 48,
              alignItems: "start",
            }}
          >
            {/* Left column: clock + summary */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {/* Stats strip above clock */}
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: 24,
                  width: "100%",
                  justifyContent: "center",
                }}
              >
                <StatPill label="Logged" value={fmt(totalSeconds, true)} color={T.green} />
                <StatPill
                  label="Remaining"
                  value={totalSeconds >= TARGET_SECONDS ? "Done" : fmt(TARGET_SECONDS - totalSeconds, true)}
                  color={totalSeconds >= TARGET_SECONDS ? T.green : T.accent}
                />
              </div>

              {loading ? (
                <div
                  style={{
                    width: clockSize,
                    height: clockSize,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: T.textDim,
                    fontSize: 12,
                  }}
                >
                  Loading…
                </div>
              ) : (
                <ClockSVG entries={entries} totalSeconds={totalSeconds} size={clockSize} selectedIndex={selectedIndex} onSelectEntry={setSelectedIndex} />
              )}
            </div>

            {/* Right column: worklog list */}
            <div
              style={{
                background: T.surface,
                border: `1px solid ${T.border}`,
                borderRadius: 12,
                padding: "20px 20px",
                maxHeight: "calc(100vh - 180px)",
                overflowY: "auto",
              }}
            >
              {worklogListContent}
            </div>
          </div>
        ) : (
          /* Mobile: stacked layout */
          <>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
              {loading ? (
                <div
                  style={{
                    width: clockSize,
                    height: clockSize,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: T.textDim,
                    fontSize: 12,
                  }}
                >
                  Loading…
                </div>
              ) : (
                <ClockSVG entries={entries} totalSeconds={totalSeconds} size={clockSize} selectedIndex={selectedIndex} onSelectEntry={setSelectedIndex} />
              )}
            </div>

            <div>{worklogListContent}</div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Stat pill (desktop only) ─────────────────────────────────────────────────
function StatPill({ label, value, color }) {
  return (
    <div
      style={{
        background: T.surface2,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: "8px 16px",
        textAlign: "center",
        flex: 1,
      }}
    >
      <div style={{ fontSize: 10, color: T.textMuted, letterSpacing: "0.08em", marginBottom: 3, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "'Syne', sans-serif" }}>
        {value}
      </div>
    </div>
  );
}

// ─── Shared nav button style ──────────────────────────────────────────────────
const navBtnStyle = {
  background: "none",
  border: `1px solid #2e2e46`,
  borderRadius: 6,
  color: "#a8a8c8",
  cursor: "pointer",
  fontSize: 20,
  width: 34,
  height: 34,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  lineHeight: 1,
  fontFamily: "inherit",
};
