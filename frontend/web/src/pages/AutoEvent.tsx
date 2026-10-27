import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchService } from "../api";
import type { MatchEvent, MatchMeta } from "../api/types";
import { useMatch } from "../components/Layout";
import { ModelTag } from "../components/SourceBadge";
import { EmptyState, Skeleton } from "../components/States";
import { VideoReader } from "../components/VideoReader";
import { IconPause, IconPlay } from "../components/icons";
import { useLiveMatch } from "../hooks/useLiveMatch";
import { ANALYSIS, BallTracker, clipName, findBall, grade, hiVisBall, parseClipName, readTimecode, teamAt, unproject, worldToHome, FEED_BALL_RADIUS,
  type Detection, type Frame } from "../lib/autoEvent";
import { clock, cx, teamColor } from "../lib/format";
import { BIBS, matchKits } from "../lib/kits";
import { usePrefs } from "../lib/prefs";
import { webglAvailable } from "../lib/webgl";
import { lazyPage } from "../lib/lazyPage";
import { venueStyle } from "../lib/venue";

const Pitch3D = lazyPage(() => import("../components/Pitch3D").then((m) => ({ default: m.Pitch3D })));

const STARTS = [1, 20, 46, 60, 75];
const EVERY_MS = 66;                                                     // ~15 analysed frames a second

/** The colours the detector uses: the hi-vis ball, and each team's shirt (and stripe) to tell passer and receiver. */
function palette(match: MatchMeta) {
  const { home, away } = matchKits(match.home, match.away);                     // the kits the feed actually shows
  const avoid = [home.shirt, home.shorts, home.socks, away.shirt, away.shorts, away.socks, "#f5c518", "#22c55e", "#ffffff", "#c9a27e", "#8d5a3b", BIBS.home, BIBS.away];
  if (home.stripe) avoid.push(home.stripe);
  if (away.stripe) avoid.push(away.stripe);
  return {
    ball: hiVisBall(avoid),
    kits: { home: [home.shirt, ...(home.stripe ? [home.stripe] : [])], away: [away.shirt, ...(away.stripe ? [away.stripe] : [])] },
  };
}

/** Reads frames (from the live feed or an uploaded clip), tracks the ball and collects detections. */
function useDetector(ballColour: string, kits: { home: string[]; away: string[] }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const tracker = useRef(new BallTracker());
  const lastAt = useRef(0);
  const lastBall = useRef<[number, number] | undefined>(undefined);
  const passer = useRef<"home" | "away" | null>(null);
  const restCount = useRef(0);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [seen, setSeen] = useState<[number, number] | null>(null);                 // match seconds analysed
  const [ballFound, setBallFound] = useState(0);
  const [frames, setFrames] = useState({ read: 0, clocked: 0 });                  // clocked: carried the feed's timecode

  const reset = useCallback(() => {
    tracker.current = new BallTracker();
    lastBall.current = undefined;
    setDetections([]);
    setSeen(null);
    setBallFound(0);
    setFrames({ read: 0, clocked: 0 });
  }, []);

  /** Analyse one frame shown at match second `t` (throttled to ~15 a second). */
  const analyse = useCallback((source: CanvasImageSource, fallbackT: number) => {
    let t = fallbackT;
    const now = performance.now();
    if (now - lastAt.current < EVERY_MS) return;
    lastAt.current = now;
    if (!canvas.current) {
      canvas.current = document.createElement("canvas");
      canvas.current.width = ANALYSIS.width;
      canvas.current.height = ANALYSIS.height;
    }
    const ctx = canvas.current.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0, ANALYSIS.width, ANALYSIS.height);
    const img = ctx.getImageData(0, 0, ANALYSIS.width, ANALYSIS.height);
    const frame: Frame = { data: img.data, width: img.width, height: img.height };
    const stamped = readTimecode(frame);
    t = stamped ?? t;                                                                 // the frame's own clock when it has one
    setFrames((f) => ({ read: f.read + 1, clocked: f.clocked + (stamped === null ? 0 : 1) }));
    setSeen((s) => (s ? [s[0], t] : [t, t]));
    const px = findBall(frame, ballColour, lastBall.current);
    if (!px) return;
    lastBall.current = px;
    setBallFound((n) => n + 1);
    const spot = worldToHome(unproject(px[0], px[1], FEED_BALL_RADIUS));
    // Who has the ball while it rests: the kit at that spot (checked every few frames, it's the costly bit).
    if (!tracker.current.moving && restCount.current++ % 3 === 0) passer.current = teamAt(frame, spot, kits) ?? passer.current;
    const done = tracker.current.push(t, spot);
    if (done) {
      const receiver = teamAt(frame, done.to, kits);
      setDetections((d) => [...d, { ...done, passer: passer.current, receiver }]);
      passer.current = receiver;
    }
  }, [ballColour, kits]);

  return { analyse, detections, seen, ballFound, frames, reset };
}

