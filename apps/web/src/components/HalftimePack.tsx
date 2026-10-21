import { useState } from "react";
import { api } from "../api/client";
import type { Analysis, Cue, MatchMeta, MatchEvent, Narrative, StudioItem } from "../api/types";
import { clock, cx } from "../lib/format";
import { usePrefs } from "../lib/prefs";
import { EngineBadge, FactCheckBadge } from "./FactCheck";
import { CitedText } from "./Markdown";
import { ModelTag } from "./SourceBadge";

type Row = { label: string; home: string; away: string; value: string };
/** `key` is stable per match ("ht-xg"), so adding twice is a no-op and the queued item can be found again: id "si-pr-{key}". */
type Graphic = { key: string; kind: "stat_card" | "lower_third"; template: string; title: string; body: string; rows: Row[]; priority: number };

const DURATION_S = 12;
export const queuedId = (key: string) => `si-pr-${key}`;
const row = (label: string, home: string, away: string): Row => ({ label, home, away, value: `${home} – ${away}` });

const SENTENCE = /(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9"'¿¡])/u;

const timecode = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

/** Graphics a studio would want at the break, built only from the first-half analysis (no AI numbers). */
function suggest(a: Analysis, match: MatchMeta, htT: number): Graphic[] {
  const h = a.stats.home;
  const w = a.stats.away;
  const out: Graphic[] = [
    {
      key: "ht-xg", kind: "stat_card", template: "halftime_xg", priority: 70,
      title: `Half time: ${match.home.short} ${a.score.home}-${a.score.away} ${match.away.short}`,
      body: `Chances so far (${match.home.short} – ${match.away.short})`,
      rows: [
        row("Expected goals (xG)", h.xg.toFixed(2), w.xg.toFixed(2)),
        row("Shots", String(h.shots), String(w.shots)),
        row("On target", String(h.shots_on_target), String(w.shots_on_target)),
      ],
    },
    {
      key: "ht-control", kind: "stat_card", template: "halftime_control", priority: 60, title: "Who's in control",
      body: `Possession, territory and pressing (${match.home.short} – ${match.away.short})`,
      rows: [
        row("Possession", `${Math.round(h.possession * 100)}%`, `${Math.round(w.possession * 100)}%`),
        row("Field tilt", `${Math.round(h.field_tilt * 100)}%`, `${Math.round(w.field_tilt * 100)}%`),
        row("PPDA (lower = more pressing)", h.ppda.toFixed(1), w.ppda.toFixed(1)),
      ],
    },
  ];
  const top = [...a.moments].filter((m) => m.t <= htT && m.type !== "turning_point").sort((x, y) => y.importance - x.importance)[0];
  if (top) {
    out.push({ key: "ht-moment", kind: "lower_third", template: "moment_of_the_half", priority: Math.min(100, Math.round(top.importance)),
      title: `Moment of the half: ${top.title}`.slice(0, 120), body: `${clock(top.minute, top.added_minute)} · ${top.summary}`.slice(0, 400), rows: [] });
  }
  return out;
}

function toCue(g: Graphic, t: number, language: string, match: MatchMeta): Cue {
  return {
    version: "1.0", timecode: timecode(t), duration_s: DURATION_S, priority: g.priority, template: g.template,
    data: { template: g.template, home: match.home.name, away: match.away.name, rows: g.rows },
    strings: { [language]: { title: g.title, body: g.body } },
  };
}

const STATUS_LABEL: Record<StudioItem["status"], string> = { proposed: "", approved: "approved", on_air: "on air", rejected: "rejected", killed: "killed" };

type Props = {
  match: MatchMeta;
  events: MatchEvent[];
  minute: number;
  ended: boolean;
  /** The Studio's queue, so a graphic added earlier (or from another console) shows as queued. */
  queue: Map<string, StudioItem>;
  onQueued: (item: StudioItem) => void;
};

/**
 * Half-time studio segment: talking points from the narrator (fact-checked like every line) plus graphics built from the
 * first-half numbers. "Add to queue" sends a graphic through the same approval, editorial check and audit as agent proposals.
 */
export function HalftimePack({ match, events, minute, ended, queue, onQueued }: Props) {
  const { t, language } = usePrefs();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [pack, setPack] = useState<{ narrative: Narrative; graphics: Graphic[]; t: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const htEvent = events.find((e) => e.type === "half_end" && e.period === 1);
  const ready = Boolean(htEvent) || ended || minute > 45;

  const build = async () => {
    setBusy(true);
    setErr(null);
    try {
      let htT = htEvent?.t;
      if (htT === undefined) {
        const ev = await api.events(match.match_id, { types: ["half_end"] });
        htT = ev.find((e) => e.period === 1)?.t ?? 45 * 60;
      }
      const [narrative, analysis] = await Promise.all([
        api.narrate({ match_id: match.match_id, scope: "halftime", persona: "broadcaster", language, upto_t: htT }),
        api.analysis(match.match_id, htT),
      ]);
      setPack({ narrative, graphics: suggest(analysis, match, htT), t: htT });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (g: Graphic, cue: Cue) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(cue, null, 2));
      setCopied(g.key);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setErr("Clipboard unavailable: open the cue below and copy it by hand.");
    }
  };

  const add = async (g: Graphic) => {
    if (!pack) return;
    setAdding(g.key);
    setErr(null);
    try {
      const item = await api.studioAdd(match.match_id, {
        // The engine finishes the last first-half possession a few seconds past the second-half kick-off clock;
        // stamp the cue just before it so it reads 45' rather than 46'.
        kind: g.kind, title: g.title, body: g.body, priority: g.priority, duration_s: DURATION_S,
        t: Math.min(pack.t, (match.period_starts?.[1] ?? pack.t + 1) - 1), template: g.template, key: g.key,
        data: { home: match.home.name, away: match.away.name, rows: g.rows, half: 1 },
      });
      onQueued(item);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(null);
    }
  };

  const points = pack ? pack.narrative.text.split(SENTENCE).filter((s) => s.trim()) : [];

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">⏸ {t("ht.title")}</h2>
        <span className="spacer" />
        <button className="btn sm primary" onClick={build} disabled={!ready || busy} title={ready ? undefined : t("ht.locked")}>
          {busy ? t("loading") : t("ht.build")}
        </button>
      </div>
      {err ? <div className="xs" style={{ color: "var(--danger)" }}>{err}</div> : null}
      {!pack ? (
        <div className="xs faint">{ready ? "Talking points and graphics for the break, from first-half data only." : t("ht.locked")}</div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div>
            <div className="xs muted" style={{ marginBottom: 6 }}>{t("ht.points")}</div>
            <ol className="ht-points">
              {points.map((p, i) => (
                <li key={i}><CitedText text={p} citations={pack.narrative.citations} /></li>
              ))}
            </ol>
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <FactCheckBadge fc={pack.narrative.fact_check} />
              <EngineBadge engine={pack.narrative.engine} ms={pack.narrative.latency_ms} />
            </div>
          </div>
          <div>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
              <span className="xs muted">{t("ht.graphics")}</span>
              <span className="xs faint">{t("ht.queueHint")}</span>
            </div>
            <div className="ht-gfx">
              {pack.graphics.map((g) => {
                const queued = queue.get(queuedId(g.key));
                const cue = queued?.cue ?? toCue(g, pack.t, language, match);
                return (
                <div key={g.key} className={cx("gfx", queued?.status)}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="gfx-kind">{g.kind === "stat_card" ? "Stat card" : "Lower third"} · HT</span>
                    {queued ? (
                      <span className={cx("pill", queued.status === "proposed" ? "warn" : queued.status === "rejected" || queued.status === "killed" ? "danger" : "accent")}>
                        {queued.status === "proposed" ? `✓ ${t("ht.queued")}` : `✓ ${STATUS_LABEL[queued.status]}`}
                      </span>
                    ) : null}
                  </div>
                  {queued?.editorial && !queued.editorial.passed ? (
                    <div className="chip editorial" role="status">
                      ⚠ {t("ht.editorial")}: {queued.editorial.issues.join(" · ") || "see the queue"}
                    </div>
                  ) : null}
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{g.title}</div>
                  <div className="small muted">{g.body}</div>
                  {g.rows.length ? (
                    <table className="ht-table xs">
                      <thead>
                        <tr><th /><th>{match.home.short}</th><th>{match.away.short}</th></tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => (
                          <tr key={r.label}><td className="muted">{r.label}</td><td className="tnum">{r.home}</td><td className="tnum">{r.away}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <ModelTag title="From Regista's synthetic first-half events" />
                    <span className="row" style={{ gap: 6 }}>
                      <button className="btn sm" onClick={() => copy(g, cue)}>{copied === g.key ? `✓ ${t("ht.copied")}` : `⧉ ${t("ht.copy")}`}</button>
                      {queued ? null : (
                        <button className="btn sm primary" onClick={() => add(g)} disabled={adding !== null}>
                          {adding === g.key ? t("ht.adding") : `＋ ${t("ht.add")}`}
                        </button>
                      )}
                    </span>
                  </div>
                  <details className="disclosure cue">
                    <summary>Cue v{cue.version} · {cue.template}{queued ? ` · ${queued.id}` : ""}</summary>
                    <pre className="kql">{JSON.stringify(cue, null, 2)}</pre>
                  </details>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
