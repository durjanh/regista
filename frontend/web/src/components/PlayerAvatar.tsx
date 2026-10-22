import type { CSSProperties } from "react";
import type { TeamRef } from "../api/types";
import { readableOn } from "../lib/format";

/** Initials ("Lionel Messi" -> "LM"), or the shirt number for players the dataset doesn't name ("Argentina No. 18" -> "18"). */
export function initials(name: string): string {
  const numbered = name.match(/ No\. (\d+)$/);
  if (numbered) return numbered[1];
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/**
 * A player's avatar: initials in the team's kit colours (primary fill, secondary ring). Generated, never a photo:
 * player photos are copyrighted and players have image rights, so Regista shows none. Decorative; the name is always
 * written next to it.
 */
export function PlayerAvatar({ name, colors, size = 32, square }: {
  name: string;
  colors?: TeamRef["colors"];
  size?: number;
  /** Rounded square for page headers; circle elsewhere. */
  square?: boolean;
}) {
  const fill = colors?.primary ?? "var(--surface-3)";
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.4),
    borderRadius: square ? Math.round(size * 0.28) : "50%",
    background: fill,
    color: colors ? readableOn(colors.primary) : "var(--text)",
    boxShadow: `0 0 0 ${Math.max(2, Math.round(size / 20))}px ${colors?.secondary ?? "var(--border-strong)"}`,
  } satisfies CSSProperties;
  return (
    <span className="player-avatar" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
