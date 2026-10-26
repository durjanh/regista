import { Link } from "react-router-dom";
import type { TeamRef } from "../api/types";
import { cx } from "../lib/format";

/** Team identity as a colour swatch: no crests, flags or logos. */
export function TeamSwatch({ team, size = "md" }: { team: Pick<TeamRef, "colors" | "name"> | undefined; size?: "sm" | "md" | "lg" }) {
  const primary = team?.colors.primary ?? "var(--surface-3)";
  const secondary = team?.colors.secondary ?? "var(--surface-3)";
  return (
    <span
      className={cx("swatch-team", size)}
      style={{ background: `linear-gradient(90deg, ${primary} 0 62%, ${secondary} 62% 100%)` }}
      aria-hidden="true"
      title={team?.name}
    />
  );
}

/** Team name linking to its Team DNA page. */
export function TeamLink({ team, className, short }: { team: Pick<TeamRef, "team_id" | "name" | "short">; className?: string; short?: boolean }) {
  return (
    <Link to={`/team/${encodeURIComponent(team.team_id)}`} className={cx("team-link", className)} title={`${team.name}: Team DNA`}>
      {short ? team.short : team.name}
    </Link>
  );
}
