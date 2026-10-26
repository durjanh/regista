import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { forgeService, referenceService, truthService } from "../api";
import type { Calibration, ForgeConfig, MatchSummary, ReferenceTeam, Scenario, Team, TruthScore } from "../api/types";
import { DistributionChart, RangeBar } from "../components/charts";
import { ReferenceStrip } from "../components/ReferenceStrip";
import { SourceBadge } from "../components/SourceBadge";
import { ErrorState, Skeleton, SkeletonCard } from "../components/States";
import { TeamSwatch } from "../components/TeamSwatch";
import { useAsync } from "../hooks/useAsync";
import { durationS, sourceUrl } from "../lib/format";
import { usePrefs } from "../lib/prefs";
import { mechanismLabel } from "../lib/truth";
import { IconDirect, IconForge, IconPlay, IconSimulate, IconStudio } from "../components/icons";
import { quietly } from "../lib/activity";

const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: "balanced", label: "Balanced" },
  { value: "late_drama", label: "Late drama" },
  { value: "comeback", label: "Comeback" },
  { value: "red_card", label: "Red card" },
  { value: "derby", label: "Derby intensity" },
  { value: "tactical_chess", label: "Tactical chess" },
  { value: "goal_fest", label: "Goal fest" },
  { value: "underdog", label: "Underdog" },
];
const FORMATIONS = ["", "4-3-3", "4-2-3-1", "4-4-2", "3-4-3", "3-5-2", "5-3-2", "4-1-4-1"];
const PROMPTS = [
  "Brazil v Japan as of 2002, tight game settled by a late red card",
  "A tense derby between Argentina and Uruguay with lots of fouls",
  "Underdog Morocco hold on against Spain with a deep block",
  "Germany v Netherlands goal fest with a second-half comeback",
];

