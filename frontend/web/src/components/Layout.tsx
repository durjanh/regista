import { NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import { ApiError, forgeService, matchService } from "../api";
import type { MatchMeta } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { usePrefs } from "../lib/prefs";
import { usePageTranslation } from "../lib/pageTranslation";
import { SourceBadge } from "./SourceBadge";
import { TeamLink, TeamSwatch } from "./TeamSwatch";
import { ActivityIndicator } from "./ActivityIndicator";
import { ErrorState, Loading, Skeleton } from "./States";
import { TopBar } from "./TopBar";
import { teamReportPath } from "../lib/players";
import { IconAsk, IconDugout, IconMatchday, IconRecap, IconReport, IconStudio, IconTactics } from "./icons";

export function AppLayout() {
  const { t, language } = usePrefs();
  usePageTranslation(language);
  return (
    <div className="app">
      <a href="#main" className="sr-only skip-link">
        Skip to content
      </a>
      <TopBar />
      <ActivityIndicator />
      <main id="main" className="main">
        <Outlet />
      </main>
      <footer className="footer">
        <span>{t("footer.disclaimer")}</span>
        <span translate="no">
          Built with Microsoft Foundry · Agent Framework · Azure AI Services · Fabric · Azure Container Apps ·{" "}
          <NavLink to="/ops" className="team-link">{t("ops.title")}</NavLink>
        </span>
      </footer>
    </div>
  );
}

export type MatchContext = { match: MatchMeta };

export function useMatch(): MatchMeta {
  return useOutletContext<MatchContext>().match;
}

export function MatchLayout() {
  const { id = "" } = useParams();
  const { t } = usePrefs();
  // A replayed real result is rebuilt on demand: after an API restart its link still works.
  const { data: match, error, loading, reload } = useAsync(
    () => matchService.get(id).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404 && /^\d{4}-\d{2}-\d{2}-/.test(id)) return forgeService.replay(id).then(() => matchService.get(id));
      throw e;
    }),
    [id],
  );

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !match)
    return (
      <div className="stack" aria-busy="true">
        <Loading />
        <Skeleton h={28} w="40%" />
        <Skeleton h={44} />
        <Skeleton h={420} />
      </div>
    );

  const tabs = [
    { to: `/match/${id}`, label: t("nav.matchday"), icon: <IconMatchday />, end: true },
    { to: `/match/${id}/tactics`, label: t("nav.tactics"), icon: <IconTactics /> },
    { to: `/match/${id}/ask`, label: t("nav.ask"), icon: <IconAsk /> },
    { to: `/match/${id}/recap`, label: t("nav.recap"), icon: <IconRecap /> },
    { to: `/match/${id}/dugout`, label: t("nav.dugout"), icon: <IconDugout /> },
  ];

  return (
    <div>
      <div className="match-header">
        <div className="row gap-12 justify-between">
          <div className="row gap-10">
            <TeamSwatch team={match.home} />
            <h1 className="display fs-26 fw-800 uppercase">
              <TeamLink team={match.home} /> <span className="faint">v</span> <TeamLink team={match.away} />
            </h1>
            <TeamSwatch team={match.away} />
          </div>
          <div className="row gap-8 wrap">
            <SourceBadge source={match.source} />
            <span className="row xs gap-4">
              <span className="muted row gap-4">
                <IconReport width={14} height={14} /> {t("scout.teamReport")}:
              </span>
              <NavLink to={teamReportPath(match.home.team_id)} className="btn sm">
                {match.home.short}
              </NavLink>
              <NavLink to={teamReportPath(match.away.team_id)} className="btn sm">
                {match.away.short}
              </NavLink>
            </span>
            <NavLink to={`/studio/${id}`} className="btn sm">
              <IconStudio /> {t("nav.studio")}
            </NavLink>
          </div>
        </div>
        <div className="row xs muted gap-8 mt-n4">
          <span className="fw-700 text-strong">{match.source?.real?.tournament ?? match.competition}</span>
          <span>·</span>
          <span className="tnum">{match.source?.real?.date ?? match.kickoff}</span>
          {match.source?.real?.city ? (
            <>
              <span>·</span>
              <span>
                {match.source.real.city}
                {match.source.real.country ? `, ${match.source.real.country}` : ""}
                {match.source.real.neutral ? " (neutral)" : ""}
              </span>
            </>
          ) : (
            <>
              <span>·</span>
              <span>{match.venue}</span>
            </>
          )}
        </div>
        <nav className="subnav" aria-label="Match sections">
          {tabs.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end}>
              {tab.icon} {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet context={{ match } satisfies MatchContext} />
    </div>
  );
}
