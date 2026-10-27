import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MatchEvent, Team } from "../api/types";
import { PITCH_H, PITCH_W, toHomeFrame } from "../lib/format";
import { BIBS, kitFor, matchKits, type Kit } from "../lib/kits";
import { hash, type VenueStyle } from "../lib/venue";
import { FEED_BALL_RADIUS, FEED_CAMERA, TIMECODE, timecodeCells } from "../lib/autoEvent";
import { ballPath, currentXI, possessionTeam, shiftedSpot, withPlayer } from "../lib/pitchShape";

/**
 * The live pitch in 3D: 22 players in their countries' kits (shirt, shorts, socks, number on the back) with a ring under each, the ball travelling event to event (lofted
 * passes arc, shots fly at goal) and a broadcast camera that follows play. The ball and the player on it come from
 * the event stream; the other 20 players are placed from their team's shape (lib/pitchShape.ts). Three.js loads only
 * when this view is shown.
 */

type Props = {
  events: MatchEvent[];
  home: Team;
  away: Team;
  homeColor: string;
  awayColor: string;
  label: string;
  /** Feed mode: the clean broadcast feed that auto-eventing reads (fixed calibrated camera, hi-vis ball moving at
   *  its real speed, no rings or name tags). `onFrame` gets the canvas right after each frame is drawn. `timecode`
   *  burns the machine-readable clock into the picture: only needed while recording a clip (the live detector is
   *  handed the clock directly), so the flickering strip isn't on screen the rest of the time. */
  feed?: { ballColour: string; onFrame: (canvas: HTMLCanvasElement) => void; clock: () => number; timecode?: boolean };
  /** The ground for this match's venue (lib/venue.ts). */
  venue: VenueStyle;
  /** "wide": the whole stadium, both goals and every stand, drag to look round and scroll to zoom;
   *  "follow": the broadcast camera that tracks the ball. */
  camera?: "wide" | "follow";
};

type Figure = {
  group: THREE.Group; body: THREE.Group; ring: THREE.Mesh; legs: [THREE.Group, THREE.Group]; arms: [THREE.Group, THREE.Group];
  pos: THREE.Vector2; phase: number; heading: number;
};

const ACTOR_RING = "#d7ff3a";
/** Figures are drawn larger than life so they read at broadcast distance, as in football games. */
const SCALE = 2.3;
const SKINS = ["#f1c7a5", "#d9a47c", "#b97f57", "#8d5a3b", "#5e3a24"];
const HAIR = ["#1b1410", "#3b2516", "#6b4a2b", "#a87b45", "#d7b77a"];
const LOFTED = new Set(["long", "cross", "switch"]);
const STRIKES = new Set(["pass", "shot", "kick_off", "corner", "free_kick", "goal_kick", "clearance"]);
/** Events that move the ball; pressure, fouls, cards and substitutions don't. */
const BALL_EVENTS = new Set([...STRIKES, "carry", "dribble", "recovery", "interception", "throw_in", "save"]);

/** Home frame (home attacks +x) → world: x along the pitch, z across it with the home team's right touchline nearest. */
const world = (hx: number, hy: number) => new THREE.Vector2(hx - PITCH_W / 2, PITCH_H / 2 - hy);

function pitchTexture(mowing: VenueStyle["mowing"] = "stripes", linesOnly = false): THREE.CanvasTexture {
  const S = 24;                                                                // pixels per metre
  const c = document.createElement("canvas");
  c.width = PITCH_W * S;
  c.height = PITCH_H * S;
  const g = c.getContext("2d")!;
  // Each ground mows its own way: stripes, a chequerboard, or wide bands.
  const bands = mowing === "wide" ? 8 : 14;
  const rows = mowing === "checks" ? 8 : 1;
  for (let i = 0; i < bands; i++)
    for (let r = 0; r < rows; r++) {
      const dark = (i + r) % 2 === 1;
      const grd = g.createLinearGradient(0, 0, 0, c.height);
      grd.addColorStop(0, dark ? "#1d6531" : "#22763a");
      grd.addColorStop(1, dark ? "#1a5c2d" : "#1f6c35");
      g.fillStyle = grd;
      g.fillRect((c.width / bands) * i, (c.height / rows) * r, c.width / bands + 1, c.height / rows + 1);
    }
  if (linesOnly) {                                                              // black, so only the markings glow
    g.fillStyle = "#000000";
    g.fillRect(0, 0, c.width, c.height);
  }
  // Grain, so the grass doesn't look like flat paint up close.
  for (let n = 0; n < (linesOnly ? 0 : 60000); n++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
  }
  g.strokeStyle = "rgba(255,255,255,0.88)";
  g.lineWidth = 0.14 * S;
  const m = (v: number) => v * S;
  const rect = (x: number, y: number, w: number, h: number) => g.strokeRect(m(x), m(y), m(w), m(h));
  const arc = (x: number, y: number, r: number, a0: number, a1: number) => { g.beginPath(); g.arc(m(x), m(y), m(r), a0, a1); g.stroke(); };
  const dot = (x: number, y: number) => { g.beginPath(); g.arc(m(x), m(y), 0.3 * S, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,0.9)"; g.fill(); };
  rect(0.07, 0.07, PITCH_W - 0.14, PITCH_H - 0.14);
  g.beginPath(); g.moveTo(m(PITCH_W / 2), 0); g.lineTo(m(PITCH_W / 2), c.height); g.stroke();
  arc(PITCH_W / 2, PITCH_H / 2, 9.15, 0, Math.PI * 2);
  dot(PITCH_W / 2, PITCH_H / 2);
  for (const left of [true, false]) {
    const x = (v: number) => (left ? v : PITCH_W - v);
    rect(left ? 0 : PITCH_W - 16.5, 13.84, 16.5, 40.32);
    rect(left ? 0 : PITCH_W - 5.5, 24.84, 5.5, 18.32);
    dot(x(11), PITCH_H / 2);
    const a = Math.acos(5.5 / 9.15);
    arc(x(11), PITCH_H / 2, 9.15, left ? -a : Math.PI - a, left ? a : Math.PI + a);
  }
  for (const [x, y, a0] of [[0, 0, 0], [PITCH_W, 0, Math.PI / 2], [PITCH_W, PITCH_H, Math.PI], [0, PITCH_H, -Math.PI / 2]] as const)
    arc(x, y, 1, a0, a0 + Math.PI / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Net mesh: a fine white grid on transparency. */
function netTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(255,255,255,0.75)";
  g.lineWidth = 2;
  for (let i = 0; i <= 64; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A goal: thick white posts and bar, a stanchion and a meshed net. `scale` matches the goal to the figures, which
 *  are drawn larger than life so they read from the broadcast camera. */
function goal(side: 1 | -1, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3, emissive: "#d8dde6", emissiveIntensity: 0.25 });
  const W = 7.32, H = 2.44, D = 2;
  const post = new THREE.CylinderGeometry(0.11, 0.11, H, 12);
  for (const z of [-W / 2, W / 2]) {
    const p = new THREE.Mesh(post, white);
    p.position.set(0, H / 2, z);
    p.castShadow = true;
    g.add(p);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, W + 0.22, 12), white);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, H, 0);
  bar.castShadow = true;
  g.add(bar);
  const tex = netTexture();
  const net = (w: number, h: number, rep: [number, number]) => {
    const t = tex.clone();
    t.repeat.set(...rep);
    t.needsUpdate = true;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  };
  const back = net(W, H * 0.7, [14, 4]);
  back.rotation.y = Math.PI / 2;
  back.position.set(side * D, H * 0.35, 0);
  const roof = net(Math.hypot(D, H * 0.3), W, [4, 14]);
  roof.rotation.set(-Math.PI / 2, 0, 0);
  roof.rotation.y = side * Math.atan2(H * 0.3, D);
  roof.position.set((side * D) / 2, H * 0.85, 0);
  g.add(back, roof);
  for (const z of [-W / 2, W / 2]) {
    const wing = net(D, H, [4, 5]);
    wing.position.set((side * D) / 2, H / 2, z);
    g.add(wing);
  }
  g.scale.setScalar(scale);
  g.position.set((side * PITCH_W) / 2, 0, 0);
  return g;
}

