import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { matchService, studioService, truthService, type StudioAction } from "../api";
import type { AuditEntry, BroadcasterProfile, Cue, MatchMeta, StudioItem, StudioSettings, StudioStatus } from "../api/types";
import { GoLivePanel } from "../components/Broadcast";
import { HalftimePack } from "../components/HalftimePack";
import { InsightCard } from "../components/InsightCard";
import { TruthPanel } from "../components/TruthPanel";
import { LiveControls, statusLabel } from "../components/LiveControls";
import { ScoreBug } from "../components/ScoreBug";
import { SourceBadge } from "../components/SourceBadge";
import { EmptyState, ErrorState, Skeleton } from "../components/States";
import { useAsync } from "../hooks/useAsync";
import { useLiveMatch } from "../hooks/useLiveMatch";
import { MOMENT_ICON, clock, cx, importanceTier, median, percentile } from "../lib/format";
import { usePrefs } from "../lib/prefs";
import { usePoll, useTruthMode, useVerifierDrill } from "../lib/truth";
import { LANGUAGES } from "../lib/i18n";

const KIND_LABEL: Record<StudioItem["kind"], string> = {
  lower_third: "Lower third",
  stat_card: "Stat card",
  talking_point: "Talking point",
  replay_cue: "Replay cue",
  score_bug_alert: "Score-bug alert",
};

type Filter = "proposed" | "approved" | "on_air" | "all";
type ActionFn = (item: StudioItem, action: StudioAction, edit?: { title: string; body: string }) => Promise<void>;

const langName = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

/** The versioned machine-readable cue any renderer can play, with its translated strings. */
function CuePreview({ cue }: { cue: Cue }) {
  const langs = Object.keys(cue.strings ?? {});
  const [lang, setLang] = useState(langs[0] ?? "en");
  const str = cue.strings?.[lang];
  return (
    <details className="disclosure cue">
      <summary>
        ⧉ Cue v{cue.version} · {cue.template} · {cue.timecode} · {langs.length} language{langs.length === 1 ? "" : "s"}
      </summary>
      {langs.length ? (
        <div className="seg" role="tablist" aria-label="Cue language" style={{ marginTop: 8 }}>
          {langs.map((l) => (
            <button key={l} role="tab" aria-selected={lang === l} className={cx(lang === l && "on")} onClick={() => setLang(l)}>
              {langName(l)}
            </button>
          ))}
        </div>
      ) : null}
      {str ? (
        <div className="cue-strings" dir={l10nDir(lang)}>
          <b>{str.title}</b>
          {str.body ? <div className="small muted">{str.body}</div> : null}
        </div>
      ) : null}
      <pre className="kql">{JSON.stringify(cue, null, 2)}</pre>
    </details>
  );
}

const l10nDir = (lang: string) => (lang === "ar" ? "rtl" : "ltr");