export function Forge() {
  const { t } = usePrefs();
  const teams = useAsync<Team[]>(() => forgeService.teams(), []);
  const calib = useAsync<Calibration>(() => forgeService.calibration(), []);
  const [refTeams, setRefTeams] = useState<Map<string, ReferenceTeam>>(new Map());
  const [prompt, setPrompt] = useState(PROMPTS[0]);
  const [config, setConfig] = useState<ForgeConfig | null>(null);
  const [explanation, setExplanation] = useState<{ text: string; engine: string } | null>(null);
  const [directing, setDirecting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ match: MatchSummary; calibration: Calibration } | null>(null);

  useEffect(() => {
    referenceService
      .teams()
      .then((list) => setRefTeams(new Map(list.map((x) => [x.team_id, x]))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!config && teams.data && teams.data.length >= 2) {
      setConfig({ home_team_id: teams.data[0].team_id, away_team_id: teams.data[1].team_id, scenario: "balanced", intensity: 0.5 });
    }
  }, [teams.data, config]);

  const teamById = useMemo(() => new Map((teams.data ?? []).map((x) => [x.team_id, x])), [teams.data]);

  const direct = async () => {
    setDirecting(true);
    setErr(null);
    try {
      const res = await quietly(() => forgeService.scenario(prompt));   // the button shows progress
      setConfig(res.config);
      setExplanation({ text: res.explanation, engine: res.engine });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDirecting(false);
    }
  };

  const generate = async () => {
    if (!config) return;
    setGenerating(true);
    setErr(null);
    try {
      const clean: ForgeConfig = { ...config };
      if (!clean.home_formation) delete clean.home_formation;
      if (!clean.away_formation) delete clean.away_formation;
      if (!clean.as_of) delete clean.as_of;
      setResult(await quietly(() => forgeService.generate(clean)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const set = <K extends keyof ForgeConfig>(k: K, v: ForgeConfig[K]) => setConfig((c) => (c ? { ...c, [k]: v } : c));
  const teamLabel = (tm: Team) => {
    const r = refTeams.get(tm.team_id);
    return r ? `${tm.name} · Elo ${Math.round(r.elo)} (#${r.rank})` : tm.name;
  };

  return (
    <div className="stack">
      <div>
        <h1 className="page-title row gap-10"><IconForge width={30} height={30} /> {t("nav.forge")}</h1>
        <p className="muted max-70ch">
          Direct a <b>what-if</b> match between real national teams in plain English. The Scenario Director agent turns your brief into a
          simulator config, team strength comes from Elo built on 150 years of real results, and every generated match is checked against
          real-world distributions.
        </p>
      </div>

      <ReferenceStrip />

      <div className="forge-grid">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">{t("forge.prompt")}</h2>
            </div>
            <textarea className="textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label={t("forge.prompt")} />
            <div className="row mt-10 justify-between">
              <div className="chips">
                {PROMPTS.slice(1).map((p) => (
                  <button key={p} className="chip" onClick={() => setPrompt(p)} title={p}>
                    {p.length > 38 ? `${p.slice(0, 38)}…` : p}
                  </button>
                ))}
              </div>
              <button className="btn primary" onClick={direct} disabled={directing || !prompt.trim()} aria-busy={directing}>
                <IconDirect /> {directing ? "Directing…" : t("forge.direct")}
              </button>
            </div>
            {explanation ? (
              <div className="note mt-12">
                <span className="ai-badge">✦ Scenario Director · {explanation.engine === "azure" ? "Azure AI" : "offline"}</span>
                <div className="mt-4">{explanation.text}</div>
              </div>
            ) : null}
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Simulator config</h2>
              <span className="spacer" />
              <span className="pill warn">What-if · Synthetic</span>
            </div>
            {teams.error ? (
              <ErrorState message={teams.error} onRetry={teams.reload} />
            ) : !config || !teams.data ? (
              <div className="stack">
                <Skeleton h={36} />
                <Skeleton h={36} />
                <Skeleton h={36} />
              </div>
            ) : (
              <div className="stack">
                <div className="form-grid">
                  {(["home", "away"] as const).map((side) => {
                    const key = side === "home" ? "home_team_id" : "away_team_id";
                    const fkey = side === "home" ? "home_formation" : "away_formation";
                    const tm = teamById.get(config[key]);
                    return (
                      <div className="stack gap-10" key={side}>
                        <div className="field">
                          <label htmlFor={`team-${side}`}>
                            {side === "home" ? "Home" : "Away"} <TeamSwatch team={tm} size="sm" />
                          </label>
                          <select id={`team-${side}`} className="select" value={config[key]} onChange={(e) => set(key, e.target.value)}>
                            {teams.data!.map((x) => (
                              <option key={x.team_id} value={x.team_id}>
                                {teamLabel(x)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`form-${side}`}>Formation</label>
                          <select id={`form-${side}`} className="select" value={config[fkey] ?? ""} onChange={(e) => set(fkey, e.target.value || undefined)}>
                            {FORMATIONS.map((f) => (
                              <option key={f} value={f}>
                                {f || `Default${tm ? ` (${tm.formation})` : ""}`}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="scenario">Scenario</label>
                    <select id="scenario" className="select" value={config.scenario ?? "balanced"} onChange={(e) => set("scenario", e.target.value as Scenario)}>
                      {SCENARIOS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="asof">Strength as of</label>
                    <input id="asof" type="date" className="input" value={config.as_of ?? ""} onChange={(e) => set("as_of", e.target.value || undefined)} />
                  </div>
                  <div className="field">
                    <label htmlFor="intensity">
                      Intensity <b className="tnum">{Math.round((config.intensity ?? 0.5) * 100)}</b>
                    </label>
                    <input id="intensity" type="range" min={0} max={1} step={0.05} value={config.intensity ?? 0.5} onChange={(e) => set("intensity", Number(e.target.value))} />
                  </div>
                  <div className="field">
                    <label htmlFor="seed">Seed (optional)</label>
                    <input
                      id="seed"
                      type="number"
                      className="input"
                      value={config.seed ?? ""}
                      onChange={(e) => set("seed", e.target.value === "" ? undefined : Number(e.target.value))}
                      placeholder="random"
                    />
                  </div>
                </div>
                {config.home_team_id === config.away_team_id ? <div className="xs text-warn">Pick two different teams.</div> : null}
                <button className="btn primary" onClick={generate} disabled={generating || config.home_team_id === config.away_team_id} aria-busy={generating}>
                  <IconSimulate /> {generating ? "Simulating…" : t("forge.generate")}
                </button>
              </div>
            )}
            {err ? <div className="xs text-danger mt-10">{err}</div> : null}
          </section>

          {result ? (
            <section className="card border-accent">
              <div className="card-head">
                <h2 className="card-title">Generated</h2>
                <span className="spacer" />
                <SourceBadge source={result.match.source} compact />
              </div>
              <div className="fixture-line mb-12">
                <div className="fixture-team home">
                  <span className="nm">{result.match.home.name}</span>
                  <TeamSwatch team={result.match.home} />
                </div>
                <div className="fixture-score tnum">
                  {result.match.final_score.home}–{result.match.final_score.away}
                </div>
                <div className="fixture-team">
                  <TeamSwatch team={result.match.away} />
                  <span className="nm">{result.match.away.name}</span>
                </div>
              </div>
              <div className="row">
                <Link to={`/match/${result.match.match_id}`} className="btn primary">
                  <IconPlay /> Watch it unfold
                </Link>
                <Link to={`/studio/${result.match.match_id}`} className="btn">
                  <IconStudio /> Studio
                </Link>
                <span className="xs muted">
                  Calibration for this run: {result.calibration.metrics.filter((m) => m.status === "pass").length}/{result.calibration.metrics.length} metrics in range
                </span>
              </div>
            </section>
          ) : null}
        </div>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("forge.calibration")}</h2>
            <span className="spacer" />
            {calib.data ? <span className="xs muted">{calib.data.n_matches} simulated matches</span> : null}
          </div>
          {calib.error ? (
            <ErrorState message={calib.error} onRetry={calib.reload} />
          ) : !calib.data ? (
            <SkeletonCard h={240} lines={5} />
          ) : (
            <CalibrationReport c={calib.data} />
          )}
        </section>
      </div>
      <TruthScoreSection />
    </div>
  );
}

/** Evaluation-driven development, made visible: how well the agents find the changes the engine secretly plants. */
function TruthScoreSection() {
  const { t } = usePrefs();
  const ts = useAsync<TruthScore>(() => truthService.score(), []);
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">◎ {t("truth.score")}</h2>
        <span className="spacer" />
        {ts.data?.latest ? <span className="xs muted">{ts.data.latest.matches} matches · {ts.data.latest.plants} planted changes · {ts.data.latest.date}</span> : null}
      </div>
      {ts.error ? (
        <ErrorState message={ts.error} onRetry={ts.reload} />
      ) : !ts.data ? (
        <SkeletonCard h={160} lines={3} />
      ) : !ts.data.latest ? (
        <div className="xs muted">No truth evaluation has run yet. CI runs it on every commit (<span className="kbd">python -m app.evals.run</span>).</div>
      ) : (
        <TruthScoreBody s={ts.data} />
      )}
    </section>
  );
}

function TruthScoreBody({ s }: { s: TruthScore }) {
  const l = s.latest!;
  const bar = (label: string, recall: number, n: number) => (
    <div key={label} className="pp-row">
      <span className="xs muted capitalize">{label}</span>
      <div className="pp-track" role="img" aria-label={`${label}: recall ${Math.round(recall * 100)}% over ${n} changes`}>
        <span style={{ width: `${Math.round(recall * 100)}%`, background: recall >= 0.7 ? "var(--accent)" : recall >= 0.4 ? "var(--warn)" : "var(--danger)" }} />
      </div>
      <b className="tnum xs">{Math.round(recall * 100)}%</b>
      <span className="xs faint tnum">{n}</span>
    </div>
  );
  return (
    <div className="stack gap-14">
      <div className="kpis cols-3">
        <div className="kpi">
          <div className="label">Recall</div>
          <div className="value tnum">{Math.round(l.recall * 100)}%</div>
          <div className="sub">planted changes detected</div>
        </div>
        <div className="kpi">
          <div className="label">False alarms</div>
          <div className="value tnum">{l.false_alarms_per_match.toFixed(2)}</div>
          <div className="sub">per match (incl. control matches)</div>
        </div>
        <div className="kpi">
          <div className="label">Median time to detect</div>
          <div className="value tnum">{durationS(l.median_seconds_to_detect)}</div>
          <div className="sub">after the change began</div>
        </div>
      </div>
      <div className="two-col">
        <div className="stack gap-6">
          <div className="card-title mb-2">By difficulty</div>
          {l.by_difficulty.map((d) => bar(d.difficulty, d.recall, d.plants))}
        </div>
        <div className="stack gap-6">
          <div className="card-title mb-2">By mechanism</div>
          {l.by_mechanism.map((d) => bar(mechanismLabel(d.mechanism), d.recall, d.plants))}
        </div>
      </div>
      {s.history.length >= 2 ? <TruthHistory history={s.history} /> : null}
    </div>
  );
}

function TruthHistory({ history }: { history: TruthScore["history"] }) {
  const W = 560;
  const H = 120;
  const P = 26;
  const x = (i: number) => P + (i / Math.max(1, history.length - 1)) * (W - P * 2);
  const y = (v: number) => 10 + (1 - v) * (H - 30);
  const line = history.map((h, i) => `${i ? "L" : "M"} ${x(i)} ${y(h.recall)}`).join(" ");
  return (
    <div>
      <div className="card-title mb-6">Recall per commit</div>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Truth score history over ${history.length} runs`}>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line className="chart-grid" x1={P} x2={W - P} y1={y(v)} y2={y(v)} />
            <text className="chart-label" x={P - 4} y={y(v) + 3} textAnchor="end">{Math.round(v * 100)}%</text>
          </g>
        ))}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} />
        {history.map((h, i) => (
          <circle key={i} cx={x(i)} cy={y(h.recall)} r={3} fill="var(--accent)">
            <title>{`${h.date}: recall ${Math.round(h.recall * 100)}%, ${h.false_alarms_per_match.toFixed(2)} false alarms per match`}</title>
          </circle>
        ))}
        <text className="chart-label" x={P} y={H - 4}>{history[0].date.slice(0, 10)}</text>
        <text className="chart-label" x={W - P} y={H - 4} textAnchor="end">{history[history.length - 1].date.slice(0, 10)}</text>
      </svg>
    </div>
  );
}

function CalibrationReport({ c }: { c: Calibration }) {
  const passes = c.metrics.filter((m) => m.status === "pass").length;
  const fmt = (v: number, unit?: string) =>
    unit === "%" || unit === "ratio" ? `${(v * 100).toFixed(1)}%` : Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(0);
  return (
    <div className="stack">
      <div className="row gap-14">
        <div className="kpi grow">
          <div className="label">In range</div>
          <div className="value tnum" style={{ color: passes === c.metrics.length ? "var(--accent)" : "var(--warn)" }}>
            {passes}/{c.metrics.length}
          </div>
          <div className="sub">metrics within the real-world band</div>
        </div>
        <div className="kpi grow-2">
          <div className="label">Reference</div>
          <div className="fw-700">{c.reference.name}</div>
          <div className="sub">
            {c.reference.matches.toLocaleString()} matches · {c.reference.licence} ·{" "}
            <a className="team-link" href={sourceUrl(c.reference.source)} target="_blank" rel="noreferrer">
              source
            </a>
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Synthetic</th>
              <th>Reference</th>
              <th className="min-w-110">Band</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {c.metrics.map((m) => (
              <tr key={m.metric}>
                <td>
                  <div className="fw-600">{m.metric}</div>
                  <div className="xs faint">{m.source}</div>
                </td>
                <td className="tnum">
                  <b>{fmt(m.simulated, m.unit)}</b>
                </td>
                <td className="tnum muted">{fmt(m.reference, m.unit)}</td>
                <td>
                  <RangeBar low={m.low} high={m.high} reference={m.reference} simulated={m.simulated} />
                </td>
                <td className={`status-${m.status} fw-800`} aria-label={m.status}>
                  {m.status === "pass" ? "✓" : m.status === "warn" ? "!" : "✕"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="card-title mb-8">
          When goals are scored
        </div>
        <DistributionChart labelKey="Goal minute distribution" data={c.goal_minute_distribution.map((d) => ({ label: d.bin, simulated: d.simulated, reference: d.reference }))} />
      </div>
      <div>
        <div className="card-title mb-8">
          Most common scorelines
        </div>
        <DistributionChart labelKey="Scoreline distribution" data={c.scoreline_distribution.slice(0, 10).map((d) => ({ label: d.score, simulated: d.simulated, reference: d.reference }))} />
      </div>
      <div className="note">
        Calibration targets come from <b>{c.reference.matches.toLocaleString()} real international results</b> (CC0,{" "}
        <a className="team-link" href="https://github.com/martj42/international_results" target="_blank" rel="noreferrer">
          martj42/international_results
        </a>
        ). Real results keep their real scores, scorers and minutes; the ball-by-ball events around them are synthetic. What-if matches are fully
        synthetic predictions.
      </div>
    </div>
  );
}