/** A stand: stepped rows of seats rising from behind the boards, with the fans sitting in them. */
type Stands = { group: THREE.Group; near: THREE.Group; cheer: (now: number, until: number) => void };

/**
 * The stadium for this venue: one continuous seating bowl round the pitch (a rounded rectangle, as modern grounds are
 * built), one to three tiers of stepped rows with balcony fronts, thousands of fans in them, and a cantilevered roof
 * ring lined with floodlights. City landmarks: London gets a great illuminated arch over the far stand, Mexico City a
 * steep three-tier bowl. The near side is a separate group: it fills the foreground of the wide shot, and the follow
 * camera (which sits in it, as a broadcast camera does) and the auto-eventing feed hide it.
 *
 * `soft` is for the auto-eventing feed's high, wide camera, which sees the seat rows more than the fans: one muted seat
 * colour instead of alternating rows (they read as stripes from up there) and fans toned down, so the crowd reads as a
 * crowd. Only the stands change; the pitch, ball and kits the detector reads are untouched.
 */
function stands(v: VenueStyle, homeColours: string[], awayColours: string[], soft = false): Stands {
  const g = new THREE.Group();
  const near = new THREE.Group();
  const roofMat = new THREE.MeshStandardMaterial({ color: "#0d121c", roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide });
  const ROWS = 11, RISE = v.landmark === "bowl" ? 0.8 : 0.6, DEPTH = 0.95;
  const A0 = PITCH_W / 2 + 6, B0 = PITCH_H / 2 + 6.5, R0 = 12;            // the bowl's inner edge round the pitch
  const tierOff = (t: number) => t * (ROWS * DEPTH - 2.2);                 // upper tiers overhang the one below
  const tierY = (t: number) => 1.2 + t * (ROWS * RISE + 3);
  const outerOff = tierOff(v.tiers - 1) + ROWS * DEPTH;
  const topY = tierY(v.tiers - 1) + ROWS * RISE;

  /** Points round the bowl at an offset from its inner edge, with outward normals; `near` marks the near side. */
  type Pt = { x: number; z: number; nx: number; nz: number; near: boolean };
  const ring = (off: number, step: number): Pt[] => {
    const a = A0 + off, b = B0 + off, r = R0 + off, sa = a - r, sb = b - r;
    const out: Pt[] = [];
    const line = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number, isNear: boolean) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
      for (let i = 0; i < n; i++) out.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n, nx, nz, near: isNear });
    };
    const arc = (cx: number, cz: number, t0: number, t1: number, isNear: boolean) => {
      const n = Math.max(2, Math.ceil((Math.abs(t1 - t0) * r) / step));
      for (let i = 0; i < n; i++) {
        const t = t0 + ((t1 - t0) * i) / n;
        out.push({ x: cx + r * Math.cos(t), z: cz + r * Math.sin(t), nx: Math.cos(t), nz: Math.sin(t), near: isNear });
      }
    };
    line(-sa, b, sa, b, 0, 1, true);                       // near side
    arc(sa, sb, Math.PI / 2, 0, true);
    line(a, sb, a, -sb, 1, 0, false);                      // right end
    arc(sa, -sb, 0, -Math.PI / 2, false);
    line(sa, -b, -sa, -b, 0, -1, false);                   // far side
    arc(-sa, -sb, -Math.PI / 2, -Math.PI, false);
    line(-a, -sb, -a, sb, -1, 0, false);                   // left end
    arc(-sa, sb, Math.PI, Math.PI / 2, true);
    return out;
  };

  // One mesh per side of the bowl: ribbons between two offsets/heights, closed round the far side, open at the near.
  type Buf = { pos: number[]; col: number[]; idx: number[] };
  const bufs: Record<"far" | "near", Buf> = { far: { pos: [], col: [], idx: [] }, near: { pos: [], col: [], idx: [] } };
  const ribbon = (off0: number, y0: number, off1: number, y1: number, colour: THREE.Color, only?: "far" | "near") => {
    const pts = ring(Math.min(off0, off1), 1.5);
    for (const side of ["far", "near"] as const) {
      if (only && only !== side) continue;
      const run = pts.filter((p) => p.near === (side === "near"));
      const b = bufs[side];
      // Split into contiguous runs (the near side wraps round the start of the loop).
      const idxs = pts.map((p, i) => (p.near === (side === "near") ? i : -1));
      let base = -1, prev = -2, firstV = -1;
      for (const i of idxs) {
        if (i < 0) { prev = -2; continue; }
        const p = pts[i];
        const v0 = b.pos.length / 3;
        b.pos.push(p.x + p.nx * (off0 - Math.min(off0, off1)), y0, p.z + p.nz * (off0 - Math.min(off0, off1)));
        b.pos.push(p.x + p.nx * (off1 - Math.min(off0, off1)), y1, p.z + p.nz * (off1 - Math.min(off0, off1)));
        b.col.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b);
        if (prev === i - 1 && base >= 0) b.idx.push(base, base + 1, v0, base + 1, v0 + 1, v0);
        if (i === 0) firstV = v0;
        base = v0;
        prev = i;
      }
      // Join across the loop's start where this side wraps round it (the near side does).
      if (run.length > 2 && firstV >= 0 && idxs[idxs.length - 1] >= 0)
        b.idx.push(base, base + 1, firstV, base + 1, firstV + 1, firstV);
    }
  };
  const dark = new THREE.Color("#1b2230"), led = new THREE.Color("#0f6e4f");
  const seatA = new THREE.Color(v.seats[0]), seatB = soft ? seatA : new THREE.Color(v.seats[1]);
  if (soft) seatA.lerp(dark, 0.72);
  const world: THREE.Vector3[] = [], nearWorld: THREE.Vector3[] = [];
  for (let t = 0; t < v.tiers; t++) {
    for (let r = 0; r < ROWS; r++) {
      const off = tierOff(t) + r * DEPTH, y = tierY(t) + r * RISE;
      const c = (r + t) % 2 ? seatB : seatA;
      ribbon(off, y, off + DEPTH, y, c);                                   // the row's tread
      ribbon(off, y - RISE, off, y, dark);                                 // and its riser
      for (const p of ring(off + DEPTH / 2, 0.78))
        (p.near ? nearWorld : world).push(new THREE.Vector3(p.x, y + 0.05, p.z));
    }
    if (t) ribbon(tierOff(t) - 0.4, tierY(t) - 2.4, tierOff(t) - 0.4, tierY(t) - 0.6, led);   // LED ribbon on the tier front
  }
  ribbon(outerOff, 0, outerOff, topY + 4, dark, "far");                     // the bowl's outer wall
  const hasRoof = v.roof !== "open";
  if (hasRoof) {
    ribbon(outerOff + 1, topY + 5, Math.max(2, tierOff(v.tiers - 1) - 4), topY + 7.5, new THREE.Color("#0d121c"), "far");
    // A continuous floodlight strip along the roof's inner edge.
    ribbon(Math.max(2, tierOff(v.tiers - 1) - 4), topY + 7.2, Math.max(2, tierOff(v.tiers - 1) - 3.4), topY + 7.2, new THREE.Color("#ffffff"), "far");
  }
  for (const side of ["far", "near"] as const) {
    const b = bufs[side];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
    geo.setIndex(b.idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    (side === "far" ? g : near).add(mesh);
  }

  // London: a great illuminated arch spanning the far stand.
  if (v.landmark === "arch") {
    const span = 105, rise = 70, z = -(B0 + outerOff + 4);
    const pts = Array.from({ length: 41 }, (_, i) => {
      const x = -span + (2 * span * i) / 40;
      return new THREE.Vector3(x, rise * (1 - (x / span) ** 2), z);
    });
    const arch = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 1.6, 12, false),
      new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#dfe9ff", emissiveIntensity: 0.9, roughness: 0.3 }));
    arch.rotation.x = -0.18;                                                // leaning over the pitch
    g.add(arch);
  }

  // Fans: one per seat, minus empty ones. Rounded bodies in shirts (home, away, everyday), heads in a range of skin
  // tones with hair, about one in eight holding a scarf up, some standing. They sway all the time and jump on a goal:
  // the motion runs in the vertex shader (per-instance phase from the instance id), so 20,000 fans cost almost nothing.
  const everyday = ["#2b3550", "#3f4a5c", "#5b6b8c", "#1f2937", "#6b4a4a", "#e5e7eb", "#374151", "#7c3a3a"];
  const filled = world.filter((_, n) => (Math.sin(n * 12.9898) * 43758.5453) % 1 > -0.84);       // ~8% empty seats
  const crowdTime = { value: 0 }, crowdCheer = { value: 0 };
  const animated = (m: THREE.Material) => {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = crowdTime;
      shader.uniforms.uCheer = crowdCheer;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uCheer;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float ph = float(gl_InstanceID) * 0.618;
          transformed.y += sin(uTime * 1.3 + ph * 7.0) * 0.035 + uCheer * (0.3 + abs(sin(uTime * 9.0 + ph * 3.0)) * 0.45);
          transformed.x += sin(uTime * 0.9 + ph * 5.0) * 0.03;`);
    };
    return m;
  };
  const fanMat = () => animated(new THREE.MeshLambertMaterial());
  const fans = (pts: THREE.Vector3[]): THREE.InstancedMesh[] => {
    const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.36, 2, 8), fanMat(), pts.length);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), fanMat(), pts.length);
    const hair = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), fanMat(), pts.length);
    const scarfIdx = pts.map((_, n) => n).filter((n) => Math.abs(Math.sin(n * 3.17)) % 1 < 0.13);
    const scarves = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.14, 0.04), fanMat(), scarfIdx.length);
    const colour = new THREE.Color();
    const mat = new THREE.Matrix4();
    const HAIRS = ["#1b1410", "#3b2516", "#6b4a2b", "#a87b45", "#d7b77a", "#2a2a2a"];
    pts.forEach((p, n) => {
      const r = Math.abs(Math.sin(n * 78.233) * 43758.5453) % 1;
      const shirt = r < 0.4 ? homeColours[n % homeColours.length] : r < 0.7 ? awayColours[n % awayColours.length] : everyday[n % everyday.length];
      const standing = Math.abs(Math.sin(n * 1.7)) % 1 < 0.22 ? 0.35 : 0;
      const y = p.y + 0.38 + standing;
      bodies.setMatrixAt(n, mat.makeTranslation(p.x, y, p.z));
      bodies.setColorAt(n, soft ? colour.set(shirt).lerp(dark, 0.3) : colour.set(shirt));
      heads.setMatrixAt(n, mat.makeTranslation(p.x, y + 0.5, p.z));
      heads.setColorAt(n, colour.set(SKINS[n % SKINS.length]));
      hair.setMatrixAt(n, mat.makeTranslation(p.x, y + 0.52, p.z));
      hair.setColorAt(n, colour.set(HAIRS[(n * 7) % HAIRS.length]));
    });
    scarfIdx.forEach((n, i) => {
      const p = pts[n];
      const r = Math.abs(Math.sin(n * 78.233) * 43758.5453) % 1;
      mat.makeRotationZ(Math.sin(n) * 0.25).setPosition(p.x, p.y + 1.55, p.z);
      scarves.setMatrixAt(i, mat);
      scarves.setColorAt(i, colour.set(r < 0.55 ? homeColours[0] : awayColours[0]));
    });
    return [bodies, heads, hair, scarves];
  };
  g.add(...fans(filled));
  near.add(...fans(nearWorld.filter((_, n) => (Math.sin(n * 12.9898) * 43758.5453) % 1 > -0.84)));

  // Big flags waving in the stands, in both teams' colours.
  const flagMat = (c: string[]) => {
    const cv = document.createElement("canvas");
    cv.width = 64;
    cv.height = 40;
    const fg = cv.getContext("2d")!;
    c.forEach((col, i) => { fg.fillStyle = col; fg.fillRect(0, (40 / c.length) * i, 64, 40 / c.length + 1); });
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = crowdTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.z += sin(position.x * 1.6 + uTime * 4.0) * 0.35 * (position.x + 2.2) / 4.4;");
    };
    return m;
  };
  const flagMats = [flagMat(homeColours), flagMat(awayColours)];
  for (let i = 0; i < 10; i++) {
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.6, 12, 4), flagMats[i % 2]);
    const fx = -55 + i * 12 + Math.sin(i * 7) * 3;
    flag.position.set(fx, 2.5 + (i % 3) * 2.6, -(PITCH_H / 2 + 9 + (i % 3) * 3.5));
    g.add(flag);
  }

  const cheer = (now: number, until: number) => {
    crowdTime.value = now;
    crowdCheer.value = now < until ? 1 : Math.max(0, crowdCheer.value - 0.05);
  };

  // Open grounds: floodlight pylons on the far corners. Roofed: glows along the roof's floodlight strip.
  const glow = glowTexture();
  const roofEdge = ring(Math.max(2, tierOff(v.tiers - 1) - 4), 22).filter((p) => !p.near);
  const lights: [number, number, number][] = hasRoof
    ? roofEdge.map((p) => [p.x, topY + 7.3, p.z] as [number, number, number])
    : [[-70, 46, -58], [70, 46, -58]];
  for (const [x, y, z] of lights) {
    if (!hasRoof) {
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, y, 8), roofMat);
      pylon.position.set(x, y / 2, z);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.6), new THREE.MeshBasicMaterial({ color: "#fffaf0" }));
      panel.position.set(x, y, z);
      panel.lookAt(0, 0, 0);
      g.add(pylon, panel);
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: "#e9f1ff", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(hasRoof ? 16 : 30);
    halo.position.set(x, y, z);
    g.add(halo);
  }
  return { group: g, near, cheer };
}

/** A night sky: deep at the top, a floodlit haze glowing over the bowl at the horizon. */
function skyDome(sky: string): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#03050b");
  grd.addColorStop(0.55, sky);
  grd.addColorStop(0.8, "#1d2a52");
  grd.addColorStop(0.92, "#3b3f78");
  grd.addColorStop(1, "#2a2350");
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  return dome;
}

/** Edge darkening and a cool, slightly lifted grade: the broadcast look. */
const VIGNETTE = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.55 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5, 0.55));
      c.rgb *= mix(1.0, 1.0 - strength, smoothstep(0.35, 0.85, d));
      c.rgb = mix(c.rgb, c.rgb * vec3(0.94, 1.0, 1.08), 0.35);
      gl_FragColor = c;
    }`,
};

