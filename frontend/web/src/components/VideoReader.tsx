import { useEffect, useMemo, useRef, useState } from "react";
import { videoService } from "../api";
import { quietly } from "../lib/activity";
import type { VideoRead, VideoTeams } from "../api/types";
import { BATCH, COUNTED, grabFrame, sampleTimes, tally, teamLabel, type Side } from "../lib/videoRead";
import { ErrorState } from "./States";

const ROWS: { type: (typeof COUNTED)[number]; label: string }[] = [
  { type: "pass", label: "Passes" }, { type: "shot", label: "Shots" }, { type: "goal", label: "Goals" },
  { type: "save", label: "Saves" }, { type: "tackle", label: "Tackles" }, { type: "foul", label: "Fouls" },
  { type: "corner", label: "Corners" }, { type: "free_kick", label: "Free kicks" }, { type: "throw_in", label: "Throw-ins" },
  { type: "card", label: "Cards" },
];
const SIDE_COLOUR: Record<Side, string> = { a: "var(--accent)", b: "var(--warn)" };

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * Any football clip read by the reasoning model: about one frame a second, sent in batches of eight, the figures
 * filling in as each batch comes back. Counts are the model's reading of the pictures; nothing is measured or graded.
 */
export function VideoReader({ src, name, onSeek }: { src: string; name: string; onSeek?: (t: number) => void }) {
  const sampler = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stop = useRef(false);
  const [reads, setReads] = useState<VideoRead[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeAt, setResumeAt] = useState(0);
  const sum = useMemo(() => tally(reads), [reads]);

  // A new clip starts a new reading.
  useEffect(() => {
    stop.current = true;
    setReads([]);
    setProgress(null);
    setError(null);
    setResumeAt(0);
  }, [src]);

  const run = async (from: number, prior: VideoRead[]) => {
    const v = sampler.current;
    if (!v) return;
    if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
    canvas.current ??= document.createElement("canvas");
    const times = sampleTimes(v.duration);
    stop.current = false;
    setBusy(true);
    setError(null);
    let teams: VideoTeams | undefined = prior.length ? prior[prior.length - 1].teams : undefined;
    let i = from;
    try {
      for (; i < times.length && !stop.current; i += BATCH) {
        const frames: { t: number; image: string }[] = [];
        for (const t of times.slice(i, i + BATCH)) frames.push({ t, image: await grabFrame(v, t, canvas.current) });
        if (stop.current) break;
        // The panel shows its own progress, so the page-wide indicator stays out of these long calls.
        const read = await quietly(() => videoService.read(frames, teams));
        teams = read.teams;
        setReads((r) => [...r, read]);
        setProgress({ done: Math.min(i + BATCH, times.length), total: times.length });
      }
      setResumeAt(i >= times.length ? 0 : i);
    } catch (e) {
      setResumeAt(i);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    setReads([]);
    setProgress(null);
    void run(0, []);
  };
  const side = (s: Side) => teamLabel(sum.teams, s);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const finished = progress && progress.done >= progress.total;

  return (
    <section className="card video-read" aria-label="AI video read">
      {/* A second, hidden copy of the clip to sample from, so the player above keeps its place. */}
      <video ref={sampler} src={src} muted playsInline preload="auto" className="sr-only" aria-hidden="true" tabIndex={-1} />
      <div className="card-head">
        <h2 className="card-title">AI video read</h2>
        <span className="pill warn" title="The reasoning model's reading of the frames: not measured, not checked against an event record">
          AI-read · not verified
        </span>
        <span className="spacer" />
        {busy ? (
          <button className="btn sm" onClick={() => { stop.current = true; }} aria-busy="true">Stop</button>
        ) : (
          <button className="btn sm primary" onClick={() => (error && resumeAt ? run(resumeAt, reads) : start())}>
            {error && resumeAt ? "Resume reading" : reads.length ? "Read again" : "Read with AI (gpt-5.5)"}
          </button>
        )}
      </div>
      <p className="small muted max-70ch">
        Works on any football clip, <i>{name}</i> included. The reasoning model (gpt-5.5) looks at about one frame a
        second and reports what it sees: who has the ball, where, and each pass, shot, tackle, foul and set piece, with the
        on-screen score. These are its reading of the pictures, not measurements, and there is no event record to check
        them against.
      </p>

      {progress ? (
        <div className="row gap-8 small mb-10" role="status">
          <div className="bar-track grow" style={{ background: "var(--surface-3)", borderRadius: 99 }}>
            <span style={{ display: "block", height: "100%", width: pct(progress.done / progress.total), background: "var(--accent)", borderRadius: 99 }} />
          </div>
          <span className="tnum muted">{finished ? "Done" : busy ? "Reading" : "Stopped"} · {progress.done}/{progress.total} frames</span>
        </div>
      ) : busy ? (
        <div className="small muted mb-10" role="status">
          <span className="spinner-inline" aria-hidden="true" /> gpt-5.5 is reading the first 8 frames: the figures below fill in as each batch comes back.
        </div>
      ) : null}
      {busy && progress && !finished ? (
        <div className="xs muted mb-10">gpt-5.5 is reading the next batch; each one takes a few seconds.</div>
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => void run(resumeAt, reads)} /> : null}

      {reads.length ? (
        <div className="stack gap-12">
          <div>
            <div className="row gap-8 xs muted mb-6">
              <span className="swatch" style={{ background: SIDE_COLOUR.a }} /> <b>{side("a")}</b>
              <span className="grow" />
              <b>{side("b")}</b> <span className="swatch" style={{ background: SIDE_COLOUR.b }} />
            </div>
            {sum.possession ? (
              <>
                <div className="row bar-track" style={{ borderRadius: 99 }} aria-label={`Possession ${pct(sum.possession.a)} to ${pct(sum.possession.b)}`}>
                  <span style={{ width: pct(sum.possession.a), height: "100%", background: SIDE_COLOUR.a }} />
                  <span style={{ width: pct(sum.possession.b), height: "100%", background: SIDE_COLOUR.b }} />
                </div>
                <div className="row xs mt-6">
                  <span className="tnum">{pct(sum.possession.a)}</span>
                  <span className="grow text-center muted">Possession · from {sum.live} live frames of {sum.frames}</span>
                  <span className="tnum">{pct(sum.possession.b)}</span>
                </div>
              </>
            ) : (
              <div className="xs muted">No live play with a clear team on the ball yet.</div>
            )}
          </div>

          <table className="table small">
            <thead>
              <tr><th className="tnum">{side("a")}</th><th /><th className="tnum">{side("b")}</th></tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.type}>
                  <td className="tnum">{sum.counts.a[r.type] ?? 0}</td>
                  <td className="muted text-center">{r.label}</td>
                  <td className="tnum">{sum.counts.b[r.type] ?? 0}</td>
                </tr>
              ))}
              <tr>
                <td className="tnum">{pct(sum.zones.a.attacking_third / Math.max(1, sum.zones.a.attacking_third + sum.zones.a.middle_third + sum.zones.a.defensive_third))}</td>
                <td className="muted text-center">On the ball in the attacking third</td>
                <td className="tnum">{pct(sum.zones.b.attacking_third / Math.max(1, sum.zones.b.attacking_third + sum.zones.b.middle_third + sum.zones.b.defensive_third))}</td>
              </tr>
            </tbody>
          </table>

          {sum.scoreboard ? (
            <div className="small">On-screen score: <b className="tnum">{sum.scoreboard.text}</b> <span className="muted">at {mmss(sum.scoreboard.t)} in the clip</span></div>
          ) : null}

          {sum.summaries.length ? (
            <div className="note" aria-live="polite">
              <span className="ai-badge">✦ Azure AI · gpt-5.5</span>
              <div className="mt-4">{sum.summaries[sum.summaries.length - 1].text}</div>
            </div>
          ) : null}

          {sum.events.length ? (
            <div>
              <div className="card-title mb-6">Timeline · {sum.events.length} moments</div>
              <ul className="autoevent-list">
                {sum.events.map((e, i) => (
                  <li key={`${e.t}-${e.type}-${i}`}>
                    <button className="btn sm ghost tnum mono" onClick={() => onSeek?.(e.t)} title="Show this moment in the clip">{mmss(e.t)}</button>
                    <span className="swatch" style={{ background: e.team ? SIDE_COLOUR[e.team] : "var(--text-faint)" }} />
                    <span>
                      <b>{e.type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}</b>{e.team ? ` · ${side(e.team)}` : ""}
                      <div className="xs muted">{e.description}</div>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
