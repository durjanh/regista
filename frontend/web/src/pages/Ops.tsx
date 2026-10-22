import { Link } from "react-router-dom";
import { systemService } from "../api";
import type { Ops as OpsT } from "../api/types";
import { EmptyState, ErrorState, Skeleton } from "../components/States";
import { usePrefs } from "../lib/prefs";
import { usePoll } from "../lib/truth";

function uptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`;
}

/** Production view: latency SLO for live narratives and the model cost of covering a match. */
export function Ops() {
  const { t } = usePrefs();
  const { data, error } = usePoll<OpsT>(() => systemService.ops(), 5000, true);

  if (error && !data) return <ErrorState message={error} />;
  if (!data) return <Skeleton h={420} />;

  const { slo, cost } = data;
  const sloState = slo.compliant === null ? "pill" : slo.compliant ? "pill accent" : "pill danger";
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 className="display" style={{ fontSize: 28, fontWeight: 800, textTransform: "uppercase" }}>📟 {t("ops.title")}</h1>
        <div className="row" style={{ gap: 8 }}>
          <span className={data.mode === "azure" ? "pill accent" : "pill warn"}>
            <span className="dot" /> {data.mode === "azure" ? t("engine.azure") : t("engine.offline")}
          </span>
          <span className="pill">up {uptime(data.uptime_s)}</span>
        </div>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("ops.slo")}</h2>
            <span className="spacer" />
            <span className={sloState}>
              {slo.compliant === null ? "No samples yet" : slo.compliant ? "✔ Within SLO" : "✖ Breaching SLO"}
            </span>
          </div>
          <div className="kpis" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            <div className="kpi">
              <div className="label">Target p95</div>
              <div className="value tnum">{slo.target_p95_ms}</div>
              <div className="sub">ms</div>
            </div>
            <div className="kpi">
              <div className="label">p50</div>
              <div className="value tnum">{slo.p50_ms ?? "–"}</div>
              <div className="sub">ms</div>
            </div>
            <div className="kpi">
              <div className="label">p95</div>
              <div className="value tnum" style={{ color: slo.compliant === false ? "var(--danger)" : undefined }}>{slo.p95_ms ?? "–"}</div>
              <div className="sub">ms</div>
            </div>
            <div className="kpi">
              <div className="label">Samples</div>
              <div className="value tnum">{slo.samples}</div>
              <div className="sub">narratives</div>
            </div>
          </div>
          {slo.p95_ms !== null ? (
            <div className="slo-track" role="img" aria-label={`p95 ${slo.p95_ms} ms against a ${slo.target_p95_ms} ms target`}>
              <span style={{ width: `${Math.min(100, (slo.p95_ms / Math.max(1, slo.target_p95_ms)) * 100)}%`, background: slo.compliant ? "var(--accent)" : "var(--danger)" }} />
              <i style={{ left: "100%" }} />
            </div>
          ) : null}
          <div className="xs faint" style={{ marginTop: 8 }}>
            Event-to-narrative latency, including agent orchestration, fact-checking and content safety. Data-only graphics fire instantly; AI text follows.
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("ops.cost")}</h2>
          </div>
          <div className="kpis" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            <div className="kpi">
              <div className="label">Model calls</div>
              <div className="value tnum">{cost.model_calls}</div>
            </div>
            <div className="kpi">
              <div className="label">Input tokens</div>
              <div className="value tnum">{cost.input_tokens.toLocaleString()}</div>
            </div>
            <div className="kpi">
              <div className="label">Output tokens</div>
              <div className="value tnum">{cost.output_tokens.toLocaleString()}</div>
            </div>
            <div className="kpi">
              <div className="label">Est. cost</div>
              <div className="value tnum">${cost.est_cost_usd.toFixed(3)}</div>
            </div>
          </div>
          {cost.per_match.length ? (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Model calls</th>
                    <th>Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {cost.per_match.map((m) => (
                    <tr key={m.match_id}>
                      <td>
                        <Link to={`/match/${m.match_id}`} className="team-link">{m.match_id}</Link>
                      </td>
                      <td className="tnum">{m.model_calls}</td>
                      <td className="tnum">${m.est_cost_usd.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="💷">No model calls yet{data.mode === "offline" ? " (the offline engine costs nothing)" : ""}.</EmptyState>
          )}
          <div className="xs faint" style={{ marginTop: 8 }}>{cost.price_note}</div>
        </section>
      </div>
    </div>
  );
}