/** A glowing arc for a pass: it grows with the ball, then fades, so the last few passes trace the move. */
type Trail = { mesh: THREE.Mesh; tip: THREE.Mesh; born: number; t0: number; dur: number; total: number };
function trail(from: THREE.Vector2, to: THREE.Vector2, lift: number, colour: string): Omit<Trail, "born" | "t0" | "dur"> {
  const height = Math.max(0.6, lift);
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(from.x, 0.3, from.y), new THREE.Vector3((from.x + to.x) / 2, height * 2, (from.y + to.y) / 2), new THREE.Vector3(to.x, 0.3, to.y));
  const geo = new THREE.TubeGeometry(curve, 64, 0.2, 8, false);
  // Brightest at the ball's end, fading back towards the passer, like a comet.
  const base = new THREE.Color(colour);
  const cols: number[] = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const along = Math.floor(i / 9) / 64;                                          // 9 vertices round each ring
    const k = 0.15 + 0.85 * along * along;
    cols.push(base.r * k, base.g * k, base.b * k);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, toneMapped: false,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  const tip = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 32), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0, toneMapped: false, side: THREE.DoubleSide }));
  tip.rotation.x = -Math.PI / 2;
  tip.position.set(to.x, 0.05, to.y);
  return { mesh, tip, total: geo.index!.count };
}

