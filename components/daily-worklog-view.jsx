"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
  const s = polarXY(cx, cy, r, startDeg);
  const e = polarXY(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
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
// Returns array of { startSec, endSec } gaps in the work window
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

  // Merge overlapping intervals
  const merged = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i].start <= last.end) {
      last.end = Math.max(last.end, intervals[i].end);
    } else {
      merged.push({ ...intervals[i] });
    }
  }

  // Find gaps within work window
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

// ─── Clock SVG ────────────────────────────────────────────────────────────────
const CX = 150, CY = 150;
const RING_R = 108;   // center of stroke
const RING_W = 30;    // stroke width
const LABEL_R = 136;  // label distance from center
const TICK_IN = RING_R - RING_W / 2 - 1;
const TICK_OUT = RING_R + RING_W / 2 + 4;
const HOUR_DOT_R = RING_R + RING_W / 2 + 2;

function ClockSVG({ entries, totalSeconds }) {
  // Assign a color to each unique issue key
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

  const arcs = useMemo(() => {
    return entries
      .map((e) => {
        const startAngle = startedToAngle(e.startedAt);
        if (startAngle === null) return null;
        const spanAngle = secondsToAngle(e.timeSpentSeconds);
        const endAngle = Math.min(startAngle + spanAngle, 360);
        if (endAngle <= startAngle) return null;
        return { startAngle, endAngle, color: colorMap[e.issueKey], key: e.issueKey };
      })
      .filter(Boolean);
  }, [entries, colorMap]);

  const progressPct = Math.min(totalSeconds / TARGET_SECONDS, 1);
  const BAR_W = 72;
  const BAR_H = 3;
  const BAR_X = CX - BAR_W / 2;
  const BAR_Y = CY + 18;

  // Minor hour dots around ring (every hour = 30°, skip the 4 major ticks)
  const majorAngles = new Set(TICK_LABELS.map((t) => t.angleDeg));
  const minorDots = Array.from({ length: 12 }, (_, i) => i * 30).filter(
    (a) => !majorAngles.has(a)
  );

  return (
    <svg viewBox="0 0 300 300" width="290" height="290" style={{ overflow: "visible" }}>
      {/* Track ring (background) */}
      <circle
        cx={CX}
        cy={CY}
        r={RING_R}
        fill="none"
        stroke={T.surface2}
        strokeWidth={RING_W}
      />

      {/* Worklog arcs */}
      {arcs.map(({ startAngle, endAngle, color }, i) => (
        <path
          key={i}
          d={arcPath(CX, CY, RING_R, startAngle, endAngle)}
          fill="none"
          stroke={color}
          strokeWidth={RING_W}
          strokeLinecap="butt"
          opacity={0.88}
        />
      ))}

      {/* Minor hour dots */}
      {minorDots.map((angle) => {
        const p = polarXY(CX, CY, HOUR_DOT_R, angle);
        return (
          <circle key={angle} cx={p.x} cy={p.y} r={1.5} fill={T.textDim} opacity={0.6} />
        );
      })}

      {/* Major hour ticks + labels */}
      {TICK_LABELS.map(({ label, angleDeg }) => {
        const inner = polarXY(CX, CY, TICK_IN, angleDeg);
        const outer = polarXY(CX, CY, TICK_OUT, angleDeg);
        const lp = polarXY(CX, CY, LABEL_R, angleDeg);
        return (
          <g key={label}>
            <line
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke={T.textDim}
              strokeWidth={1.5}
            />
            <text
              x={lp.x}
              y={lp.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={T.textMuted}
              fontSize={8.5}
              fontFamily="'DM Mono', monospace"
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* Center: total logged */}
      <text
        x={CX}
        y={CY - 22}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={T.text}
        fontSize={28}
        fontWeight={700}
        fontFamily="'Syne', sans-serif"
        letterSpacing={-0.5}
      >
        {fmt(totalSeconds, true)}
      </text>

      {/* Center: subtitle */}
      <text
        x={CX}
        y={CY + 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={T.textMuted}
        fontSize={9.5}
        fontFamily="'DM Mono', monospace"
        letterSpacing={0.3}
      >
        logged today
      </text>

      {/* Progress bar */}
      <rect
        x={BAR_X}
        y={BAR_Y}
        width={BAR_W}
        height={BAR_H}
        rx={BAR_H / 2}
        fill={T.surface2}
      />
      <rect
        x={BAR_X}
        y={BAR_Y}
        width={BAR_W * progressPct}
        height={BAR_H}
        rx={BAR_H / 2}
        fill={T.green}
      />

      {/* Progress label */}
      <text
        x={CX}
        y={BAR_Y + 13}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={T.textDim}
        fontSize={8.5}
        fontFamily="'DM Mono', monospace"
      >
        {Math.round(progressPct * 100)}% · target {fmt(TARGET_SECONDS, true)}
      </text>
    </svg>
  );
}

// ─── Worklog list item ────────────────────────────────────────────────────────
function WorklogItem({ entry, color }) {
  return (
    <div
      style={{
        background: T.surface2,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: "11px 13px",
        borderLeft: `3px solid ${color}`,
      }}
    >
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
        <span
          style={{
            fontSize: 12,
            color: T.text,
            fontWeight: 600,
            fontFamily: "'DM Mono', monospace",
          }}
        >
          {fmt(entry.timeSpentSeconds, true)}
        </span>
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

  // Resolve the day from ?day=YYYY-MM-DD (fall back to today)
  const rawDay = searchParams.get("day");
  const today = toDS(new Date());
  const day = isValidDayStr(rawDay) ? rawDay : today;

  const [creds, setCreds] = useState(null);
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [monthData, setMonthData] = useState({}); // { "YYYY-MM-DD": Entry[] }
  const [fetchedMonths, setFetchedMonths] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Read credentials from localStorage once on mount
  useEffect(() => {
    const raw = typeof window !== "undefined" ? localStorage.getItem("jira-worklog-creds") : null;
    setCreds(parseStoredCreds(raw));
    setCredsLoaded(true);
  }, []);

  // Redirect to home if no credentials once we've loaded
  useEffect(() => {
    if (credsLoaded && !creds) {
      router.replace("/");
    }
  }, [credsLoaded, creds, router]);

  // Fetch worklogs whenever day or creds change
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

  // Derive display values
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

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!credsLoaded) return null;
  if (credsLoaded && !creds) return null; // redirecting

  const prevDay = addDays(day, -1);
  const nextDay = addDays(day, 1);
  const isNextFuture = nextDay > today;

  const weekday = dayDate.toLocaleDateString("en-US", { weekday: "long" });
  const dateLabel = dayDate.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: T.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "'DM Mono', 'Courier New', monospace",
        color: T.text,
        paddingBottom: 48,
      }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          padding: "18px 20px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        {/* Back link */}
        <div style={{ width: "100%", display: "flex", justifyContent: "flex-start" }}>
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
            }}
          >
            ← Calendar
          </button>
        </div>

        {/* Date navigation */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
            justifyContent: "space-between",
          }}
        >
          <button
            onClick={() => navigateDay(prevDay)}
            style={navBtnStyle}
            aria-label="Previous day"
          >
            ‹
          </button>

          <div style={{ textAlign: "center", flex: 1 }}>
            <div
              style={{
                fontFamily: "'Syne', sans-serif",
                fontWeight: 700,
                fontSize: 16,
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
      </div>

      {/* ── Clock ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 20,
          display: "flex",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {loading ? (
          <div
            style={{
              width: 290,
              height: 290,
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
          <ClockSVG entries={entries} totalSeconds={totalSeconds} />
        )}
      </div>

      {/* ── Worklog list ───────────────────────────────────────────────────── */}
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          padding: "0 20px",
          marginTop: 4,
        }}
      >
        {/* Section heading */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: T.textMuted,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          Worklogs
          <span style={{ color: T.textDim, fontWeight: 400 }}>—</span>
          <span style={{ color: T.textSub, fontWeight: 400 }}>
            {dateLabel}
          </span>
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
          <div
            style={{
              textAlign: "center",
              color: T.textDim,
              fontSize: 12,
              padding: "32px 0",
            }}
          >
            No worklogs for this day.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {entries.map((entry, i) => (
              <WorklogItem key={`${entry.issueKey}-${i}`} entry={entry} color={colorMap[entry.issueKey]} />
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
                  <span
                    style={{
                      fontSize: 10,
                      color: T.textDim,
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    {secToTimeStr(gap.startSec)} – {secToTimeStr(gap.endSec)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
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
