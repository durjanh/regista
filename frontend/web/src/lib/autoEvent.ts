import type { MatchEvent } from "../api/types";
import { PITCH_H, PITCH_W, toHomeFrame } from "./format";

/**
 * Auto-eventing: computer vision over Regista's own broadcast feed (the 3D pitch rendered by a fixed, calibrated
 * camera). It reads only pixels: it finds the ball by its colour and shape, maps it onto the pitch with the camera's
 * calibration, tracks it, cuts the track into passes and shots, measures distance and speed, and tells the teams apart
 * by the kit colours at each end. It never sees the event data; `grade` then checks every detection against it.
 *
 * Coordinates: world metres with x along the pitch (0 at the centre spot), z across it, y up; "home frame" metres as
 * in the events (home attacks +x, y = 0 on its right touchline).
 */

export type Vec3 = [number, number, number];
export type Rgb = [number, number, number];
export type Frame = { data: Uint8ClampedArray; width: number; height: number };

/** The broadcast camera: high on the near touchline, wide enough for the whole pitch. Pitch3D renders with exactly this. */
export const FEED_CAMERA = { position: [0, 64, 70] as Vec3, target: [0, 0, 2] as Vec3, fov: 36, aspect: 16 / 9 };
/** The size frames are analysed at, whatever the feed or video resolution. */
export const ANALYSIS = { width: 960, height: 540 };
/** Ball radius in the feed (m): the ball's centre sits this high when it rolls. */
export const FEED_BALL_RADIUS = 0.45;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

function basis(cam = FEED_CAMERA) {
  const forward = norm(sub(cam.target, cam.position));
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tan = Math.tan((cam.fov * Math.PI) / 360);
  return { forward, right, up, tan };
}

/** A world point → its pixel in a frame of this size. */
export function project(p: Vec3, width = ANALYSIS.width, height = ANALYSIS.height, cam = FEED_CAMERA): [number, number] {
  const { forward, right, up, tan } = basis(cam);
  const d = sub(p, cam.position);
  const z = dot(d, forward);
  const x = dot(d, right) / (z * tan * cam.aspect);
  const y = dot(d, up) / (z * tan);
  return [((x + 1) / 2) * width, ((1 - y) / 2) * height];
}

/** A pixel → the world point it shows on the horizontal plane at `height` metres (the camera's calibration, inverted). */
export function unproject(u: number, v: number, height = 0, width = ANALYSIS.width, frameH = ANALYSIS.height, cam = FEED_CAMERA): Vec3 {
  const { forward, right, up, tan } = basis(cam);
  const x = ((u / width) * 2 - 1) * tan * cam.aspect;
  const y = (1 - (v / frameH) * 2) * tan;
  const dir: Vec3 = [forward[0] + x * right[0] + y * up[0], forward[1] + x * right[1] + y * up[1], forward[2] + x * right[2] + y * up[2]];
  const t = (height - cam.position[1]) / dir[1];
  return [cam.position[0] + t * dir[0], height, cam.position[2] + t * dir[2]];
}

export const worldToHome = (w: Vec3): [number, number] => [w[0] + PITCH_W / 2, PITCH_H / 2 - w[2]];
export const homeToWorld = (hx: number, hy: number, y = 0): Vec3 => [hx - PITCH_W / 2, y, PITCH_H / 2 - hy];

const hex = (h: string): Rgb => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const dist2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
/** Colour with brightness divided out, so a shaded white shirt is still white and not sky blue. */
const chroma = (c: Rgb): Rgb => { const m = Math.max(c[0], c[1], c[2], 1); return [c[0] / m, c[1] / m, c[2] / m]; };

/** A high-visibility ball colour that no kit, keeper or skin tone on the pitch is close to (as winter balls are). */
export function hiVisBall(avoid: string[]): string {
  const candidates = ["#ff2d95", "#ff7a00", "#00e5ff", "#ffe600", "#b026ff"];
  const used = avoid.map(hex);
  return candidates
    .map((c) => ({ c, d: Math.min(...used.map((u) => dist2(hex(c), u))) }))
    .sort((a, b) => b.d - a.d)[0].c;
}