/** Mountains on the horizon for a high-altitude city. */
function mountains(v: VenueStyle): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: "#1b2540" });
  const h = hash(v.city);
  for (let i = 0; i < 9; i++) {
    const height = 30 + ((h >>> i) % 7) * 9;
    const peak = new THREE.Mesh(new THREE.ConeGeometry(28 + ((h >>> (i + 3)) % 5) * 6, height, 5), mat);
    peak.position.set(-160 + i * 40, height / 2 - 2, -190 - ((h >>> (i + 5)) % 4) * 12);
    g.add(peak);
  }
  return g;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,0.95)");
  r.addColorStop(0.25, "rgba(255,240,200,0.35)");
  r.addColorStop(1, "rgba(255,240,200,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** LED boards around the pitch, glowing with the app's name and the host city's. */
function boards(city: string): THREE.Group {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, 0, c.width, 0);
  grd.addColorStop(0, "#0b3d2e");
  grd.addColorStop(0.5, "#0f6e4f");
  grd.addColorStop(1, "#0b3d2e");
  g.fillStyle = grd;
  g.fillRect(0, 0, c.width, c.height);
  g.font = "800 40px Inter, system-ui, sans-serif";
  g.fillStyle = "#d7ff3a";
  g.textBaseline = "middle";
  const text = city && !/neutral/i.test(city) ? `REGISTA · ${city.toUpperCase()}` : "REGISTA · LIVE";
  const step = g.measureText(text).width + 80;
  for (let x = 20; x < c.width; x += step) g.fillText(text, x, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  const group = new THREE.Group();
  const mat = (len: number) => {
    const t = tex.clone();
    t.repeat.set(len / 40, 1);
    t.needsUpdate = true;
    return new THREE.MeshBasicMaterial({ map: t });
  };
  for (const [x, z, len, rot] of [[0, -PITCH_H / 2 - 5, PITCH_W + 10, 0], [-PITCH_W / 2 - 5, 0, PITCH_H, Math.PI / 2], [PITCH_W / 2 + 5, 0, PITCH_H, -Math.PI / 2]] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(len, 1, 0.2), mat(len));
    b.position.set(x, 0.5, z);
    b.rotation.y = rot;
    group.add(b);
  }
  return group;
}

/** A white ball with dark panels, so its spin shows. */
function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f8f8f8";
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = "#1c1c1c";
  for (const [x, y] of [[32, 32], [96, 64], [160, 32], [224, 64], [64, 100], [192, 100], [128, 110], [0, 64]]) {
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13);
    }
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shirtTexture(kit: Kit, shirtNo: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = kit.shirt;
  g.fillRect(0, 0, c.width, c.height);
  if (kit.stripe) {
    g.fillStyle = kit.stripe;
    for (let x = 0; x < c.width; x += 32) g.fillRect(x + 16, 0, 16, c.height);
  }
  // The cylinder's texture wraps from the chest (u = 0) round to the back (u = 0.5): the number goes on the back.
  g.font = "800 66px Inter, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = kit.stripe ? kit.shirt : "rgba(0,0,0,0.25)";
  g.strokeText(String(shirtNo), c.width / 2, c.height / 2 + 4);
  g.fillStyle = kit.number;
  g.fillText(String(shirtNo), c.width / 2, c.height / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function part(geo: THREE.BufferGeometry, mat: THREE.Material, y: number, x = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** A low-poly footballer facing +z: boots, socks, legs, shorts, shirt with sleeves, arms, head and hair. */
function figure(kit: Kit, shirtNo: number, ringColour: string, scale = SCALE): Figure {
  const mat = (color: string, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  const skin = mat(SKINS[shirtNo % SKINS.length], 0.7);
  const shirt = mat(kit.shirt, 0.55);
  const shorts = mat(kit.shorts, 0.6);
  const socks = mat(kit.socks, 0.6);
  const boots = mat("#101010", 0.4);
  const body = new THREE.Group();

  const legs = ([-1, 1] as const).map((side) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.11, 0.92, 0);
    leg.add(part(new THREE.CylinderGeometry(0.11, 0.1, 0.3, 10), shorts, -0.14));
    leg.add(part(new THREE.CylinderGeometry(0.075, 0.065, 0.24, 8), skin, -0.4));
    leg.add(part(new THREE.CylinderGeometry(0.075, 0.065, 0.32, 8), socks, -0.68));
    leg.add(part(new THREE.BoxGeometry(0.11, 0.08, 0.25), boots, -0.88, 0, 0.05));
    body.add(leg);
    return leg;
  }) as [THREE.Group, THREE.Group];

  const torso = part(new THREE.CylinderGeometry(0.23, 0.19, 0.6, 24, 1, false), new THREE.MeshStandardMaterial({ map: shirtTexture(kit, shirtNo), roughness: 0.55 }), 1.22);
  torso.rotation.y = Math.PI;                                                  // the number (u = 0.5) faces backwards
  body.add(torso);
  const arms = ([-1, 1] as const).map((side) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.29, 1.47, 0);
    arm.add(part(new THREE.CylinderGeometry(0.075, 0.07, 0.22, 8), shirt, -0.11));
    arm.add(part(new THREE.CylinderGeometry(0.055, 0.05, 0.3, 8), skin, -0.37));
    arm.add(part(new THREE.SphereGeometry(0.055, 8, 6), skin, -0.54));
    body.add(arm);
    return arm;
  }) as [THREE.Group, THREE.Group];
  body.add(part(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), skin, 1.56));
  body.add(part(new THREE.SphereGeometry(0.125, 20, 16), skin, 1.7));
  const hair = part(new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(HAIR[(shirtNo * 3) % HAIR.length], 0.9), 1.71, 0, -0.01);
  body.add(hair);
  body.scale.setScalar(scale);

  const group = new THREE.Group();
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.16 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.75, 36), new THREE.MeshBasicMaterial({ color: ringColour, transparent: true, opacity: 0.85 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(shadow, ring, body);
  return { group, body, ring, legs, arms, pos: new THREE.Vector2(), phase: shirtNo, heading: 0 };
}

/** A label sprite ("10 · Kane") that floats above the player on the ball. */
function labelSprite(): { sprite: THREE.Sprite; set: (text: string) => void } {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const g = c.getContext("2d")!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(11, 2.06, 1);
  let last = "";
  const set = (text: string) => {
    if (text === last) return;
    last = text;
    g.clearRect(0, 0, c.width, c.height);
    g.font = "600 44px Inter, system-ui, sans-serif";
    const w = Math.min(c.width - 8, g.measureText(text).width + 40);
    g.fillStyle = "rgba(7,11,20,0.82)";
    g.beginPath();
    g.roundRect((c.width - w) / 2, 14, w, 68, 34);
    g.fill();
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, c.width / 2, 49);
    tex.needsUpdate = true;
  };
  return { sprite, set };
}

