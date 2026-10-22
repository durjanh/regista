import { useEffect, useRef, useState } from "react";
import { truthService } from "../api";
import type { Counterfactual, Plant, Range3, TruthReport } from "../api/types";
import { clock, cx, pct } from "../lib/format";
import { usePrefs } from "../lib/prefs";
import { mechanismIcon, mechanismLabel, plantStatus, type PlantStatus } from "../lib/truth";
import { Skeleton } from "./States";
import { IconCounterfactual } from "./icons";
import { quietly } from "../lib/activity";

type Props = {
  matchId: string;
  report: TruthReport | null;
  t: number;
  ended: boolean;
  teams: Record<string, { short: string; color: string }>;
  error?: string | null;
};

const STATUS_LABEL: Record<PlantStatus, string> = {
  pending: "Not yet reached",
  waiting: "Watching…",
  detected: "Detected",
  missed: "Missed",
};

/** Score strip + one row per hidden planted change, revealed only in truth mode. */
export function TruthPanel({ matchId, report, t, ended, teams, error }: Props) {
  const { t: tr } = usePrefs();
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const prev = useRef<Map<string, PlantStatus>>(new Map());
  const [cf, setCf] = useState<Record<string, { loading: boolean; data?: Counterfactual; error?: string }>>({});

  const rows = (report?.plants ?? []).map((p) => {
    const grade = report?.grades.find((g) => g.plant_id === p.id);
    return { plant: p, grade, status: plantStatus(p, grade, t, ended) };
  });

  // Pulse a plant row the moment it flips to detected.
  useEffect(() => {
    const newly: string[] = [];
    for (const r of rows) {
      const before = prev.current.get(r.plant.id);
      if (r.status === "detected" && before && before !== "detected") newly.push(r.plant.id);
      prev.current.set(r.plant.id, r.status);
    }
    if (!newly.length) return;
    setFresh((s) => new Set([...s, ...newly]));
    const tid = window.setTimeout(() => setFresh((s) => new Set([...s].filter((id) => !newly.includes(id)))), 2600);
    return () => window.clearTimeout(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, t, ended]);

  const runCf = async (p: Plant) => {
    setCf((c) => ({ ...c, [p.id]: { loading: true } }));
    try {
      const data = await quietly(() => truthService.counterfactual(matchId, p.id));   // the button shows progress
      setCf((c) => ({ ...c, [p.id]: { loading: false, data } }));
    } catch (e) {
      setCf((c) => ({ ...c, [p.id]: { loading: false, error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  if (!report)
    return error ? <div className="xs" style={{ color: "var(--danger)" }}>{error}</div> : <Skeleton h={120} />;

  const s = report.score;
  return (
    <div className="truth">
      <div className="truth-score" aria-label="Truth score">
        <div className="kpi">
          <div className="label">{tr("truth.recall")}</div>
          <div className="value tnum">{s.recall === null ? "–" : pct(s.recall)}</div>
        </div>
        <div className="kpi">
          <div className="label">{tr("truth.falseAlarms")}</div>
          <div className="value tnum">{s.false_alarms}</div>
        </div>
        <div className="kpi">
          <div className="label">{tr("truth.median")}</div>
          <div className="value tnum">{s.median_seconds_to_detect === null ? "–" : `${Math.round(s.median_seconds_to_detect)}s`}</div>
        </div>
        <div className="kpi">
          <div className="label">{tr("truth.explanation")}</div>
          <div className="value tnum">{s.explanation_accuracy === null ? "–" : pct(s.explanation_accuracy)}</div>
        </div>
      </div>

      {rows.length ? (
        <ul className="plant-list">
          {rows.map(({ plant, grade, status }) => {
            const team = teams[plant.team_id];
            const c = cf[plant.id];
            return (
              <li key={plant.id} className={cx("plant", status, fresh.has(plant.id) && "just-detected")}>
                <div className="plant-row">
                  <span className="plant-icon" aria-hidden="true">{mechanismIcon(plant.mechanism)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="plant-title">
                      <span className="swatch" style={{ background: team?.color }} /> {team?.short ?? plant.team_id} · {mechanismLabel(plant.mechanism)}
                      <span className="faint"> · {clock(plant.minute)} · {plant.difficulty}</span>
                    </div>
                    <div className="xs muted">{plant.description}</div>
                  </div>
                  <span className={cx("plant-status", status)} aria-live="polite">
                    {status === "detected" ? "✔" : status === "missed" ? "✖" : status === "waiting" ? "…" : "◌"} {STATUS_LABEL[status]}
                    {status === "detected" && grade?.seconds_to_detect !== undefined ? (
                      <b className="tnum"> in {Math.round(grade.seconds_to_detect)}s</b>
                    ) : null}
                  </span>
                </div>
                {status === "detected" && grade?.explanation_correct !== undefined ? (
                  <div className="xs" style={{ marginTop: 4 }}>
                    {grade.explanation_correct ? (
                      <span className="status-pass">✔ explanation correct (team, mechanism and direction)</span>
                    ) : (
                      <span className="status-warn">⚠ detected, but the explanation got a detail wrong</span>
                    )}
                  </div>
                ) : null}
                {status === "detected" || status === "missed" || ended ? (
                  <div style={{ marginTop: 8 }}>
                    {c?.data ? (
                      <CounterfactualCard cf={c.data} color={team?.color} />
                    ) : (
                      <button className="btn sm" onClick={() => runCf(plant)} disabled={c?.loading} aria-busy={!!c?.loading}>
                        <IconCounterfactual /> {c?.loading ? "Replaying the match without it…" : tr("truth.whatChanged")}
                      </button>
                    )}
                    {c?.loading ? <div style={{ marginTop: 8 }}><Skeleton h={70} /></div> : null}
                    {c?.error ? <div className="xs" style={{ color: "var(--danger)", marginTop: 6 }}>{c.error}</div> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="xs muted">Nothing was planted in this match: any insight here counts as a false alarm.</div>
      )}

      {report.false_alarms.length ? (
        <div className="stack" style={{ gap: 6 }}>
          <div className="xs muted" style={{ fontWeight: 700 }}>{tr("truth.falseAlarms")}</div>
          {report.false_alarms.map((fa) => (
            <div key={fa.id} className="false-alarm-row xs">
              <span className="pill danger">✖</span> {clock(fa.detected_minute)} · {teams[fa.team_id]?.short ?? fa.team_id} · {mechanismLabel(fa.mechanism)}:{" "}
              <span className="muted">{fa.title}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RangeBar({ r, lo, hi, color, label }: { r: Range3; lo: number; hi: number; color: string; label: string }) {
  const pos = (v: number) => `${((v - lo) / Math.max(1e-9, hi - lo)) * 100}%`;
  return (
    <div className="cf-row">
      <span className="cf-label">{label}</span>
      <div className="cf-track" role="img" aria-label={`${label}: median ${r.median.toFixed(2)}, range ${r.p10.toFixed(2)} to ${r.p90.toFixed(2)}`}>
        <span className="cf-range" style={{ left: pos(r.p10), width: `calc(${pos(r.p90)} - ${pos(r.p10)})`, background: color }} />
        <span className="cf-median" style={{ left: pos(r.median) }} />
      </div>
      <span className="cf-val tnum">{r.median.toFixed(2)}</span>
    </div>
  );
}

/** With vs without the planted change across many seeded re-runs: a measured cause, not a guess. */
export function CounterfactualCard({ cf, color = "var(--accent)" }: { cf: Counterfactual; color?: string }) {
  const lo = Math.min(cf.with_change.p10, cf.without_change.p10, 0);
  const hi = Math.max(cf.with_change.p90, cf.without_change.p90) || 1;
  const e = cf.effect;
  const unit = cf.metric.unit ? ` ${cf.metric.unit}` : "";
  return (
    <div className="cf-card">
      <div className="row xs" style={{ justifyContent: "space-between" }}>
        <b>{cf.metric.label}</b>
        <span className="faint">{cf.runs} paired re-runs · p10–p90</span>
      </div>
      <RangeBar r={cf.with_change} lo={lo} hi={hi} color={color} label="With change" />
      <RangeBar r={cf.without_change} lo={lo} hi={hi} color="var(--text-faint)" label="Without" />
      <div className="small">
        Effect: <b className="tnum">{e.median >= 0 ? "+" : ""}{e.median.toFixed(2)}{unit}</b>{" "}
        <span className="faint tnum">(range {e.p10.toFixed(2)} to {e.p90.toFixed(2)})</span>
      </div>
      <div className="xs muted">{cf.explanation}</div>
    </div>
  );
}