function pct(v: number | null) {
  return v === null ? "-" : `${Math.round(v * 100)}%`;
}
function num(v: number | null, unit: string, digits = 1) {
  return v === null ? "-" : `${v.toFixed(digits)} ${unit}`;
}

/**
 * Auto-eventing: Regista renders its own broadcast feed and a computer-vision pass reads the frames, without the event
 * data, to find passes and shots and measure distance and speed; every detection is graded against what happened.
 * The same detector runs on an uploaded recording of the feed.
 */
export function AutoEvent() {
  const match = useMatch();
  const { persona, language } = usePrefs();
  const { ball, kits } = useMemo(() => palette(match), [match]);
  const venue = useMemo(() => venueStyle(match), [match]);
  // Real time, waiting up to 8 s between events, so the ball moves at its true speed (dead time is still squeezed).
  const live = useLiveMatch(match.match_id, { persona, language, initialSpeed: 1, autoplay: false, maxGap: 8 });
  const det = useDetector(ball, kits);
  const can3d = useMemo(() => webglAvailable(), []);
  const [mode, setMode] = useState<"live" | "clip">("live");

  // Match clock for the live feed: it runs in real time, so the last event's time plus the seconds since it arrived.
  const clockRef = useRef({ t: 0, at: performance.now() });
  const lastId = useRef("");
  const last = live.state.events[live.state.events.length - 1];
  useEffect(() => {
    if (last && last.id !== lastId.current) {
      lastId.current = last.id;
      clockRef.current = { t: last.t, at: performance.now() };
    }
  }, [last]);
  const matchClock = useCallback(() => clockRef.current.t + (performance.now() - clockRef.current.at) / 1000, []);
  const feedCanvas = useRef<HTMLCanvasElement | null>(null);
  const onFrame = useCallback((c: HTMLCanvasElement) => {
    feedCanvas.current = c;
    if (live.state.status !== "live") return;
    det.analyse(c, matchClock());
  }, [det, live.state.status]);

  // Recording the feed as a clip whose name says which match and minute it starts at, so an upload can be graded.
  const recorder = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState<{ start: number } | null>(null);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const record = () => {
    const c = feedCanvas.current;
    if (!c || typeof MediaRecorder === "undefined") return;
    const start = clockRef.current.t + (performance.now() - clockRef.current.at) / 1000;
    const chunks: Blob[] = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const r = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => setDownload({ url: URL.createObjectURL(new Blob(chunks, { type: "video/webm" })), name: clipName(match.match_id, start) });
    r.start(1000);
    recorder.current = r;
    setRecording({ start });
  };
  const stopRecording = () => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(null);
  };

  // Uploaded clip: the same detector on the video's frames; graded when its name says which match and minute.
  const video = useRef<HTMLVideoElement>(null);
  const [clip, setClip] = useState<{ url: string; name: string; matchId?: string; t: number } | null>(null);
  const [clipTruth, setClipTruth] = useState<MatchEvent[]>([]);
  const upload = (file: File) => {
    const info = parseClipName(file.name);
    live.pause();
    det.reset();
    setMode("clip");
    setClip({ url: URL.createObjectURL(file), name: file.name, matchId: info?.matchId, t: info?.t ?? 0 });
    setClipTruth([]);
    if (info?.matchId === match.match_id) void matchService.events(info.matchId).then(setClipTruth).catch(() => setClipTruth([]));
  };
  useEffect(() => {
    const v = video.current;
    if (mode !== "clip" || !v || !clip) return;
    let handle = 0;
    const tick = () => {
      if (!v.paused && !v.ended) det.analyse(v, clip.t + v.currentTime);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [mode, clip, det]);

  const truth = mode === "live" ? live.state.events : clipTruth;
  // About three seconds of an uploaded clip with neither the feed's timecode nor its ball: not footage this detector reads.
  const notFeed = mode === "clip" && det.frames.read >= 45 && det.frames.clocked === 0 && det.ballFound === 0;
  const window: [number, number] | null = det.seen ? [det.seen[0] + 1, det.seen[1] - 3] : null;
  const { graded, score } = useMemo(() => grade(det.detections, truth, match.home.team_id, window),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [det.detections, truth, match.home.team_id, det.seen?.[0], Math.floor((det.seen?.[1] ?? 0) / 2)]);
  const side = (s: "home" | "away" | null) => (s === "home" ? match.home.short : s === "away" ? match.away.short : "?");
  const colour = (s: "home" | "away" | null) => (s === "home" ? teamColor(match.home) : s === "away" ? teamColor(match.away) : "var(--text-faint)");

  const start = (minute: number) => {
    setMode("live");
    det.reset();
    void live.seekMinute(minute);
  };

  return (
    <div className="stack gap-16">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Auto-eventing from the broadcast feed</h2>
          <ModelTag title="Computer vision over Regista's synthetic broadcast feed; graded against the event stream" />
        </div>
        <p className="small muted max-70ch">
          Regista renders its own broadcast feed, in real time, from a fixed calibrated camera. A computer-vision pass reads
          only the frames: it finds the ball by colour and shape, maps it onto the pitch with the camera's calibration,
          tracks it, cuts the track into passes and shots, measures distance and speed, and tells the teams apart by their
          kits. It never sees the event data. Every detection is then checked against what actually happened.
        </p>
      </section>

      <div className="autoevent">
        <section className="card p-12">
          <div className="row gap-8 wrap mb-10">
            <div className="seg" role="group" aria-label="Source">
              <button className={cx(mode === "live" && "on")} aria-pressed={mode === "live"} onClick={() => setMode("live")}>Live feed</button>
              <button className={cx(mode === "clip" && "on")} aria-pressed={mode === "clip"} onClick={() => clip && setMode("clip")} disabled={!clip}>Uploaded clip</button>
            </div>
            {mode === "live" ? (
              <>
                <label className="row gap-6 small">
                  <span className="muted">Start at</span>
                  <select className="select" aria-label="Start at" defaultValue="" onChange={(e) => e.target.value && start(Number(e.target.value))}>
                    <option value="">Choose…</option>
                    {STARTS.map((m) => <option key={m} value={m}>{m}'</option>)}
                  </select>
                </label>
                {live.state.status === "live" ? (
                  <button className="btn sm" onClick={live.pause}><IconPause /> Pause</button>
                ) : (
                  <button className="btn sm primary" onClick={() => (live.state.t ? live.play() : start(STARTS[3]))}><IconPlay /> Play</button>
                )}
                <span className="xs muted tnum">{live.state.status === "live" ? `${clock(live.state.minute ?? 0)} · real time` : "paused"}</span>
                <span className="grow" />
                {recording ? (
                  <button className="btn sm danger" onClick={stopRecording}>■ Stop recording</button>
                ) : (
                  <button className="btn sm" onClick={record} disabled={live.state.status !== "live" || typeof MediaRecorder === "undefined"}>● Record clip</button>
                )}
              </>
            ) : null}
            <label className="btn sm">
              ⬆ Upload clip
              <input type="file" accept="video/*" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          </div>
          {download ? (
            <p className="xs mb-8">
              Clip ready: <a className="team-link" href={download.url} download={download.name}>{download.name}</a>. Upload it here to
              auto-event it again from the file.
            </p>
          ) : null}
          {mode === "live" ? (
            can3d ? (
              <Suspense fallback={<Skeleton h={360} />}>
                <Pitch3D events={live.state.events} home={match.home} away={match.away} homeColor={teamColor(match.home)}
                  awayColor={teamColor(match.away)} label="Broadcast feed for auto-eventing" venue={venue} feed={{ ballColour: ball, onFrame, clock: matchClock }} />
              </Suspense>
            ) : (
              <EmptyState>This browser can't render the 3D feed (no WebGL). Upload a recorded clip instead.</EmptyState>
            )
          ) : clip ? (
            <video ref={video} src={clip.url} controls muted playsInline className="autoevent-video" aria-label={`Uploaded clip ${clip.name}`} />
          ) : null}
          <div className="xs muted mt-8">
            Ball sightings: <span className="tnum">{det.ballFound}</span>
            {mode === "clip" && clip ? <> · frames read <span className="tnum">{det.frames.read}</span> · with feed time code <span className="tnum">{det.frames.clocked}</span></> : null}
            {mode === "clip" && clip && !clip.matchId ? " · name the file as recorded (regista-feed_<match>_t<seconds>.webm) to grade it" : null}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2 className="card-title">Detector vs truth</h2></div>
          <div className="stat-grid mb-12">
            <div className="stat"><div className="xs muted">Passes and shots</div><div className="big tnum">{score.detected}</div></div>
            <div className="stat"><div className="xs muted">Found (recall)</div><div className="big tnum">{pct(score.recall)}</div></div>
            <div className="stat"><div className="xs muted">Correct (precision)</div><div className="big tnum">{pct(score.precision)}</div></div>
            <div className="stat"><div className="xs muted">Distance error</div><div className="big tnum">{num(score.distanceErr, "m")}</div></div>
            <div className="stat"><div className="xs muted">Speed error</div><div className="big tnum">{num(score.speedErr, "km/h")}</div></div>
            <div className="stat"><div className="xs muted">Team right</div><div className="big tnum">{pct(score.teamAccuracy)}</div></div>
          </div>
          {graded.length ? (
            <ul className="autoevent-list">
              {[...graded].reverse().slice(0, 12).map((g, i) => (
                <li key={`${g.t0}-${i}`} className={cx(!g.truth && "faint")}>
                  <span className="tnum mono">{clock(Math.floor(g.t0 / 60) + 1)}</span>
                  <span className="swatch" style={{ background: colour(g.passer) }} />
                  <span>
                    <b>{g.kind === "shot" ? "Shot" : "Pass"}</b> {side(g.passer)}{g.kind === "pass" ? ` → ${side(g.receiver)}` : ""} ·{" "}
                    <span className="tnum">{g.distance.toFixed(1)} m · {Math.round(g.speedKmh)} km/h</span>
                    <div className="xs muted">
                      {g.truth ? (
                        <>✓ {g.truth.player ?? "matched"} · truth <span className="tnum">{g.truth.distance?.toFixed(1) ?? "-"} m · {g.truth.speedKmh ?? "-"} km/h</span></>
                      ) : "✗ no matching event"}
                    </div>
                  </span>
                </li>
              ))}
            </ul>
          ) : notFeed ? (
            <div className="note" role="status">
              <strong>This clip isn't a Regista feed, so there is nothing to read.</strong>
              <p className="small mt-6 mb-0">
                The detector reads Regista's own broadcast: a fixed camera whose calibration turns pixels into metres, a
                high-visibility match ball, and a time code in every frame that lets each detection be checked against the
                event data. After <span className="tnum">{det.frames.read}</span> frames this clip has none of the three,
                so it can't measure passes or check itself. Real broadcast footage needs a trained player and ball detector
                and per-shot camera calibration; that's on the roadmap.
              </p>
              <p className="small mt-6 mb-0">
                For this clip, use <b>AI video read</b> below: the reasoning model reads any footage frame by frame. To see the
                calibrated detector measure and grade itself, switch to <b>Live feed</b> and press Play.
              </p>
            </div>
          ) : (
            <EmptyState>{mode === "live" ? "Press Play: detections appear as the ball moves." : "Play the clip: detections appear as the ball moves."}</EmptyState>
          )}
        </section>
      </div>

      {mode === "clip" && clip ? (
        <VideoReader src={clip.url} name={clip.name} onSeek={(t) => {
          const v = video.current;
          if (!v) return;
          v.currentTime = t;
          v.scrollIntoView({ behavior: "smooth", block: "center" });
        }} />
      ) : null}
    </div>
  );
}
