import type { CSSProperties } from "react";
import type { Evidence, LiveMoment, Narrative } from "../api/types";
import { MOMENT_ICON, MOMENT_LABEL, clock, cx, importanceTier, pct } from "../lib/format";
import { usePrefs } from "../lib/prefs";
import { AgentTrace } from "./AgentTrace";
import { EngineBadge, FactCheckBadge } from "./FactCheck";
import { ListenButton } from "./ListenButton";
import { CitedText } from "./Markdown";

type Props = {
  moment: LiveMoment;
  narrative?: Narrative;
  teamColor?: string;
  selected?: boolean;
  activeFact?: string | null;
  onEvidence?: (ev: Evidence, momentId: string) => void;
  onSelect?: () => void;
  language: string;
  persona: string;
  onNarrate?: () => void;
  narrating?: boolean;
};

export function MomentCard({ moment, narrative, teamColor, selected, activeFact, onEvidence, onSelect, language, persona, onNarrate, narrating }: Props) {
  const { t } = usePrefs();
  const n = narrative ?? moment.narrative;
  const tier = importanceTier(moment);
  const speakText = n?.text ?? `${moment.title}. ${moment.summary}`;

  return (
    <article
      className={cx("moment", tier === "high" && "high", selected && "selected")}
      style={{ "--team": teamColor } as CSSProperties}
      aria-label={`${clock(moment.minute, moment.added_minute)} ${moment.title}`}
    >
      <div className="moment-head">
        <span className="moment-min tnum">{clock(moment.minute, moment.added_minute)}</span>
        <span aria-hidden="true">{MOMENT_ICON[moment.type] ?? "•"}</span>
        <button
          type="button"
          className="moment-title"
          onClick={onSelect}
          style={{ background: "none", border: 0, padding: 0, textAlign: "start", cursor: onSelect ? "pointer" : "default", color: "inherit", font: "inherit", fontWeight: 700 }}
        >
          {moment.title}
        </button>
        <span className={cx("importance", tier)} title={`Importance ${moment.importance}/100 · confidence ${pct(moment.confidence)}`}>
          {Math.round(moment.importance)}
        </span>
      </div>

      {n ? (
        <p className="moment-text">
          <CitedText
            text={n.text}
            citations={n.citations}
            onCite={(c) => onEvidence?.({ fact_id: c.fact_id, label: c.label, value: c.value, event_ids: c.event_ids }, moment.id)}
          />
        </p>
      ) : null}
      <p className="moment-summary">
        <span className="faint">{MOMENT_LABEL[moment.type]} · </span>
        {moment.summary}
      </p>

      {moment.evidence.length ? (
        <div className="chips" aria-label="Evidence">
          {moment.evidence.slice(0, 6).map((ev) => (
            <button
              type="button"
              key={ev.fact_id}
              className={cx("chip", activeFact === `${moment.id}:${ev.fact_id}` && "on")}
              onClick={() => onEvidence?.(ev, moment.id)}
              title={ev.event_ids?.length ? `Show ${ev.event_ids.length} event(s) on the pitch` : ev.label}
            >
              <span className="fid">{ev.fact_id}</span>
              {ev.label}: <b>{ev.value}{ev.unit ? ` ${ev.unit}` : ""}</b>
            </button>
          ))}
        </div>
      ) : null}

      <div className="row" style={{ gap: 8 }}>
        {n ? <EngineBadge engine={n.engine} ms={n.latency_ms} /> : null}
        {n ? <FactCheckBadge fc={n.fact_check} /> : null}
        {!n && onNarrate ? (
          <button type="button" className="btn sm ghost" onClick={onNarrate} disabled={narrating}>
            ✦ {narrating ? "Writing…" : "Narrate"}
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        <ListenButton small text={speakText} language={n?.language ?? language} persona={persona} />
      </div>

      <details className="disclosure">
        <summary>{t("feed.why")}</summary>
        <p className="small" style={{ margin: "8px 0 0" }}>
          {moment.explanation.why_it_matters}
        </p>
        {moment.explanation.factors.length ? (
          <ul className="factors">
            {moment.explanation.factors.map((f, i) => (
              <li key={i}>
                <span className={cx("impact", f.impact)} aria-label={f.impact}>
                  {f.impact === "positive" ? "+" : f.impact === "negative" ? "−" : "·"}
                </span>
                <span>
                  <b>{f.name}</b> <span className="muted">{f.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {moment.wp_before && moment.wp_after ? (
          <div className="xs muted" style={{ marginTop: 8 }}>
            Win probability (home/draw/away): {pct(moment.wp_before.home)}/{pct(moment.wp_before.draw)}/{pct(moment.wp_before.away)} →{" "}
            <b>
              {pct(moment.wp_after.home)}/{pct(moment.wp_after.draw)}/{pct(moment.wp_after.away)}
            </b>
          </div>
        ) : null}
      </details>

      {n?.agent_trace?.length ? (
        <details className="disclosure">
          <summary>
            {t("feed.trace")} · {n.agent_trace.length} steps
          </summary>
          <AgentTrace steps={n.agent_trace} />
        </details>
      ) : null}
    </article>
  );
}
