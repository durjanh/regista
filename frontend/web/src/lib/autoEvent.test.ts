import { describe, expect, it } from "vitest";
import {
  ANALYSIS, BallTracker, clipName, findBall, grade, hiVisBall, homeToWorld, parseClipName, project, readTimecode, TIMECODE,
  teamAt, timecodeCells, unproject, worldToHome, type Frame,
} from "./autoEvent";
import { event } from "../test/fixtures";

const W = ANALYSIS.width, H = ANALYSIS.height;
const blank = (rgb: [number, number, number] = [30, 110, 50]): Frame => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...rgb, 255], i * 4);
  return { data, width: W, height: H };
};
const paint = (f: Frame, u0: number, v0: number, w: number, h: number, rgb: [number, number, number]) => {
  for (let v = Math.round(v0); v < v0 + h; v++) for (let u = Math.round(u0); u < u0 + w; u++) f.data.set([...rgb, 255], (v * W + u) * 4);
};

describe("camera calibration", () => {
  it("maps a pitch point to a pixel and back", () => {
    for (const [hx, hy] of [[52.5, 34], [10, 5], [95, 60]] as const) {
      const [u, v] = project(homeToWorld(hx, hy));
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(W);
      const back = worldToHome(unproject(u, v));
      expect(back[0]).toBeCloseTo(hx, 4);
      expect(back[1]).toBeCloseTo(hy, 4);
    }
  });
});

describe("timecode", () => {
  it("writes and reads the match clock to the hundredth", () => {
    const f = blank();
    timecodeCells(3725.37).forEach((on, i) =>
      paint(f, (TIMECODE.x + i * TIMECODE.cellW) * W, TIMECODE.y * H, TIMECODE.cellW * W, TIMECODE.cellH * H, on ? [255, 255, 255] : [0, 0, 0]));
    expect(readTimecode(f)).toBeCloseTo(3725.37, 2);
    expect(readTimecode(blank())).toBeNull();
  });
});

describe("detection", () => {
  it("picks a hi-vis colour no kit is close to", () => {
    expect(hiVisBall(["#ffffff", "#75aadb", "#0b1f3a", "#ff2d95"])).not.toBe("#ff2d95");
  });

  it("finds the ball on the pitch and ignores long shapes and things off it", () => {
    const f = blank();
    const [u, v] = project(homeToWorld(60, 30, 0.45));
    paint(f, u - 2, v - 2, 5, 5, [255, 45, 149]);
    paint(f, 100, 300, 60, 2, [255, 45, 149]);                                      // a long streak: not a ball
    const hit = findBall(f, "#ff2d95");
    expect(hit![0]).toBeCloseTo(u, 0);
    expect(findBall(blank(), "#ff2d95")).toBeNull();
  });

  it("tells teams apart by the colours only one of them wears", () => {
    const kits = { home: ["#ffffff"], away: ["#75aadb", "#ffffff"] };
    const spot: [number, number] = [52.5, 34];
    const [u, v] = project(homeToWorld(...spot, 0));
    const [, top] = project(homeToWorld(...spot, 4.2));
    const shaded = blank();
    paint(shaded, u - 3, top, 6, v - top, [200, 208, 225]);                         // a white shirt in bluish light
    expect(teamAt(shaded, spot, kits)).toBe("home");
    const sky = blank();
    paint(sky, u - 3, top, 6, v - top, [117, 170, 219]);
    expect(teamAt(sky, spot, kits)).toBe("away");
    expect(teamAt(blank(), spot, kits)).toBeNull();
  });
});

describe("tracking and grading", () => {
  const flight = () => {
    const tr = new BallTracker();
    const out = [];
    for (let i = 0; i <= 6; i++) out.push(tr.push(i * 0.1, [30, 34]));                // at rest
    for (let i = 1; i <= 15; i++) out.push(tr.push(0.6 + i * 0.1, [30 + i * 1.5, 34])); // 15 m/s for 22.5 m
    for (let i = 1; i <= 3; i++) out.push(tr.push(2.1 + i * 0.1, [52.5, 34]));       // stops
    return out.filter(Boolean)[0]!;
  };

  it("cuts the ball's path into a pass with its distance and speed", () => {
    const d = flight();
    expect(d.kind).toBe("pass");
    expect(d.distance).toBeCloseTo(22.5, 1);
    expect(d.speedKmh).toBeGreaterThan(45);
    expect(d.speedKmh).toBeLessThan(60);                                              // true speed 54 km/h
  });

  it("matches detections to the real pass and scores them", () => {
    const d = { ...flight(), passer: "home" as const, receiver: "home" as const };
    const truth = [event({ id: "p1", type: "pass", team_id: "england", t: 0.6, x: 30, y: 34, end_x: 52.5, end_y: 34, pass_length: 22.5, ball_speed_kmh: 54 })];
    const { graded, score } = grade([d], truth, "england", [0, 5]);
    expect(graded[0].truth?.id).toBe("p1");
    expect(score).toMatchObject({ detected: 1, matched: 1, recall: 1, precision: 1, teamAccuracy: 1 });
    expect(score.distanceErr).toBeLessThan(0.5);
  });

  it("names a recorded clip so an upload can be graded", () => {
    expect(parseClipName(clipName("2026-07-15-england-argentina", 3725.4))).toEqual({ matchId: "2026-07-15-england-argentina", t: 3725 });
    expect(parseClipName("holiday.mp4")).toBeNull();
  });
});
