import type { TeamStats } from "../api/types";

type Row = { label: string; key: keyof TeamStats; fmt?: (v: number) => string; lowerIsBetter?: boolean };

const ROWS: Row[] = [
  { label: "Possession", key: "possession", fmt: (v) => `${Math.round(v * 100)}%` },
  { label: "Expected goals (xG)", key: "xg", fmt: (v) => v.toFixed(2) },
  { label: "Shots", key: "shots" },
  { label: "On target", key: "shots_on_target" },
  { label: "Big chances", key: "big_chances" },
  { label: "Expected threat (xT)", key: "xt", fmt: (v) => v.toFixed(2) },
  { label: "Passes", key: "passes" },
  { label: "Pass completion", key: "pass_completion", fmt: (v) => `${Math.round(v * 100)}%` },
  { label: "Final-third entries", key: "final_third_entries" },
  { label: "Field tilt", key: "field_tilt", fmt: (v) => `${Math.round(v * 100)}%` },
  { label: "PPDA (lower = more pressing)", key: "ppda", fmt: (v) => v.toFixed(1), lowerIsBetter: true },
  { label: "Corners", key: "corners" },
  { label: "Fouls", key: "fouls" },
];

export function StatBars({
  home, away, homeColor, awayColor, compact,
}: { home: TeamStats; away: TeamStats; homeColor: string; awayColor: string; compact?: boolean }) {
  const rows = compact ? ROWS.slice(0, 7) : ROWS;
  return (
    <div className="statbars">
      {rows.map((r) => {
        const hv = Number(home[r.key]) || 0;
        const av = Number(away[r.key]) || 0;
        let hShare: number;
        let aShare: number;
        if (r.lowerIsBetter) {
          // invert so the more aggressive presser gets the longer bar
          const hi = hv > 0 ? 1 / hv : 0;
          const ai = av > 0 ? 1 / av : 0;
          const tot = hi + ai || 1;
          hShare = hi / tot;
          aShare = ai / tot;
        } else {
          const tot = hv + av || 1;
          hShare = hv / tot;
          aShare = av / tot;
        }
        const fmt = r.fmt ?? ((v: number) => String(Math.round(v)));
        return (
          <div className="statbar-row" key={r.key}>
            <span className="v">{fmt(hv)}</span>
            <div className="statbar-mid">
              <span className="statbar-label">{r.label}</span>
              <div className="statbar-track" aria-hidden="true">
                <div>
                  <span style={{ width: `${hShare * 100}%`, background: homeColor, opacity: hShare >= aShare ? 1 : 0.55 }} />
                </div>
                <div>
                  <span style={{ width: `${aShare * 100}%`, background: awayColor, opacity: aShare >= hShare ? 1 : 0.55 }} />
                </div>
              </div>
            </div>
            <span className="v r">{fmt(av)}</span>
          </div>
        );
      })}
    </div>
  );
}
