import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { sourceUrl } from "../lib/format";
import { RealTag } from "./SourceBadge";
import { Skeleton } from "./States";

/** Headline numbers of the real CC0 dataset that grounds every match. */
export function ReferenceStrip() {
  const { data, error } = useAsync(() => api.referenceSummary(), []);
  if (error) return null;
  if (!data)
    return (
      <div className="ref-strip">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} h={64} />
        ))}
      </div>
    );
  const years = `${data.first_date.slice(0, 4)}–${data.last_date.slice(0, 4)}`;
  const items: [string, string][] = [
    ["Real results", data.matches.toLocaleString()],
    ["Years", years],
    ["National teams", data.teams.toLocaleString()],
    ["Goals recorded", data.goals_recorded.toLocaleString()],
    ["Shoot-outs", data.shootouts.toLocaleString()],
  ];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="ref-strip">
        {items.map(([label, value]) => (
          <div className="kpi" key={label}>
            <div className="label">
              {label} <RealTag />
            </div>
            <div className="value tnum">{value}</div>
          </div>
        ))}
      </div>
      <div className="xs faint">
        Source:{" "}
        <a className="team-link" href={sourceUrl(data.source)} target="_blank" rel="noreferrer">
          {data.source}
        </a>{" "}
        · {data.licence}
      </div>
    </div>
  );
}
