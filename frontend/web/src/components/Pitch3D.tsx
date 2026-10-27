import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { MatchEvent, Team } from "../api/types";
import { PITCH_H, PITCH_W, toHomeFrame } from "../lib/format";
import { kitFor, type Kit } from "../lib/kits";
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

/** Home frame (home attacks +x) → world: x along the pitch, z across it with the home team's right touchline nearest. */
const world = (hx: number, hy: number) => new THREE.Vector2(hx - PITCH_W / 2, PITCH_H / 2 - hy);

function pitchTexture(): THREE.CanvasTexture {
  const S = 24;                                                                // pixels per metre
  const c = document.createElement("canvas");
  c.width = PITCH_W * S;
  c.height = PITCH_H * S;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 14; i++) {
    const grd = g.createLinearGradient(0, 0, 0, c.height);
    grd.addColorStop(0, i % 2 ? "#1d6531" : "#22763a");
    grd.addColorStop(1, i % 2 ? "#1a5c2d" : "#1f6c35");
    g.fillStyle = grd;
    g.fillRect((c.width / 14) * i, 0, c.width / 14 + 1, c.height);
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

/** Sloped stands on all four sides, with a roof line, behind the advertising boards. */
function stadium(): THREE.Group {
  const g = new THREE.Group();
  const stand = new THREE.MeshStandardMaterial({ color: "#1a2233", roughness: 0.9 });
  const roof = new THREE.MeshStandardMaterial({ color: "#0e1420", roughness: 0.6, metalness: 0.3 });
  const sides: [number, number, number, number][] = [
    [0, PITCH_H / 2 + 18, 150, 0], [0, -PITCH_H / 2 - 18, 150, Math.PI], [PITCH_W / 2 + 19, 0, 96, -Math.PI / 2], [-PITCH_W / 2 - 19, 0, 96, Math.PI / 2],
  ];
  for (const [x, z, len, rot] of sides) {
    const side = new THREE.Group();
    const tier = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 22), stand);
    tier.rotation.x = -0.52;
    tier.position.set(0, 6, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 16, 1), roof);
    back.position.set(0, 9, 10);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 14), roof);
    lid.position.set(0, 17, 4);
    side.add(tier, back, lid);
    side.position.set(x, 0, z);
    side.rotation.y = rot;
    g.add(side);
  }
  // Floodlight pylons at the corners, each with a bright panel and a soft glow.
  const glow = glowTexture();
  for (const [x, z] of [[-62, -48], [62, -48], [-62, 48], [62, 48]]) {
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 34, 8), roof);
    pylon.position.set(x, 17, z);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 0.6), new THREE.MeshBasicMaterial({ color: "#fffaf0" }));
    panel.position.set(x, 35, z);
    panel.lookAt(0, 0, 0);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: "#fff4d6", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(26, 26, 1);
    halo.position.set(x, 35, z);
    g.add(pylon, panel, halo);
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