export function Pitch3D({ events, home, away, homeColor, awayColor, label, feed, venue, camera: cameraMode = "wide" }: Props) {
  const mode = useRef(cameraMode);
  mode.current = cameraMode;
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(events);
  latest.current = events;
  const onFrame = useRef(feed?.onFrame);
  onFrame.current = feed?.onFrame;
  const feedClock = useRef(feed?.clock);
  feedClock.current = feed?.clock;
  const burnTimecode = useRef(feed?.timecode ?? false);
  burnTimecode.current = feed?.timecode ?? false;
  const ballColour = feed?.ballColour;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(venue.sky);
    scene.fog = new THREE.Fog(venue.sky, 130, 300);
    const cinematic = !ballColour;                                                         // the feed stays plain for the detector
    if (cinematic) {
      scene.add(skyDome(venue.sky));
      // Image-based light, so kits, boards and roofs pick up the floodlights instead of looking flat.
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.26;
      renderer.toneMappingExposure = 0.95;
      pmrem.dispose();
    }
    scene.add(new THREE.HemisphereLight("#d6e4ff", "#173017", 0.85));
    // The floodlights' combined key light, casting the players' shadows on the grass.
    const sun = new THREE.DirectionalLight("#fff6e8", 2.1);
    sun.position.set(30, 80, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -64, right: 64, top: 44, bottom: -44, near: 10, far: 220 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    // A cool rim light from the far stand, so players stand out from the grass.
    const rim = new THREE.DirectionalLight("#9cc3ff", cinematic ? 1.1 : 0);
    rim.position.set(0, 25, -70);
    scene.add(rim);
    const fill = new THREE.DirectionalLight("#9fb8ff", 0.5);
    fill.position.set(-40, 50, -30);
    scene.add(fill);

    const surround = new THREE.Mesh(new THREE.PlaneGeometry(170, 120), new THREE.MeshStandardMaterial({ color: "#123d22", roughness: 1 }));
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.02;
    scene.add(surround);
    const turf = pitchTexture(venue.mowing);
    turf.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(PITCH_W, PITCH_H), new THREE.MeshStandardMaterial({
      map: turf, roughness: 0.88,
      // The markings glow a little under the bloom, like floodlit paint.
      ...(cinematic ? { emissiveMap: pitchTexture(venue.mowing, true), emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.22 } : {}),
    }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    surround.receiveShadow = true;
    const kits = matchKits(home, away);
    const homeKit = kits.home, awayKit = kits.away;
    const ground = stands(venue, [homeKit.shirt, homeKit.stripe ?? homeKit.shorts], [awayKit.shirt, awayKit.stripe ?? awayKit.shorts], !!ballColour);
    const goalScale = ballColour ? 1.25 : 1.7;                                               // in proportion to the figures
    scene.add(pitch, goal(1, goalScale), goal(-1, goalScale), ground.group, ground.near, boards(venue.city));
    if (venue.mountains) scene.add(mountains(venue));

    // Players: a figure per squad member, shown while they're on the pitch.
    const figures = new Map<string, Figure>();
    const sides = [
      { team: home, colour: homeColor, isHome: true },
      { team: away, colour: awayColor, isHome: false },
    ];
    for (const s of sides)
      for (const p of s.team.players) {
        const kit = p.position === "GK" ? kitFor(s.team, s.isHome ? "home" : "away") : s.isHome ? kits.home : kits.away;
        // In the feed players are drawn closer to life size, as a wide broadcast camera sees them.
        const f = figure(kit, p.shirt, s.colour, ballColour ? 1.5 : SCALE);
        f.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        f.group.visible = false;
        figures.set(p.player_id, f);
        scene.add(f.group);
      }
    const xi = new Map(sides.map((s) => [s.team.team_id, currentXI(s.team, latest.current)]));

    // Dugouts on the far touchline: substitutes in training bibs, staff in tracksuits, the manager in a suit pacing
    // the technical area (celebrating his team's goals), and the fourth official between them.
    const people = ballColour ? 1.5 : SCALE;
    const dugoutZ = -(PITCH_H / 2 + 3.4);
    const shell = new THREE.MeshStandardMaterial({ color: "#1f2937", roughness: 0.7 });
    const perspex = new THREE.MeshStandardMaterial({ color: "#9fb3c8", transparent: true, opacity: 0.28, roughness: 0.1 });
    const line = new THREE.MeshBasicMaterial({ color: "#e8eef5" });
    type Coach = { fig: Figure; x: number; team: string; cheerUntil: number; phase: number };
    const coaches: Coach[] = [];
    const warmers: { fig: Figure; id: string; centre: number; phase: number }[] = [];
    const benchFigs = new Map<string, Figure>();
    const seat = (f: Figure, x: number) => {
      f.ring.visible = false;
      f.legs.forEach((l) => (l.rotation.x = -1.45));
      f.body.position.y = -0.4 * people;
      f.group.position.set(x, 0.5, dugoutZ - 1.6);
      f.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      scene.add(f.group);
    };
    for (const sd of sides) {
      const x0 = (sd.isHome ? -1 : 1) * 12;
      const kit = sd.isHome ? kits.home : kits.away;
      // A modern dugout: a curved glass canopy over padded seats in the team's colour.
      const shelter = new THREE.Group();
      const floor = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.12, 2.6), shell);
      floor.position.set(0, 0.06, 0);
      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 10.6, 28, 1, true, 0, Math.PI), perspex);
      canopy.rotation.z = Math.PI / 2;
      canopy.rotation.y = Math.PI / 2;
      canopy.position.set(0, 1.1, -0.2);
      const seatMat = new THREE.MeshStandardMaterial({ color: kit.shirt === "#ffffff" || kit.shirt === "#FFFFFF" ? kit.shorts : kit.shirt, roughness: 0.5 });
      for (let i = 0; i < 9; i++) {
        const sx = -4.2 + i * 1.05;
        const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.16, 0.6), seatMat);
        cushion.position.set(sx, 0.5, -0.25);
        const rest = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.9, 0.14), seatMat);
        rest.position.set(sx, 0.95, -0.6);
        shelter.add(cushion, rest);
      }
      shelter.add(floor, canopy);
      shelter.position.set(x0, 0, dugoutZ - 1.4);
      scene.add(shelter);
      // The technical area, marked on the grass in front of the dugout.
      for (const [w, d, x, z] of [[10, 0.12, x0, dugoutZ + 2.6], [0.12, 2.8, x0 - 5, dugoutZ + 1.2], [0.12, 2.8, x0 + 5, dugoutZ + 1.2]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), line);
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.02, z);
        scene.add(m);
      }
      const subs = sd.team.players.filter((p) => !p.starter);
      const bib: Kit = { shirt: BIBS[sd.isHome ? "home" : "away"], shorts: kit.shorts, socks: kit.socks, number: "#111111" };
      const tracksuit: Kit = { shirt: kit.shorts, shorts: kit.shorts, socks: kit.shorts, number: kit.shorts };
      // Three substitutes warm up along the touchline near their corner; the rest sit with two of the staff.
      subs.slice(0, 3).forEach((p, i) => {
        const f = figure(bib, p.shirt, sd.colour, people);
        f.ring.visible = false;
        f.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        scene.add(f.group);
        warmers.push({ fig: f, id: p.player_id, centre: (sd.isHome ? -1 : 1) * (36 + i * 3), phase: i * 1.7 });
      });
      const seated = [...subs.slice(3, 9).map((p) => ({ k: bib, n: p.shirt, id: p.player_id })), { k: tracksuit, n: 30, id: "" }, { k: tracksuit, n: 31, id: "" }];
      seated.forEach((st, i) => {
        const f = figure(st.k, st.n, sd.colour, people);
        seat(f, x0 - 4.2 + i * 1.05);
        if (st.id) benchFigs.set(st.id, f);
      });
      const suit: Kit = { shirt: "#1f2937", shorts: "#111827", socks: "#111827", number: "#1f2937" };
      const manager = figure(suit, sd.isHome ? 40 : 41, sd.colour, people);
      manager.ring.visible = false;
      manager.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      manager.group.position.set(x0, 0, dugoutZ + 1.4);
      scene.add(manager.group);
      coaches.push({ fig: manager, x: x0, team: sd.team.team_id, cheerUntil: 0, phase: sd.isHome ? 0 : 2 });
      // An assistant stands at the edge of the technical area, arms folded.
      const assistant = figure(tracksuit, sd.isHome ? 42 : 43, sd.colour, people);
      assistant.ring.visible = false;
      assistant.arms.forEach((a) => (a.rotation.x = -0.9));
      assistant.group.position.set(x0 + (sd.isHome ? 4 : -4), 0, dugoutZ + 0.9);
      assistant.group.rotation.y = 0;
      scene.add(assistant.group);
    }
    const fourth = figure({ shirt: "#111111", shorts: "#111111", socks: "#111111", number: "#111111" }, 4, "#000000", people);
    fourth.ring.visible = false;
    fourth.group.position.set(0, 0, dugoutZ + 1);
    scene.add(fourth.group);
    // The fourth official's substitution board: raised with the real numbers off (red) and on (green).
    const boardCanvas = document.createElement("canvas");
    boardCanvas.width = 256;
    boardCanvas.height = 128;
    const boardTex = new THREE.CanvasTexture(boardCanvas);
    boardTex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.75, 0.08), new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false }));
    board.visible = false;
    scene.add(board);
    let boardUntil = 0;
    const showBoard = (off: number | undefined, on: number | undefined, now: number) => {
      const g = boardCanvas.getContext("2d")!;
      g.fillStyle = "#050505";
      g.fillRect(0, 0, 256, 128);
      g.font = "800 64px Inter, system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#ff3b3b";
      g.fillText(String(off ?? "–"), 68, 66);
      g.fillStyle = "#3bff6e";
      g.fillText(String(on ?? "–"), 188, 66);
      boardTex.needsUpdate = true;
      boardUntil = now + 6;
    };
    let lastScore = "";
    let crowdCheerUntil = 0;

    const ballR = ballColour ? FEED_BALL_RADIUS : 0.3;
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(ballR, 3), ballColour
      ? new THREE.MeshBasicMaterial({ color: ballColour, toneMapped: false })                    // a flat hi-vis colour the detector can find
      : new THREE.MeshStandardMaterial({ map: ballTexture(), emissive: "#333333", roughness: 0.35 }));
    ball.castShadow = true;
    const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.35, 16), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.4 }));
    ballShadow.rotation.x = -Math.PI / 2;
    ballShadow.position.y = 0.02;
    scene.add(ball, ballShadow);
    const tag = labelSprite();
    scene.add(tag.sprite);

    const camera = new THREE.PerspectiveCamera(ballColour ? FEED_CAMERA.fov : 31, 16 / 9, 0.5, 600);

    // Burned-in timecode for the feed: a strip of cells at the bottom left, drawn over the picture.
    const hud = new THREE.Scene();
    const hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    const cells = TIMECODE.bits + 2;
    const tcCanvas = document.createElement("canvas");
    tcCanvas.width = cells;
    tcCanvas.height = 1;
    const tcTex = new THREE.CanvasTexture(tcCanvas);
    tcTex.magFilter = THREE.NearestFilter;
    tcTex.minFilter = THREE.NearestFilter;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(cells * TIMECODE.cellW, TIMECODE.cellH), new THREE.MeshBasicMaterial({ map: tcTex, toneMapped: false }));
    strip.position.set(TIMECODE.x + (cells * TIMECODE.cellW) / 2, 1 - TIMECODE.y - TIMECODE.cellH / 2, 0);
    hud.add(strip);
    let stamped = -1;
    const stamp = (seconds: number) => {
      const tenths = Math.round(seconds * 10);
      if (tenths === stamped) return;
      stamped = tenths;
      const g = tcCanvas.getContext("2d")!;
      timecodeCells(seconds).forEach((on, i) => { g.fillStyle = on ? "#ffffff" : "#000000"; g.fillRect(i, 0, 1, 1); });
      tcTex.needsUpdate = true;
    };
    let camX = 0;
    let zoom = 0;
    // Wide view: the whole stadium from high above the near stand; drag to orbit, scroll to zoom.
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.enablePan = false;
    orbit.minDistance = 45;
    orbit.maxDistance = 230;
    orbit.maxPolarAngle = 1.32;
    orbit.target.set(0, 0, -4);
    camera.position.set(0, 70, 112);
    orbit.update();
    if (ballColour) {                                   // the auto-eventing feed keeps its fixed, calibrated camera
      orbit.enabled = false;
      ground.near.visible = false;
    }
    let lastMode = "";

    // The ball's current flight: from → to over `dur` seconds, with an arc for lofted balls.
    const flight = { from: new THREE.Vector2(), to: new THREE.Vector2(), t0: 0, dur: 0.01, lift: 0 };
    // Before a touch the ball runs to where it starts (no teleports), slower than any pass.
    const glide = { from: new THREE.Vector2(), to: new THREE.Vector2(), t0: 0, dur: 0 };
    let shownId = "";
    let actorId: string | undefined;

    // Post-processing for the broadcast view: bloom on lights and lines, vignette and grade, 4x MSAA.
    const composer = cinematic
      ? new EffectComposer(renderer, new THREE.WebGLRenderTarget(640, 360, { samples: 4, type: THREE.HalfFloatType }))
      : null;
    const bloom = new UnrealBloomPass(new THREE.Vector2(640, 360), 0.5, 0.4, 0.87);    // lights, lines, trails and white kits glow softly
    if (composer) {
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(bloom);
      composer.addPass(new ShaderPass(VIGNETTE));
      composer.addPass(new OutputPass());
    }

    // Camera flashes sparkling in the crowd.
    const flashes: { sprite: THREE.Sprite; until: number }[] = [];
    if (cinematic) {
      const fg = glowTexture();
      for (let i = 0; i < 36; i++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: fg, color: "#ffffff", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        sprite.visible = false;
        scene.add(sprite);
        flashes.push({ sprite, until: 0 });
      }
    }
    const trails: Trail[] = [];
    const passTag = labelSprite();
    passTag.sprite.scale.multiplyScalar(0.8);
    passTag.sprite.visible = false;
    scene.add(passTag.sprite);
    let passTagAt = -10;
    const glowUnder = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), new THREE.MeshBasicMaterial({
      map: glowTexture(), color: "#5eead4", transparent: true, opacity: cinematic ? 0.55 : 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glowUnder.rotation.x = -Math.PI / 2;
    glowUnder.position.y = 0.04;
    scene.add(glowUnder);

    const resize = () => {
      const w = el.clientWidth || 640;
      const h = Math.round(w * (ballColour ? 9 / 16 : 0.56));
      renderer.setSize(w, h, false);
      composer?.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      composer?.setSize(w, h);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "auto";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const clock = new THREE.Clock();
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.1);
      const now = clock.elapsedTime;
      const evs = latest.current;
      const e = evs[evs.length - 1];

      if (e && e.id !== shownId) {
        shownId = e.id;
        if (BALL_EVENTS.has(e.type)) {
          const { from, to } = ballPath(e, home.team_id);
          const start = world(...from);
          const here = new THREE.Vector2(ball.position.x, ball.position.z);
          const placed = here.lengthSq() > 0;
          glide.from.copy(placed ? here : start);
          glide.to.copy(start);
          glide.t0 = now;
          glide.dur = placed ? Math.min(1.2, here.distanceTo(start) / 6) : 0;
          flight.from.copy(start);
          flight.to.copy(world(...to));
          const dist = flight.from.distanceTo(flight.to);
          const kmh = e.type === "shot" ? e.shot_speed_kmh : e.ball_speed_kmh ?? e.speed_kmh;
          // The feed runs in real time with the ball at its recorded speed, so speeds measured from it are true.
          flight.t0 = now + glide.dur + (ballColour ? 0.3 : 0.05);
          flight.dur = ballColour ? (kmh ? dist / (kmh / 3.6) : Math.max(0.3, dist / 6)) : Math.min(1.1, Math.max(0.25, dist / 30));
          flight.lift = e.type === "shot" ? Math.min(2.2, dist / 14) : LOFTED.has(e.pass_type ?? "") || (e.pass_length ?? 0) > 28 ? Math.min(9, dist / 5) : 0;
          if (cinematic && (e.type === "pass" || e.type === "shot") && dist > 3) {
            const t = trail(flight.from, flight.to, flight.lift, e.type === "shot" ? "#ffb347" : e.team_id === home.team_id ? "#5eead4" : "#a78bfa");
            t.mesh.geometry.setDrawRange(0, 0);
            scene.add(t.mesh, t.tip);
            trails.push({ ...t, born: now, t0: flight.t0, dur: flight.dur });
            const kmh = e.type === "shot" ? e.shot_speed_kmh : e.ball_speed_kmh;
            const metres = e.pass_length ?? dist;
            passTag.set(`${e.type === "shot" ? "Shot · " : ""}${Math.round(metres)} m${kmh ? ` · ${Math.round(kmh)} km/h` : ""}`);
            passTag.sprite.position.set((flight.from.x + flight.to.x) / 2, Math.max(3.2, flight.lift * 2 + 2.4), (flight.from.y + flight.to.y) / 2);
            passTagAt = flight.t0;
            while (trails.length > 6) {
              const old = trails.shift()!;
              scene.remove(old.mesh, old.tip);
              old.mesh.geometry.dispose();
              old.tip.geometry.dispose();
            }
          }
        }
        actorId = e.player_id;
        if (e.type === "substitution") {
          const squad = (e.team_id === home.team_id ? home : away).players;
          showBoard(squad.find((p) => p.player_id === e.sub_out)?.shirt, squad.find((p) => p.player_id === e.sub_in)?.shirt, now);
        }
        // A goal: that team's manager celebrates.
        const score = `${e.score?.home ?? 0}-${e.score?.away ?? 0}`;
        if (lastScore && score !== lastScore) {
          const [h0, a0] = lastScore.split("-").map(Number);
          const scorer = (e.score?.home ?? 0) > h0 ? home.team_id : (e.score?.away ?? 0) > a0 ? away.team_id : null;
          for (const c of coaches) if (c.team === scorer) c.cheerUntil = now + 3.5;
          if (scorer) crowdCheerUntil = now + 4;
        }
        lastScore = score;
        const team = e.team_id;
        const squad = (team === home.team_id ? home : away).players;
        for (const sd of sides) xi.set(sd.team.team_id, currentXI(sd.team, evs));          // substitutions so far
        xi.set(team, withPlayer(withPlayer(xi.get(team) ?? [], squad, e.player_id), squad, e.recipient_id));
        const shirt = squad.find((p) => p.player_id === e.player_id)?.shirt;
        // "Pakistan No. 10" (no name in the dataset) reads "No. 10"; a named player reads "10 Kane".
        const unnamed = /No\. \d+$/.test(e.player_name ?? "");
        const name = e.player_name?.split(" ").slice(-1)[0];
        tag.set(unnamed ? `No. ${shirt ?? name}` : name ? `${shirt ?? ""} ${name}`.trim() : "");
      }

      // Ball: running to the touch, resting for it, then along its flight (constant speed in the feed).
      let bx: number, bz: number, by = ballR, k = 1;
      if (now < flight.t0) {
        const g = glide.dur ? Math.min(1, (now - glide.t0) / glide.dur) : 1;
        bx = glide.from.x + (glide.to.x - glide.from.x) * g;
        bz = glide.from.y + (glide.to.y - glide.from.y) * g;
      } else {
        k = Math.min(1, (now - flight.t0) / flight.dur);
        const eased = ballColour ? k : 1 - (1 - k) * (1 - k);
        bx = flight.from.x + (flight.to.x - flight.from.x) * eased;
        bz = flight.from.y + (flight.to.y - flight.from.y) * eased;
        by = ballR + flight.lift * 4 * k * (1 - k);
      }
      ball.position.set(bx, by, bz);
      ball.rotation.x += dt * (k < 1 ? 14 : 0);
      ballShadow.position.set(bx, 0.02, bz);
      ballShadow.scale.setScalar(Math.max(0.5, 1 - by / 10));

      // Players: each team's shape around the ball; the player on the ball at the ball, the receiver at its end.
      const poss = possessionTeam(evs.slice(-12));
      for (const s of sides) {
        const team = s.team.team_id;
        const slots = xi.get(team) ?? [];
        const spots = new Map(slots.map((sl) => [sl.player.player_id, sl.spot]));
        const ballHome: [number, number] = [bx + PITCH_W / 2, PITCH_H / 2 - bz];
        const ballOwn = toHomeFrame(ballHome[0], ballHome[1], s.isHome);
        const onIds = new Set(slots.map((sl) => sl.player.player_id));
        for (const p of s.team.players) {
          const f = figures.get(p.player_id)!;
          f.group.visible = onIds.has(p.player_id);
          if (!f.group.visible) continue;
          let target: THREE.Vector2;
          // The passer stands just behind the ball, the receiver just beyond where it stops.
          const dir = flight.to.clone().sub(flight.from);
          if (dir.lengthSq() > 0) dir.normalize();
          if (e && p.player_id === actorId && e.team_id === team)
            target = e.type === "carry" || e.type === "dribble" ? new THREE.Vector2(bx, bz).addScaledVector(dir, -0.9) : flight.from.clone().addScaledVector(dir, -1);
          else if (e && p.player_id === e.recipient_id) target = flight.to.clone().addScaledVector(dir, 1);
          else {
            const own = shiftedSpot(spots.get(p.player_id) ?? [50, 34], ballOwn, poss === team, p.position === "GK");
            target = world(...toHomeFrame(own[0], own[1], s.isHome));
            // A little life: players drift around their spot.
            const seed = p.shirt * 1.7;
            target.x += Math.sin(now * 0.6 + seed) * 0.8;
            target.y += Math.cos(now * 0.5 + seed) * 0.6;
          }
          if (!f.pos.lengthSq()) f.pos.copy(target);
          const prevX = f.pos.x;
          const prevZ = f.pos.y;
          const receiving = !!e && p.player_id === e.recipient_id;
          f.pos.lerp(target, 1 - Math.exp(-dt * (receiving ? 5.5 : 3.2)));
          f.group.position.set(f.pos.x, 0, f.pos.y);
          const isActor = p.player_id === actorId;
          f.ring.visible = !ballColour;
          (f.ring.material as THREE.MeshBasicMaterial).color.set(isActor ? ACTOR_RING : s.colour);
          f.ring.scale.setScalar(isActor ? 1.3 : 1);
        (f.ring.material as THREE.MeshBasicMaterial).opacity = isActor ? 0.95 : 0.55;
          if (isActor) tag.sprite.position.set(f.pos.x, 5.8, f.pos.y);

          // Run cycle from the speed; face the way they run, or the ball when standing.
          const speed = Math.hypot(f.pos.x - prevX, f.pos.y - prevZ) / Math.max(dt, 1e-3);
          const stride = Math.min(1, speed / 4);
          f.phase += dt * (5 + speed * 1.6);
          const swing = Math.sin(f.phase) * 0.85 * stride;
          f.legs[0].rotation.x = swing;
          f.legs[1].rotation.x = -swing;
          f.arms[0].rotation.x = -swing * 0.8;
          f.arms[1].rotation.x = swing * 0.8;
          f.body.position.y = Math.abs(Math.sin(f.phase)) * 0.06 * stride;
          // The player on the ball strikes it as each pass or shot leaves.
          const sinceKick = now - flight.t0;
          if (isActor && e && STRIKES.has(e.type) && sinceKick < 0.35) f.legs[1].rotation.x = -1.25 * Math.sin((sinceKick / 0.35) * Math.PI);
          const face = speed > 0.8 ? Math.atan2(f.pos.x - prevX, f.pos.y - prevZ) : Math.atan2(bx - f.pos.x, bz - f.pos.y);
          let turn = face - f.heading;
          turn = Math.atan2(Math.sin(turn), Math.cos(turn));
          f.heading += turn * (1 - Math.exp(-dt * 6));
          f.group.rotation.y = f.heading;
        }
      }
      tag.sprite.visible = !!actorId && !ballColour;

      ground.cheer(now, crowdCheerUntil);
      const onNow = new Set([...xi.values()].flatMap((sl) => sl.map((x) => x.player.player_id)));
      for (const w of warmers) {
        w.fig.group.visible = !onNow.has(w.id);
        const t = now * 0.5 + w.phase;
        const x = w.centre + Math.sin(t) * 5;
        const vx = Math.cos(t) * 2.5;
        w.fig.group.position.set(x, 0, dugoutZ + 1.6 + Math.sin(w.phase) * 0.6);
        w.fig.group.rotation.y = vx > 0 ? Math.PI / 2 : -Math.PI / 2;
        w.fig.phase += dt * 7;
        const sw = Math.sin(w.fig.phase) * 0.7;
        w.fig.legs[0].rotation.x = sw;
        w.fig.legs[1].rotation.x = -sw;
        w.fig.arms[0].rotation.x = -sw * 0.7;
        w.fig.arms[1].rotation.x = sw * 0.7;
      }
      for (const [id, f] of benchFigs) f.group.visible = !onNow.has(id);
      const raising = now < boardUntil;
      board.visible = raising;
      fourth.arms.forEach((a) => (a.rotation.x = raising ? -2.9 : 0));
      if (raising) board.position.set(fourth.group.position.x, 2.2 * people + 0.6, fourth.group.position.z + 0.2);

      // Managers pace their technical areas, facing the play; arms up and a hop after a goal.
      for (const c of coaches) {
        const f = c.fig;
        const x = c.x + Math.sin(now * 0.33 + c.phase) * 2.6;
        const vx = Math.cos(now * 0.33 + c.phase) * 0.86;
        f.group.position.x = x;
        f.group.rotation.y = Math.atan2(bx - x, bz - f.group.position.z) * 0.6;
        const cheering = now < c.cheerUntil;
        f.phase += dt * (4 + Math.abs(vx) * 3);
        const swing = Math.sin(f.phase) * 0.5 * Math.min(1, Math.abs(vx));
        f.legs[0].rotation.x = swing;
        f.legs[1].rotation.x = -swing;
        f.arms[0].rotation.x = cheering ? -2.9 : -swing * 0.6;
        f.arms[1].rotation.x = cheering ? -2.9 : swing * 0.6;
        f.body.position.y = cheering ? Math.abs(Math.sin(now * 9)) * 0.25 : 0;
      }

      // Broadcast camera: high on the near touchline, following the ball along the pitch.
      if (ballColour) {
        camera.position.set(...FEED_CAMERA.position);                                          // fixed and calibrated
        camera.lookAt(...FEED_CAMERA.target);
        renderer.render(scene, camera);
        if (burnTimecode.current) {
          stamp(feedClock.current?.() ?? 0);
          renderer.autoClear = false;
          renderer.render(hud, hudCam);
          renderer.autoClear = true;
        }
        onFrame.current?.(renderer.domElement);
        return;
      }
      // Trails grow with the ball, then fade; the newest is brightest.
      trails.forEach((t, i) => {
        const grow = Math.min(1, Math.max(0, (now - t.t0) / t.dur));
        t.mesh.geometry.setDrawRange(0, Math.floor((t.total * grow) / 3) * 3);
        const age = now - t.born;
        const fade = Math.max(0, 1 - age / 7) * (0.35 + 0.65 * ((i + 1) / trails.length));
        (t.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * fade;
        const landed = grow >= 1 ? Math.min(1, (now - t.t0 - t.dur) / 0.6) : 0;
        (t.tip.material as THREE.MeshBasicMaterial).opacity = landed > 0 ? (1 - landed) * 0.9 * fade + 0.2 * fade : 0;
        t.tip.scale.setScalar(1 + landed * 1.5);
      });
      // The pass label shows while the ball travels and a moment after, then fades.
      const sincePass = now - passTagAt;
      passTag.sprite.visible = cinematic && sincePass > 0 && sincePass < 2.4;
      (passTag.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, Math.max(0, 2.4 - sincePass));
      const actorFig = actorId ? figures.get(actorId) : undefined;
      if (actorFig?.group.visible) glowUnder.position.set(actorFig.pos.x, 0.04, actorFig.pos.y);
      glowUnder.visible = !!actorFig?.group.visible;
      for (const f of flashes) {
        if (now > f.until && Math.random() < dt * 0.9) {
          // Somewhere in the far stand, where the camera sees the crowd.
          const depth = Math.random() * 22;
          f.sprite.position.set((Math.random() - 0.5) * 120, 2.5 + depth * 0.62, -(PITCH_H / 2 + 9 + depth));
          f.sprite.scale.setScalar(1.2 + Math.random());
          f.until = now + 0.08 + Math.random() * 0.08;
        }
        f.sprite.visible = now < f.until;
      }

      const wide = mode.current === "wide";
      if (wide !== (lastMode === "wide")) {
        lastMode = mode.current;
        ground.near.visible = wide;                       // the follow camera sits in the near stand
        orbit.enabled = wide;
        if (wide) {
          camera.position.set(0, 70, 112);
          orbit.target.set(0, 0, -4);
        }
      }
      if (wide) {
        orbit.update();
        if (composer) composer.render();
        else renderer.render(scene, camera);
        return;
      }
      // Follow the ball; in the final third the camera reaches the goal and moves in a little, as a director would.
      const want = reduceMotion ? 0 : THREE.MathUtils.clamp(bx * 0.75, -32, 32);
      camX += (want - camX) * (1 - Math.exp(-dt * 1.6));
      const near = reduceMotion ? 0 : THREE.MathUtils.smoothstep(Math.abs(bx), 24, 44);
      zoom += (near - zoom) * (1 - Math.exp(-dt * 1.2));
      camera.position.set(camX, 34 - 6 * zoom, 66 - 12 * zoom);
      camera.lookAt(camX + Math.sign(bx) * 8 * zoom, 2, -4);
      if (composer) composer.render();
      else renderer.render(scene, camera);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((m) => {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        });
      });
      orbit.dispose();
      composer?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [home, away, homeColor, awayColor, ballColour, venue]);

  return <div ref={host} className="pitch-3d" role="img" aria-label={label} />;
}