/** The ball in a frame: the most compact blob of the ball's colour on the pitch, closest to where it was. */
export function findBall(frame: Frame, ballColour: string, near?: [number, number]): [number, number] | null {
  const target = hex(ballColour);
  const { data, width, height } = frame;
  const tol = 85 ** 2;
  const seen = new Uint8Array(width * height);
  let best: { u: number; v: number; score: number } | null = null;
  for (let i = 0; i < width * height; i++) {
    if (seen[i]) continue;
    const o = i * 4;
    if (dist2([data[o], data[o + 1], data[o + 2]], target) > tol) continue;
    // Flood-fill this blob.
    const stack = [i];
    seen[i] = 1;
    let n = 0, su = 0, sv = 0, minU = width, maxU = 0, minV = height, maxV = 0;
    while (stack.length) {
      const j = stack.pop()!;
      const u = j % width, v = (j - u) / width;
      n++; su += u; sv += v;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      for (const k of [j - 1, j + 1, j - width, j + width]) {
        if (k < 0 || k >= width * height || seen[k]) continue;
        if (Math.abs((k % width) - u) > 1) continue;
        const q = k * 4;
        if (dist2([data[q], data[q + 1], data[q + 2]], target) > tol) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    const w = maxU - minU + 1, h = maxV - minV + 1;
    // A ball is small and round: reject specks and long or large shapes.
    if (n < 3 || n > 400 || w > 3 * h || h > 3 * w) continue;
    const u = su / n, v = sv / n;
    const [hx, hy] = worldToHome(unproject(u, v, FEED_BALL_RADIUS, width, height));
    if (hx < -6 || hx > PITCH_W + 6 || hy < -4 || hy > PITCH_H + 4) continue;                   // off the pitch: boards, crowd
    const fill = n / (w * h);
    const score = fill * 10 - (near ? Math.hypot(u - near[0], v - near[1]) / 40 : 0);
    if (!best || score > best.score) best = { u, v, score };
  }
  return best ? [best.u, best.v] : null;
}

/** Which team's kit dominates the body standing at a pitch spot (home frame), from the pixels above it. */
export function teamAt(frame: Frame, spot: [number, number], kits: { home: string[]; away: string[] }): "home" | "away" | null {
  const { data, width, height } = frame;
  const [fu, fv] = project(homeToWorld(spot[0], spot[1], 0), width, height);
  const [, hv] = project(homeToWorld(spot[0], spot[1], 4.2), width, height);
  const half = Math.max(3, Math.abs(project(homeToWorld(spot[0] + 1.6, spot[1], 0), width, height)[0] - fu));
  // Only colours that tell the teams apart count: Argentina's white stripes say nothing against England's white shirts.
  const close = (c: Rgb, set: Rgb[]) => set.some((x) => dist2(c, x) < 0.2 ** 2);
  const allHome = kits.home.map((k) => chroma(hex(k))), allAway = kits.away.map((k) => chroma(hex(k)));
  const home = allHome.filter((c) => !close(c, allAway)), away = allAway.filter((c) => !close(c, allHome));
  const shared = [...allHome, ...allAway].filter((c) => !home.includes(c) && !away.includes(c));
  let h = 0, a = 0, both = 0;
  for (let v = Math.max(0, Math.floor(hv)); v <= Math.min(height - 1, Math.ceil(fv)); v++)
    for (let u = Math.max(0, Math.floor(fu - half)); u <= Math.min(width - 1, Math.ceil(fu + half)); u++) {
      const o = (v * width + u) * 4;
      const raw: Rgb = [data[o], data[o + 1], data[o + 2]];
      if (raw[1] > raw[0] * 1.2 && raw[1] > raw[2] * 1.2) continue;                                  // grass
      if (Math.max(...raw) < 70) continue;                                                            // shorts, boots, shadow
      const px = chroma(raw);
      const dh = home.length ? Math.min(...home.map((c) => dist2(px, c))) : Infinity;
      const da = away.length ? Math.min(...away.map((c) => dist2(px, c))) : Infinity;
      const ds = shared.length ? Math.min(...shared.map((c) => dist2(px, c))) : Infinity;
      const m = Math.min(dh, da, ds);
      if (m > 0.22 ** 2) continue;
      if (m === ds) both++; else if (m === dh) h++; else a++;
    }
  // A team whose every colour is shared (England's white) is the one in shared colours with none of the other's.
  if (!home.length && both >= 4) return a >= both * 0.25 ? "away" : "home";
  if (!away.length && both >= 4) return h >= both * 0.25 ? "home" : "away";
  if (h + a < 4) return null;
  return h > a * 1.3 ? "home" : a > h * 1.3 ? "away" : null;
}

// ------------------------------------------------------------------ burned-in timecode

/**
 * The feed stamps the match clock into every frame, as broadcast video carries a timecode: a strip of cells at the
 * bottom left, two marker cells (white, black) then 20 bits of hundredths of a second (up to 2 h 54 min). A recording carries its own clock,
 * so an uploaded clip is timed exactly. Positions are fractions of the frame from its top-left corner.
 */
export const TIMECODE = { x: 0.006, y: 0.972, cellW: 0.008, cellH: 0.016, bits: 20 };

/** The cells to draw for a match time: true = white. */
export function timecodeCells(seconds: number): boolean[] {
  const v = Math.max(0, Math.min(2 ** TIMECODE.bits - 1, Math.round(seconds * 100)));
  return [true, false, ...Array.from({ length: TIMECODE.bits }, (_, i) => ((v >> (TIMECODE.bits - 1 - i)) & 1) === 1)];
}

/** The match time stamped in a frame, or null when it has no timecode. */
export function readTimecode(frame: Frame): number | null {
  const { data, width, height } = frame;
  const cell = (i: number) => {
    const u = Math.floor((TIMECODE.x + (i + 0.5) * TIMECODE.cellW) * width);
    const v = Math.floor((TIMECODE.y + TIMECODE.cellH / 2) * height);
    const o = (v * width + u) * 4;
    return (data[o] + data[o + 1] + data[o + 2]) / 3;
  };
  if (cell(0) < 200 || cell(1) > 55) return null;
  let v = 0;
  for (let i = 0; i < TIMECODE.bits; i++) v = v * 2 + (cell(i + 2) > 127 ? 1 : 0);
  return v / 100;
}

// ------------------------------------------------------------------ tracking: passes and shots from the ball's path

export type Detection = {
  kind: "pass" | "shot";
  t0: number;                 // match seconds the ball left
  t1: number;                 // match seconds it stopped
  from: [number, number];     // home frame
  to: [number, number];
  distance: number;           // metres
  speedKmh: number;
  passer: "home" | "away" | null;
  receiver: "home" | "away" | null;
};

type Sample = { t: number; p: [number, number] };

/** Turns ball positions into passes and shots: the ball rests, moves fast, rests again. */
export class BallTracker {
  private last: Sample | null = null;
  private rest: Sample | null = null;
  private moving_: Sample[] = [];
  private slow = 0;

  /** True while the ball is travelling (between leaving one player and coming to rest). */
  get moving(): boolean {
    return this.moving_.length > 0;
  }

  /** Feed one ball sighting. Returns a finished flight when the ball has come to rest after one. */
  push(t: number, p: [number, number]): Omit<Detection, "passer" | "receiver"> | null {
    const prev = this.last;
    this.last = { t, p };
    if (!prev || t <= prev.t) return null;
    const v = Math.hypot(p[0] - prev.p[0], p[1] - prev.p[1]) / (t - prev.t);
    if (v > 60) return null;                                                                       // a mis-sighting
    if (!this.moving_.length) {
      if (v < 3) { this.rest = { t, p }; return null; }
      if (v > 6 && this.rest) this.moving_ = [this.rest, { t, p }];
      return null;
    }
    this.moving_.push({ t, p });
    this.slow = v < 3 ? this.slow + 1 : 0;
    if (this.slow < 2 && t - this.moving_[0].t < 6) return null;
    const path = this.moving_;
    this.moving_ = [];
    this.slow = 0;
    this.rest = { t, p };
    const from = path[0].p, to = p;
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
    // Speed: ground distance from where the ball left to where it stopped, over the time between. Positions in the
    // air are only used to see that it moved: a lofted ball's projection onto the pitch overstates its travel.
    const speeds = path.slice(1).map((s, i) => Math.hypot(s.p[0] - path[i].p[0], s.p[1] - path[i].p[1]) / (s.t - path[i].t));
    const peak = Math.max(...speeds);
    const depart = (path[0].t + path[1].t) / 2;
    const arrive = (path[path.length - 3].t + path[path.length - 2].t) / 2;
    const speed = arrive > depart ? distance / (arrive - depart) : 0;
    if (peak < 9 || distance < 4) return null;                                                      // a dribble, not a pass
    const atGoal = (to[0] < 4 || to[0] > PITCH_W - 4) && to[1] > 24 && to[1] < 44;
    return { kind: atGoal ? "shot" : "pass", t0: path[0].t, t1: t, from, to, distance, speedKmh: speed * 3.6 };
  }
}

// ------------------------------------------------------------------ grading against the event stream

export type Graded = Detection & {
  truth?: { id: string; team: "home" | "away"; distance?: number; speedKmh?: number; player?: string };
};
export type Scorecard = {
  detected: number; matched: number; truthInWindow: number;
  recall: number | null; precision: number | null;
  distanceErr: number | null; speedErr: number | null; teamAccuracy: number | null;
};

const FLIGHT = new Set(["pass", "shot"]);

/** Match each detection to the real pass or shot it saw (same moment, same place) and score the detector. */
export function grade(detections: Detection[], truth: MatchEvent[], homeId: string, window: [number, number] | null): { graded: Graded[]; score: Scorecard } {
  const flights = truth.filter((e) => FLIGHT.has(e.type) && e.end_x !== undefined);
  const used = new Set<string>();
  const graded: Graded[] = detections.map((d) => {
    let best: { e: MatchEvent; cost: number } | null = null;
    for (const e of flights) {
      // The ball leaves just after the event's time: a touch first, sometimes a short run to the spot.
      if (used.has(e.id) || d.t0 - e.t > 2 || d.t0 - e.t < -0.6) continue;
      const start = toHomeFrame(e.x, e.y, e.team_id === homeId);
      const gap = Math.hypot(start[0] - d.from[0], start[1] - d.from[1]);
      if (gap > 7) continue;
      const cost = gap + Math.abs(e.t - d.t0) * 3;
      if (!best || cost < best.cost) best = { e, cost };
    }
    if (!best) return d;
    used.add(best.e.id);
    const e = best.e;
    return { ...d, truth: { id: e.id, team: e.team_id === homeId ? "home" : "away", distance: e.pass_length,
      speedKmh: e.type === "shot" ? e.shot_speed_kmh : e.ball_speed_kmh, player: e.player_name } };
  });
  const matched = graded.filter((g) => g.truth);
  const inWindow = window ? flights.filter((e) => e.t >= window[0] && e.t <= window[1]).length : 0;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const score: Scorecard = {
    detected: detections.length,
    matched: matched.length,
    truthInWindow: inWindow,
    recall: inWindow ? Math.min(1, matched.length / inWindow) : null,
    precision: detections.length ? matched.length / detections.length : null,
    distanceErr: mean(matched.filter((g) => g.truth!.distance !== undefined).map((g) => Math.abs(g.distance - g.truth!.distance!))),
    speedErr: mean(matched.filter((g) => g.truth!.speedKmh !== undefined).map((g) => Math.abs(g.speedKmh - g.truth!.speedKmh!))),
    teamAccuracy: mean(matched.filter((g) => g.passer).map((g) => (g.passer === g.truth!.team ? 1 : 0))),
  };
  return { graded, score };
}

/** The clip name that lets an uploaded recording be graded: regista-feed_<match id>_t<match seconds>.webm */
export const clipName = (matchId: string, t: number) => `regista-feed_${matchId}_t${Math.round(t)}.webm`;
export function parseClipName(name: string): { matchId: string; t: number } | null {
  const m = name.match(/regista-feed_(.+)_t(\d+)\.\w+$/);
  return m ? { matchId: m[1], t: Number(m[2]) } : null;
}
