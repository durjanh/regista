import type { MatchSource } from "../api/types";
import { sourceUrl } from "../lib/format";

/** "Real result · Synthetic match events" (or What-if) with the full disclosure on click. */
export function SourceBadge({ source, compact }: { source: MatchSource | undefined; compact?: boolean }) {
  if (!source) return null;
  const real = source.kind === "real_result";
  const label = real ? "Real result · Synthetic match events" : "What-if · Synthetic";
  return (
    <details className="source-badge">
      <summary className={real ? "pill real" : "pill warn"} aria-label={`${label}. Show data disclosure`}>
        <span aria-hidden="true">{real ? "◉" : "◌"}</span>
        {compact ? (real ? "Real result" : "What-if") : label}
        <span aria-hidden="true" className="faint">ⓘ</span>
      </summary>
      <div className="source-pop" role="note">
        <strong>{label}</strong>
        <p>{source.disclosure}</p>
        <div className="xs faint">
          Dataset: {source.dataset.name} · {source.dataset.licence} ·{" "}
          <a href={sourceUrl(source.dataset.source)} target="_blank" rel="noreferrer" className="team-link">
            source
          </a>
        </div>
      </div>
    </details>
  );
}

export function RealTag({ title = "Real fact from the CC0 international results dataset" }: { title?: string }) {
  return (
    <span className="real-tag" title={title}>
      REAL
    </span>
  );
}

/** MODEL: a number produced by Regista's synthetic events (sides, feet, placements, dives, distance, passing). */
export function ModelTag({ title = "Modelled from Regista's synthetic match events, not from real-world tracking" }: { title?: string }) {
  return (
    <span className="model-tag" title={title}>
      MODEL
    </span>
  );
}

/** Small ⓘ popover holding a disclosure string. */
export function InfoPop({ text, label = "About this data" }: { text: string | undefined; label?: string }) {
  if (!text) return null;
  return (
    <details className="source-badge info-pop">
      <summary className="info-dot" aria-label={label} title={label}>
        ⓘ
      </summary>
      <div className="source-pop" role="note">
        <strong>{label}</strong>
        <p>{text}</p>
      </div>
    </details>
  );
}