/** LED advertising boards around the pitch, glowing with the app's own name. */
function boards(): THREE.Group {
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
  for (let x = 20; x < c.width; x += 340) g.fillText("REGISTA · LIVE", x, 34);
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
  for (const [x, z, len, rot] of [[0, -PITCH_H / 2 - 4, PITCH_W + 10, 0], [-PITCH_W / 2 - 5, 0, PITCH_H, Math.PI / 2], [PITCH_W / 2 + 5, 0, PITCH_H, -Math.PI / 2]] as const) {
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

/** Spectators: points on sloped stands around the pitch, for depth. */
function crowd(): THREE.Points {
  const pts: number[] = [];
  const colours: number[] = [];
  const palette = ["#3a4a6b", "#5b6b8c", "#8a97b3", "#2b3550", "#9aa7c7", "#6b4a4a", "#4a6b55"].map((c) => new THREE.Color(c));
  for (let i = 0; i < 14000; i++) {
    const side = i % 4;
    const depth = 4 + Math.random() * 17;
    const along = (Math.random() - 0.5) * (side < 2 ? 140 : 100);
    const h = 1.2 + depth * 0.58;
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
function figure(kit: Kit, shirtNo: number, ringColour: string): Figure {
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
  body.scale.setScalar(SCALE);

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

export function Pitch3D({ events, home, away, homeColor, awayColor, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(events);
  latest.current = events;

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
    scene.background = new THREE.Color("#070b14");
    scene.fog = new THREE.Fog("#070b14", 110, 230);
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
    const turf = pitchTexture();
    turf.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(PITCH_W, PITCH_H), new THREE.MeshStandardMaterial({ map: turf, roughness: 0.92 }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    surround.receiveShadow = true;
    scene.add(pitch, goal(1), goal(-1), stadium(), crowd(), boards());

    // Players: a figure per squad member, shown while they're on the pitch.
    const figures = new Map<string, Figure>();
    const sides = [
      { team: home, colour: homeColor, isHome: true },
      { team: away, colour: awayColor, isHome: false },
    ];
    for (const s of sides)
      for (const p of s.team.players) {
        const kit = kitFor(s.team, p.position === "GK" ? (s.isHome ? "home" : "away") : null);
        const f = figure(kit, p.shirt, s.colour);
        f.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        f.group.visible = false;
        figures.set(p.player_id, f);
        scene.add(f.group);
      }
    const xi = new Map(sides.map((s) => [s.team.team_id, currentXI(s.team, latest.current)]));

    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 3), new THREE.MeshStandardMaterial({ map: ballTexture(), emissive: "#333333", roughness: 0.35 }));
    ball.castShadow = true;
    const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.35, 16), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.4 }));
    ballShadow.rotation.x = -Math.PI / 2;
    ballShadow.position.y = 0.02;
    scene.add(ball, ballShadow);
    const tag = labelSprite();
    scene.add(tag.sprite);

    const camera = new THREE.PerspectiveCamera(31, 16 / 9, 0.5, 600);
    let camX = 0;

    // The ball's current flight: from → to over `dur` seconds, with an arc for lofted balls.
    const flight = { from: new THREE.Vector2(), to: new THREE.Vector2(), t0: 0, dur: 0.01, lift: 0 };
    let shownId = "";
    let actorId: string | undefined;

    const resize = () => {
      const w = el.clientWidth || 640;
      const h = Math.round(w * 0.56);
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
        const { from, to } = ballPath(e, home.team_id);
        const current = new THREE.Vector2(ball.position.x, ball.position.z);
        const start = world(...from);
        flight.from.copy(shownId && current.lengthSq() ? current.lerp(start, 0.6) : start);
        flight.to.copy(world(...to));
        const dist = flight.from.distanceTo(flight.to);
        flight.t0 = now;
        flight.dur = Math.min(1.1, Math.max(0.25, dist / 30));
        flight.lift = e.type === "shot" ? Math.min(2.2, dist / 14) : LOFTED.has(e.pass_type ?? "") || (e.pass_length ?? 0) > 28 ? Math.min(9, dist / 5) : 0;
        actorId = e.player_id;
        const team = e.team_id;
        const squad = (team === home.team_id ? home : away).players;
        for (const sd of sides) xi.set(sd.team.team_id, currentXI(sd.team, evs));          // substitutions so far
        xi.set(team, withPlayer(withPlayer(xi.get(team) ?? [], squad, e.player_id), squad, e.recipient_id));
        const name = e.player_name?.split(" ").slice(-1)[0];
        const shirt = squad.find((p) => p.player_id === e.player_id)?.shirt;
        tag.set(name ? `${shirt ?? ""} ${name}`.trim() : "");
      }

      // Ball along its flight.
      const k = Math.min(1, (now - flight.t0) / flight.dur);
      const eased = 1 - (1 - k) * (1 - k);
      const bx = flight.from.x + (flight.to.x - flight.from.x) * eased;
      const bz = flight.from.y + (flight.to.y - flight.from.y) * eased;
      const by = 0.26 + flight.lift * 4 * k * (1 - k);
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
          if (e && p.player_id === actorId && e.team_id === team)
            target = e.type === "carry" || e.type === "dribble" ? new THREE.Vector2(bx, bz) : flight.from.clone();
          else if (e && p.player_id === e.recipient_id) target = flight.to.clone();
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
      tag.sprite.visible = !!actorId;

      // Broadcast camera: high on the near touchline, following the ball along the pitch.
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
  }, [home, away, homeColor, awayColor]);

  return <div ref={host} className="pitch-3d" role="img" aria-label={label} />;
}
