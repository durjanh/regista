import type { VideoEventRead, VideoEventType, VideoRead, VideoTeams } from "../api/types";

/**
 * Reading any football clip with the reasoning model: the browser samples frames, sends them in batches, and these
 * helpers add the batches up into possession, event counts and a timeline. Every figure is the model's reading of the
 * pictures, not a measurement.
 */

export const MAX_FRAMES = 90;          // about 1.5 minutes at one frame a second; longer clips are sampled more sparsely
export const BATCH = 8;                // frames per request
export const FRAME_WIDTH = 512;        // px: enough for the model's low-detail view, ~40 kB as JPEG

/** When to sample: about one frame a second, at most MAX_FRAMES spread over the whole clip. */
export function sampleTimes(duration: number, max = MAX_FRAMES): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const step = Math.max(1, duration / max);
  const out: number[] = [];
  for (let t = Math.min(step / 2, duration / 2); t < duration && out.length < max; t += step) out.push(Math.round(t * 10) / 10);
  return out;
}

export const COUNTED: VideoEventType[] = ["pass", "shot", "goal", "save", "tackle", "foul", "corner", "free_kick", "throw_in", "card"];

export type Side = "a" | "b";
export type Tally = {
  teams: VideoTeams;
  frames: number;                                  // frames read
  live: number;                                    // of which live play (not replays, close-ups or graphics)
  possession: Record<Side, number> | null;         // share of live frames where a team had the ball, 0..1
  zones: Record<Side, Record<"defensive_third" | "middle_third" | "attacking_third", number>>;
  counts: Record<Side, Partial<Record<VideoEventType, number>>>;
  events: VideoEventRead[];
  scoreboard: { t: number; text: string } | null;
  summaries: { t: number; text: string }[];
};

const zeroZones = () => ({ defensive_third: 0, middle_third: 0, attacking_third: 0 });

/** The same event seen at the edge of two batches counts once: same type and team within 1.5 s. */
function dedupe(events: VideoEventRead[]): VideoEventRead[] {
  const out: VideoEventRead[] = [];
  for (const e of [...events].sort((x, y) => x.t - y.t)) {
    if (out.some((o) => o.type === e.type && o.team === e.team && Math.abs(o.t - e.t) <= 1.5)) continue;
    out.push(e);
  }
  return out;
}

export function tally(reads: VideoRead[]): Tally {
  const frames = reads.flatMap((r) => r.frames);
  const live = frames.filter((f) => f.view === "live");
  const held = live.filter((f) => f.possession);
  const zones = { a: zeroZones(), b: zeroZones() };
  for (const f of held) if (f.zone) zones[f.possession!][f.zone] += 1;
  const events = dedupe(reads.flatMap((r) => r.events));
  const counts: Tally["counts"] = { a: {}, b: {} };
  for (const e of events) if (e.team && COUNTED.includes(e.type)) counts[e.team][e.type] = (counts[e.team][e.type] ?? 0) + 1;
  // A goal is also a shot.
  for (const s of ["a", "b"] as const) if (counts[s].goal) counts[s].shot = (counts[s].shot ?? 0) + counts[s].goal!;
  const boards = frames.filter((f) => f.scoreboard);
  const last = boards[boards.length - 1];
  return {
    teams: reads.length ? reads[reads.length - 1].teams : {},
    frames: frames.length,
    live: live.length,
    possession: held.length ? { a: held.filter((f) => f.possession === "a").length / held.length, b: held.filter((f) => f.possession === "b").length / held.length } : null,
    zones,
    counts,
    events,
    scoreboard: last ? { t: last.t, text: last.scoreboard! } : null,
    summaries: reads.filter((r) => r.summary).map((r) => ({ t: r.frames[0]?.t ?? 0, text: r.summary })),
  };
}

/** "White shirts (England)", or the kit alone when no name was on screen. */
export function teamLabel(teams: VideoTeams, side: Side): string {
  const t = teams[side];
  const kit = t?.kit ? t.kit.charAt(0).toUpperCase() + t.kit.slice(1) : side === "a" ? "Team A" : "Team B";
  return t?.name ? `${t.name} (${t.kit ?? kit})` : kit;
}

/** Resolves once the browser has the frame at the new position ready to draw (or after 500 ms where it can't say):
 * right after a seek Chrome can still hand drawImage the previous or an empty picture. */
function framePainted(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    v.requestVideoFrameCallback?.(finish);
    window.setTimeout(finish, 500);
  });
}

/** Frames that would mislead the model: a batch that is blank (tiny JPEGs) or the same picture every time. */
export function unusableBatch(images: string[]): string | null {
  if (!images.length) return null;
  if (images.every((d) => d.length < 3000)) return "The browser returned blank frames for this clip.";
  if (images.length > 1 && new Set(images).size === 1) return "The browser returned the same frame every time.";
  return null;
}

/** Seek a video to `t` and draw that frame as a JPEG data URL `width` pixels wide. */
export async function grabFrame(video: HTMLVideoElement, t: number, canvas: HTMLCanvasElement, width = FRAME_WIDTH): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const done = () => { video.removeEventListener("seeked", done); video.removeEventListener("error", fail); resolve(); };
    const fail = () => { video.removeEventListener("seeked", done); video.removeEventListener("error", fail); reject(new Error("The clip can't be read")); };
    video.addEventListener("seeked", done);
    video.addEventListener("error", fail);
    video.currentTime = t;
  });
  await framePainted(video);
  const w = video.videoWidth || width;
  const h = video.videoHeight || width * 0.5625;
  const scale = width / Math.max(w, h);                                     // the longer side, so a portrait clip stays small
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}
