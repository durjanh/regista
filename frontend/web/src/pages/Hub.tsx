import { Link } from "react-router-dom";
import { matchService } from "../api";
import type { MatchSummary } from "../api/types";
import { ReferenceStrip } from "../components/ReferenceStrip";
import { SourceBadge } from "../components/SourceBadge";
import { EmptyState, ErrorState, Skeleton } from "../components/States";
import { TeamLink, TeamSwatch } from "../components/TeamSwatch";
import { useAsync } from "../hooks/useAsync";
import { usePrefs } from "../lib/prefs";

function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function Fixture({ m }: { m: MatchSummary }) {
  const { t } = usePrefs();
  const real = m.source?.real;
  return (
    <article className="card fixture">
      <div className="fixture-meta">
        <span className="comp">{real?.tournament ?? m.competition}</span>
        <span className="tnum">{formatDate(real?.date ?? m.kickoff)}</span>
        <span>{real?.city ? `${real.city}${real.neutral ? " · neutral" : ""}` : m.venue}</span>
      </div>
      <div>
        <div className="fixture-line">
          <div className="fixture-team home">
            <span className="nm">
              <TeamLink team={m.home} />
            </span>
            <TeamSwatch team={m.home} />
          </div>
          <div className="fixture-score tnum" aria-label={`Final score ${m.final_score.home} to ${m.final_score.away}`}>
            {m.final_score.home}–{m.final_score.away}
          </div>
          <div className="fixture-team">
            <TeamSwatch team={m.away} />
            <span className="nm">
              <TeamLink team={m.away} />
            </span>
          </div>
        </div>
        <div className="row" style={{ justifyContent: "center", gap: 6, marginTop: 8 }}>
          <SourceBadge source={m.source} compact />
          {m.headline_hint ? <span className="pill">{m.headline_hint}</span> : null}
          {m.planted_changes ? (
            <span className="pill truth-pill" title={`${m.planted_changes} hidden planted change${m.planted_changes === 1 ? "" : "s"}: open the Studio or Matchday and switch on truth mode`}>
              ◎ Truth mode
            </span>
          ) : null}
          {m.elo ? (
            <span className="pill" title="Pre-match Elo rating from every prior result since 1872">
              Elo {Math.round(m.elo.home)} v {Math.round(m.elo.away)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="fixture-actions">
        <Link to={`/match/${m.match_id}`} className="btn primary">
          ▶ {t("hub.open")}
        </Link>
        <Link to={`/studio/${m.match_id}`} className="btn" title={t("hub.studio")}>
          🎛 <span className="hide-sm">{t("nav.studio")}</span>
        </Link>
      </div>
    </article>
  );
}

export function Hub() {
  const { t } = usePrefs();
  const { data, error, loading, reload } = useAsync(() => matchService.list(), []);
  const sorted = data ? [...data].sort((a, b) => (b.source?.real?.date ?? b.kickoff).localeCompare(a.source?.real?.date ?? a.kickoff)) : [];

  return (
    <div className="stack" style={{ gap: 22 }}>
      <section className="hub-hero" style={{ marginBottom: 0 }}>
        <div className="card hero-copy">
          <span className="pill signal" style={{ marginBottom: 12 }}>
            <span className="dot live" /> Inside the Game
          </span>
          <h1 className="page-title">{t("tagline")}</h1>
          <p>{t("hub.subtitle")}</p>
          <p className="small" style={{ marginTop: -4 }}>
            Real international results, with every goal, scorer and minute from 150 years of records, rebuilt ball by ball as synthetic
            match events. Every insight cites its evidence.
          </p>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="pill real">◉ Real results</span>
            <span className="pill">12 languages</span>
            <span className="pill">Audio described</span>
            <span className="pill">Broadcast overlays</span>
          </div>
        </div>
        <Link to="/forge" className="card forge-cta">
          <div>
            <div className="card-title" style={{ marginBottom: 8 }}>
              ⚒ {t("hub.forge.title")} · What-if
            </div>
            <div className="section-title" style={{ fontSize: 22, marginBottom: 6 }}>
              “Brazil v Japan, as of 2002, with a late red card”
            </div>
            <div className="muted small">{t("hub.forge.body")}</div>
          </div>
          <span className="btn primary" style={{ alignSelf: "flex-start" }}>
            {t("nav.forge")} →
          </span>
        </Link>
      </section>

      <ReferenceStrip />

      <section>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h2 className="section-title">Fixtures</h2>
          {data ? <span className="xs muted">{data.length} matches</span> : null}
        </div>
        {error ? (
          <div className="card">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : loading ? (
          <div className="fixtures">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} h={84} />
            ))}
          </div>
        ) : sorted.length ? (
          <div className="fixtures">
            {sorted.map((m) => (
              <Fixture key={m.match_id} m={m} />
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState icon="⚽">
              No matches yet. <Link to="/forge" className="status-pass">Generate a what-if in the Data Forge</Link>.
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  );
}
