import type { LiveState } from "../hooks/useLiveMatch";
import { usePrefs } from "../lib/prefs";
import { cx } from "../lib/format";
import { IconPause, IconPlay, IconRestart, IconToEnd } from "./icons";

const SPEEDS = [10, 30, 60, 120];
/** Jump points on the match clock; 58' sits just before the showcase match's planted press. */
const JUMPS = [1, 30, 46, 58, 70, 80];

type Props = {
  state: LiveState;
  speed: number;
  play: () => void;
  pause: () => void;
  restart: () => void;
  setSpeed: (n: number) => void;
  jumpToEnd: () => void;
  seekMinute?: (minute: number) => void;
};

export function statusLabel(state: LiveState, t: ReturnType<typeof usePrefs>["t"]): string {
  switch (state.status) {
    case "connecting":
      return t("live.connecting");
    case "live":
      return t("live.live");
    case "paused":
      return t("live.paused");
    case "ended":
      return t("live.ended");
    case "error":
      return t("live.error");
    default:
      return "";
  }
}

export function LiveControls({ state, speed, play, pause, restart, setSpeed, jumpToEnd, seekMinute }: Props) {
  const { t } = usePrefs();
  const running = state.status === "live" || state.status === "connecting";
  const duration = state.meta?.duration_s ?? 5700;
  const progress = Math.min(1, state.t / duration);
  const pillClass =
    state.status === "live" ? "pill signal" : state.status === "error" ? "pill danger" : state.status === "ended" ? "pill accent" : "pill";

  return (
    <div className="controls" role="toolbar" aria-label="Replay controls">
      {running ? (
        <button className="btn" onClick={pause} aria-label={t("live.pause")}>
          <IconPause /> <span className="hide-sm">{t("live.pause")}</span>
        </button>
      ) : (
        <button className="btn primary" onClick={state.status === "ended" ? restart : play} aria-label={state.status === "error" ? t("live.resume") : t("live.play")}>
          <IconPlay /> <span className="hide-sm">{state.status === "error" ? t("live.resume") : state.status === "ended" ? t("live.restart") : t("live.play")}</span>
        </button>
      )}
      <button className="btn ghost" onClick={restart} aria-label={t("live.restart")} title={t("live.restart")}>
        <IconRestart />
      </button>
      <div className="seg" role="group" aria-label={t("live.speed")}>
        {SPEEDS.map((s) => (
          <button key={s} className={cx(speed === s && "on")} onClick={() => setSpeed(s)} aria-pressed={speed === s}>
            {s}×
          </button>
        ))}
      </div>
      {seekMinute ? (
        <select className="select" value="" aria-label={t("live.jump")} title={t("live.jump")}
          onChange={(e) => e.target.value && seekMinute(Number(e.target.value))}>
          <option value="">⤼ {t("live.jump")}</option>
          {JUMPS.map((m) => (
            <option key={m} value={m}>{m === 1 ? t("live.kickoff") : m === 46 ? t("live.secondHalf") : `${m}:00`}</option>
          ))}
        </select>
      ) : null}
      <button className="btn ghost sm hide-sm" onClick={jumpToEnd} disabled={state.status === "ended"}>
        <IconToEnd /> {t("live.toEnd")}
      </button>
      <div className="progress" aria-label={`Match progress ${Math.round(progress * 100)}%`} role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <span className={pillClass}>
        {state.status === "live" ? <span className="dot live" /> : null}
        {statusLabel(state, t)}
      </span>
    </div>
  );
}