function GovernanceBar({ matchId }: { matchId: string }) {
  const { t } = usePrefs();
  const [profiles, setProfiles] = useState<BroadcasterProfile[]>([]);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([studioService.profiles(), studioService.settings(matchId)])
      .then(([p, st]) => {
        if (!alive) return;
        setProfiles(p);
        setSettings(st);
        setDraft(st.auto_approve_threshold);
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [matchId]);

  const save = async (body: Partial<StudioSettings>) => {
    setErr(null);
    try {
      const st = await studioService.saveSettings(matchId, body);
      setSettings(st);
      setDraft(st.auto_approve_threshold);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  // debounce slider writes
  useEffect(() => {
    if (!settings || draft === settings.auto_approve_threshold) return;
    const tid = window.setTimeout(() => void save({ auto_approve_threshold: draft }), 450);
    return () => window.clearTimeout(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const profile = profiles.find((p) => p.id === settings?.profile_id);
  const off = draft === null;
  return (
    <div className="governance">
      <label className="row" style={{ gap: 6 }}>
        <span className="xs muted">{t("studio.profile")}</span>
        <select className="select" value={settings?.profile_id ?? ""} disabled={!settings}
          onChange={(e) => void save({ profile_id: e.target.value })} aria-label={t("studio.profile")}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      {profile ? (
        <span className="row xs muted" style={{ gap: 6 }}>
          <span className="swatch" style={{ background: profile.brand.primary }} />
          <span className="swatch" style={{ background: profile.brand.secondary }} />
          {profile.languages.map(langName).join(" · ")} · {profile.tone}
        </span>
      ) : null}
      <span className="spacer" />
      <label className="toggle" title="Graphics at or above this priority go to air without a click">
        <input type="checkbox" checked={!off} disabled={!settings}
          onChange={(e) => setDraft(e.target.checked ? profile?.auto_approve_threshold ?? 85 : null)} />
        {t("studio.autoApprove")}
      </label>
      <input type="range" min={0} max={100} step={1} value={draft ?? 85} disabled={off || !settings}
        onChange={(e) => setDraft(Number(e.target.value))} aria-label={t("studio.autoApprove")} />
      <b className="tnum" style={{ minWidth: 34 }}>{off ? t("studio.off") : `≥${draft}`}</b>
      {err ? <span className="xs" style={{ color: "var(--danger)" }}>{err}</span> : null}
    </div>
  );
}

function AuditLog({ matchId }: { matchId: string }) {
  const { t } = usePrefs();
  const { data, error } = usePoll<AuditEntry[]>(() => studioService.audit(matchId), 4000, true, [matchId]);
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">🧾 {t("studio.audit")}</h2>
        <span className="spacer" />
        <span className="xs muted">{data?.length ?? 0}</span>
      </div>
      {error && !data ? <div className="xs" style={{ color: "var(--danger)" }}>{error}</div> : null}
      {data?.length ? (
        <div className="audit">
          {data.slice(0, 60).map((a, i) => (
            <div key={`${a.at}-${a.item_id}-${i}`} className="audit-row">
              <span className="tnum faint">{a.at.slice(11, 19)}</span>
              <span className={cx("pill", a.by === "auto" ? "accent" : a.by === "system" ? "" : "warn")}>{a.by}</span>
              <span>
                <b>{a.action.replace("_", " ")}</b> <span className="muted">{a.title}</span>
                {a.detail ? <span className="faint"> · {a.detail}</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon="🧾">Every approval, edit, kill and auto-approval is recorded here.</EmptyState>
      )}
    </section>
  );
}

function OverlayPreview({ matchId }: { matchId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1920));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="preview-frame" ref={ref}>
      <iframe title="On-air overlay preview" src={`/overlay/${encodeURIComponent(matchId)}`} style={{ transform: `scale(${scale})` }} />
    </div>
  );
}

function GraphicCard({ item, onAction }: { item: StudioItem; onAction: ActionFn }) {
  const { t } = usePrefs();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [busy, setBusy] = useState<StudioAction | null>(null);
  useEffect(() => {
    if (!editing) {
      setTitle(item.title);
      setBody(item.body);
    }
  }, [item.title, item.body, editing]);

  const run = async (action: StudioAction, edit?: { title: string; body: string }) => {
    setBusy(action);
    try {
      await onAction(item, action, edit);
      if (action === "edit") setEditing(false);
    } finally {
      setBusy(null);
    }
  };

  const rows = Array.isArray(item.data?.rows) ? (item.data.rows as { label: string; value: string | number }[]) : null;

  return (
    <div className={cx("gfx", item.status)}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="gfx-kind">
          {KIND_LABEL[item.kind]} · {item.minute}'
        </span>
        <span className="row" style={{ gap: 4 }}>
          {item.auto_approved ? <span className="pill accent" title="Approved automatically: priority above the producer's threshold">AUTO</span> : null}
          <span className={item.status === "on_air" ? "pill signal" : item.status === "approved" ? "pill accent" : item.status === "rejected" || item.status === "killed" ? "pill danger" : "pill warn"}>
            {item.status === "on_air" ? <span className="dot live" /> : null}
            {item.status.replace("_", " ")}
          </span>
        </span>
      </div>
      {item.editorial && !item.editorial.passed ? (
        <div className="chip editorial" title="Editorial rules: no betting language, balanced tone">
          ⚠ {item.editorial.issues.join(" · ") || "Editorial check failed"}
        </div>
      ) : null}
      {editing ? (
        <div className="stack" style={{ gap: 8 }}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Graphic title" />
          <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Graphic body" />
        </div>
      ) : (
        <>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{item.title}</div>
          <div className="small muted">{item.body}</div>
          {rows ? (
            <div className="stack" style={{ gap: 4 }}>
              {rows.slice(0, 4).map((r, i) => (
                <div key={i} className="row xs" style={{ justifyContent: "space-between" }}>
                  <span className="muted">{r.label}</span>
                  <b className="tnum">{r.value}</b>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
      <div className="row xs faint" style={{ justifyContent: "space-between" }}>
        <span>Priority {Math.round(item.priority)}</span>
        <span>{item.duration_s}s on air</span>
      </div>
      <div className="gfx-actions">
        {editing ? (
          <>
            <button className="btn sm primary" disabled={!!busy} aria-busy={busy === "edit"} onClick={() => run("edit", { title, body })}>
              Save
            </button>
            <button className="btn sm ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {item.status === "proposed" ? (
              <button className="btn sm success" disabled={!!busy} aria-busy={busy === "approve"} onClick={() => run("approve")}>
                ✓ {t("studio.approve")}
              </button>
            ) : null}
            {item.status !== "rejected" && item.status !== "on_air" ? (
              <button className="btn sm danger" disabled={!!busy} aria-busy={busy === "reject"} onClick={() => run("reject")}>
                ✕ {t("studio.reject")}
              </button>
            ) : null}
            <button className="btn sm" disabled={!!busy} onClick={() => setEditing(true)}>
              ✎ {t("studio.edit")}
            </button>
            {item.status !== "on_air" && item.status !== "rejected" && item.status !== "killed" ? (
              <button className="btn sm signal" disabled={!!busy} aria-busy={busy === "on_air"} onClick={() => run("on_air")}>
                ● {t("studio.onair")}
              </button>
            ) : null}
            {item.status === "on_air" ? (
              <button className="btn sm danger" disabled={!!busy} aria-busy={busy === "kill"} onClick={() => run("kill")} title="Take this graphic off air immediately">
                ■ {t("studio.kill")}
              </button>
            ) : null}
          </>
        )}
      </div>
      {item.cue ? <CuePreview cue={item.cue} /> : null}
    </div>
  );
}

export function Studio() {
  const { id = "" } = useParams();
  const { data: match, error, loading, reload } = useAsync<MatchMeta>(() => matchService.get(id), [id]);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading || !match) return <Skeleton h={500} />;
  return <StudioConsole match={match} />;
}

function StudioConsole({ match }: { match: MatchMeta }) {
  const id = match.match_id;
  const { t, language } = usePrefs();
  // Commentator whisper needs the analyst register regardless of the fan persona.
  const [drill, setDrill] = useVerifierDrill();
  const live = useLiveMatch(id, { persona: "analyst", language, initialSpeed: 30, drill });
  const { state } = live;
  const [items, setItems] = useState<Map<string, StudioItem>>(new Map());
  const [filter, setFilter] = useState<Filter>("proposed");
  const [actionErr, setActionErr] = useState<string | null>(null);

  const merge = useCallback((list: StudioItem[]) => {
    setItems((prev) => {
      const next = new Map(prev);
      for (const it of list) next.set(it.id, it);
      return next;
    });
  }, []);

  useEffect(() => merge(state.studio), [state.studio, merge]);

  // Poll the server queue so approvals made elsewhere show up too.
  const tRef = useRef(0);
  tRef.current = state.t;
  useEffect(() => {
    let alive = true;
    const load = () =>
      studioService
        // Always bound by the clock: before kick-off t is 0, and an unbounded queue would show the full-time graphics.
        .queue(id, tRef.current)
        .then((q) => alive && merge(q))
        .catch(() => undefined);
    load();
    const iv = window.setInterval(load, 8000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, [id, merge]);

  const onAction: ActionFn = async (item, action, edit) => {
    setActionErr(null);
    try {
      const updated = await studioService.act(id, item.id, { action, ...(edit ?? {}) });
      merge([updated]);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    }
  };

  const all = useMemo(() => [...items.values()].sort((a, b) => b.t - a.t || b.priority - a.priority), [items]);
  const counts = useMemo(() => {
    const c: Record<StudioStatus, number> = { proposed: 0, approved: 0, rejected: 0, on_air: 0, killed: 0 };
    all.forEach((i) => c[i.status]++);
    return c;
  }, [all]);
  const shown = filter === "all" ? all : all.filter((i) => i.status === filter);

  const moments = useMemo(() => [...state.moments].sort((a, b) => b.t - a.t), [state.moments]);
  const whispers = moments.filter((m) => m.narrative).slice(0, 20);
  const latencies = state.moments.map((m) => m.narrative?.latency_ms).filter((v): v is number => typeof v === "number");
  const lastEvent = state.events[state.events.length - 1];

  const [truthMode, setTruthMode] = useTruthMode();
  const truth = usePoll(() => truthService.report(id, Math.max(1, tRef.current)), 3000, truthMode && state.status === "live", [id]);
  useEffect(() => {
    if (truthMode && state.status !== "live" && state.t > 0) truthService.report(id, Math.max(1, state.t)).then(truth.setData).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truthMode, state.status, id]);
  const plantedFor = useMemo(() => {
    const map = new Map<string, number>();
    const rep = truth.data;
    if (!rep) return map;
    for (const g of rep.grades) {
      const p = rep.plants.find((x) => x.id === g.plant_id);
      if (g.insight_id && p) map.set(g.insight_id, p.minute);
    }
    return map;
  }, [truth.data]);
  const homeColor = match.home.colors.primary;
  const awayColor = match.away.colors.primary;
  const teamMeta = {
    [match.home.team_id]: { short: match.home.short, color: homeColor },
    [match.away.team_id]: { short: match.away.short, color: awayColor },
  };
  const insights = useMemo(() => [...state.insights].sort((a, b) => b.detected_t - a.detected_t), [state.insights]);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <h1 className="display" style={{ fontSize: 28, fontWeight: 800, textTransform: "uppercase" }}>
            🎛 {t("nav.studio")}
          </h1>
          <SourceBadge source={match.source} />
        </div>
        <div className="row">
          <Link to={`/match/${id}`} className="btn sm">
            ← {t("nav.matchday")}
          </Link>
          <a href={`/overlay/${id}?preview=1`} target="_blank" rel="noreferrer" className="btn sm" title="Preview the overlay; in OBS / vMix use /overlay/{id} as a 1920×1080 browser source">
            ↗ Overlay URL
          </a>
        </div>
      </div>

      <ScoreBug
        home={match.home}
        away={match.away}
        score={state.score}
        clockLabel={lastEvent ? clock(lastEvent.minute, lastEvent.added_minute) : "0'"}
        live={state.status === "live"}
        statusLabel={state.status === "live" ? undefined : statusLabel(state, t)}
      />
      <div className="card" style={{ padding: 12 }}>
        <LiveControls {...live} />
        <div className="row" style={{ marginTop: 10, gap: 12 }}>
          <label className="toggle" title="Reveal the hidden planted changes and the Grader's verdicts">
            <input type="checkbox" checked={truthMode} onChange={(e) => setTruthMode(e.target.checked)} />
            {t("truth.mode")}
          </label>
          {truthMode ? <span className="pill truth-pill">◎ {t("truth.mode")}</span> : null}
          <label className="toggle" title={t("verifier.toggleHint")}>
            <input type="checkbox" checked={drill} onChange={(e) => setDrill(e.target.checked)} />
            🛡 {t("verifier.toggle")}
          </label>
          {drill ? <span className="xs muted">{t("verifier.toggleHint")}</span> : null}
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <GovernanceBar matchId={id} />
      </div>

      <GoLivePanel matchId={id} currentT={state.t} homeId={match.home.team_id} awayId={match.away.team_id} />

      {insights.length || truthMode ? (
        <div className={truthMode ? "truth-row" : "truth-row single"}>
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">{t("insight.title")}</h2>
              <span className="spacer" />
              <span className="xs muted">{insights.length}</span>
            </div>
            {insights.length ? (
              <div className="insight-list">
                {insights.slice(0, 4).map((ins) => (
                  <InsightCard
                    key={ins.id}
                    insight={ins}
                    teamName={teamMeta[ins.team_id]?.short}
                    teamColor={teamMeta[ins.team_id]?.color}
                    plantedMinute={truthMode ? plantedFor.get(ins.id) ?? null : null}
                    verdict={truthMode ? (plantedFor.has(ins.id) ? "hit" : truth.data?.false_alarms.some((f) => f.id === ins.id) ? "false_alarm" : null) : null}
                  />
                ))}
              </div>
            ) : (
              <EmptyState icon="📈">{t("insight.empty")}</EmptyState>
            )}
          </section>
          {truthMode ? (
            <section className="card truth-card">
              <div className="card-head">
                <h2 className="card-title">◎ {t("truth.panel")}</h2>
                <span className="spacer" />
                <span className="xs muted">{t("truth.hidden")}</span>
              </div>
              <TruthPanel matchId={id} report={truth.data} t={state.t} ended={state.status === "ended"} teams={teamMeta} error={truth.error} />
            </section>
          ) : null}
        </div>
      ) : null}

      {state.minute >= 46 || state.status === "ended" ? (
        <HalftimePack match={match} events={state.events} minute={state.minute} ended={state.status === "ended"}
          queue={items} onQueued={(it) => merge([it])} />
      ) : null}

      <div className="studio">
        <div className="studio-col">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">{t("studio.queue")}</h2>
              <span className="spacer" />
              <span className="xs muted">{moments.length}</span>
            </div>
            {moments.length ? (
              <div className="queue">
                {moments.map((m) => (
                  <div className="queue-item" key={m.id}>
                    <b className="tnum display" style={{ fontSize: 16 }}>
                      {clock(m.minute, m.added_minute)}
                    </b>
                    <span>
                      <span aria-hidden="true">{MOMENT_ICON[m.type]} </span>
                      {m.title}
                    </span>
                    <span className={cx("importance", importanceTier(m))}>{Math.round(m.importance)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="⏱">Moments queue here as the producer agent detects them.</EmptyState>
            )}
          </section>
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Narrative latency</h2>
            </div>
            <div className="latency">
              <div className="kpi">
                <div className="label">p50</div>
                <div className="value tnum" style={{ fontSize: 24 }}>{latencies.length ? Math.round(median(latencies)) : "–"}</div>
                <div className="sub">ms</div>
              </div>
              <div className="kpi">
                <div className="label">p95</div>
                <div className="value tnum" style={{ fontSize: 24 }}>{latencies.length ? Math.round(percentile(latencies, 95)) : "–"}</div>
                <div className="sub">ms</div>
              </div>
              <div className="kpi">
                <div className="label">n</div>
                <div className="value tnum" style={{ fontSize: 24 }}>{latencies.length}</div>
                <div className="sub">narratives</div>
              </div>
            </div>
            <div className="xs faint" style={{ marginTop: 8 }}>
              Event-to-narrative time, including agent orchestration and fact-checking.
            </div>
          </section>
        </div>

        <section className="card studio-col" style={{ gap: 12 }}>
          <div className="card-head" style={{ marginBottom: 0 }}>
            <h2 className="card-title">{t("studio.graphics")}</h2>
            <span className="spacer" />
            <div className="seg" role="tablist" aria-label="Filter graphics">
              {(["proposed", "approved", "on_air", "all"] as Filter[]).map((f) => (
                <button key={f} role="tab" aria-selected={filter === f} className={cx(filter === f && "on")} onClick={() => setFilter(f)}>
                  {f === "on_air" ? "On air" : f[0].toUpperCase() + f.slice(1)}
                  {f !== "all" ? <span className="faint"> {counts[f as StudioStatus]}</span> : null}
                </button>
              ))}
            </div>
          </div>
          {actionErr ? <div className="xs" style={{ color: "var(--danger)" }}>{actionErr}</div> : null}
          {shown.length ? (
            <div className="gfx-list">
              {shown.map((it) => (
                <GraphicCard key={it.id} item={it} onAction={onAction} />
              ))}
            </div>
          ) : (
            <EmptyState icon="🖼">
              {filter === "proposed"
                ? "The producer agent will propose lower-thirds, stat cards and talking points as moments happen."
                : "Nothing here yet."}
            </EmptyState>
          )}
        </section>

        <div className="studio-col col-right">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">{t("studio.preview")}</h2>
              <span className="spacer" />
              <span className="pill signal">
                <span className="dot live" /> PGM
              </span>
            </div>
            <OverlayPreview matchId={id} />
            <div className="xs faint" style={{ marginTop: 8 }}>
              Transparent 1920×1080 page; add <span className="kbd">/overlay/{id}</span> as a browser source in OBS or vMix.
            </div>
          </section>
          <AuditLog matchId={id} />
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">{t("studio.whisper")}</h2>
            </div>
            {whispers.length ? (
              <div className="whisper" aria-live="polite">
                {whispers.map((m) => (
                  <div className="whisper-line" key={m.id}>
                    <b className="tnum">{clock(m.minute, m.added_minute)}</b> {m.narrative!.text.replace(/\s?\[f\d+\]/g, "")}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="🎙">Analyst one-liners for the commentary box appear here.</EmptyState>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
