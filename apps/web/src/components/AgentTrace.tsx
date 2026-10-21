import type { AgentStep } from "../api/types";

/** Waterfall of the agents that produced a piece of content, laid out sequentially. */
export function AgentTrace({ steps }: { steps: AgentStep[] }) {
  if (!steps?.length) return <div className="xs faint">No agent steps recorded.</div>;
  const total = steps.reduce((s, x) => s + Math.max(0, x.ms), 0) || 1;
  let offset = 0;
  return (
    <div className="trace">
      {steps.map((s, i) => {
        const left = (offset / total) * 100;
        const width = Math.max(1.5, (Math.max(0, s.ms) / total) * 100);
        offset += Math.max(0, s.ms);
        return (
          <div className="trace-row" key={`${s.agent}-${i}`}>
            <span className="agent" title={s.agent}>
              {s.agent}
            </span>
            <div className="trace-bar" aria-hidden="true">
              <span style={{ left: `${left}%`, width: `${width}%` }} />
            </div>
            <span className="ms">{Math.round(s.ms)} ms</span>
            <span className="action">
              {s.action}
              {s.detail ? ` — ${s.detail}` : ""}
            </span>
          </div>
        );
      })}
      <div className="xs faint" style={{ textAlign: "end" }}>
        Total {Math.round(total)} ms
      </div>
    </div>
  );
}
