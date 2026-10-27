import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { MatchEvent, Team } from "../api/types";
import { PITCH_H, PITCH_W, toHomeFrame } from "../lib/format";
import { BIBS, kitFor, type Kit } from "../lib/kits";
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
   *  its real speed, no rings or name tags). `onFrame` gets the canvas right after each frame is drawn. */
  feed?: { ballColour: string; onFrame: (canvas: HTMLCanvasElement) => void; clock: () => number };
  /** The ground for this match's venue (lib/venue.ts). */
  venue: VenueStyle;
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

function pitchTexture(mowing: VenueStyle["mowing"] = "stripes"): THREE.CanvasTexture {
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
  // Grain, so the grass doesn't look like flat paint up close.
  for (let n = 0; n < 60000; n++) {
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

function goal(side: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: "#f4f6f8", roughness: 0.4 });
  const post = new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8);
  for (const z of [-3.66, 3.66]) {
    const p = new THREE.Mesh(post, white);
    p.position.set(0, 1.22, z);
    g.add(p);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32, 8), white);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, 2.44, 0);
  g.add(bar);
  const net = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.44, 7.32), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.12, wireframe: true }));
  net.position.set(side * 0.9, 1.22, 0);
  g.add(net);
  g.position.set((side * PITCH_W) / 2, 0, 0);
  return g;
}

/** The stands for this venue: one to three tiers, open, cantilevered roof or a closed bowl, seats in its colours. */
function stadium(v: VenueStyle): THREE.Group {
  const g = new THREE.Group();
  const seatA = new THREE.MeshStandardMaterial({ color: v.seats[0], roughness: 0.9 });
  const seatB = new THREE.MeshStandardMaterial({ color: v.seats[1], roughness: 0.9 });
  const concrete = new THREE.MeshStandardMaterial({ color: "#151b28", roughness: 0.8 });
  const roof = new THREE.MeshStandardMaterial({ color: "#0e1420", roughness: 0.6, metalness: 0.3 });
  // Far side and both ends: the broadcast camera sits in the near stand, so that one stays out of the picture.
  const sides: [number, number, number, number][] = [
    [0, -PITCH_H / 2 - 12, 150, Math.PI], [PITCH_W / 2 + 13, 0, 96, -Math.PI / 2], [-PITCH_W / 2 - 13, 0, 96, Math.PI / 2],
  ];
  const top = 5 + v.tiers * 8;
  for (const [x, z, len, rot] of sides) {
    const side = new THREE.Group();
    for (let t = 0; t < v.tiers; t++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 14), t % 2 ? seatB : seatA);
      tier.rotation.x = -0.55;
      tier.position.set(0, 4 + t * 8, 3 + t * 9);
      tier.receiveShadow = true;
      side.add(tier);
      if (t) {                                                                              // the front of an upper tier
        const lip = new THREE.Mesh(new THREE.BoxGeometry(len, 1.4, 0.8), concrete);
        lip.position.set(0, 1 + t * 8, -3 + t * 9);
        side.add(lip);
      }
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, top, 1), concrete);
    back.position.set(0, top / 2, 9 + v.tiers * 9);
    side.add(back);
    if (v.roof !== "open") {
      const lid = new THREE.Mesh(new THREE.BoxGeometry(len, 0.7, 10 + v.tiers * 6), roof);
      lid.position.set(0, top + 1, 4 + v.tiers * 6);
      lid.rotation.x = 0.08;
      side.add(lid);
    }
    side.position.set(x, 0, z);
    side.rotation.y = rot;
    g.add(side);
  }
  if (v.roof === "bowl") {
    // Closed corners, so the stands wrap round the pitch.
    for (const [x, z] of [[-1, -1], [1, -1]] as const) {
      const corner = new THREE.Mesh(new THREE.CylinderGeometry(14 + v.tiers * 8, 10, top, 6, 1, true, 0, Math.PI / 2), seatA);
      corner.material = new THREE.MeshStandardMaterial({ color: v.seats[0], roughness: 0.9, side: THREE.DoubleSide });
      corner.position.set(x * (PITCH_W / 2 + 8), top / 2, z * (PITCH_H / 2 + 8));
      corner.rotation.y = Math.atan2(x, z) - Math.PI / 4;
      g.add(corner);
    }
  }
  // Floodlights: corner pylons for open grounds, lights along the roof edge where there's a roof.
  const glow = glowTexture();
  const lights: [number, number, number][] = v.roof === "open"
    ? [[-62, 40, -48], [62, 40, -48]]
    : [-45, -15, 15, 45].map((x) => [x, top + 2, -(PITCH_H / 2 + 14)] as [number, number, number]);
  for (const [x, y, z] of lights) {
    if (v.roof === "open") {
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, y, 8), roof);
      pylon.position.set(x, y / 2, z);
      g.add(pylon);
    }
    const panel = new THREE.Mesh(new THREE.BoxGeometry(v.roof === "open" ? 7 : 5, 2.4, 0.6), new THREE.MeshBasicMaterial({ color: "#fffaf0" }));
    panel.position.set(x, y, z);
    panel.lookAt(0, 0, 0);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: "#fff4d6", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(v.roof === "open" ? 26 : 16);
    halo.position.set(x, y, z);
    g.add(panel, halo);
  }
  return g;
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
  const text = `REGISTA · ${city.toUpperCase()}`;
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
  for (const [x, z, len, rot] of [[0, -PITCH_H / 2 - 6, PITCH_W + 10, 0], [-PITCH_W / 2 - 5, 0, PITCH_H, Math.PI / 2], [PITCH_W / 2 + 5, 0, PITCH_H, -Math.PI / 2]] as const) {
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

/** Spectators on the stands: fans in both teams' colours among the seats. */
function crowd(v: VenueStyle, homeColours: string[], awayColours: string[]): THREE.Points {
  const pts: number[] = [];
  const colours: number[] = [];
  const palette = [...homeColours, ...homeColours, ...awayColours, v.seats[0], v.seats[1], "#2b3550", "#8a97b3", "#c9a27e"].map((c) => new THREE.Color(c));
  for (let i = 0; i < 9000 + v.tiers * 5000; i++) {
    const side = 1 + (i % 3);                                                     // not the near stand, behind the camera
    const depth = Math.random() * (v.tiers * 9 + 3);
    const along = (Math.random() - 0.5) * (side < 2 ? 140 : 90);
    const h = 1.6 + depth * 0.62 + Math.floor(depth / 9) * 1.5;
    const [x, z] = side === 0 ? [along, PITCH_H / 2 + 9 + depth] : side === 1 ? [along, -PITCH_H / 2 - 9 - depth]
      : side === 2 ? [PITCH_W / 2 + 10 + depth, along] : [-PITCH_W / 2 - 10 - depth, along];
    pts.push(x, h, z);
    const c = palette[i % palette.length];
    colours.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, opacity: 0.9 }));
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

