import { useState } from "react";
import { useParams } from "react-router-dom";
import { narrationService } from "../api";
import type { Persona, Recap as RecapT } from "../api/types";
import { AgentTrace } from "../components/AgentTrace";
import { EngineBadge, FactCheckBadge, FactCheckPanel } from "../components/FactCheck";
import { useMatch } from "../components/Layout";
import { ListenButton } from "../components/ListenButton";
import { Markdown } from "../components/Markdown";
import { SourceBadge } from "../components/SourceBadge";
import { ErrorState, Skeleton } from "../components/States";
import { LANGUAGES } from "../lib/i18n";
import { teamColors } from "../lib/match";
import { usePrefs } from "../lib/prefs";
import { PlayerLink } from "../components/ScoutViz";
import { IconAI } from "../components/icons";
import { quietly } from "../lib/activity";

const RECAP_PERSONAS: Persona[] = ["casual", "analyst", "kids", "fantasy", "broadcaster", "social", "accessible"];
const PLATFORM_LABEL: Record<string, string> = { x: "X", instagram: "Instagram", tiktok: "TikTok", whatsapp: "WhatsApp" };

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? "✓ Copied" : "Copy"}
    </button>
  );
}

export function Recap() {
  const { id = "" } = useParams();
  const match = useMatch();
  const colors = teamColors(match);
  const prefs = usePrefs();
  const [persona, setPersona] = useState<Persona>(prefs.persona);
  const [language, setLanguage] = useState(prefs.language);
  const [recap, setRecap] = useState<RecapT | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setRecap(await quietly(() => narrationService.recap({ match_id: id, persona, language })));   // the button shows progress
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="row gap-12 items-end">
          <div className="field">
            <label htmlFor="rp">{prefs.t("persona")}</label>
            <select id="rp" className="select" value={persona} onChange={(e) => setPersona(e.target.value as Persona)}>
              {RECAP_PERSONAS.map((p) => (
                <option key={p} value={p}>
                  {prefs.t(`persona.${p}` as Parameters<typeof prefs.t>[0])}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rl">{prefs.t("language")}</label>
            <select id="rl" className="select" value={language} onChange={(e) => setLanguage(e.target.value)} translate="no">
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <button className="btn primary" onClick={generate} disabled={busy} aria-busy={busy}>
            <IconAI /> {busy ? prefs.t("recap.generating") : prefs.t("recap.generate")}
          </button>
          <span className="xs muted grow min-w-200">
            Analyst and Tactician agents run in parallel; the Narrator writes; the Fact-checker verifies every claim; the Localizer adapts the
            language.
          </span>
        </div>
      </section>

      {error ? (
        <div className="card">
          <ErrorState message={error} onRetry={generate} />
        </div>
      ) : null}

      {busy && !recap ? (
        <div className="recap-grid">
          <div className="card stack">
            <Skeleton h={44} w="80%" />
            <Skeleton h={18} w="60%" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} h={12} w={`${95 - (i % 3) * 12}%`} />
            ))}
          </div>
          <div className="card stack">
            <Skeleton h={120} />
            <Skeleton h={120} />
          </div>
        </div>
      ) : null}

      {!recap && !busy && !error ? (
        <div className="card">
          <div className="state">
            <div className="icon" aria-hidden="true">📰</div>
            <strong>Full-time package in one click</strong>
            <div className="small max-60ch">
              Match report, social posts, a 60-second audio script and a highlight run-sheet with timecodes for editors. Every claim is
              cited back to the event log.
            </div>
          </div>
        </div>
      ) : null}

      {recap ? (
        <div className="recap-grid" style={{ opacity: busy ? 0.55 : 1 }}>
          <div className="stack">
            <article className="card">
              <div className="row gap-8 mb-12">
                <SourceBadge source={match.source} compact />
                <EngineBadge engine={recap.engine} ms={recap.latency_ms} />
                <FactCheckBadge fc={recap.fact_check} />
              </div>
              <h2 className="headline">{recap.headline}</h2>
              <p className="standfirst">{recap.standfirst}</p>
              <div className="divider my-18" />
              <Markdown source={recap.report_md} citations={recap.citations} />
            </article>

            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Highlight run-sheet</h2>
                <span className="spacer" />
                <span className="xs muted">match-clock timecodes for the edit</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>In</th>
                      <th>Out</th>
                      <th>Min</th>
                      <th>Clip</th>
                      <th>Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recap.run_sheet.map((r, i) => (
                      <tr key={i}>
                        <td className="mono">{r.tc_start}</td>
                        <td className="mono">{r.tc_end}</td>
                        <td className="tnum">{r.minute}'</td>
                        <td>{r.title}</td>
                        <td>
                          <span className={r.priority >= 75 ? "pill signal" : r.priority >= 45 ? "pill warn" : "pill"}>{Math.round(r.priority)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="stack">
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Player of the match</h2>
              </div>
              <div className="potm">
                <div
                  className="badge"
                  style={{
                    background: recap.player_of_match.team_id === match.home.team_id ? colors.home : colors.away,
                    color: recap.player_of_match.team_id === match.home.team_id ? match.home.colors.text : match.away.colors.text,
                  }}
                >
                  ★
                </div>
                <div>
                  <div className="fw-800 fs-18">
                    <PlayerLink
                      name={recap.player_of_match.name}
                      playerKey={[...match.home.players, ...match.away.players].find((pl) => pl.player_id === recap.player_of_match.player_id)?.player_key}
                    />
                  </div>
                  <div className="small muted">{recap.player_of_match.reason}</div>
                </div>
              </div>
              <div className="chips mt-12">
                {recap.player_of_match.metrics.map((m) => (
                  <span key={m.fact_id} className="chip cursor-default">
                    <span className="fid">{m.fact_id}</span>
                    {m.label}: <b>{m.value}{m.unit ? ` ${m.unit}` : ""}</b>
                  </span>
                ))}
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h2 className="card-title">60-second audio recap</h2>
                <span className="spacer" />
                <ListenButton small text={recap.audio_script} language={recap.language} persona={recap.persona} />
              </div>
              <p className="small m-0 pre-wrap lh-prose">
                {recap.audio_script.replace(/\s?\[f\d+\]/g, "")}
              </p>
            </section>

            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Social pack</h2>
              </div>
              <div className="stack gap-10">
                {recap.social_posts.map((p, i) => (
                  <div key={i} className="social">
                    <div className="row justify-between">
                      <span className="platform">{PLATFORM_LABEL[p.platform] ?? p.platform}</span>
                      <CopyButton text={p.text} />
                    </div>
                    <div className="small pre-wrap">
                      {p.text}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Fact check</h2>
              </div>
              <FactCheckPanel fc={recap.fact_check} />
            </section>

            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Agent trace</h2>
              </div>
              <AgentTrace steps={recap.agent_trace} />
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
