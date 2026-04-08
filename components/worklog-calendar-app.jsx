"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_DOMAIN = process.env.NEXT_PUBLIC_JIRA_DOMAIN_DEFAULT || "";
const STORAGE_KEY = "jira-worklog-creds";
const LAST_SESSION_KEY = "jira-worklog-last-session";
const STORAGE_EVENT = "jira-worklog-creds-change";

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

const HEAT_STYLE = {
  0: { bg: "transparent", bar: "transparent", num: T.textDim, txt: T.textDim },
  1: { bg: "rgba(139,127,255,0.10)", bar: "#6d60e8", num: T.accent, txt: T.textSub },
  2: { bg: "rgba(139,127,255,0.18)", bar: "#8b7fff", num: "#c4baff", txt: T.text },
  3: { bg: "rgba(139,127,255,0.27)", bar: "#a99bff", num: "#d4ccff", txt: T.text },
  4: { bg: "rgba(74,222,128,0.14)", bar: "#22c55e", num: T.green, txt: T.text },
  5: { bg: "rgba(74,222,128,0.22)", bar: "#4ade80", num: "#86efac", txt: T.text },
};

function fmt(seconds, full = false) {
  if (!seconds) return full ? "0h" : null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function toDS(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function firstDayOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function lastDay(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function heat(seconds) {
  const hours = seconds / 3600;
  return hours === 0 ? 0 : hours < 2 ? 1 : hours < 4 ? 2 : hours < 6 ? 3 : hours < 8 ? 4 : 5;
}

function normalizeDomain(domain) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\.atlassian\.net\/?$/i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function parseMonthParam(raw, fallbackDate) {
  if (!raw || !/^\d{4}-\d{2}$/.test(raw)) {
    return firstDayOfMonth(fallbackDate);
  }

  const [year, month] = raw.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return firstDayOfMonth(fallbackDate);
  }

  return new Date(year, month - 1, 1);
}

function parseDayParam(raw) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }

  const [year, month, day] = raw.split("-").map(Number);
  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return raw;
}

function sameMonth(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function readCalendarStateFromSearch(search, fallbackDate) {
  const params = new URLSearchParams(search || "");
  const day = parseDayParam(params.get("day"));
  const month = day ? parseMonthParam(day.slice(0, 7), fallbackDate) : parseMonthParam(params.get("month"), fallbackDate);

  return { month, day };
}

function readStoredCredsSnapshot() {
  if (typeof window === "undefined") return null;

  return window.localStorage.getItem(STORAGE_KEY);
}

function readLastSessionSnapshot() {
  if (typeof window === "undefined") return null;

  return window.localStorage.getItem(LAST_SESSION_KEY);
}

function parseStoredCreds(raw) {
  try {
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.domain || !parsed?.email || !parsed?.token || !parsed?.accountId || !parsed?.displayName) {
      return null;
    }

    return {
      domain: normalizeDomain(parsed.domain),
      email: String(parsed.email),
      token: String(parsed.token),
      accountId: String(parsed.accountId),
      displayName: String(parsed.displayName),
    };
  } catch {
    return null;
  }
}

function subscribeToStoredCreds(callback) {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("storage", callback);
  window.addEventListener(STORAGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(STORAGE_EVENT, callback);
  };
}

function notifyStoredCredsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

function writeStoredCreds(creds) {
  if (typeof window === "undefined") return;

  if (!creds) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
    window.localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(creds));
  }

  notifyStoredCredsChanged();
}

async function callLocalApi(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `${response.status} ${response.statusText}`);
  }

  return body;
}

function makeClient(domain, email, token) {
  const creds = { domain, email, token };

  return {
    async getMyself() {
      return callLocalApi("/api/jira/myself", creds);
    },
    async fetchMonthWorklogs(accountId, year, month) {
      return callLocalApi("/api/jira/worklogs", { ...creds, accountId, year, month });
    },
  };
}