export function Pitch3D({ events, home, away, homeColor, awayColor, label, feed, venue }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(events);
  latest.current = events;
  const onFrame = useRef(feed?.onFrame);
  onFrame.current = feed?.onFrame;
  const feedClock = useRef(feed?.clock);
  feedClock.current = feed?.clock;
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
    scene.fog = new THREE.Fog(venue.sky, 120, 260);
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
    const fill = new THREE.DirectionalLight("#9fb8ff", 0.5);
    fill.position.set(-40, 50, -30);
    scene.add(fill);

    const surround = new THREE.Mesh(new THREE.PlaneGeometry(170, 120), new THREE.MeshStandardMaterial({ color: "#123d22", roughness: 1 }));
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.02;
    scene.add(surround);
    const turf = pitchTexture(venue.mowing);
    turf.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(PITCH_W, PITCH_H), new THREE.MeshStandardMaterial({ map: turf, roughness: 0.92 }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    surround.receiveShadow = true;
    const homeKit = kitFor(home, null), awayKit = kitFor(away, null);
    scene.add(pitch, goal(1), goal(-1), stadium(venue), boards(venue.city),
      crowd(venue, [homeKit.shirt, homeKit.stripe ?? homeKit.shorts], [awayKit.shirt, awayKit.stripe ?? awayKit.shorts]));
    if (venue.mountains) scene.add(mountains(venue));

    // Players: a figure per squad member, shown while they're on the pitch.
    const figures = new Map<string, Figure>();
    const sides = [
      { team: home, colour: homeColor, isHome: true },
      { team: away, colour: awayColor, isHome: false },
    ];
    for (const s of sides)
      for (const p of s.team.players) {
        const kit = kitFor(s.team, p.position === "GK" ? (s.isHome ? "home" : "away") : null);
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
      const kit = kitFor(sd.team, null);
      const shelter = new THREE.Group();
      const bench = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 1.2), shell);
      bench.position.set(0, 0.25, -0.2);
      const back = new THREE.Mesh(new THREE.BoxGeometry(10.4, 3, 0.25), shell);
      back.position.set(0, 1.5, -1.2);
      const top = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.15, 3.2), perspex);
      top.position.set(0, 3.1, 0.2);
      top.rotation.x = -0.12;
      shelter.add(bench, back, top);
      for (const end of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3, 3), perspex);
        wall.position.set(end * 5.2, 1.5, 0.2);
        shelter.add(wall);
      }
      shelter.position.set(x0, 0, dugoutZ - 1.4);
      scene.add(shelter);
      // The technical area, marked on the grass in front of the dugout.
      for (const [w, d, x, z] of [[10, 0.12, x0, dugoutZ + 2.6], [0.12, 2.8, x0 - 5, dugoutZ + 1.2], [0.12, 2.8, x0 + 5, dugoutZ + 1.2]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), line);
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.02, z);
        scene.add(m);
      }
      const subs = sd.team.players.filter((p) => !p.starter).slice(0, 7);
      const bib: Kit = { shirt: BIBS[sd.isHome ? "home" : "away"], shorts: kit.shorts, socks: kit.socks, number: "#111111" };
      const tracksuit: Kit = { shirt: kit.shorts, shorts: kit.shorts, socks: kit.shorts, number: kit.shorts };
      const seated = [...subs.map((p) => ({ k: bib, n: p.shirt })), { k: tracksuit, n: 30 }, { k: tracksuit, n: 31 }];
      seated.forEach((st, i) => seat(figure(st.k, st.n, sd.colour, people), x0 - 4.2 + (8.4 * i) / Math.max(1, seated.length - 1)));
      const suit: Kit = { shirt: "#1f2937", shorts: "#111827", socks: "#111827", number: "#1f2937" };
      const manager = figure(suit, sd.isHome ? 40 : 41, sd.colour, people);
      manager.ring.visible = false;
      manager.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      manager.group.position.set(x0, 0, dugoutZ + 1.4);
      scene.add(manager.group);
      coaches.push({ fig: manager, x: x0, team: sd.team.team_id, cheerUntil: 0, phase: sd.isHome ? 0 : 2 });
    }
    const fourth = figure({ shirt: "#111111", shorts: "#111111", socks: "#111111", number: "#111111" }, 4, "#000000", people);
    fourth.ring.visible = false;
    fourth.group.position.set(0, 0, dugoutZ + 1);
    scene.add(fourth.group);
    let lastScore = "";

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

    // The ball's current flight: from → to over `dur` seconds, with an arc for lofted balls.
    const flight = { from: new THREE.Vector2(), to: new THREE.Vector2(), t0: 0, dur: 0.01, lift: 0 };
    // Before a touch the ball runs to where it starts (no teleports), slower than any pass.
    const glide = { from: new THREE.Vector2(), to: new THREE.Vector2(), t0: 0, dur: 0 };
    let shownId = "";
    let actorId: string | undefined;

    const resize = () => {
      const w = el.clientWidth || 640;
      const h = Math.round(w * (ballColour ? 9 / 16 : 0.56));
      renderer.setSize(w, h, false);
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
        }
        actorId = e.player_id;
        // A goal: that team's manager celebrates.
        const score = `${e.score?.home ?? 0}-${e.score?.away ?? 0}`;
        if (lastScore && score !== lastScore) {
          const [h0, a0] = lastScore.split("-").map(Number);
          const scorer = (e.score?.home ?? 0) > h0 ? home.team_id : (e.score?.away ?? 0) > a0 ? away.team_id : null;
          for (const c of coaches) if (c.team === scorer) c.cheerUntil = now + 3.5;
        }
        lastScore = score;
        const team = e.team_id;
        const squad = (team === home.team_id ? home : away).players;
        for (const sd of sides) xi.set(sd.team.team_id, currentXI(sd.team, evs));          // substitutions so far
        xi.set(team, withPlayer(withPlayer(xi.get(team) ?? [], squad, e.player_id), squad, e.recipient_id));
        const name = e.player_name?.split(" ").slice(-1)[0];
        const shirt = squad.find((p) => p.player_id === e.player_id)?.shirt;
        tag.set(name ? `${shirt ?? ""} ${name}`.trim() : "");
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
          f.pos.lerp(target, 1 - Math.exp(-dt * 3.2));
          f.group.position.set(f.pos.x, 0, f.pos.y);
          const isActor = p.player_id === actorId;
          f.ring.visible = !ballColour;
          (f.ring.material as THREE.MeshBasicMaterial).color.set(isActor ? ACTOR_RING : s.colour);
          f.ring.scale.setScalar(isActor ? 1.3 : 1);
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
        stamp(feedClock.current?.() ?? 0);
        renderer.autoClear = false;
        renderer.render(hud, hudCam);
        renderer.autoClear = true;
        onFrame.current?.(renderer.domElement);
        return;
      }
      const want = reduceMotion ? 0 : THREE.MathUtils.clamp(bx * 0.6, -22, 22);
      camX += (want - camX) * (1 - Math.exp(-dt * 1.6));
      camera.position.set(camX, 40, 68);
      camera.lookAt(camX, 0, 3);
      renderer.render(scene, camera);
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
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [home, away, homeColor, awayColor, ballColour, venue]);

  return <div ref={host} className="pitch-3d" role="img" aria-label={label} />;
}