function SettingsPanel({ onSave, lastSession }) {
  const [domain, setDomain] = useState(DEFAULT_DOMAIN);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const [testing, setTesting] = useState(false);
  const [tokenGuideOpen, setTokenGuideOpen] = useState(false);

  async function handleConnect() {
    const normalizedDomain = normalizeDomain(domain);

    if (!normalizedDomain || !email || !token) {
      setErr("All fields are required.");
      return;
    }

    setTesting(true);
    setErr("");

    try {
      const client = makeClient(normalizedDomain, email, token);
      const me = await client.getMyself();
      onSave({
        domain: normalizedDomain,
        email,
        token,
        accountId: me.accountId,
        displayName: me.displayName,
      });
    } catch (error) {
      setErr(`Connection failed: ${error.message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 32,
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 22,
              fontWeight: 800,
              color: T.text,
              letterSpacing: "-0.02em",
            }}
          >
            worklog <span style={{ color: T.accent }}>calendar</span>
          </div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>
            Connect your Jira account to get started
          </div>
        </div>

        {[
          { label: "JIRA DOMAIN", placeholder: "e.g. your-company", val: domain, set: setDomain, suffix: ".atlassian.net" },
          { label: "EMAIL", placeholder: "you@company.com", val: email, set: setEmail },
          { label: "API TOKEN", placeholder: "paste your Jira API token", val: token, set: setToken, type: "password" },
        ].map(({ label, placeholder, val, set, suffix, type }) => (
          <div key={label} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: T.textMuted, letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: T.surface2,
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              <input
                type={type || "text"}
                placeholder={placeholder}
                value={val}
                onChange={(event) => set(event.target.value)}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: T.text,
                  fontSize: 12,
                  padding: "10px 12px",
                }}
              />
              {suffix ? <span style={{ fontSize: 11, color: T.textMuted, paddingRight: 12 }}>{suffix}</span> : null}
            </div>
          </div>
        ))}

        {err ? (
          <div
            style={{
              padding: "9px 12px",
              background: "rgba(248,113,113,.10)",
              border: "1px solid rgba(248,113,113,.3)",
              borderRadius: 6,
              color: T.red,
              fontSize: 11,
              marginBottom: 14,
              lineHeight: 1.5,
            }}
          >
            {err}
          </div>
        ) : null}

        {lastSession ? (
          <button
            type="button"
            onClick={() => onSave(lastSession)}
            disabled={testing}
            style={{
              width: "100%",
              marginBottom: 20,
              padding: "12px 14px",
              background: "rgba(139,127,255,.08)",
              border: "1px solid rgba(139,127,255,.2)",
              borderRadius: 8,
              color: T.text,
              display: "flex",
              alignItems: "center",
              gap: 12,
              textAlign: "left",
              cursor: testing ? "not-allowed" : "pointer",
              opacity: testing ? 0.7 : 1,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "rgba(139,127,255,.18)",
                border: "1px solid rgba(139,127,255,.35)",
                color: T.accentBr,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {(lastSession.displayName || lastSession.email).slice(0, 1).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: T.textMuted, letterSpacing: "0.1em", marginBottom: 4 }}>
                LAST CONNECTION
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: T.text,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {lastSession.displayName}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: T.textMuted,
                  marginTop: 3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {lastSession.email} · {lastSession.domain}.atlassian.net
              </div>
            </div>
            <div style={{ fontSize: 11, color: T.accent, fontWeight: 600, flexShrink: 0 }}>Connect →</div>
          </button>
        ) : (
          <div
            style={{
              marginBottom: 20,
              background: "rgba(139,127,255,.08)",
              border: "1px solid rgba(139,127,255,.2)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setTokenGuideOpen((open) => !open)}
              style={{
                width: "100%",
                padding: "12px 14px",
                background: "transparent",
                border: "none",
                color: T.text,
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                cursor: "pointer",
              }}
              aria-expanded={tokenGuideOpen}
              aria-controls="jira-token-guide"
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "rgba(139,127,255,.18)",
                  border: "1px solid rgba(139,127,255,.35)",
                  color: T.accentBr,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                ?
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: T.textMuted, letterSpacing: "0.1em", marginBottom: 4 }}>
                  API TOKEN HELP
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: T.text,
                    fontWeight: 600,
                  }}
                >
                  Need help generating a Jira API token?
                </div>
                <div style={{ fontSize: 10, color: T.textMuted, marginTop: 3 }}>
                  Expand for the quick steps.
                </div>
              </div>
              <div style={{ fontSize: 14, color: T.accent, fontWeight: 600, flexShrink: 0 }}>
                {tokenGuideOpen ? "−" : "+"}
              </div>
            </button>

            {tokenGuideOpen ? (
              <div
                id="jira-token-guide"
                style={{
                  borderTop: "1px solid rgba(139,127,255,.14)",
                  padding: "0 14px 14px",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: T.textSub,
                    lineHeight: 1.6,
                    paddingLeft: 44,
                  }}
                >
                  <div>
                    Go to `https://id.atlassian.com/manage-profile/security/api-tokens`, create a token, then paste it above.
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={testing}
          style={{
            width: "100%",
            padding: 11,
            background: T.accent,
            border: "none",
            borderRadius: 6,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: testing ? "not-allowed" : "pointer",
            opacity: testing ? 0.7 : 1,
            letterSpacing: "0.03em",
          }}
        >
          {testing ? "Connecting…" : "Connect & Load Calendar →"}
        </button>
      </div>
    </div>
  );
}

function Calendar({ creds, onLogout }) {
  const now = useMemo(() => new Date(), []);
  const pathname = usePathname();
  const router = useRouter();
  const clientRef = useRef(makeClient(creds.domain, creds.email, creds.token));
  const currentMonth = useMemo(() => firstDayOfMonth(now), [now]);
  const initialCalendarState = useMemo(() => {
    if (typeof window === "undefined") {
      return { month: currentMonth, day: null };
    }

    return readCalendarStateFromSearch(window.location.search, now);
  }, [currentMonth, now]);

  const [cur, setCur] = useState(() => initialCalendarState.month);
  const [sel, setSel] = useState(() => initialCalendarState.day);
  const [data, setData] = useState({});
  const [fetched, setFetched] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const year = cur.getFullYear();
  const month = cur.getMonth();
  const activeMonthKey = monthKey(year, month);
  const todayStr = toDS(now.getFullYear(), now.getMonth(), now.getDate());

  useEffect(() => {
    clientRef.current = makeClient(creds.domain, creds.email, creds.token);
  }, [creds.domain, creds.email, creds.token]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function syncFromLocation() {
      const nextState = readCalendarStateFromSearch(window.location.search, now);

      setCur((prev) => (sameMonth(prev, nextState.month) ? prev : nextState.month));
      setSel((prev) => (prev === nextState.day ? prev : nextState.day));
    }

    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [now]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const nextMonth = monthKey(cur.getFullYear(), cur.getMonth());

    params.set("month", nextMonth);

    if (sel) {
      params.set("day", sel);
    } else {
      params.delete("day");
    }

    const nextQuery = params.toString();
    const currentQuery = window.location.search.replace(/^\?/, "");
    if (nextQuery === currentQuery) return;

    window.history.replaceState(null, "", nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [cur, pathname, sel]);

  const fetchMonth = useCallback(
    async (targetYear, targetMonth, force = false) => {
      const key = monthKey(targetYear, targetMonth);
      if (!force && fetched.has(key)) return;

      setLoading(true);
      setError(null);

      try {
        const byDate = await clientRef.current.fetchMonthWorklogs(creds.accountId, targetYear, targetMonth);
        setData((prev) => {
          const next = { ...prev };
          const prefix = `${key}-`;

          for (const prevKey of Object.keys(next)) {
            if (prevKey.startsWith(prefix)) {
              delete next[prevKey];
            }
          }

          return { ...next, ...byDate };
        });

        setFetched((prev) => {
          const next = new Set(prev);
          next.add(key);
          return next;
        });
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setLoading(false);
      }
    },
    [creds.accountId, fetched],
  );

  useEffect(() => {
    fetchMonth(year, month);
  }, [fetchMonth, year, month]);

  const daysInMonth = lastDay(year, month);
  const firstDow = new Date(year, month, 1).getDay();
  const cells = [];
  for (let index = 0; index < firstDow; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthDays = Object.entries(data).filter(([key]) => key.startsWith(activeMonthKey));
  const monthTotal = monthDays.reduce((sum, [, entries]) => {
    return sum + entries.reduce((entrySum, entry) => entrySum + entry.timeSpentSeconds, 0);
  }, 0);
  const daysLogged = monthDays.length;
  const ticketCount = monthDays.reduce((sum, [, entries]) => sum + entries.length, 0);
  const selectedEntries = sel ? data[sel] || [] : [];
  const selectedTotal = selectedEntries.reduce((sum, entry) => sum + entry.timeSpentSeconds, 0);
  const hasFetched = fetched.has(activeMonthKey);
  const allMonths = [...new Set(Object.keys(data).map((date) => date.slice(0, 7)))].sort();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        color: T.text,
        padding: "20px 16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <style jsx>{`
        .dc {
          transition: all 0.1s;
          cursor: pointer;
        }

        .dc:hover {
          border-color: ${T.accent} !important;
          transform: scale(1.04);
          z-index: 2;
          position: relative;
        }

        .dc.sel {
          border-color: ${T.accentBr} !important;
          box-shadow: 0 0 0 1px ${T.accentBr}, 0 0 18px rgba(139, 127, 255, 0.22);
        }

        .nb {
          background: ${T.surface};
          border: 1px solid ${T.border};
          color: ${T.textSub};
          padding: 7px 13px;
          cursor: pointer;
          font-size: 11px;
          border-radius: 5px;
          transition: all 0.1s;
        }

        .nb:hover {
          background: ${T.surface2};
          border-color: ${T.border2};
          color: ${T.text};
        }

        .nb:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .ir {
          padding: 11px 12px;
          border: 1px solid ${T.border};
          border-radius: 7px;
          background: ${T.surface};
          margin-bottom: 8px;
          transition: border-color 0.1s;
        }

        .ir:hover {
          border-color: ${T.border2};
        }

        .pill {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.06em;
          background: rgba(139, 127, 255, 0.18);
          color: ${T.accentBr};
          border: 1px solid rgba(139, 127, 255, 0.35);
        }

        .mk-chip {
          font-size: 10px;
          padding: 3px 9px;
          border-radius: 20px;
          border: 1px solid ${T.border};
          cursor: pointer;
          transition: all 0.1s;
          background: transparent;
        }

        .mk-chip:hover {
          border-color: ${T.border2};
          background: ${T.surface2};
        }

        .mk-chip.active {
          background: rgba(139, 127, 255, 0.18);
          border-color: ${T.accent};
          color: ${T.accentBr};
        }

        @media (max-width: 920px) {
          .main-layout {
            flex-direction: column;
          }

          .detail-panel {
            width: 100% !important;
            min-height: 320px !important;
          }
        }
      `}</style>

      <div style={{ width: "100%", maxWidth: 920 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 5, gap: 12, flexWrap: "wrap" }}>
          <div>
            <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 21, fontWeight: 800, color: T.text, letterSpacing: "-0.02em" }}>
              worklog
            </span>
            <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 21, fontWeight: 700, color: T.accent, marginLeft: 8 }}>
              calendar
            </span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: T.textMuted }}>{creds.displayName}</span>
            <span style={{ fontSize: 11, color: T.textDim }}>·</span>
            <span style={{ fontSize: 11, color: T.textMuted }}>{creds.domain}.atlassian.net</span>
            <button className="nb" onClick={onLogout} style={{ fontSize: 10, color: T.textMuted, padding: "4px 10px" }}>
              logout
            </button>
          </div>
        </div>

        <div style={{ height: 1, background: `linear-gradient(90deg, ${T.accent} 0%, ${T.surface2} 70%)`, marginBottom: 18 }} />

        {allMonths.length > 0 ? (
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {allMonths.map((value) => {
              const [targetYear, targetMonth] = value.split("-").map(Number);
              const total = Object.entries(data)
                .filter(([key]) => key.startsWith(value))
                .reduce((sum, [, entries]) => sum + entries.reduce((entrySum, entry) => entrySum + entry.timeSpentSeconds, 0), 0);
              const isActive = value === activeMonthKey;

              return (
                <button
                  key={value}
                  className={`mk-chip${isActive ? " active" : ""}`}
                  style={{ color: isActive ? T.accentBr : T.textMuted }}
                  onClick={() => {
                    setSel(null);
                    setCur(new Date(targetYear, targetMonth - 1, 1));
                  }}
                >
                  {MONTHS3[targetMonth - 1]} &apos;{String(targetYear).slice(2)}{" "}
                  <span style={{ color: isActive ? T.accent : T.textDim, marginLeft: 4 }}>{fmt(total)}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="main-layout" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <button className="nb" onClick={() => {
                setSel(null);
                setCur(new Date(year, month - 1, 1));
              }}>
                ←
              </button>
              <div style={{ flex: 1, textAlign: "center", minWidth: 180 }}>
                <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 17, fontWeight: 700 }}>{MONTHS[month]}</span>
                <span style={{ fontSize: 13, color: T.textMuted, marginLeft: 8 }}>{year}</span>
              </div>
              <button className="nb" onClick={() => {
                setSel(null);
                setCur(new Date(year, month + 1, 1));
              }}>
                →
              </button>
              <button
                className="nb"
                onClick={() => {
                  setSel(null);
                  setCur(currentMonth);
                }}
                style={{ color: T.accent, fontSize: 10 }}
              >
                today
              </button>
              <button
                className="nb"
                onClick={() => fetchMonth(year, month, true)}
                disabled={loading}
                style={{ color: loading ? T.textDim : T.accent, minWidth: 80, textAlign: "center" }}
              >
                {loading ? "loading…" : "↻ refresh"}
              </button>
            </div>

            {error ? (
              <div
                style={{
                  padding: "10px 13px",
                  background: "rgba(248,113,113,.10)",
                  border: "1px solid rgba(248,113,113,.3)",
                  borderRadius: 6,
                  color: T.red,
                  fontSize: 11,
                  marginBottom: 12,
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 3 }}>
              {DAYS.map((day) => (
                <div
                  key={day}
                  style={{
                    textAlign: "center",
                    fontSize: 10,
                    color: T.textMuted,
                    letterSpacing: "0.1em",
                    padding: "4px 0",
                    fontWeight: 500,
                  }}
                >
                  {day}
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
              {cells.map((day, index) => {
                if (!day) return <div key={`empty-${index}`} style={{ aspectRatio: "1", background: T.bg }} />;

                const date = toDS(year, month, day);
                const entries = data[date] || [];
                const total = entries.reduce((sum, entry) => sum + entry.timeSpentSeconds, 0);
                const level = heat(total);
                const heatStyle = HEAT_STYLE[level];
                const isToday = date === todayStr;
                const isSelected = sel === date;
                const isWeekend = [0, 6].includes(new Date(year, month, day).getDay());
                const backgroundColor = isSelected
                  ? "rgba(139,127,255,.14)"
                  : level > 0
                    ? heatStyle.bg
                    : isWeekend
                      ? "#0f0f1a"
                      : T.surface;
                const borderColor = isToday ? T.accent : isSelected ? T.accentBr : level > 0 ? T.border2 : T.border;

                return (
                  <div
                    key={date}
                    className={`dc${isSelected ? " sel" : ""}`}
                    onClick={() => setSel(isSelected ? null : date)}
                    onDoubleClick={() => router.push(`/daily-worklog?day=${date}`)}
                    title="Double-click to open day view"
                    style={{
                      aspectRatio: "1",
                      background: backgroundColor,
                      border: `1px solid ${borderColor}`,
                      borderRadius: 5,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "5px 3px",
                      gap: 2,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: isToday ? 700 : 400,
                        color: isToday ? T.accent : isWeekend && level === 0 ? T.textDim : level > 0 ? T.text : T.textSub,
                        lineHeight: 1,
                      }}
                    >
                      {day}
                    </span>
                    {level > 0 ? (
                      <>
                        <span style={{ fontSize: 9, color: heatStyle.num, lineHeight: 1, fontWeight: 500 }}>{fmt(total)}</span>
                        <div style={{ width: "56%", height: 2, borderRadius: 1, background: heatStyle.bar }} />
                      </>
                    ) : null}
                    {hasFetched && level === 0 && !isWeekend ? (
                      <div style={{ width: 4, height: 4, borderRadius: "50%", background: T.border, opacity: 0.5 }} />
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div
              style={{
                marginTop: 14,
                padding: "13px 16px",
                background: T.surface,
                border: `1px solid ${T.border}`,
                borderRadius: 7,
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 16,
              }}
            >
              {[
                { label: "MONTH TOTAL", value: fmt(monthTotal, true), color: monthTotal > 0 ? T.accent : T.textDim },
                { label: "DAYS LOGGED", value: daysLogged || "—", color: daysLogged > 0 ? T.accentBr : T.textDim },
                {
                  label: "AVG / DAY",
                  value: daysLogged > 0 ? fmt(Math.round(monthTotal / daysLogged), true) : "—",
                  color: daysLogged > 0 ? T.text : T.textDim,
                },
                { label: "TICKETS", value: ticketCount || "—", color: ticketCount > 0 ? T.green : T.textDim },
              ].map(({ label, value, color }, index) => (
                <div
                  key={label}
                  style={{
                    flex: "1 1 140px",
                    paddingRight: 16,
                    borderRight: index < 3 ? `1px solid ${T.border}` : "none",
                    marginRight: index < 3 ? 16 : 0,
                  }}
                >
                  <div style={{ fontSize: 9, color: T.textMuted, letterSpacing: "0.12em", marginBottom: 3 }}>{label}</div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700, color }}>{value}</div>
                </div>
              ))}

              <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
                {[0, 1, 2, 3, 4, 5].map((value) => (
                  <div
                    key={value}
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      background: value === 0 ? T.surface2 : HEAT_STYLE[value].bar,
                      border: `1px solid ${value === 0 ? T.border : "transparent"}`,
                    }}
                  />
                ))}
                <span style={{ fontSize: 9, color: T.textMuted, marginLeft: 4 }}>less → more</span>
              </div>
            </div>
          </div>

          <div
            className="detail-panel"
            style={{
              width: 270,
              flexShrink: 0,
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 9,
              overflow: "hidden",
              minHeight: 430,
            }}
          >
            {sel ? (
              <>
                <div style={{ padding: "14px 15px", borderBottom: `1px solid ${T.border}`, background: T.surface2 }}>
                  <div style={{ fontSize: 10, color: T.textMuted, letterSpacing: "0.1em", marginBottom: 4, textTransform: "uppercase" }}>
                    {new Date(`${sel}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" })}
                  </div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 15, fontWeight: 700, color: T.text }}>
                    {new Date(`${sel}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </div>
                  {selectedTotal > 0 ? (
                    <div style={{ fontSize: 12, color: T.accent, marginTop: 5 }}>
                      {fmt(selectedTotal, true)} logged · {selectedEntries.length} ticket{selectedEntries.length !== 1 ? "s" : ""}
                    </div>
                  ) : null}
                </div>
                <div style={{ padding: "11px 11px", maxHeight: 520, overflowY: "auto" }}>
                  {selectedEntries.length === 0 ? (
                    <div style={{ textAlign: "center", color: T.textDim, fontSize: 12, padding: "32px 0" }}>no worklogs</div>
                  ) : (
                    selectedEntries.map((entry, index) => (
                      <div key={`${entry.issueKey}-${index}`} className="ir">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                          <span className="pill">{entry.issueKey}</span>
                          <span style={{ fontSize: 11, color: T.accent, fontWeight: 600 }}>{fmt(entry.timeSpentSeconds, true)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: T.textSub, marginTop: 6, lineHeight: 1.5 }}>{entry.issueSummary}</div>
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
                    ))
                  )}
                </div>
              </>
            ) : (
              <div
                style={{
                  minHeight: 430,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: T.textDim,
                  fontSize: 12,
                  gap: 10,
                  padding: 24,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 32, opacity: 0.35 }}>◫</div>
                <div style={{ lineHeight: 1.6 }}>
                  Select a day
                  <br />
                  to view worklogs
                </div>
                {!hasFetched && !loading ? (
                  <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>Fetching {MONTHS[month]} data…</div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorklogCalendarApp() {
  const storedCreds = useSyncExternalStore(subscribeToStoredCreds, readStoredCredsSnapshot, () => null);
  const storedLastSession = useSyncExternalStore(subscribeToStoredCreds, readLastSessionSnapshot, () => null);
  const creds = useMemo(() => parseStoredCreds(storedCreds), [storedCreds]);
  const lastSession = useMemo(() => parseStoredCreds(storedLastSession), [storedLastSession]);

  if (!creds) {
    return <SettingsPanel onSave={writeStoredCreds} lastSession={lastSession} />;
  }

  return <Calendar creds={creds} onLogout={() => writeStoredCreds(null)} />;
}
