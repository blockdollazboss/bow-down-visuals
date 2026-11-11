import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { mediaUrl } from "@/lib/media-cdn";
import {
  CROWNFALL,
  crownfallFloorName,
  crownfallScore,
  type ArcadeRunResult,
} from "@/lib/arcade-games";
/* Online multiplayer (CrownfallClient, lib/crownfall-net.ts) rides
   this game through a thin seam: the engine runs unchanged solo, and
   every `g.mp` guard below is inert when no party is connected. */
import type { CrownfallClient } from "@/lib/crownfall-net";

/* ─── Crownfall Run ───────────────────────────────────────────────────────
   Top-down arena roguelike, ported whole from the owner-approved
   preview Space (same mechanics, same numbers, same repairs), then
   re-ruled by the owner on Nov 10, 2026:
   - AIM IS MANUAL, AUTO-SHOOT IS OFF (owner, twice confirmed): the
     King fires ONLY where the player aims — right stick on a pad,
     the mouse pointer on desktop, the right thumb-stick on touch.
     No aim input, no shots, ever; there is no nearest-foe targeting
     anywhere in the firing path.
   - NO TELEPORTING: clearing a room starts a visible walk-through —
     the King walks to the golden door and the view slides up into
     the next room before the upgrade cards appear.
   - EVERY ROOM READS AS ITS ROOM: each company floor carries its own
     set dressing (desks, speaker stacks, cameras, the green screen,
     the vault, the throne dais…) drawn over the same collision rects.
   - THE KING is a purpose-drawn game sprite in the King's identity
     (grey shark, gold crown, gold fishbone chain, wine sash) — the
     same character in both themes; the theme changes the room's
     light, not the King. Pickups are the site's real Visual Buc coin.
   Clear the room and the golden door opens to the next studio floor
   down. Glitches chase, Spam Bots shoot, Trolls telegraph and lunge;
   THE USURPER waits every 5th floor. One upgrade card (of three)
   between floors. Permadeath. Score = depth × 100 + Bucs coins × 25
   + foes × 10 + combo bonus — coins are score only, never a charge
   or a wager. Aiming changes accuracy only, never the score economy,
   so the server caps in arcade-rules.ts stand unchanged.

   Hostile-host rules carried from the preview (they were each learned
   from a real failure there):
   - The frame loop schedules its next frame FIRST and guards its
     whole body — one throwing host API can never kill the game.
   - Gamepad polling never latches off after a throw; it retries on a
     timer and re-arms on any tap/keypress. The pad actually sending
     input wins (Bluetooth pads often sit on slot 1+), non-standard
     mappings (hat-axis D-pad, right stick) steer too, and any face
     button or Start/Select begins — no single index can strand a pad.
   - Every synth sound call is wrapped so an audio hiccup can't break
     a frame; storage is never touched.
   - The arena paints one frame immediately at boot and at run start.
   The reported durationMs is PLAY time only (pause + upgrade picks
   excluded) — exactly the clock the server caps in arcade-rules.ts
   are derived against. */

const LW = CROWNFALL.width;
const LH = CROWNFALL.height;
const WALL = CROWNFALL.wall;

const PAL = {
  dark: {
    floor: "#0a0a0b", blotch: "rgba(255,255,255,0.025)", vein: "rgba(212,175,55,",
    grid: "rgba(255,255,255,0.045)", wall: "#17171a", wallFace: "#101012",
    ob: "#34343b", obTop: "#54545e", obEdge: "rgba(212,175,55,0.5)",
    vign: "rgba(0,0,0,0.5)",
  },
  light: {
    floor: "#f3ecdc", blotch: "rgba(166,124,26,0.05)", vein: "rgba(166,124,26,",
    grid: "rgba(120,90,20,0.07)", wall: "#e3d5b4", wallFace: "#eee1c2",
    ob: "#d9cba6", obTop: "#f6ecd2", obEdge: "rgba(138,109,31,0.55)",
    vign: "rgba(120,90,20,0.16)",
  },
} as const;
type ThemeName = keyof typeof PAL;

/* ─── helpers ─────────────────────────────────────────────────────────── */
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
function dist2(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}
function fmtTime(s: number) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return m + ":" + (ss < 10 ? "0" : "") + ss;
}

/* ─── audio (synth, no files — every call guarded) ────────────────────── */
let AC: AudioContext | null = null;
let mutedFlag = false;
function ensureAudio() {
  if (AC) {
    if (AC.state === "suspended") void AC.resume().catch(() => {});
    return;
  }
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    AC = Ctor ? new Ctor() : null;
  } catch {
    AC = null;
  }
}
function tone(freq: number, freq2: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
  if (!AC || mutedFlag) return;
  try {
    const t = AC.currentTime + delay;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freq2) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch { /* a synth hiccup must never break the frame loop */ }
}
function noiseBurst(dur: number, vol: number, freq: number) {
  if (!AC || mutedFlag) return;
  try {
    const len = Math.floor(AC.sampleRate * dur);
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = AC.createBufferSource(); src.buffer = buf;
    const f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq || 900;
    const g = AC.createGain(); g.gain.value = vol || 0.07;
    src.connect(f); f.connect(g); g.connect(AC.destination); src.start();
  } catch { /* a synth hiccup must never break the frame loop */ }
}
const sfx = {
  shoot() { tone(880, 620, 0.07, "triangle", 0.025); },
  hit() { tone(220, 140, 0.06, "square", 0.03); },
  die() { tone(320, 60, 0.22, "sawtooth", 0.05); noiseBurst(0.12, 0.04, 700); },
  crown() { tone(1180, 0, 0.09, "sine", 0.06); tone(1560, 0, 0.13, "sine", 0.05, 0.06); },
  hurt() { tone(110, 55, 0.18, "sine", 0.11); noiseBurst(0.1, 0.06, 400); },
  dash() { noiseBurst(0.16, 0.06, 1600); tone(300, 700, 0.12, "sine", 0.02); },
  door() { tone(660, 0, 0.14, "sine", 0.05); tone(880, 0, 0.16, "sine", 0.05, 0.09); tone(1320, 0, 0.2, "sine", 0.04, 0.18); },
  upgrade() { tone(740, 0, 0.1, "triangle", 0.06); tone(1108, 0, 0.16, "triangle", 0.06, 0.08); },
  boss() { tone(68, 48, 0.7, "sawtooth", 0.09); tone(102, 72, 0.7, "triangle", 0.07, 0.05); },
  sting() { tone(392, 0, 0.22, "triangle", 0.07); tone(311, 0, 0.26, "triangle", 0.07, 0.18); tone(233, 110, 0.5, "triangle", 0.08, 0.36); },
};

/* ─── game state ──────────────────────────────────────────────────────── */
type Phase = "start" | "playing" | "upgrade" | "dead" | "transit";
type EnemyType = "chaser" | "shooter" | "dasher" | "boss";

interface Player {
  x: number; y: number; r: number;
  hp: number; maxhp: number;
  speed: number; dmg: number; fireRate: number; multishot: number;
  faceX: number; faceY: number;
  dashCdMax: number; dashCd: number; dashT: number; dashDX: number; dashDY: number;
  invuln: number; flash: number;
  spread: boolean; pierce: boolean; magnet: number; moveMag: number;
}
interface Enemy {
  /* MP: the foe's index within its floor — its party-wide identity
     (the floor is deterministic, so every client agrees). */
  id: number;
  type: EnemyType; x: number; y: number; vx: number; vy: number; kx: number; ky: number;
  state: string; t: number; fireT: number;
  lockX: number; lockY: number; wob: number; flash: number; elite: boolean;
  r: number; hp: number; maxhp: number; speed: number; dmg: number;
}
interface Bolt { x: number; y: number; vx: number; vy: number; r: number; dmg: number; pierceLeft: number; hit: Enemy[] }
interface EBolt { x: number; y: number; vx: number; vy: number; r: number; dmg: number }
interface Pickup {
  x: number; y: number; r: number; kind: "crown" | "heart"; bob: number;
  /* MP: the server's coin id (`f<depth>:p<i>` placed, `f<depth>:d<n>`
     dropped) — claims and removals are arbitrated by it. Solo: null. */
  mpId: string | null;
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Floater { x: number; y: number; life: number; text: string; color: string }
interface Obstacle { x: number; y: number; w: number; h: number; skin?: string }
interface Afterimage { x: number; y: number; faceX: number; faceY: number; life: number }

interface PadState {
  index: number;
  apiState: "unknown" | "ok" | "missing" | "blocked";
  nextRetry: number;
  uiKey: string;
  everSeen: boolean;
  firstPollAt: number;
  connected: boolean;
  name: string;
  prev: Record<number, boolean>;
  navCd: number;
}

interface UiBridge {
  hud: () => void;
  phase: (p: Phase) => void;
  paused: (p: boolean) => void;
  msg: (t: string) => void;
  intro: (depth: number) => void;
  upgrades: (picks: UpgradeDef[]) => void;
  highlight: (i: number) => void;
  flash: () => void;
  death: (summary: RunSummary) => void;
  padStatus: (s: { text: string; waiting: boolean } | null, live: boolean) => void;
}

export interface RunSummary {
  depth: number; crowns: number; kills: number; score: number;
  bestCombo: number; timeSec: number; bossDeath: boolean; isSessionBest: boolean;
}

/* The walk-through passage between rooms (owner ruling: no teleport).
   Phase 1 (walkT): the King walks from wherever he stands to the open
   door. Phase 2 (slideT): the view slides up one full room — the old
   room (kept as a snapshot) slides down out of frame while the new
   room, already generated into the spare bg canvas, slides in. Input
   is locked for the whole passage and nothing is queued. */
interface Transit {
  t: number;
  fromX: number; fromY: number;
  camY: number;         /* current view slide, 0..LH */
  kingX: number; kingY: number; /* King's screen-space draw position */
  done: boolean;
  snapObstacles: Obstacle[];
  snapPickups: Pickup[];
}
const TRANSIT_WALK_SEC = 0.32;
const TRANSIT_SLIDE_SEC = 0.78; /* total passage ≈ 1.1s */

interface G {
  theme: ThemeName;
  phase: Phase;
  paused: boolean;
  runSeed: number;
  depth: number; crowns: number; kills: number;
  P: Player;
  enemies: Enemy[]; bolts: Bolt[]; ebolts: EBolt[]; pickups: Pickup[];
  parts: Particle[]; floats: Floater[]; obstacles: Obstacle[]; afterimages: Afterimage[];
  doorOpen: boolean; doorPulse: number;
  fireTimer: number; shake: number; timeNow: number;
  bgSeed: number;
  boss: Enemy | null;
  combo: number; comboTimer: number; bestCombo: number; comboBonus: number;
  runTime: number;
  keys: Record<string, boolean>;
  joy: { on: boolean; id: number | null; bx: number; by: number; dx: number; dy: number };
  /* manual aim (auto-shoot is OFF — the King fires only along aim) */
  aimJoy: { on: boolean; id: number | null; bx: number; by: number; dx: number; dy: number };
  padAim: { on: boolean; x: number; y: number };
  mouseAim: { x: number; y: number; lastAt: number; inside: boolean };
  aim: { on: boolean; x: number; y: number };
  transit: Transit | null;
  bgSwap: boolean; /* set when a passage ends: the component swaps bg canvases */
  padVec: { x: number; y: number };
  pad: PadState;
  upgradePicks: UpgradeDef[];
  upgradeIndex: number;
  sessionBest: { depth: number; score: number };
  overFired: boolean;
  deathAt: number;
  ui: UiBridge;
  /* ── online multiplayer seam (all inert when mp is null) ── */
  mp: CrownfallClient | null;
  /** MP: the local King has fallen — spectate until the party's next
   *  floor revives him at half health. */
  mpDown: boolean;
  /** MP: revive is owed when the next floor begins (applied by the
   *  tick once the passage completes). */
  mpRevive: boolean;
  /** MP: placed crowns on the current floor (for the roster frame). */
  mpPlacedCount: number;
}

function newPlayer(): Player {
  return {
    x: LW / 2, y: LH - 110, r: 22,
    hp: CROWNFALL.baseHp, maxhp: CROWNFALL.baseHp,
    speed: CROWNFALL.baseSpeed, dmg: CROWNFALL.baseDamage, fireRate: CROWNFALL.baseFireRate, multishot: 1,
    faceX: 0, faceY: -1,
    dashCdMax: CROWNFALL.dashCooldownSec, dashCd: 0, dashT: 0, dashDX: 0, dashDY: -1,
    invuln: 0, flash: 0,
    spread: false, pierce: false, magnet: CROWNFALL.baseMagnet, moveMag: 0,
  };
}

function scoreOf(g: G) {
  return crownfallScore(g.depth, g.crowns, g.kills, g.comboBonus);
}
function enemyName(e: Enemy) {
  const base = e.type === "chaser" ? "Glitch" : e.type === "shooter" ? "Spam Bot" : e.type === "dasher" ? "Troll" : "The Usurper";
  return e.elite ? "Gold-" + base : base;
}

/* ─── rooms: every floor reads as its room ──────────────────────────────
   The floor name cycle maps to a room kind; each kind dresses the SAME
   collision rects with its own furniture skins and floor/wall accents
   (the accents live in makeBg). Collision never changes — only what a
   rect is drawn as. Deeper cycles reuse the set with the room's trim. */
type RoomKind = "lobby" | "beatlab" | "studio" | "green" | "mixing" | "vault" | "throne" | "server";
function roomKind(depth: number): RoomKind {
  const kinds: RoomKind[] = ["lobby", "beatlab", "studio", "green", "mixing", "vault", "throne", "vault", "server", "throne"];
  return kinds[(depth - 1) % kinds.length]!;
}
const ROOM_SKINS: Record<RoomKind, string[]> = {
  lobby: ["desk", "planter", "pillar", "desk", "planter", "pillar"],
  beatlab: ["workdesk", "speakers", "pillar", "workdesk", "speakers", "pillar"],
  studio: ["camera", "lightstand", "pillar", "camera", "lightstand", "pillar"],
  green: ["lightstand", "camera", "lightstand", "speakers"],
  mixing: ["console", "speakers", "pillar", "console", "speakers", "pillar"],
  vault: ["goldbars", "coinpile", "pillar", "goldbars", "coinpile", "pillar"],
  throne: ["pillar", "brazier", "pillar", "brazier", "pillar", "brazier"],
  server: ["rack", "pillar", "rack", "rack", "pillar", "rack"],
};

/* ─── floor generation ────────────────────────────────────────────────── */
function rectsOverlap(a: Obstacle, b: Obstacle, pad: number) {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}
function pointInRects(g: G, x: number, y: number, pad: number) {
  for (const o of g.obstacles) {
    if (x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) return true;
  }
  return false;
}

function genFloor(g: G, d: number, bg: HTMLCanvasElement | null) {
  const rng = mulberry32(g.runSeed + d * 7919);
  g.bgSeed = g.runSeed + d * 104729;
  g.obstacles = []; g.bolts = []; g.ebolts = []; g.parts = []; g.floats = []; g.pickups = [];
  g.enemies = []; g.doorOpen = false; g.boss = null; g.fireTimer = 0.3;

  /* obstacles — keep spawn (bottom centre) and door (top centre) clear */
  const want = 3 + Math.floor(rng() * 4); /* 3..6 */
  let guard = 0;
  while (g.obstacles.length < want && guard++ < 300) {
    const w = 56 + rng() * 84, h = 40 + rng() * 76;
    const r: Obstacle = {
      x: WALL + 26 + rng() * (LW - 2 * WALL - 52 - w),
      y: WALL + 70 + rng() * (LH - 2 * WALL - 170 - h),
      w, h,
    };
    if (dist2(r.x + w / 2, r.y + h / 2, LW / 2, LH - 110) < 190 * 190) continue;
    if (r.x < LW / 2 + 90 && r.x + r.w > LW / 2 - 90 && r.y < 190) continue;
    let bad = false;
    for (const o of g.obstacles) if (rectsOverlap(r, o, 30)) { bad = true; break; }
    if (!bad) g.obstacles.push(r);
  }
  /* dress each collision rect as this room's furniture */
  const skins = ROOM_SKINS[roomKind(d)];
  g.obstacles.forEach((o, i) => { o.skin = skins[i % skins.length]; });

  /* crown pickups */
  const nc = 3 + Math.floor(rng() * 3); /* 3..5 */
  guard = 0;
  while (g.pickups.length < nc && guard++ < 200) {
    const px = WALL + 40 + rng() * (LW - 2 * WALL - 80);
    const py = WALL + 40 + rng() * (LH - 2 * WALL - 80);
    if (pointInRects(g, px, py, 22)) continue;
    g.pickups.push({ x: px, y: py, r: 11, kind: "crown", bob: rng() * 6.28, mpId: "f" + d + ":p" + g.pickups.length });
  }
  g.mpPlacedCount = g.pickups.length;

  /* player back to the entrance */
  const P = g.P;
  P.x = LW / 2; P.y = LH - 110; P.invuln = Math.max(P.invuln, 0.6);
  P.dashCd = 0; P.dashT = 0;

  /* enemies */
  const hpScale = 1 + (d - 1) * 0.22;
  const spScale = 1 + Math.min(0.35, (d - 1) * 0.03);
  function spawnPos() {
    for (let t = 0; t < 200; t++) {
      const x = WALL + 50 + rng() * (LW - 2 * WALL - 100);
      const y = WALL + 60 + rng() * (LH - 2 * WALL - 130);
      if (dist2(x, y, P.x, P.y) < 215 * 215) continue;
      if (pointInRects(g, x, y, 26)) continue;
      return { x, y };
    }
    return { x: LW / 2, y: 150 };
  }
  function addEnemy(type: EnemyType) {
    const s = spawnPos();
    const e: Enemy = {
      id: g.enemies.length,
      type, x: s.x, y: s.y, vx: 0, vy: 0, kx: 0, ky: 0,
      state: "stalk", t: 0, fireT: 1 + rng() * 1.2,
      lockX: 0, lockY: 0, wob: rng() * 6.28, flash: 0, elite: false,
      r: 15, hp: 1, maxhp: 1, speed: 100, dmg: 10,
    };
    if (type === "chaser") { e.r = 16; e.hp = e.maxhp = 26 * hpScale; e.speed = 106 * spScale; e.dmg = 12; }
    if (type === "shooter") { e.r = 15; e.hp = e.maxhp = 20 * hpScale; e.speed = 92 * spScale; e.dmg = 10; }
    if (type === "dasher") { e.r = 15; e.hp = e.maxhp = 22 * hpScale; e.speed = 100 * spScale; e.dmg = 14; }
    if (type !== "boss" && d >= 3 && rng() < 0.22) {
      e.elite = true; e.hp = e.maxhp = e.hp * 1.9; e.r += 2; e.speed *= 1.06;
    }
    if (type === "boss") {
      e.r = 36; e.hp = e.maxhp = 330 * (1 + (Math.floor(d / 5) - 1) * 0.6);
      e.speed = 72 * spScale; e.dmg = 20; e.x = LW / 2; e.y = 170;
      g.boss = e;
    }
    g.enemies.push(e);
  }
  if (d % 5 === 0) {
    addEnemy("boss");
    if (d >= 10) { addEnemy("chaser"); addEnemy("shooter"); }
  } else {
    const n = Math.min(CROWNFALL.maxFoesPerFloor, 3 + d + Math.floor(d / 3)); /* grows with depth */
    for (let k = 0; k < n; k++) {
      const roll = rng();
      let type: EnemyType = roll < 0.45 ? "chaser" : roll < 0.75 ? "shooter" : "dasher";
      if (d < 2 && k > 1) type = "chaser";
      if (d < 3 && type === "dasher") type = "shooter";
      addEnemy(type);
    }
  }
  makeBg(g, bg);
  g.ui.msg(d % 5 === 0 ? "Floor " + d + " — The Usurper wants the throne." : "Floor " + d + " · " + crownfallFloorName(d) + " — clear the invaders");
  if (g.phase === "playing") { g.ui.intro(d); if (d % 5 === 0) sfx.boss(); }
  g.ui.hud();
}

/* ─── floor backdrop (procedural marble-stone) ────────────────────────── */
function makeBg(g: G, bg: HTMLCanvasElement | null) {
  if (!bg) return;
  const b = bg.getContext("2d");
  if (!b) return;
  const pal = PAL[g.theme];
  const scale = bg.width / LW;
  b.setTransform(scale, 0, 0, scale, 0, 0);
  b.clearRect(0, 0, LW, LH);
  b.fillStyle = pal.floor;
  b.fillRect(0, 0, LW, LH);
  const rng = mulberry32(g.bgSeed);
  let i: number, x: number, y: number;
  /* soft stone blotches */
  for (i = 0; i < 9; i++) {
    x = rng() * LW; y = rng() * LH;
    const gr = b.createRadialGradient(x, y, 0, x, y, 120 + rng() * 160);
    gr.addColorStop(0, pal.blotch); gr.addColorStop(1, "rgba(0,0,0,0)");
    b.fillStyle = gr;
    b.fillRect(0, 0, LW, LH);
  }
  /* pale-gold marble veins carried across the whole floor — the
     centre included, fainter there so the room still reads calm */
  for (i = 0; i < 22; i++) {
    const edge = rng();
    if (edge < 0.45) { x = rng() < 0.5 ? rng() * 90 : LW - rng() * 90; y = rng() * LH; }
    else if (edge < 0.7) { x = rng() * LW; y = rng() < 0.5 ? rng() * 90 : LH - rng() * 90; }
    else { x = 120 + rng() * (LW - 240); y = 120 + rng() * (LH - 240); }
    b.strokeStyle = pal.vein + (0.05 + rng() * 0.10) + ")";
    b.lineWidth = 0.8 + rng() * 1.1;
    b.beginPath(); b.moveTo(x, y);
    let cx = x, cy = y;
    for (let s = 0; s < 3; s++) {
      const nx = cx + (rng() - 0.5) * 170, ny = cy + (rng() - 0.5) * 170;
      b.quadraticCurveTo(cx + (rng() - 0.5) * 60, cy + (rng() - 0.5) * 60, nx, ny);
      cx = nx; cy = ny;
    }
    b.stroke();
  }
  /* faint tile seams */
  b.strokeStyle = pal.grid; b.lineWidth = 1;
  for (i = 1; i < 8; i++) {
    b.beginPath(); b.moveTo(i * 90, WALL); b.lineTo(i * 90, LH - WALL); b.stroke();
    b.beginPath(); b.moveTo(WALL, i * 90); b.lineTo(LW - WALL, i * 90); b.stroke();
  }
  /* studio rug in the centre — filled, patterned, thin gold border */
  b.save();
  const rx0 = LW / 2 - 150, ry0 = LH / 2 - 110, rw0 = 300, rh0 = 220;
  b.beginPath(); b.rect(rx0, ry0, rw0, rh0);
  b.fillStyle = g.theme === "dark" ? "rgba(104,30,40,0.5)" : "rgba(150,52,44,0.20)";
  b.fill();
  b.clip();
  b.strokeStyle = g.theme === "dark" ? "rgba(240,201,79,0.10)" : "rgba(120,40,30,0.12)";
  b.lineWidth = 1;
  for (let dg = -rh0; dg < rw0 + rh0; dg += 30) {
    b.beginPath(); b.moveTo(rx0 + dg, ry0); b.lineTo(rx0 + dg + rh0, ry0 + rh0); b.stroke();
    b.beginPath(); b.moveTo(rx0 + dg + rh0, ry0); b.lineTo(rx0 + dg, ry0 + rh0); b.stroke();
  }
  b.restore();
  b.strokeStyle = g.theme === "dark" ? "rgba(212,175,55,0.55)" : "rgba(138,109,31,0.55)"; b.lineWidth = 2;
  b.strokeRect(rx0, ry0, rw0, rh0);
  b.lineWidth = 1; b.strokeStyle = g.theme === "dark" ? "rgba(212,175,55,0.3)" : "rgba(138,109,31,0.3)";
  b.strokeRect(rx0 + 9, ry0 + 9, rw0 - 18, rh0 - 18);

  /* ── room dressing: floor + wall accents so each room reads as
     itself before the intro card is read. All non-collision. ── */
  const kind = roomKind(Math.max(1, Math.round((g.bgSeed - g.runSeed) / 104729)));
  const dark = g.theme === "dark";
  if (kind === "green") {
    /* THE green screen: one unmistakable green backdrop wall */
    const gx = 128, gw = LW - 256, gy = WALL + 2, gh = 96;
    const gg = b.createLinearGradient(0, gy, 0, gy + gh);
    gg.addColorStop(0, dark ? "#1faa59" : "#2fbf71"); gg.addColorStop(1, dark ? "#0d7a3c" : "#1d9e57");
    b.fillStyle = gg; b.fillRect(gx, gy, gw, gh);
    b.fillStyle = "rgba(255,255,255,0.10)"; b.fillRect(gx, gy, gw, 10);
    b.fillStyle = "rgba(0,0,0,0.22)"; b.fillRect(gx, gy + gh - 8, gw, 8);
    b.strokeStyle = dark ? "#3a3a40" : "#8a7a4a"; b.lineWidth = 4; b.strokeRect(gx, gy, gw, gh);
    b.fillStyle = "rgba(0,0,0,0.3)";
    b.fillRect(gx - 6, gy + gh, 8, 14); b.fillRect(gx + gw - 2, gy + gh, 8, 14);
  }
  if (kind === "studio") {
    /* pale seamless backdrop sweeping down the left wall */
    const sg = b.createLinearGradient(WALL, 0, WALL + 120, 0);
    sg.addColorStop(0, dark ? "rgba(226,230,236,0.20)" : "rgba(255,255,255,0.55)");
    sg.addColorStop(1, "rgba(226,230,236,0)");
    b.fillStyle = sg; b.fillRect(WALL, WALL, 120, LH - 2 * WALL);
    b.strokeStyle = dark ? "rgba(255,255,255,0.14)" : "rgba(120,100,50,0.2)"; b.lineWidth = 2;
    b.beginPath(); b.moveTo(WALL + 118, WALL); b.lineTo(WALL + 118, LH - WALL); b.stroke();
  }
  if (kind === "beatlab") {
    /* a keyboard strip inlaid along the entrance wall */
    const ky = LH - WALL - 17, kx = 130, kw = LW - 260;
    b.fillStyle = dark ? "#e8e4da" : "#fffdf4"; b.fillRect(kx, ky, kw, 15);
    b.strokeStyle = "rgba(60,50,20,0.5)"; b.lineWidth = 1; b.strokeRect(kx, ky, kw, 15);
    b.fillStyle = "#17171a";
    for (let kx2 = kx + 7; kx2 < kx + kw - 6; kx2 += 13) {
      if (((kx2 / 13) | 0) % 7 === 2 || ((kx2 / 13) | 0) % 7 === 6) continue;
      b.fillRect(kx2, ky, 7, 9);
    }
  }
  if (kind === "throne") {
    /* red carpet runner: entrance to throne door, gold fringe */
    const cx0 = LW / 2 - 52;
    b.fillStyle = dark ? "rgba(122,26,36,0.55)" : "rgba(150,40,48,0.30)";
    b.fillRect(cx0, WALL, 104, LH - 2 * WALL);
    b.strokeStyle = dark ? "rgba(240,201,79,0.5)" : "rgba(138,109,31,0.5)"; b.lineWidth = 2;
    b.beginPath(); b.moveTo(cx0, WALL); b.lineTo(cx0, LH - WALL); b.moveTo(cx0 + 104, WALL); b.lineTo(cx0 + 104, LH - WALL); b.stroke();
    b.strokeStyle = dark ? "rgba(240,201,79,0.16)" : "rgba(120,40,30,0.14)"; b.lineWidth = 1;
    for (let dy2 = WALL + 26; dy2 < LH - WALL; dy2 += 34) {
      b.beginPath(); b.moveTo(cx0 + 8, dy2); b.lineTo(cx0 + 96, dy2); b.stroke();
    }
    /* wine banners flanking the door, crown at the heart of each */
    for (const bx of [LW / 2 - 168, LW / 2 + 128]) {
      b.fillStyle = dark ? "#5e1420" : "#7e2430";
      b.fillRect(bx, WALL + 2, 40, 86);
      b.beginPath(); b.moveTo(bx, WALL + 88); b.lineTo(bx + 20, WALL + 74); b.lineTo(bx + 40, WALL + 88); b.closePath(); b.fill();
      b.fillStyle = "#c49a22"; b.fillRect(bx, WALL + 2, 40, 5);
      b.fillStyle = "#f0c94f";
      crownPath(b, bx + 20, WALL + 42, 11); b.fill();
    }
  }
  if (kind === "vault") {
    /* coin-pile decals + a great vault ring on the far wall */
    b.strokeStyle = dark ? "rgba(212,175,55,0.5)" : "rgba(138,109,31,0.5)"; b.lineWidth = 5;
    b.beginPath(); b.arc(LW / 2, WALL + 46, 30, 0, 6.283); b.stroke();
    b.lineWidth = 2; b.beginPath(); b.arc(LW / 2, WALL + 46, 20, 0, 6.283); b.stroke();
    b.fillStyle = "#c49a22";
    for (let sp = 0; sp < 6; sp++) {
      const a2 = (sp / 6) * 6.283;
      b.beginPath(); b.arc(LW / 2 + Math.cos(a2) * 25, WALL + 46 + Math.sin(a2) * 25, 2.6, 0, 6.283); b.fill();
    }
    for (let cp = 0; cp < 7; cp++) {
      const px2 = 70 + rng() * (LW - 140), py2 = 90 + rng() * (LH - 180);
      if (Math.abs(px2 - LW / 2) < 90 && py2 < 200) continue;
      b.fillStyle = dark ? "rgba(240,201,79,0.20)" : "rgba(180,140,40,0.22)";
      b.beginPath(); b.ellipse(px2, py2, 17, 6, 0, 0, 6.283); b.fill();
      b.fillStyle = dark ? "rgba(255,232,138,0.35)" : "rgba(200,155,45,0.35)";
      b.beginPath(); b.ellipse(px2, py2 - 3, 10, 4, 0, 0, 6.283); b.fill();
    }
  }
  if (kind === "server") {
    /* cool light pools + floor cable runs */
    for (const [lx, ly] of [[150, 170], [570, 170], [150, 540], [570, 540]] as const) {
      const lg = b.createRadialGradient(lx, ly, 0, lx, ly, 95);
      lg.addColorStop(0, dark ? "rgba(96,165,250,0.13)" : "rgba(96,140,220,0.10)"); lg.addColorStop(1, "rgba(0,0,0,0)");
      b.fillStyle = lg; b.fillRect(lx - 95, ly - 95, 190, 190);
    }
    b.strokeStyle = dark ? "rgba(120,130,150,0.25)" : "rgba(90,100,120,0.22)"; b.lineWidth = 3;
    for (const cx3 of [110, 610]) {
      b.beginPath(); b.moveTo(cx3, WALL); b.lineTo(cx3, LH - WALL); b.stroke();
    }
  }
  if (kind === "lobby") {
    /* gold inlay diamonds in the floor corners — a lobby's welcome */
    b.strokeStyle = dark ? "rgba(212,175,55,0.35)" : "rgba(138,109,31,0.35)"; b.lineWidth = 1.6;
    for (const [ix2, iy2] of [[120, 130], [600, 130], [120, 590], [600, 590]] as const) {
      b.beginPath();
      b.moveTo(ix2, iy2 - 17); b.lineTo(ix2 + 17, iy2); b.lineTo(ix2, iy2 + 17); b.lineTo(ix2 - 17, iy2);
      b.closePath(); b.stroke();
      b.fillStyle = dark ? "rgba(240,201,79,0.5)" : "rgba(160,120,35,0.5)";
      b.beginPath(); b.arc(ix2, iy2, 2.6, 0, 6.283); b.fill();
    }
  }
  /* vignette */
  const vg = b.createRadialGradient(LW / 2, LH / 2, LH * 0.42, LW / 2, LH / 2, LH * 0.78);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, pal.vign);
  b.fillStyle = vg; b.fillRect(0, 0, LW, LH);
}

/* ─── collisions ──────────────────────────────────────────────────────── */
function moveCircle(g: G, e: { x: number; y: number; r: number }, dx: number, dy: number) {
  e.x += dx;
  e.x = clamp(e.x, WALL + e.r, LW - WALL - e.r);
  e.y = clamp(e.y, WALL + e.r, LH - WALL - e.r);
  for (const o of g.obstacles) {
    const nx = clamp(e.x, o.x, o.x + o.w), ny = clamp(e.y, o.y, o.y + o.h);
    const ddx = e.x - nx, ddy = e.y - ny, dd = ddx * ddx + ddy * ddy;
    if (dd < e.r * e.r) {
      if (dd === 0) { e.x = o.x - e.r; continue; }
      const len = Math.sqrt(dd);
      e.x = nx + (ddx / len) * e.r;
    }
  }
  e.y += dy;
  e.y = clamp(e.y, WALL + e.r, LH - WALL - e.r);
  for (const o2 of g.obstacles) {
    const mx = clamp(e.x, o2.x, o2.x + o2.w), my = clamp(e.y, o2.y, o2.y + o2.h);
    const ex = e.x - mx, ey = e.y - my, ee = ex * ex + ey * ey;
    if (ee < e.r * e.r) {
      if (ee === 0) { e.y = o2.y - e.r; continue; }
      const len2 = Math.sqrt(ee);
      e.y = my + (ey / len2) * e.r;
    }
  }
}
function boltBlocked(g: G, x: number, y: number) {
  if (x < WALL || x > LW - WALL || y < WALL || y > LH - WALL) return true;
  return pointInRects(g, x, y, 0);
}

/* ─── effects ─────────────────────────────────────────────────────────── */
function burst(g: G, x: number, y: number, color: string, n: number, spd = 130) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = (0.3 + Math.random() * 0.7) * spd;
    g.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.35 + Math.random() * 0.3, color, size: 2 + Math.random() * 2.5 });
  }
}
function floater(g: G, x: number, y: number, text: string, color: string) {
  g.floats.push({ x, y, life: 0, text, color });
}

/* ─── combat ──────────────────────────────────────────────────────────── */
function damagePlayer(g: G, dmg: number, bg: HTMLCanvasElement | null) {
  const P = g.P;
  if (P.invuln > 0 || P.dashT > 0 || g.phase !== "playing") return;
  P.hp -= dmg; sfx.hurt();
  P.invuln = 0.9; P.flash = 0.25; g.shake = Math.max(g.shake, 9);
  burst(g, P.x, P.y, "#e5484d", 10, 150);
  g.ui.hud();
  if (P.hp <= 0) { P.hp = 0; die(g, bg); }
}
function killEnemy(g: G, e: Enemy) {
  g.kills++; sfx.die();
  if (g.comboTimer > 0) g.combo++; else g.combo = 1;
  g.comboTimer = CROWNFALL.comboWindowSec;
  if (g.combo > g.bestCombo) g.bestCombo = g.combo;
  if (g.combo >= 2) { g.comboBonus += g.combo - 1; floater(g, e.x, e.y - 20, "Combo x" + g.combo, "#c49a22"); }
  if (e.type === "boss") g.shake = Math.max(g.shake, 14);
  burst(g, e.x, e.y, "#f0c94f", e.type === "boss" ? 42 : 16, 190);
  burst(g, e.x, e.y, "#e5484d", 8, 130);
  /* MP: drops are rolled by the server and arrive as coin.spawn
     events — the local Math.random drop table is solo-only. */
  if (!g.mp) {
    if (e.type === "boss" || e.elite) {
      g.pickups.push({ x: e.x, y: e.y, r: 11, kind: "crown", bob: Math.random() * 6.28, mpId: null });
      g.pickups.push({ x: e.x + 18, y: e.y + 8, r: 11, kind: "crown", bob: Math.random() * 6.28, mpId: null });
    } else if (Math.random() < 0.3) {
      g.pickups.push({ x: e.x, y: e.y, r: 11, kind: "crown", bob: Math.random() * 6.28, mpId: null });
    }
    if (Math.random() < 0.12 && g.P.hp < g.P.maxhp) {
      g.pickups.push({ x: e.x + 14, y: e.y - 10, r: 10, kind: "heart", bob: 0, mpId: null });
    }
  }
  if (e === g.boss) g.boss = null;
  /* MP: the door opens on the server's floor.cleared, never locally. */
  if (!g.mp && g.enemies.length === 0 && g.phase === "playing") {
    g.doorOpen = true; sfx.door();
    g.ui.msg("Room cleared — the golden door is open!");
  }
  g.ui.hud();
}
/* Resolve the player's aim for this frame. AUTO-SHOOT IS OFF (owner
   ruling, Nov 10): there is no fallback targeting — with no aim input
   the King simply does not fire. Priority: pad right stick, then the
   touch aim stick, then a recently-moved mouse over the arena. */
function resolveAim(g: G) {
  const P = g.P;
  if (g.padAim.on) { g.aim.on = true; g.aim.x = g.padAim.x; g.aim.y = g.padAim.y; return; }
  if (g.aimJoy.on) {
    const m = Math.sqrt(g.aimJoy.dx * g.aimJoy.dx + g.aimJoy.dy * g.aimJoy.dy);
    if (m > 0.35) {
      g.aim.on = true; g.aim.x = g.aimJoy.dx / (m || 1); g.aim.y = g.aimJoy.dy / (m || 1);
      return;
    }
  }
  const ma = g.mouseAim;
  if (ma.inside && g.timeNow - ma.lastAt < 2.5) {
    const dx = ma.x - P.x, dy = ma.y - P.y;
    const m = Math.sqrt(dx * dx + dy * dy);
    if (m > 10) { g.aim.on = true; g.aim.x = dx / m; g.aim.y = dy / m; return; }
  }
  g.aim.on = false;
}

function fireBolts(g: G) {
  const P = g.P;
  if (!g.aim.on) return; /* no aim, no shots — the player's call alone */
  const base = Math.atan2(g.aim.y, g.aim.x);
  P.faceX = Math.cos(base); P.faceY = Math.sin(base);
  sfx.shoot();
  burst(g, P.x + Math.cos(base) * 20, P.y + Math.sin(base) * 20, "#ffe98a", 2, 60);
  let shots: number[] = [];
  for (let k = 0; k < P.multishot; k++) shots.push(P.multishot === 1 ? 0 : (k - (P.multishot - 1) / 2) * 0.14);
  if (P.spread) { if (shots.length === 1) shots = [-0.22, 0, 0.22]; else shots = shots.concat([-0.24, 0.24]); }
  for (const off of shots) {
    const a = base + off;
    g.bolts.push({ x: P.x + Math.cos(a) * 18, y: P.y + Math.sin(a) * 18, vx: Math.cos(a) * 545, vy: Math.sin(a) * 545, r: 5, dmg: P.dmg, pierceLeft: P.pierce ? 2 : 0, hit: [] });
  }
}
function enemyShoot(g: G, e: Enemy, speed: number, dmg: number, spread = 0, tx = g.P.x, ty = g.P.y) {
  const a = Math.atan2(ty - e.y, tx - e.x) + spread;
  g.ebolts.push({ x: e.x + Math.cos(a) * (e.r + 4), y: e.y + Math.sin(a) * (e.r + 4), vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 5, dmg });
}

/* MP: the foe's prey — the nearest living King among the local King
   and the party's last-known positions (down/away Kings are not
   prey). Solo this is always the local King (updateEnemy passes P). */
function mpTargetOf(g: G, e: Enemy): { x: number; y: number } {
  const mp = g.mp;
  if (!mp) return g.P;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  if (!g.mpDown) {
    best = g.P;
    bestD = dist2(e.x, e.y, g.P.x, g.P.y);
  }
  for (const king of mp.remoteKings.values()) {
    if (king.down || king.away) continue;
    const d = dist2(e.x, e.y, king.x, king.y);
    if (d < bestD) { bestD = d; best = king; }
  }
  return best ?? g.P;
}

/* ─── enemy brains ────────────────────────────────────────────────────── */
function updateEnemy(g: G, e: Enemy, dt: number, bg: HTMLCanvasElement | null) {
  const P = g.P;
  e.flash = Math.max(0, e.flash - dt);
  if (e.kx || e.ky) { moveCircle(g, e, e.kx * dt, e.ky * dt); e.kx *= 0.82; e.ky *= 0.82; if (Math.abs(e.kx) < 4) e.kx = 0; if (Math.abs(e.ky) < 4) e.ky = 0; }
  e.wob += dt * 3;
  /* MP: foes hunt the nearest living King (see mpTargetOf); solo the
     target is the local King and every line below is unchanged. */
  const T = g.mp ? mpTargetOf(g, e) : P;
  const dx = T.x - e.x, dy = T.y - e.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / d, uy = dy / d;
  let mx = 0, my = 0;

  if (e.type === "chaser") {
    mx = ux + Math.cos(e.wob) * 0.18;
    my = uy + Math.sin(e.wob) * 0.18;
    const ml = Math.sqrt(mx * mx + my * my) || 1;
    moveCircle(g, e, (mx / ml) * e.speed * dt, (my / ml) * e.speed * dt);
  } else if (e.type === "shooter") {
    const want = 252;
    const radial = d > want + 26 ? 1 : d < want - 26 ? -1 : 0;
    const strafe = Math.sin(e.wob * 0.6) > 0 ? 1 : -1;
    mx = ux * radial + -uy * strafe * 0.55;
    my = uy * radial + ux * strafe * 0.55;
    const ml2 = Math.sqrt(mx * mx + my * my) || 1;
    moveCircle(g, e, (mx / ml2) * e.speed * dt, (my / ml2) * e.speed * dt);
    e.fireT -= dt;
    if (e.fireT <= 0 && d < 430) { enemyShoot(g, e, 295, 8, 0, T.x, T.y); e.fireT = Math.max(1.05, 1.8 - g.depth * 0.05); }
  } else if (e.type === "dasher") {
    e.t -= dt;
    if (e.state === "stalk") {
      moveCircle(g, e, ux * e.speed * dt, uy * e.speed * dt);
      if (d < 315) { e.state = "aim"; e.t = 0.55; e.lockX = ux; e.lockY = uy; }
    } else if (e.state === "aim") {
      e.lockX = ux; e.lockY = uy; /* tracks until the lunge commits */
      if (e.t <= 0) { e.state = "lunge"; e.t = 0.32; }
    } else if (e.state === "lunge") {
      moveCircle(g, e, e.lockX * 625 * dt, e.lockY * 625 * dt);
      if (e.t <= 0) { e.state = "rest"; e.t = 0.75; }
    } else { /* rest */
      moveCircle(g, e, ux * e.speed * 0.3 * dt, uy * e.speed * 0.3 * dt);
      if (e.t <= 0) e.state = "stalk";
    }
  } else if (e.type === "boss") {
    e.t -= dt;
    e.fireT -= dt;
    if (e.state === "stalk") {
      moveCircle(g, e, ux * e.speed * dt, uy * e.speed * dt);
      if (e.t <= 0 && d < 430) { e.state = "aim"; e.t = 0.45; e.lockX = ux; e.lockY = uy; }
      if (e.fireT <= 0) {
        enemyShoot(g, e, 285, 12, 0, T.x, T.y); enemyShoot(g, e, 285, 12, 0.3, T.x, T.y); enemyShoot(g, e, 285, 12, -0.3, T.x, T.y);
        e.fireT = 2.3;
      }
    } else if (e.state === "aim") {
      e.lockX = ux; e.lockY = uy;
      if (e.t <= 0) { e.state = "lunge"; e.t = 0.5; burst(g, e.x, e.y, "#e5484d", 8, 120); }
    } else if (e.state === "lunge") {
      moveCircle(g, e, e.lockX * 480 * dt, e.lockY * 480 * dt);
      if (e.t <= 0) { e.state = "stalk"; e.t = 2.6 + Math.random() * 1.4; }
    }
  }

  /* gentle separation so foes don't stack */
  for (const o of g.enemies) {
    if (o === e) continue;
    const sx = e.x - o.x, sy = e.y - o.y, sd = sx * sx + sy * sy, min = (e.r + o.r) * (e.r + o.r);
    if (sd > 0 && sd < min) {
      const l = Math.sqrt(sd);
      e.x += (sx / l) * 26 * dt; e.y += (sy / l) * 26 * dt;
    }
  }
  /* contact damage — always measured against the LOCAL King: a foe
     harms a player only on that player's own screen (in MP, d above
     tracks the party target, which may be somebody else's King). */
  const pd = Math.sqrt(dist2(e.x, e.y, P.x, P.y));
  if (pd < e.r + P.r - 2) damagePlayer(g, e.dmg, bg);
}

/* ─── upgrades ────────────────────────────────────────────────────────── */
interface UpgradeDef {
  id: string; name: string; desc: string;
  apply: (p: Player) => void;
}
const UPGRADES: UpgradeDef[] = [
  { id: "dmg", name: "Turbo Damage", desc: "+30% bolt damage. Every Glitch feels it.", apply: (p) => { p.dmg *= 1.3; } },
  { id: "speed", name: "Studio Hustle", desc: "+12% move speed. Outrun anything in the studio.", apply: (p) => { p.speed *= 1.12; } },
  { id: "vit", name: "Royal Vitality", desc: "+25 max HP, and heal 40 right now.", apply: (p) => { p.maxhp += 25; p.hp = Math.min(p.maxhp, p.hp + 40); } },
  { id: "rapid", name: "Turbo Fire", desc: "+18% attack speed. A golden storm.", apply: (p) => { p.fireRate *= 1.18; } },
  { id: "dash", name: "Quick Dash", desc: "Dash recharges 25% faster.", apply: (p) => { p.dashCdMax *= 0.75; } },
  { id: "twin", name: "Twin Bolts", desc: "Fire one extra bolt with every shot.", apply: (p) => { p.multishot += 1; } },
  { id: "spread", name: "Triple Upload", desc: "Spread shot: bolts fan out in a triple burst.", apply: (p) => { p.spread = true; } },
  { id: "pierce", name: "Royal Pierce", desc: "Bolts pierce through foes and keep going.", apply: (p) => { p.pierce = true; } },
  { id: "magnet", name: "Bucs Magnet", desc: "Bucs coins pull in from much farther away.", apply: (p) => { p.magnet = 165; } },
];
function setUpgradeHighlight(g: G, i: number) {
  if (!g.upgradePicks.length) return;
  g.upgradeIndex = ((i % g.upgradePicks.length) + g.upgradePicks.length) % g.upgradePicks.length;
  g.ui.highlight(g.upgradeIndex);
}
function pickUpgrade(g: G, idx: number, _bg: HTMLCanvasElement | null) {
  if (g.phase !== "upgrade" || !g.upgradePicks.length) return;
  const u = g.upgradePicks[clamp(idx, 0, g.upgradePicks.length - 1)];
  if (!u) return;
  sfx.upgrade();
  u.apply(g.P);
  g.upgradePicks = [];
  /* The next floor was already generated and walked into during the
     door passage — picking the card simply starts the fight there. */
  g.phase = "playing";
  g.ui.phase("playing");
  g.ui.upgrades([]);
  g.ui.hud();
}

/* ─── the door passage (no teleport — owner ruling) ─────────────────────
   Stepping through the golden door: snapshot the cleared room, THEN
   generate the next floor into the spare backdrop. updateTransit
   walks the King to the door and slides the view up a full room;
   only on arrival do the upgrade cards appear, in the new room. */
function beginTransit(g: G, _bg: HTMLCanvasElement | null, bgAlt: HTMLCanvasElement | null) {
  if (g.transit || g.phase !== "playing") return;
  const snapObstacles = g.obstacles;
  const snapPickups = g.pickups;
  const fromX = g.P.x, fromY = g.P.y;
  g.depth++;
  g.phase = "transit";
  g.ui.phase("transit");
  genFloor(g, g.depth, bgAlt);
  g.transit = {
    t: 0, fromX, fromY, camY: 0, kingX: fromX, kingY: fromY,
    done: false, snapObstacles, snapPickups,
  };
}
function updateTransit(g: G, dt: number) {
  const tr = g.transit;
  if (!tr) return;
  tr.t += dt;
  if (tr.t < TRANSIT_WALK_SEC) {
    const k = tr.t / TRANSIT_WALK_SEC;
    const e = 1 - (1 - k) * (1 - k); /* ease-out toward the door */
    tr.camY = 0;
    tr.kingX = tr.fromX + (LW / 2 - tr.fromX) * e;
    tr.kingY = tr.fromY + (WALL + 6 - tr.fromY) * e;
    return;
  }
  const k = clamp((tr.t - TRANSIT_WALK_SEC) / TRANSIT_SLIDE_SEC, 0, 1);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; /* easeInOutCubic */
  tr.camY = e * LH;
  tr.kingX = LW / 2;
  tr.kingY = WALL + 6 + (LH - 110 - (WALL + 6)) * e;
  if (k >= 1) {
    g.transit = null;
    g.bgSwap = true; /* the component now treats the spare bg as current */
    g.P.x = LW / 2; g.P.y = LH - 110; /* genFloor's entrance, exactly */
    g.phase = "upgrade";
    g.ui.phase("upgrade");
    g.ui.intro(g.depth);
    showUpgrades(g);
    g.ui.hud();
  }
}
function showUpgrades(g: G) {
  const pool = UPGRADES.slice();
  g.upgradePicks = [];
  while (g.upgradePicks.length < 3 && pool.length) {
    g.upgradePicks.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]!);
  }
  g.upgradeIndex = 0;
  g.ui.upgrades(g.upgradePicks);
  g.ui.highlight(0);
}

/* ─── run flow ────────────────────────────────────────────────────────── */
function startRun(g: G, bg: HTMLCanvasElement | null) {
  /* MP: a run starts only on the server's word (the tick consumes a
     start directive) — a death-screen restart inside a party room
     must never spin up a phantom local run. */
  if (g.mp && !g.mp.started) return;
  ensureAudio();
  /* MP: the seed is the room's — every King in the party generates
     the identical descent from it. */
  g.runSeed = g.mp ? g.mp.seed : ((Math.random() * 1000000000) | 0);
  g.depth = 1; g.crowns = 0; g.kills = 0;
  g.combo = 0; g.comboTimer = 0; g.bestCombo = 0; g.comboBonus = 0; g.runTime = 0;
  g.paused = false; g.afterimages = [];
  g.mpDown = false; g.mpRevive = false;
  g.overFired = false;
  g.P = newPlayer();
  g.phase = "playing";
  g.ui.paused(false);
  g.ui.phase("playing");
  genFloor(g, 1, bg);
  g.ui.hud();
}
function die(g: G, _bg: HTMLCanvasElement | null) {
  /* MP: falling is not the end — the King spectates his party and
     rises at the next floor at half health. The run itself ends only
     on the server's word (a party wipe), via mpEndRun. */
  if (g.mp) {
    if (!g.mpDown) {
      g.mpDown = true;
      g.mp.notifyLocalDown();
      g.ui.msg("You fell — watch the party. You rise next floor at half health.");
      g.ui.hud();
    }
    return;
  }
  g.phase = "dead";
  g.deathAt = g.timeNow;
  const sc = scoreOf(g);
  const isSessionBest = sc > g.sessionBest.score;
  if (isSessionBest) g.sessionBest.score = sc;
  g.sessionBest.depth = Math.max(g.sessionBest.depth, g.depth);
  sfx.sting();
  g.ui.phase("dead");
  g.ui.death({
    depth: g.depth, crowns: g.crowns, kills: g.kills, score: sc,
    bestCombo: g.bestCombo, timeSec: g.runTime,
    bossDeath: g.boss !== null || g.depth % 5 === 0,
    isSessionBest,
  });
}

/* ─── online multiplayer: the tick + party rendering ───────────────────
   Everything below is inert solo (g.mp null). The tick runs once per
   rAF frame while a party is connected: ALL network truth enters the
   simulation here — server events are drained and applied between
   updates, never mid-update — and the King's state streams out at
   ~15 Hz. The referee math (damage, drops, purses, doors, receipts)
   lives server-side in lib/crownfall-rooms.ts; this is presentation
   and intent only. */

/** The server ended the run (a party wipe): close the local run out
 *  exactly the way die() closes a solo one — same summary, same
 *  onGameOver — but on the party's word, not the local King's. */
function mpEndRun(g: G) {
  if (g.phase === "dead" || g.phase === "start") return;
  g.phase = "dead";
  g.deathAt = g.timeNow;
  const sc = scoreOf(g);
  const isSessionBest = sc > g.sessionBest.score;
  if (isSessionBest) g.sessionBest.score = sc;
  g.sessionBest.depth = Math.max(g.sessionBest.depth, g.depth);
  sfx.sting();
  g.ui.phase("dead");
  g.ui.death({
    depth: g.depth, crowns: g.crowns, kills: g.kills, score: sc,
    bestCombo: g.bestCombo, timeSec: g.runTime,
    bossDeath: g.boss !== null || g.depth % 5 === 0,
    isSessionBest,
  });
}

function mpTick(g: G, bg: HTMLCanvasElement | null, bgAlt: HTMLCanvasElement | null) {
  const mp = g.mp;
  if (!mp) return;
  /* A party run does not pause: the room is live whether or not this
     screen is looking at it, so a local pause request is undone. */
  if (g.paused) { g.paused = false; g.ui.paused(false); }
  mp.pruneRemoteKings();

  /* ── start / resync directive ── */
  const dir = mp.takeStartDirective();
  if (dir && (dir.resync || g.phase === "start" || g.phase === "dead")) {
    startRun(g, bg);
    if (dir.snapshot || dir.depth > 1) {
      /* Reconnect: rebuild the party's current floor from the seed
         and re-apply its server truth (dead/hurt foes, taken coins,
         live drops). The King re-enters at the entrance — a v1
         resync simplification, never a score event. */
      g.depth = dir.depth;
      genFloor(g, dir.depth, bg);
      const snap = dir.snapshot;
      if (snap) {
        for (const f of snap.foes) {
          const idx = g.enemies.findIndex((e) => e.id === f.id);
          if (idx < 0) continue;
          if (f.down) {
            const [gone] = g.enemies.splice(idx, 1);
            if (gone === g.boss) g.boss = null;
          } else {
            g.enemies[idx]!.hp = f.hp;
          }
        }
        if (snap.coinsTaken.length) {
          const taken = new Set(snap.coinsTaken);
          g.pickups = g.pickups.filter((pk) => !pk.mpId || !taken.has(pk.mpId));
        }
        for (const c of snap.coinsLive) {
          if (c.onlyPeerId && c.onlyPeerId !== mp.selfPeerId) continue;
          g.pickups.push({ x: c.x, y: c.y, r: c.kind === "heart" ? 10 : 11, kind: c.kind, bob: 0, mpId: c.coinId });
        }
      }
      if (mp.selfDown) g.mpDown = true;
      g.ui.hud();
    }
  }

  /* ── register this floor's roster (first client in wins) ── */
  if (g.phase === "playing" && mp.needsRoster(g.depth)) {
    mp.sendRoster(
      g.depth,
      g.enemies.map((e) => ({ id: e.id, type: e.type, elite: e.elite, maxHp: e.maxhp })),
      g.mpPlacedCount,
    );
  }

  /* ── server events ── */
  for (const ev of mp.drainEvents()) {
    switch (ev.kind) {
      case "foeHp": {
        const foe = g.enemies.find((e) => e.id === ev.foeId);
        if (foe && ev.hp > 0) foe.hp = ev.hp;
        break;
      }
      case "foeDown": {
        const idx = g.enemies.findIndex((e) => e.id === ev.foeId);
        if (idx < 0) break;
        const [foe] = g.enemies.splice(idx, 1);
        if (!foe) break;
        if (ev.byPeerId === mp.selfPeerId) {
          /* My kill: the full local kill path (combo, sfx, bursts) —
             its drop/door branches are MP-guarded inside killEnemy. */
          killEnemy(g, foe);
        } else {
          burst(g, foe.x, foe.y, "#f0c94f", foe.type === "boss" ? 42 : 16, 190);
          burst(g, foe.x, foe.y, "#e5484d", 8, 130);
          if (foe.type === "boss") g.shake = Math.max(g.shake, 14);
          if (foe === g.boss) g.boss = null;
          g.ui.hud();
        }
        break;
      }
      case "coinSpawn": {
        if (ev.onlyPeerId && ev.onlyPeerId !== mp.selfPeerId) break;
        g.pickups.push({
          x: ev.x, y: ev.y, r: ev.coinKind === "heart" ? 10 : 11,
          kind: ev.coinKind, bob: 0, mpId: ev.coinId,
        });
        break;
      }
      case "coinTaken": {
        const idx = g.pickups.findIndex((pk) => pk.mpId === ev.coinId);
        if (idx >= 0) g.pickups.splice(idx, 1);
        break;
      }
      case "floorCleared": {
        if (!g.doorOpen) {
          g.doorOpen = true; sfx.door();
          g.ui.msg("Room cleared — the golden door is open!");
        }
        break;
      }
      case "floorBegin": {
        if (g.mpDown) g.mpRevive = true;
        if (g.phase === "playing" || g.phase === "upgrade") {
          /* beginTransit counts the floor it walks into. */
          g.depth = ev.depth - 1;
          beginTransit(g, bg, bgAlt ?? bg);
        }
        break;
      }
      case "playerDown":
        break; /* the roster + state frames carry a fall */
      case "runEnded": {
        mpEndRun(g);
        break;
      }
    }
  }

  /* ── revive at floor start: half health, on the new floor ── */
  if (g.mpRevive && g.phase === "playing") {
    g.mpRevive = false;
    g.mpDown = false;
    g.P.hp = Math.ceil(g.P.maxhp / 2);
    g.P.invuln = Math.max(g.P.invuln, 0.6);
    g.ui.msg("You rise again — half health. Make it count.");
    g.ui.hud();
  }

  /* ── tallies are the server's: sync HUD/score truth every frame ── */
  if (mp.myPurse > g.crowns) {
    sfx.crown();
    floater(g, g.P.x, g.P.y - 24, "+25", "#c49a22");
  }
  g.crowns = mp.myPurse;
  g.kills = mp.myKills;

  /* ── my King state, ~15 Hz (throttled inside the client) ── */
  if (g.phase === "playing" || g.phase === "upgrade" || g.phase === "transit") {
    mp.maybeSendState({
      x: Math.round(g.P.x), y: Math.round(g.P.y),
      faceX: g.P.faceX, faceY: g.P.faceY,
      hp: Math.max(0, Math.ceil(g.P.hp)), maxhp: g.P.maxhp,
      firing: g.aim.on, down: g.mpDown, away: g.phase === "upgrade",
    });
  }
}

/* The party's Kings, drawn with the same sprite as the local King —
   a fallen party member ghosts, and every King wears his name. */
function drawRemoteKings(g: G, ctx: CanvasRenderingContext2D) {
  const mp = g.mp;
  if (!mp) return;
  for (const king of mp.remoteKings.values()) {
    const alpha = king.down ? 0.3 : king.away ? 0.55 : 1;
    drawKingSprite(g, ctx, king.x, king.y, 1.35, alpha, king.faceX, king.faceY);
    ctx.save();
    ctx.globalAlpha = king.down ? 0.5 : 0.95;
    ctx.font = "700 10px Cinzel, serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#f0c94f";
    ctx.fillText(king.displayName, king.x, king.y - 34);
    if (king.maxhp > 0 && king.hp < king.maxhp) {
      const w = 38, pct = Math.max(0, king.hp / king.maxhp);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(king.x - w / 2, king.y - 29, w, 4);
      ctx.fillStyle = king.down ? "#e5484d" : "#7bc47f";
      ctx.fillRect(king.x - w / 2, king.y - 29, w * pct, 4);
    }
    if (king.down) {
      ctx.font = "700 9px sans-serif";
      ctx.fillStyle = "#e5484d";
      ctx.fillText("DOWN", king.x, king.y + 32);
    }
    ctx.restore();
  }
}

/* ─── player actions + main update ────────────────────────────────────── */
function tryDash(g: G) {
  const P = g.P;
  if (g.mpDown) return; /* MP: a fallen King spectates — no dashing */
  if (g.phase !== "playing" || P.dashCd > 0) return;
  let dx = 0, dy = 0;
  if (g.joy.on && (g.joy.dx || g.joy.dy)) { dx = g.joy.dx; dy = g.joy.dy; }
  else if (g.padVec.x || g.padVec.y) { dx = g.padVec.x; dy = g.padVec.y; }
  else {
    if (g.keys["a"] || g.keys["arrowleft"]) dx -= 1;
    if (g.keys["d"] || g.keys["arrowright"]) dx += 1;
    if (g.keys["w"] || g.keys["arrowup"]) dy -= 1;
    if (g.keys["s"] || g.keys["arrowdown"]) dy += 1;
  }
  if (dx === 0 && dy === 0) { dx = P.faceX; dy = P.faceY; }
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  P.dashDX = dx / l; P.dashDY = dy / l;
  P.dashT = 0.16; P.dashCd = P.dashCdMax; sfx.dash();
  burst(g, P.x, P.y, "#f0c94f", 6, 90);
}

function update(g: G, dt: number, bg: HTMLCanvasElement | null, bgAlt: HTMLCanvasElement | null = null) {
  g.timeNow += dt;
  g.doorPulse += dt;
  if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 26);
  let i: number;

  /* particles & floaters always drift */
  for (i = g.parts.length - 1; i >= 0; i--) {
    const pt = g.parts[i]!;
    pt.life += dt;
    pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= 0.92; pt.vy *= 0.92;
    if (pt.life > pt.max) g.parts.splice(i, 1);
  }
  for (i = g.floats.length - 1; i >= 0; i--) {
    const f = g.floats[i]!;
    f.life += dt; f.y -= 34 * dt;
    if (f.life > 0.9) g.floats.splice(i, 1);
  }
  for (i = g.afterimages.length - 1; i >= 0; i--) {
    if ((g.afterimages[i]!.life += dt) > 0.3) g.afterimages.splice(i, 1);
  }
  if (g.paused) return;
  if (g.phase === "transit") { updateTransit(g, dt); return; }
  if (g.phase !== "playing") return;
  const P = g.P;
  g.runTime += dt;
  if (g.comboTimer > 0) { g.comboTimer -= dt; if (g.comboTimer <= 0) g.combo = 0; }

  /* MP: a fallen King is a spectator — every input source is zeroed
     before the reads below, so he cannot move, aim, or fire. (Dash
     has its own guard in tryDash; it is triggered outside update.) */
  if (g.mpDown) {
    g.keys = {};
    g.joy.on = false; g.joy.dx = 0; g.joy.dy = 0;
    g.padVec.x = 0; g.padVec.y = 0;
    g.padAim.on = false; g.aimJoy.on = false;
    g.mouseAim.lastAt = -10;
  }

  /* ---- player movement ---- */
  let ix = 0, iy = 0;
  if (g.keys["a"] || g.keys["arrowleft"]) ix -= 1;
  if (g.keys["d"] || g.keys["arrowright"]) ix += 1;
  if (g.keys["w"] || g.keys["arrowup"]) iy -= 1;
  if (g.keys["s"] || g.keys["arrowdown"]) iy += 1;
  if (g.joy.on) { ix = g.joy.dx; iy = g.joy.dy; }
  else if (g.padVec.x || g.padVec.y) { ix = g.padVec.x; iy = g.padVec.y; }
  P.moveMag = Math.min(1, Math.sqrt(ix * ix + iy * iy));
  let il = Math.sqrt(ix * ix + iy * iy);
  if (il > 1) { ix /= il; iy /= il; il = 1; }
  if (il > 0.12) { P.faceX = ix / (il || 1); P.faceY = iy / (il || 1); }

  P.invuln = Math.max(0, P.invuln - dt);
  P.flash = Math.max(0, P.flash - dt);
  P.dashCd = Math.max(0, P.dashCd - dt);
  if (P.dashT > 0) {
    P.dashT -= dt;
    moveCircle(g, P, P.dashDX * P.speed * 3.1 * dt, P.dashDY * P.speed * 3.1 * dt);
    g.afterimages.push({ x: P.x, y: P.y, faceX: P.faceX, faceY: P.faceY, life: 0 });
    g.parts.push({ x: P.x, y: P.y, vx: 0, vy: 0, life: 0, max: 0.28, color: "#d4af37", size: 7 });
  } else if (il > 0.05) {
    moveCircle(g, P, ix * P.speed * dt, iy * P.speed * dt);
  }

  /* ---- manual fire: bolts fly only while the player aims ---- */
  resolveAim(g);
  if (g.aim.on) { P.faceX = g.aim.x; P.faceY = g.aim.y; }
  g.fireTimer -= dt;
  if (g.fireTimer <= 0) {
    if (g.aim.on && g.enemies.length) { fireBolts(g); g.fireTimer = 1 / P.fireRate; }
    else g.fireTimer = 0; /* ready the instant aim is given */
  }

  /* ---- player bolts ---- */
  for (i = g.bolts.length - 1; i >= 0; i--) {
    const b = g.bolts[i]!;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (boltBlocked(g, b.x, b.y)) { g.bolts.splice(i, 1); continue; }
    for (let j = 0; j < g.enemies.length; j++) {
      const e = g.enemies[j]!;
      if (b.hit.indexOf(e) >= 0) continue;
      if (dist2(b.x, b.y, e.x, e.y) < (e.r + b.r) * (e.r + b.r)) {
        /* MP: the hit is REPORTED, not adjudicated — the server
           accumulates damage party-wide and broadcasts the death.
           Locally the foe's HP is visual only and never reaches 0
           here, so the kill branch below stays solo-only in effect. */
        if (g.mp) {
          g.mp.reportHit(e.id, b.dmg, e.x, e.y);
          e.hp = Math.max(1, e.hp - b.dmg);
        } else {
          e.hp -= b.dmg;
        }
        e.flash = 0.14; sfx.hit();
        floater(g, e.x + (Math.random() * 14 - 7), e.y - e.r - 6, "" + Math.round(b.dmg), "#ffffff");
        const kb = e.type === "boss" ? 30 : 150;
        const bl = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
        e.kx = (e.kx || 0) + (b.vx / bl) * kb; e.ky = (e.ky || 0) + (b.vy / bl) * kb;
        burst(g, b.x, b.y, "#f0c94f", 4, 120);
        if (e.hp <= 0) { g.enemies.splice(j, 1); killEnemy(g, e); }
        if (b.pierceLeft > 0) { b.pierceLeft--; b.hit.push(e); }
        else { g.bolts.splice(i, 1); }
        break;
      }
    }
  }

  /* ---- enemies ---- */
  for (i = 0; i < g.enemies.length; i++) updateEnemy(g, g.enemies[i]!, dt, bg);

  /* ---- enemy bolts ---- */
  for (i = g.ebolts.length - 1; i >= 0; i--) {
    const eb = g.ebolts[i]!;
    eb.x += eb.vx * dt; eb.y += eb.vy * dt;
    if (boltBlocked(g, eb.x, eb.y)) { g.ebolts.splice(i, 1); continue; }
    if (dist2(eb.x, eb.y, P.x, P.y) < (P.r + eb.r) * (P.r + eb.r)) {
      g.ebolts.splice(i, 1);
      damagePlayer(g, eb.dmg, bg);
    }
  }

  /* ---- pickups ---- */
  for (i = g.pickups.length - 1; i >= 0; i--) {
    const pk = g.pickups[i]!;
    const pd = Math.sqrt(dist2(pk.x, pk.y, P.x, P.y));
    const magnetR = pk.kind === "crown" ? P.magnet : 74;
    if (pd < magnetR && pd > 1) {
      pk.x += ((P.x - pk.x) / pd) * 200 * dt;
      pk.y += ((P.y - pk.y) / pd) * 200 * dt;
    }
    if (pd < P.r + pk.r + 4) {
      g.pickups.splice(i, 1);
      /* MP: touching a coin CLAIMS it — the server arbitrates the
         race, credits the winner's purse, and the tick plays the
         pickup fanfare for the winner only (coinTaken). The local
         splice is just the coin leaving this screen's floor. */
      if (g.mp && pk.mpId) g.mp.claimCoin(pk.mpId);
      if (pk.kind === "crown") {
        if (!g.mp) {
          g.crowns++; sfx.crown();
          floater(g, P.x, P.y - 24, "+25", "#c49a22");
          burst(g, pk.x, pk.y, "#f0c94f", 12, 140);
          burst(g, pk.x, pk.y, "#fff3c4", 5, 90);
        }
      } else {
        P.hp = Math.min(P.maxhp, P.hp + 18);
        floater(g, P.x, P.y - 24, "+18 HP", "#7bc47f");
        burst(g, pk.x, pk.y, "#7bc47f", 7, 110);
      }
      g.ui.hud();
    }
  }

  /* ---- the golden door: step through and WALK into the next room ---- */
  if (g.doorOpen && P.y < WALL + 26 && Math.abs(P.x - LW / 2) < 42) {
    /* MP: stepping in tells the server; the passage itself begins
       when the whole party is through (floor.begin → the tick calls
       beginTransit). The King waits at the door meanwhile. */
    if (g.mp) g.mp.notifyDoor(g.depth);
    else beginTransit(g, bg, bgAlt ?? bg);
  }

  g.ui.hud();
}

/* ─── drawing ─────────────────────────────────────────────────────────── */
function crownPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.7);
  ctx.lineTo(x - s, y - s * 0.5);
  ctx.lineTo(x - s * 0.45, y + s * 0.05);
  ctx.lineTo(x, y - s * 0.85);
  ctx.lineTo(x + s * 0.45, y + s * 0.05);
  ctx.lineTo(x + s, y - s * 0.5);
  ctx.lineTo(x + s, y + s * 0.7);
  ctx.closePath();
}

/* ─── THE KING — a purpose-drawn game sprite ──────────────────────────
   Drawn to live in the room (not a photo cutout): grey shark body with
   consistent outline + shading, gold crown, gold-bead chain with the
   fishbone pendant, wine robe sash. The same King in both themes —
   the theme changes the room's light, never the King. Faces his aim /
   move direction (horizontal flip; portrait art is never rotated). */
function drawKingSprite(g: G, ctx: CanvasRenderingContext2D, x: number, y: number, s: number, alpha: number, faceX?: number, faceY?: number) {
  const P = g.P;
  const fx = faceX ?? P.faceX, fy = faceY ?? P.faceY;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha *= alpha;
  /* soft gold ring + glow beneath him */
  const pulse = 0.8 + Math.sin(g.timeNow * 3.2) * 0.2;
  const gg = ctx.createRadialGradient(0, 26 * s, 0, 0, 26 * s, 46 * s);
  gg.addColorStop(0, "rgba(240,201,79," + 0.16 * pulse + ")"); gg.addColorStop(1, "rgba(240,201,79,0)");
  ctx.fillStyle = gg;
  ctx.beginPath(); ctx.arc(0, 26 * s, 46 * s, 0, 6.283); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  ctx.beginPath(); ctx.ellipse(0, 29 * s, 27 * s, 8 * s, 0, 0, 6.283); ctx.fill();
  ctx.strokeStyle = "rgba(240,201,79," + 0.45 * pulse + ")"; ctx.lineWidth = 1.8 * s;
  ctx.beginPath(); ctx.ellipse(0, 29 * s, 24 * s, 7 * s, 0, 0, 6.283); ctx.stroke();

  const flip = fx < -0.05 ? -1 : 1;
  ctx.scale(flip * s, s);
  ctx.rotate(clamp(fy, -1, 1) * 0.13);
  const bob = Math.sin(g.timeNow * (5 + (P.moveMag || 0) * 6)) * 1.5 * (0.35 + (P.moveMag || 0));
  ctx.translate(0, bob);
  const outline = "rgba(22,17,8,0.62)";

  /* tail fin — sways behind him */
  const sway = Math.sin(g.timeNow * (4 + (P.moveMag || 0) * 8)) * (1.5 + (P.moveMag || 0) * 3);
  const tg = ctx.createLinearGradient(-36, 0, -12, 0);
  tg.addColorStop(0, "#59636d"); tg.addColorStop(1, "#7d8791");
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(-13, -3);
  ctx.quadraticCurveTo(-26, -6 + sway * 0.3, -33, -13 + sway);
  ctx.quadraticCurveTo(-30, -1, -35, 9 + sway);
  ctx.quadraticCurveTo(-25, 7, -13, 5);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = outline; ctx.lineWidth = 1.4; ctx.stroke();

  /* body — one Path2D so sash/chain shade clip to the shark */
  const body = new Path2D();
  body.moveTo(31, 2);
  body.quadraticCurveTo(24, -13, 3, -16);
  body.quadraticCurveTo(-15, -15, -21, -5);
  body.quadraticCurveTo(-26, 5, -14, 12);
  body.quadraticCurveTo(3, 18, 18, 13);
  body.quadraticCurveTo(29, 9, 31, 2);
  body.closePath();
  const bg2 = ctx.createLinearGradient(-24, -16, 28, 16);
  bg2.addColorStop(0, "#98a2ac"); bg2.addColorStop(0.45, "#c3cad2"); bg2.addColorStop(1, "#59636d");
  ctx.fillStyle = bg2; ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  /* pale belly */
  ctx.fillStyle = "rgba(233,237,241,0.55)";
  ctx.beginPath(); ctx.ellipse(7, 11, 16, 6.5, 0.1, 0, 6.283); ctx.fill();
  /* the wine robe sash, gold-trimmed, diagonal across the torso */
  ctx.save();
  ctx.translate(1, 1); ctx.rotate(0.62);
  ctx.fillStyle = "#6d1420"; ctx.fillRect(-3.4, -24, 12.5, 48);
  ctx.fillStyle = "#c49a22"; ctx.fillRect(-3.4, -24, 2.2, 48); ctx.fillRect(6.9, -24, 2.2, 48);
  ctx.restore();
  /* shade the tail side */
  ctx.fillStyle = "rgba(30,36,44,0.18)"; ctx.fillRect(-26, -18, 13, 36);
  ctx.restore();
  ctx.strokeStyle = outline; ctx.lineWidth = 1.6; ctx.stroke(body);

  /* dorsal fin */
  ctx.fillStyle = "#6a747f";
  ctx.beginPath();
  ctx.moveTo(-1, -14.5); ctx.quadraticCurveTo(6, -25, 13, -15.5); ctx.quadraticCurveTo(6, -12.5, -1, -14.5);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = outline; ctx.lineWidth = 1.3; ctx.stroke();

  /* gill slits */
  ctx.strokeStyle = "rgba(38,44,52,0.55)"; ctx.lineWidth = 1.5;
  for (let gi = 0; gi < 3; gi++) {
    ctx.beginPath();
    ctx.moveTo(13 - gi * 3.4, -5 + gi * 0.7);
    ctx.quadraticCurveTo(11 - gi * 3.4, 0, 13.5 - gi * 3.4, 5.5);
    ctx.stroke();
  }

  /* near pectoral fin — his arm, knuckle-low and ready */
  ctx.fillStyle = "#77828d";
  ctx.beginPath();
  ctx.moveTo(6, 9);
  ctx.quadraticCurveTo(13, 20, 23, 19);
  ctx.quadraticCurveTo(17, 9.5, 8, 7);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = outline; ctx.lineWidth = 1.3; ctx.stroke();

  /* jaw line + teeth */
  ctx.strokeStyle = "rgba(28,32,38,0.7)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(30.5, 4.5); ctx.quadraticCurveTo(22, 10.5, 13, 9); ctx.stroke();
  ctx.fillStyle = "#f4f6f8";
  for (let ti = 0; ti < 3; ti++) {
    const tx = 25 - ti * 5.2, ty = 7.6 - ti * 0.9;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + 3.4, ty + 0.6); ctx.lineTo(tx + 1.4, ty + 3.6); ctx.closePath(); ctx.fill();
  }

  /* the eye — set and determined, gold brow over a dark bead */
  ctx.strokeStyle = "#c49a22"; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(15.5, -8.2); ctx.lineTo(24.5, -6.2); ctx.stroke();
  ctx.fillStyle = "#10151c";
  ctx.beginPath(); ctx.arc(20.2, -3.2, 2.7, 0, 6.283); ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(21.1, -4.1, 0.95, 0, 6.283); ctx.fill();
  ctx.fillStyle = "rgba(16,21,28,0.7)";
  ctx.beginPath(); ctx.arc(27.6, -0.6, 0.8, 0, 6.283); ctx.fill();

  /* gold-bead chain across the chest + the fishbone pendant */
  ctx.strokeStyle = "#8a6d1f"; ctx.lineWidth = 0.7;
  for (let bi = 0; bi <= 6; bi++) {
    const t = bi / 6;
    /* beads along a quadratic drape: (-7,-8.5) → ctrl (4,5) → (16,-3.5) */
    const qx = (1 - t) * (1 - t) * -7 + 2 * (1 - t) * t * 4 + t * t * 16;
    const qy = (1 - t) * (1 - t) * -8.5 + 2 * (1 - t) * t * 5 + t * t * -3.5;
    ctx.fillStyle = bi % 2 ? "#f0c94f" : "#d9b23c";
    ctx.beginPath(); ctx.arc(qx, qy, 1.55, 0, 6.283); ctx.fill(); ctx.stroke();
  }
  /* fishbone pendant at the chain's low point */
  ctx.strokeStyle = "#f3e9d2"; ctx.lineWidth = 1.4;
  const px3 = 4, py3 = 4.6;
  ctx.beginPath(); ctx.moveTo(px3, py3); ctx.lineTo(px3, py3 + 7.5); ctx.stroke();
  for (let ri = 0; ri < 3; ri++) {
    const ry = py3 + 1.8 + ri * 2;
    ctx.beginPath(); ctx.moveTo(px3 - 3 + ri * 0.6, ry + 1.6); ctx.lineTo(px3, ry); ctx.lineTo(px3 + 3 - ri * 0.6, ry + 1.6); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(px3, py3 + 7.5); ctx.lineTo(px3 - 2.8, py3 + 10.6); ctx.lineTo(px3 + 2.8, py3 + 10.6); ctx.closePath();
  ctx.fillStyle = "#f3e9d2"; ctx.fill();

  /* THE CROWN — always his, riding the head with a living tilt */
  ctx.save();
  ctx.translate(12, -18.5);
  ctx.rotate(-0.05 + Math.sin(g.timeNow * 2.3) * 0.035);
  ctx.shadowColor = "rgba(240,201,79,0.85)"; ctx.shadowBlur = 9;
  const cg = ctx.createLinearGradient(0, -9, 0, 7);
  cg.addColorStop(0, "#ffe98a"); cg.addColorStop(0.6, "#f0c94f"); cg.addColorStop(1, "#b8860b");
  ctx.fillStyle = cg;
  crownPath(ctx, 0, 0, 11.5);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#8a6d1f"; ctx.lineWidth = 1.1; ctx.stroke();
  ctx.fillStyle = "#e5484d";
  ctx.beginPath(); ctx.arc(0, 2.4, 2.3, 0, 6.283); ctx.fill();
  ctx.fillStyle = "#fff3c4";
  ctx.beginPath(); ctx.arc(-11.5, -5.7, 1.8, 0, 6.283); ctx.arc(0, -9.8, 1.8, 0, 6.283); ctx.arc(11.5, -5.7, 1.8, 0, 6.283); ctx.fill();
  ctx.restore();

  ctx.restore();
}

function drawKing(g: G, ctx: CanvasRenderingContext2D, ox?: number, oy?: number) {
  const P = g.P;
  const blink = P.invuln > 0 && P.dashT <= 0 && Math.floor(g.timeNow * 14) % 2 === 0;
  drawKingSprite(g, ctx, ox ?? P.x, oy ?? P.y, 1.35, blink ? 0.35 : 1);
  if (P.flash > 0 && ox === undefined) {
    ctx.save();
    ctx.globalAlpha = P.flash * 2.2;
    ctx.fillStyle = "#e5484d";
    ctx.beginPath(); ctx.arc(P.x, P.y, P.r + 7, 0, 6.283); ctx.fill();
    ctx.restore();
  }
}

/* ─── foes — designed sprites in the King's outline style ─────────────
   Glitch: a jagged static shard with electric edges and an RGB-split
   ghost. Spam Bot: a boxy bot — antenna, one red eye, vents. Troll: a
   hunched brute with brow, tusks and knuckle arms; its aim telegraph
   (lean back, shake, warning ring) is untouched. The Usurper keeps his
   stolen crown, shaded deep. Elites keep the gold ring + Gold- name. */
function drawEnemy(g: G, ctx: CanvasRenderingContext2D, e: Enemy) {
  const P = g.P;
  const OL = "rgba(16,12,6,0.6)";
  ctx.save();
  ctx.translate(e.x, e.y);
  if (e.elite) { ctx.strokeStyle = "#f0c94f"; ctx.lineWidth = 2.4; ctx.shadowColor = "#f0c94f"; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(0, 0, e.r + 5, 0, 6.283); ctx.stroke(); ctx.shadowBlur = 0; }
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath(); ctx.ellipse(0, e.r * 0.85, e.r * 0.95, e.r * 0.34, 0, 0, 6.283); ctx.fill();
  const flash = e.flash > 0;
  if (e.type === "chaser") {
    /* GLITCH — shard polygon, corners re-rolled by the wobble clock */
    const shard = (off: number, fill: string, alpha: number) => {
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.translate(off, 0);
      ctx.fillStyle = fill;
      ctx.beginPath();
      const pts = 8;
      for (let i = 0; i < pts; i++) {
        const a = (i / pts) * 6.283 + e.wob * 0.16;
        const jitter = 1 + 0.16 * Math.sin(e.wob * 7 + i * 2.7);
        const rr = e.r * (i % 2 ? 0.68 : 1.12) * jitter;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    shard(-2.4, "rgba(80,200,255,0.35)", 1);   /* cyan ghost */
    shard(2.4, "rgba(255,60,80,0.35)", 1);      /* red ghost */
    shard(0, flash ? "#ffb3b5" : "#7e1a20", 1); /* the shard itself */
    ctx.strokeStyle = flash ? "#ffffff" : "#67e8f9"; ctx.lineWidth = 1.6;
    ctx.shadowColor = "#22d3ee"; ctx.shadowBlur = 7;
    ctx.beginPath();
    const pts2 = 8;
    for (let i = 0; i < pts2; i++) {
      const a = (i / pts2) * 6.283 + e.wob * 0.16;
      const jitter = 1 + 0.16 * Math.sin(e.wob * 7 + i * 2.7);
      const rr = e.r * (i % 2 ? 0.68 : 1.12) * jitter;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
    ctx.shadowBlur = 0;
    /* static flecks */
    ctx.fillStyle = "rgba(190,240,255,0.85)";
    for (let fi = 0; fi < 4; fi++) {
      const fa = e.wob * 3 + fi * 1.9;
      ctx.fillRect(Math.cos(fa) * e.r * 0.55 - 1.4, Math.sin(fa * 1.3) * e.r * 0.5 - 1, 2.8, 2);
    }
    /* one hostile eye, slit over a dark core */
    ctx.fillStyle = "#2b0508";
    ctx.beginPath(); ctx.arc(0, 1, e.r * 0.44, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#ffdf6b";
    ctx.beginPath(); ctx.ellipse(0, 0, e.r * 0.3, 2.1, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#12060a";
    ctx.beginPath(); ctx.ellipse(0, 0, 2, 2.1, 0, 0, 6.283); ctx.fill();
  } else if (e.type === "shooter") {
    /* SPAM BOT — boxy bot: tread base, panel body, antenna, red eye */
    const r = e.r;
    ctx.fillStyle = "#24262b";
    ctx.beginPath(); ctx.ellipse(0, r * 0.78, r * 0.92, r * 0.3, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "rgba(240,201,79,0.75)";
    for (let ti = -1; ti <= 1; ti++) { ctx.beginPath(); ctx.arc(ti * r * 0.5, r * 0.78, 2, 0, 6.283); ctx.fill(); }
    const bodyG = ctx.createLinearGradient(0, -r, 0, r);
    bodyG.addColorStop(0, flash ? "#cfe8de" : "#3f7a68"); bodyG.addColorStop(1, flash ? "#9fc9ba" : "#1d4a3e");
    ctx.fillStyle = bodyG;
    ctx.beginPath();
    ctx.roundRect(-r * 0.92, -r * 0.72, r * 1.84, r * 1.5, 5);
    ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.5; ctx.stroke();
    /* rivets */
    ctx.fillStyle = "rgba(10,20,16,0.6)";
    for (const [rx2, ry2] of [[-0.72, -0.52], [0.72, -0.52], [-0.72, 0.58], [0.72, 0.58]] as const) {
      ctx.beginPath(); ctx.arc(rx2 * r, ry2 * r, 1.6, 0, 6.283); ctx.fill();
    }
    /* antenna with a blinking spam tip */
    ctx.strokeStyle = "#9aa3ab"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.72); ctx.lineTo(0, -r * 1.22); ctx.stroke();
    const blinkOn = Math.floor(g.timeNow * 2.4 + e.wob) % 2 === 0;
    ctx.fillStyle = blinkOn ? "#ff5347" : "#7e1a20";
    ctx.shadowColor = "#ff5347"; ctx.shadowBlur = blinkOn ? 8 : 0;
    ctx.beginPath(); ctx.arc(0, -r * 1.3, 3.1, 0, 6.283); ctx.fill();
    ctx.shadowBlur = 0;
    /* the one big red eye */
    ctx.fillStyle = "#0b1512";
    ctx.beginPath(); ctx.arc(0, -r * 0.08, r * 0.46, 0, 6.283); ctx.fill();
    ctx.strokeStyle = "rgba(240,201,79,0.5)"; ctx.lineWidth = 1.2; ctx.stroke();
    const look = Math.atan2(P.y - e.y, P.x - e.x);
    ctx.fillStyle = "#ff5347";
    ctx.shadowColor = "#ff5347"; ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.arc(Math.cos(look) * 2.6, -r * 0.08 + Math.sin(look) * 2.6, r * 0.2, 0, 6.283); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(Math.cos(look) * 2.6 - 1.4, -r * 0.08 + Math.sin(look) * 2.6 - 1.4, 1.3, 0, 6.283); ctx.fill();
    /* speaker-vent mouth: it spams */
    ctx.fillStyle = "rgba(8,16,13,0.75)";
    for (let vi = 0; vi < 3; vi++) ctx.fillRect(-r * 0.4, r * (0.42 + vi * 0.16), r * 0.8, 2.2);
  } else if (e.type === "dasher") {
    /* TROLL — hunched brute: heavy shoulders, brow, tusks, knuckles */
    let ang = Math.atan2(P.y - e.y, P.x - e.x) + Math.PI / 2;
    if (e.state === "lunge") ang = Math.atan2(e.lockY, e.lockX) + Math.PI / 2;
    ctx.rotate(ang);
    if (e.state === "aim") {
      /* telegraph: lean back, shake, flash — fair warning (unchanged) */
      ctx.translate(-e.lockX * 4 + Math.sin(g.timeNow * 55) * 1.6, -e.lockY * 4);
      ctx.scale(1.12, 0.9);
      ctx.strokeStyle = Math.floor(g.timeNow * 12) % 2 === 0 ? "rgba(255,60,60,0.95)" : "rgba(255,200,60,0.8)"; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(0, 0, e.r + 6, 0, 6.283); ctx.stroke();
    }
    const r = e.r;
    const skin = e.state === "aim" && Math.floor(g.timeNow * 12) % 2 === 0 ? "#ffdf6b" : flash ? "#ffe1a8" : "#c97a16";
    /* knuckle arms, low at the sides */
    ctx.fillStyle = flash ? "#f2c184" : "#a35f10";
    ctx.beginPath(); ctx.ellipse(-r * 0.98, r * 0.42, r * 0.34, r * 0.5, 0.35, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.98, r * 0.42, r * 0.34, r * 0.5, -0.35, 0, 6.283); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.2; ctx.stroke();
    /* hunched mass: shoulders over a low head */
    const tg2 = ctx.createLinearGradient(0, -r, 0, r);
    tg2.addColorStop(0, skin); tg2.addColorStop(1, flash ? "#d99a3c" : "#8a4f0c");
    ctx.fillStyle = tg2;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.62);
    ctx.quadraticCurveTo(r * 1.04, -r * 0.72, r * 0.94, r * 0.34);
    ctx.quadraticCurveTo(r * 0.8, r * 1.02, 0, r * 1.06);
    ctx.quadraticCurveTo(-r * 0.8, r * 1.02, -r * 0.94, r * 0.34);
    ctx.quadraticCurveTo(-r * 1.04, -r * 0.72, 0, -r * 0.62);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.5; ctx.stroke();
    /* heavy brow + hostile eyes under it */
    ctx.fillStyle = flash ? "#8a4f0c" : "#5f3606";
    ctx.beginPath(); ctx.ellipse(0, -r * 0.34, r * 0.52, r * 0.24, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#ffd34d";
    ctx.beginPath(); ctx.arc(-r * 0.24, -r * 0.2, 2.3, 0, 6.283); ctx.arc(r * 0.24, -r * 0.2, 2.3, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#1a0d02";
    ctx.beginPath(); ctx.arc(-r * 0.24, -r * 0.18, 1.1, 0, 6.283); ctx.arc(r * 0.24, -r * 0.18, 1.1, 0, 6.283); ctx.fill();
    /* underbite jaw + tusks */
    ctx.fillStyle = flash ? "#f7cf8e" : "#b06a12";
    ctx.beginPath(); ctx.ellipse(0, r * 0.52, r * 0.5, r * 0.3, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#fff6e0";
    for (const tx of [-0.3, 0.3]) {
      ctx.beginPath();
      ctx.moveTo(tx * r - 2.4, r * 0.62); ctx.lineTo(tx * r + 2.4, r * 0.62); ctx.lineTo(tx * r, r * 0.22);
      ctx.closePath(); ctx.fill();
    }
    /* back spikes */
    ctx.fillStyle = "#5f3606";
    for (let si = -1; si <= 1; si++) {
      ctx.beginPath();
      ctx.moveTo(si * r * 0.44 - 3, -r * 0.6); ctx.lineTo(si * r * 0.44, -r * 1.02); ctx.lineTo(si * r * 0.44 + 3, -r * 0.6);
      ctx.closePath(); ctx.fill();
    }
  } else if (e.type === "boss") {
    ctx.fillStyle = flash ? "#ffb3b5" : "#8c1d23";
    const bossG = ctx.createRadialGradient(-e.r * 0.3, -e.r * 0.35, e.r * 0.2, 0, 0, e.r * 1.15);
    bossG.addColorStop(0, flash ? "#ffc9cb" : "#b03036"); bossG.addColorStop(1, flash ? "#e08a8e" : "#5d0f13");
    ctx.fillStyle = bossG;
    ctx.beginPath(); ctx.arc(0, 0, e.r, 0, 6.283); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 2.4; ctx.stroke();
    /* horns */
    ctx.fillStyle = "#e8dcc0";
    ctx.beginPath();
    ctx.moveTo(-e.r * 0.8, -e.r * 0.55); ctx.lineTo(-e.r * 1.18, -e.r * 1.05); ctx.lineTo(-e.r * 0.38, -e.r * 0.86); ctx.closePath();
    ctx.moveTo(e.r * 0.8, -e.r * 0.55); ctx.lineTo(e.r * 1.18, -e.r * 1.05); ctx.lineTo(e.r * 0.38, -e.r * 0.86); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.2; ctx.stroke();
    /* stolen crown, tilted */
    ctx.save();
    ctx.translate(0, -e.r - 4); ctx.rotate(0.28 + Math.sin(g.timeNow * 2) * 0.05);
    const bg2 = ctx.createLinearGradient(0, -10, 0, 8);
    bg2.addColorStop(0, "#ffe98a"); bg2.addColorStop(1, "#b8860b");
    ctx.fillStyle = bg2; crownPath(ctx, 0, 0, 15); ctx.fill();
    ctx.strokeStyle = "#8a6d1f"; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
    /* eyes + maw */
    ctx.fillStyle = "#ffd9da";
    ctx.beginPath(); ctx.arc(-11, -7, 4.6, 0, 6.283); ctx.arc(11, -7, 4.6, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#1a0505";
    ctx.beginPath(); ctx.arc(-11, -6, 2.2, 0, 6.283); ctx.arc(11, -6, 2.2, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#4a0a0d";
    ctx.beginPath(); ctx.ellipse(0, 13, 14, 7.5, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#fff";
    for (let bI = 0; bI < 4; bI++) {
      ctx.beginPath();
      ctx.moveTo(-11 + bI * 7.4, 8); ctx.lineTo(-7.6 + bI * 7.4, 8); ctx.lineTo(-9.3 + bI * 7.4, 13.5);
      ctx.closePath(); ctx.fill();
    }
    if (e.state === "aim") {
      ctx.strokeStyle = "rgba(229,72,77,0.85)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, e.r + 9 + Math.sin(g.timeNow * 30) * 2, 0, 6.283); ctx.stroke();
    }
  }
  ctx.restore();

  if (e.elite) {
    ctx.save();
    ctx.font = "700 9px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#f0c94f";
    ctx.fillText(enemyName(e), e.x, e.y + e.r + 14);
    ctx.restore();
  }
  /* mini hp bar */
  if (e.hp < e.maxhp && e.type !== "boss") {
    const w = e.r * 2;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(e.x - e.r, e.y - e.r - 11, w, 4.5);
    ctx.fillStyle = "#e5484d";
    ctx.fillRect(e.x - e.r, e.y - e.r - 11, w * clamp(e.hp / e.maxhp, 0, 1), 4.5);
  }
}

function drawDoor(g: G, ctx: CanvasRenderingContext2D, open?: boolean) {
  const pal = PAL[g.theme];
  const isOpen = open ?? g.doorOpen;
  const dx = LW / 2, dw = 74;
  ctx.save();
  if (isOpen) {
    const pulse = 0.72 + Math.sin(g.doorPulse * 5) * 0.28;
    ctx.shadowColor = "rgba(240,201,79," + 0.85 * pulse + ")";
    ctx.shadowBlur = 26 * pulse;
    const gr = ctx.createLinearGradient(0, 0, 0, WALL + 16);
    gr.addColorStop(0, "#fff3c4"); gr.addColorStop(0.55, "#f0c94f"); gr.addColorStop(1, "#c49a22");
    ctx.fillStyle = gr;
    ctx.fillRect(dx - dw / 2, 2, dw, WALL + 12);
    ctx.shadowBlur = 0;
    /* golden DOUBLE door: two panels, centre seam, ring handles */
    ctx.strokeStyle = "rgba(122,92,14,0.8)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(dx, 4); ctx.lineTo(dx, WALL + 10); ctx.stroke();
    ctx.strokeStyle = "rgba(122,92,14,0.45)"; ctx.lineWidth = 1.4;
    ctx.strokeRect(dx - dw / 2 + 6, 7, dw / 2 - 10, WALL - 2);
    ctx.strokeRect(dx + 4, 7, dw / 2 - 10, WALL - 2);
    ctx.fillStyle = "#7a5c0e";
    ctx.beginPath(); ctx.arc(dx - 5, WALL / 2 + 4, 2.6, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(dx + 5, WALL / 2 + 4, 2.6, 0, 6.283); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255," + (0.35 + 0.3 * pulse) + ")";
    ctx.fillRect(dx - dw / 2 + 8, 6, 7, WALL);
    ctx.fillRect(dx + dw / 2 - 15, 6, 7, WALL);
    /* downward chevron hint */
    ctx.fillStyle = "rgba(90,64,4,0.85)";
    const cy = WALL + 22 + Math.sin(g.doorPulse * 5) * 3;
    ctx.beginPath();
    ctx.moveTo(dx - 11, cy); ctx.lineTo(dx + 11, cy); ctx.lineTo(dx, cy + 10); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = g.theme === "dark" ? "#232326" : "#cdbb8d";
    ctx.fillRect(dx - dw / 2, 2, dw, WALL + 8);
    ctx.strokeStyle = pal.obEdge; ctx.lineWidth = 1.6;
    ctx.strokeRect(dx - dw / 2, 2, dw, WALL + 8);
    /* closed double door: centre seam + panel grooves */
    ctx.strokeStyle = g.theme === "dark" ? "#3d3d42" : "#a68d4e";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(dx, 5); ctx.lineTo(dx, WALL + 6); ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.strokeRect(dx - dw / 2 + 7, 8, dw / 2 - 12, WALL - 6);
    ctx.strokeRect(dx + 5, 8, dw / 2 - 12, WALL - 6);
    /* padlock ring */
    ctx.strokeStyle = "#d4af37"; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(dx, WALL / 2 + 3, 6.5, 0, 6.283); ctx.stroke();
    ctx.fillStyle = "#d4af37";
    ctx.beginPath(); ctx.arc(dx, WALL / 2 + 3, 2.2, 0, 6.283); ctx.fill();
  }
  ctx.restore();
}

/* ─── the Visual Buc coin sprite ──────────────────────────────────────
   Pickups ARE the site's Visual Buc coin: the component loads the
   primary balance coin (images/visual-bucs-icon.webp — the art
   VisualBucsIcon puts next to every balance on the site) and hands it
   here. Until it loads (or if it ever fails) the drawn fallback below
   matches the site's coin styling: gold face, crown over a B. */
let coinImg: HTMLImageElement | null = null;
function setCoinImage(img: HTMLImageElement | null) { coinImg = img; }

function drawPickup(g: G, ctx: CanvasRenderingContext2D, pk: Pickup) {
  const bobY = Math.sin(g.timeNow * 3.4 + pk.bob) * 2.6;
  ctx.save();
  ctx.translate(pk.x, pk.y + bobY);
  if (pk.kind === "crown") {
    ctx.shadowColor = "rgba(240,201,79,0.9)"; ctx.shadowBlur = 12;
    if (coinImg && coinImg.complete && coinImg.naturalWidth > 0) {
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, 6.283); ctx.clip();
      ctx.drawImage(coinImg, -11, -11, 22, 22);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#8a6d1f"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, 0, 10.6, 0, 6.283); ctx.stroke();
    } else {
      const cg2 = ctx.createLinearGradient(0, -10, 0, 10);
      cg2.addColorStop(0, "#ffe98a"); cg2.addColorStop(1, "#c49a22");
      ctx.fillStyle = cg2; ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, 6.283); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#8a6d1f"; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, 6.283); ctx.stroke();
      ctx.fillStyle = "#7a5c0e";
      crownPath(ctx, 0, -3.4, 3.6); ctx.fill();
      ctx.font = "900 10px Cinzel, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("B", 0, 3.4); ctx.textBaseline = "alphabetic";
    }
    /* a soft twinkle so the coin catches the eye */
    const tw = 0.5 + 0.5 * Math.sin(g.timeNow * 4.2 + pk.bob * 3);
    ctx.globalAlpha = 0.35 + 0.55 * tw;
    ctx.strokeStyle = "#fff6cf"; ctx.lineWidth = 1.3;
    const sx = 6.5, sy = -7.5, ss = 3.4 + tw * 1.6;
    ctx.beginPath();
    ctx.moveTo(sx, sy - ss); ctx.lineTo(sx, sy + ss);
    ctx.moveTo(sx - ss, sy); ctx.lineTo(sx + ss, sy);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else {
    ctx.shadowColor = "rgba(123,196,127,0.9)"; ctx.shadowBlur = 10;
    ctx.fillStyle = "#7bc47f";
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.bezierCurveTo(-11, 0, -8, -9, -3.4, -9);
    ctx.bezierCurveTo(-1, -9, 0, -7.4, 0, -5.8);
    ctx.bezierCurveTo(0, -7.4, 1, -9, 3.4, -9);
    ctx.bezierCurveTo(8, -9, 11, 0, 0, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

/* ─── obstacle dressing: one collision rect, many room pieces ─────────
   Every skin draws INSIDE its rect (glow pools excepted) so what you
   see is exactly what you collide with. */
function drawObstacle(g: G, ctx: CanvasRenderingContext2D, o: Obstacle) {
  const pal = PAL[g.theme];
  const dark = g.theme === "dark";
  const skin = o.skin || "pillar";
  /* warm light pools spilling from studio lights + braziers (dark) */
  if (dark && (skin === "lightstand" || skin === "brazier")) {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    const flick = skin === "brazier" ? 0.8 + Math.sin(g.timeNow * 11 + o.x) * 0.2 : 0.9;
    const lg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 92 * flick);
    lg.addColorStop(0, skin === "brazier" ? "rgba(255,150,50,0.20)" : "rgba(255,214,130,0.16)");
    lg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(cx - 96, cy - 96, 192, 192);
  }
  ctx.fillStyle = dark ? "rgba(0,0,0,0.4)" : "rgba(96,74,20,0.28)";
  ctx.fillRect(o.x + 4, o.y + 6, o.w, o.h);
  const OL = "rgba(22,17,8,0.55)";
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;

  if (skin === "desk") {
    /* the Lobby front desk: wood counter, stone top, gold trim */
    const dg = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
    dg.addColorStop(0, dark ? "#5a4030" : "#8a6844"); dg.addColorStop(1, dark ? "#33241a" : "#66482c");
    ctx.fillStyle = dg; ctx.fillRect(o.x, o.y + 7, o.w, o.h - 7);
    ctx.fillStyle = dark ? "#cbb98f" : "#e8dcc0"; ctx.fillRect(o.x - 1, o.y, o.w + 2, 9);
    ctx.fillStyle = "#c49a22"; ctx.fillRect(o.x - 1, o.y + 9, o.w + 2, 2.4);
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1.2;
    for (let pi = 1; pi <= 3; pi++) {
      const px = o.x + (o.w / 4) * pi;
      ctx.beginPath(); ctx.moveTo(px, o.y + 14); ctx.lineTo(px, o.y + o.h - 6); ctx.stroke();
    }
    ctx.fillStyle = "#f0c94f";
    crownPath(ctx, cx, o.y + o.h / 2 + 3, Math.min(9, o.w / 6)); ctx.fill();
    ctx.strokeStyle = OL; ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
    return;
  }
  if (skin === "planter") {
    /* gold pot, deep-green foliage */
    ctx.fillStyle = "#8a6d1f";
    ctx.beginPath();
    ctx.moveTo(cx - o.w * 0.3, o.y + o.h); ctx.lineTo(cx + o.w * 0.3, o.y + o.h);
    ctx.lineTo(cx + o.w * 0.22, o.y + o.h * 0.55); ctx.lineTo(cx - o.w * 0.22, o.y + o.h * 0.55);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#c49a22"; ctx.fillRect(cx - o.w * 0.26, o.y + o.h * 0.5, o.w * 0.52, 5);
    for (const [fx, fy, fr] of [[-0.24, 0.3, 0.3], [0.22, 0.26, 0.34], [0, 0.12, 0.36], [-0.05, 0.42, 0.26]] as const) {
      const fg = ctx.createRadialGradient(o.x + o.w * (0.5 + fx) - 4, o.y + o.h * fy - 4, 2, o.x + o.w * (0.5 + fx), o.y + o.h * fy, o.w * fr);
      fg.addColorStop(0, dark ? "#3f7d46" : "#4c9455"); fg.addColorStop(1, dark ? "#17301c" : "#26502e");
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(o.x + o.w * (0.5 + fx), o.y + o.h * fy, o.w * fr * 0.62, 0, 6.283); ctx.fill();
    }
    return;
  }
  if (skin === "workdesk" || skin === "console") {
    /* Beat Lab workstation / Mixing Room console */
    const dg = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
    dg.addColorStop(0, dark ? "#3a3f46" : "#b9ac8d"); dg.addColorStop(1, dark ? "#1d2025" : "#8f8163");
    ctx.fillStyle = dg; ctx.fillRect(o.x, o.y + o.h * 0.34, o.w, o.h * 0.66);
    ctx.strokeStyle = OL; ctx.lineWidth = 1.2; ctx.strokeRect(o.x + 0.5, o.y + o.h * 0.34, o.w - 1, o.h * 0.66 - 1);
    if (skin === "console") {
      /* fader tracks on the sloped face */
      ctx.strokeStyle = dark ? "rgba(240,201,79,0.5)" : "rgba(110,84,30,0.55)"; ctx.lineWidth = 1.4;
      const n = Math.max(3, Math.floor(o.w / 16));
      for (let fi = 0; fi < n; fi++) {
        const fx = o.x + 8 + fi * ((o.w - 16) / Math.max(1, n - 1));
        ctx.beginPath(); ctx.moveTo(fx, o.y + o.h * 0.48); ctx.lineTo(fx, o.y + o.h * 0.86); ctx.stroke();
        ctx.fillStyle = "#e8e4da";
        ctx.fillRect(fx - 2.4, o.y + o.h * (0.52 + ((fi * 37) % 30) / 100), 4.8, 3);
      }
    } else {
      /* producer desk: keyboard tray + mouse pad lines */
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.16)" : "rgba(80,64,30,0.25)"; ctx.lineWidth = 1;
      for (let ki = 0; ki < 4; ki++) {
        ctx.beginPath(); ctx.moveTo(o.x + 8, o.y + o.h * (0.52 + ki * 0.11)); ctx.lineTo(o.x + o.w * 0.62, o.y + o.h * (0.52 + ki * 0.11)); ctx.stroke();
      }
      ctx.fillStyle = dark ? "rgba(240,201,79,0.35)" : "rgba(160,120,35,0.4)";
      ctx.beginPath(); ctx.ellipse(o.x + o.w * 0.82, o.y + o.h * 0.68, 7, 5, 0, 0, 6.283); ctx.fill();
    }
    /* twin monitors along the back edge, screens alive */
    for (const mx of [o.x + o.w * 0.26, o.x + o.w * 0.74]) {
      const mw = Math.min(40, o.w * 0.4), mh = o.h * 0.34;
      ctx.fillStyle = "#101216";
      ctx.beginPath(); ctx.roundRect(mx - mw / 2, o.y, mw, mh, 3); ctx.fill();
      ctx.strokeStyle = OL; ctx.lineWidth = 1.2; ctx.stroke();
      const sg = ctx.createLinearGradient(0, o.y, 0, o.y + mh);
      sg.addColorStop(0, dark ? "#274b63" : "#bcd6ea"); sg.addColorStop(1, dark ? "#101c28" : "#7ea6c4");
      ctx.fillStyle = sg; ctx.fillRect(mx - mw / 2 + 2.5, o.y + 2.5, mw - 5, mh - 5);
      /* waveform / level bars on screen */
      ctx.strokeStyle = "#f0c94f"; ctx.lineWidth = 1.4;
      ctx.beginPath();
      const seed = Math.floor(mx * 3 + o.y);
      for (let wi = 0; wi <= 8; wi++) {
        const wx = mx - mw / 2 + 4 + wi * ((mw - 8) / 8);
        const wy = o.y + mh / 2 + Math.sin(wi * 1.7 + seed) * mh * 0.22;
        if (wi === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
      }
      ctx.stroke();
    }
    return;
  }
  if (skin === "speakers") {
    /* speaker stack: big cab + top cab, coned drivers */
    const drawCab = (x: number, y: number, w: number, h: number, cones: number) => {
      ctx.fillStyle = dark ? "#17181c" : "#4c463c";
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
      ctx.strokeStyle = OL; ctx.lineWidth = 1.4; ctx.stroke();
      for (let ci = 0; ci < cones; ci++) {
        const ccx = x + w / 2, ccy = y + h * (cones === 1 ? 0.5 : 0.28 + ci * 0.44), cr = Math.min(w, h) * (cones === 1 ? 0.3 : 0.19);
        ctx.fillStyle = dark ? "#26282e" : "#6a6355";
        ctx.beginPath(); ctx.arc(ccx, ccy, cr, 0, 6.283); ctx.fill();
        ctx.strokeStyle = "#c49a22"; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = dark ? "#0c0d10" : "#37332b";
        ctx.beginPath(); ctx.arc(ccx, ccy, cr * 0.45, 0, 6.283); ctx.fill();
      }
    };
    drawCab(o.x + o.w * 0.14, o.y + o.h * 0.42, o.w * 0.72, o.h * 0.58, 2);
    drawCab(o.x + o.w * 0.26, o.y, o.w * 0.48, o.h * 0.4, 1);
    return;
  }
  if (skin === "camera") {
    /* camera block on a tripod — lens toward the entrance */
    ctx.strokeStyle = dark ? "#9aa3ab" : "#5d5648"; ctx.lineWidth = 3;
    for (const lx of [-0.32, 0, 0.32]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + 2);
      ctx.lineTo(cx + o.w * lx, o.y + o.h - 2);
      ctx.stroke();
    }
    ctx.fillStyle = dark ? "#1b1d21" : "#57503f";
    ctx.beginPath(); ctx.roundRect(cx - o.w * 0.3, o.y + o.h * 0.08, o.w * 0.6, o.h * 0.44, 4); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.4; ctx.stroke();
    /* lens barrel pointing down-stage */
    ctx.fillStyle = "#0c0d10";
    ctx.beginPath(); ctx.roundRect(cx - o.w * 0.13, o.y + o.h * 0.44, o.w * 0.26, o.h * 0.22, 3); ctx.fill();
    const lensG = ctx.createRadialGradient(cx - 2, cy + o.h * 0.12, 1, cx, cy + o.h * 0.12, o.w * 0.11);
    lensG.addColorStop(0, "#bfe0ff"); lensG.addColorStop(0.5, "#2c5d8a"); lensG.addColorStop(1, "#0a1622");
    ctx.fillStyle = lensG;
    ctx.beginPath(); ctx.arc(cx, cy + o.h * 0.12, o.w * 0.1, 0, 6.283); ctx.fill();
    /* tally light + top handle */
    ctx.fillStyle = Math.floor(g.timeNow * 1.6 + o.x) % 2 === 0 ? "#ff5347" : "#7e1a20";
    ctx.beginPath(); ctx.arc(cx + o.w * 0.2, o.y + o.h * 0.16, 2.6, 0, 6.283); ctx.fill();
    ctx.strokeStyle = dark ? "#9aa3ab" : "#5d5648"; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(cx - o.w * 0.16, o.y + o.h * 0.08); ctx.lineTo(cx - o.w * 0.16, o.y); ctx.lineTo(cx + o.w * 0.16, o.y); ctx.lineTo(cx + o.w * 0.16, o.y + o.h * 0.08); ctx.stroke();
    return;
  }
  if (skin === "lightstand") {
    /* light stand: tripod feet, pole, glowing softbox head */
    ctx.strokeStyle = dark ? "#9aa3ab" : "#5d5648"; ctx.lineWidth = 2.6;
    for (const lx of [-0.3, 0.3]) {
      ctx.beginPath(); ctx.moveTo(cx, cy + o.h * 0.18); ctx.lineTo(cx + o.w * lx, o.y + o.h - 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx, o.y + o.h * 0.3); ctx.lineTo(cx, o.y + o.h - 4); ctx.stroke();
    const bw = o.w * 0.72, bh = o.h * 0.42;
    const lg2 = ctx.createLinearGradient(0, o.y, 0, o.y + bh);
    lg2.addColorStop(0, "#fff6d8"); lg2.addColorStop(1, "#e8cf8e");
    ctx.fillStyle = lg2;
    ctx.beginPath(); ctx.roundRect(cx - bw / 2, o.y, bw, bh, 4); ctx.fill();
    ctx.strokeStyle = "#8a6d1f"; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.strokeStyle = "rgba(138,109,31,0.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, o.y + 2); ctx.lineTo(cx, o.y + bh - 2); ctx.stroke();
    return;
  }
  if (skin === "goldbars") {
    /* stacked gold bars, 3-2-1 */
    const bar = (bx: number, by: number, bw: number, bh: number) => {
      const bg3 = ctx.createLinearGradient(0, by, 0, by + bh);
      bg3.addColorStop(0, "#ffe98a"); bg3.addColorStop(0.55, "#e9be4a"); bg3.addColorStop(1, "#a87e17");
      ctx.fillStyle = bg3;
      ctx.beginPath();
      ctx.moveTo(bx + bw * 0.14, by); ctx.lineTo(bx + bw * 0.86, by);
      ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx, by + bh);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(90,64,4,0.65)"; ctx.lineWidth = 1.1; ctx.stroke();
    };
    const bw = o.w * 0.3, bh = Math.min(15, o.h * 0.26);
    const rows = Math.max(1, Math.floor(o.h / (bh + 3)));
    for (let ri = 0; ri < rows; ri++) {
      const n = 3 - Math.min(2, ri);
      const y0 = o.y + o.h - (ri + 1) * (bh + 3) + 3;
      for (let bi = 0; bi < n; bi++) bar(o.x + o.w / 2 + (bi - (n - 1) / 2) * (bw + 3) - bw / 2, y0, bw, bh);
    }
    return;
  }
  if (skin === "coinpile") {
    /* a mound of Visual Bucs, drawn as clustered gold discs */
    const seed = Math.floor(o.x * 5 + o.y * 3);
    ctx.fillStyle = dark ? "rgba(160,120,30,0.5)" : "rgba(150,115,40,0.4)";
    ctx.beginPath(); ctx.ellipse(cx, o.y + o.h * 0.72, o.w * 0.46, o.h * 0.26, 0, 0, 6.283); ctx.fill();
    for (let ci = 0; ci < 16; ci++) {
      const a = ((seed * (ci + 3) * 37) % 100) / 100 * 6.283;
      const rr = ((seed * (ci + 7) * 53) % 100) / 100;
      const px = cx + Math.cos(a) * o.w * 0.36 * rr;
      const py = o.y + o.h * 0.72 + Math.sin(a) * o.h * 0.18 * rr - (1 - rr) * o.h * 0.16;
      const cg = ctx.createLinearGradient(px, py - 5, px, py + 5);
      cg.addColorStop(0, "#ffe98a"); cg.addColorStop(1, "#b8860b");
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.ellipse(px, py, 6.4, 4.4, 0, 0, 6.283); ctx.fill();
      ctx.strokeStyle = "rgba(90,64,4,0.5)"; ctx.lineWidth = 0.8; ctx.stroke();
    }
    return;
  }
  if (skin === "rack") {
    /* server rack: dark cabinet, LED grid, vents */
    ctx.fillStyle = dark ? "#12141a" : "#3f4450";
    ctx.beginPath(); ctx.roundRect(o.x, o.y, o.w, o.h, 4); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = dark ? "rgba(150,165,190,0.25)" : "rgba(230,235,245,0.3)"; ctx.lineWidth = 1;
    for (let ri = 1; ri < 4; ri++) {
      const ry = o.y + (o.h / 4) * ri;
      ctx.beginPath(); ctx.moveTo(o.x + 4, ry); ctx.lineTo(o.x + o.w - 4, ry); ctx.stroke();
    }
    const seed = Math.floor(o.x * 7 + o.y * 11);
    for (let li = 0; li < 12; li++) {
      const lx = o.x + 7 + (li % 4) * ((o.w - 14) / 3);
      const ly = o.y + 8 + Math.floor(li / 4) * (o.h / 4) + 4;
      const on = ((seed + li * 7 + Math.floor(g.timeNow * (1 + (li % 3)))) % 3) !== 0;
      ctx.fillStyle = !on ? "rgba(120,130,150,0.3)" : li % 5 === 4 ? "#ff5347" : li % 3 === 0 ? "#57d97a" : "#6ab8ff";
      ctx.beginPath(); ctx.arc(lx, ly, 1.9, 0, 6.283); ctx.fill();
    }
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    for (let vi = 0; vi < 3; vi++) ctx.fillRect(o.x + o.w * 0.55, o.y + o.h * 0.6 + vi * 5, o.w * 0.36, 2.4);
    return;
  }
  if (skin === "brazier") {
    /* throne-room brazier: pedestal, bowl, living flame */
    ctx.fillStyle = dark ? "#2c2c31" : "#a08c5e";
    ctx.fillRect(cx - 5, cy, 10, o.h / 2);
    ctx.fillStyle = dark ? "#3a3a41" : "#bfa96f";
    ctx.beginPath();
    ctx.moveTo(cx - o.w * 0.34, o.y + o.h * 0.3); ctx.lineTo(cx + o.w * 0.34, o.y + o.h * 0.3);
    ctx.lineTo(cx + o.w * 0.2, o.y + o.h * 0.52); ctx.lineTo(cx - o.w * 0.2, o.y + o.h * 0.52);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#c49a22"; ctx.fillRect(cx - o.w * 0.36, o.y + o.h * 0.26, o.w * 0.72, 4.4);
    const fl = 1 + Math.sin(g.timeNow * 12 + o.x * 3) * 0.16;
    ctx.fillStyle = "#ff9a3c";
    ctx.beginPath();
    ctx.moveTo(cx, o.y + o.h * 0.28 - 13 * fl);
    ctx.quadraticCurveTo(cx + 6.4, o.y + o.h * 0.28 - 3, cx + 3.6, o.y + o.h * 0.28);
    ctx.lineTo(cx - 3.6, o.y + o.h * 0.28);
    ctx.quadraticCurveTo(cx - 6.4, o.y + o.h * 0.28 - 3, cx, o.y + o.h * 0.28 - 13 * fl);
    ctx.fill();
    ctx.fillStyle = "#ffe98a";
    ctx.beginPath(); ctx.ellipse(cx, o.y + o.h * 0.28 - 3.4, 2.6, 4.2 * fl, 0, 0, 6.283); ctx.fill();
    return;
  }
  /* pillar — the marble column: bevelled stone, veins, gold capital */
  const pg = ctx.createLinearGradient(o.x, 0, o.x + o.w, 0);
  pg.addColorStop(0, pal.ob); pg.addColorStop(0.28, pal.obTop); pg.addColorStop(0.55, pal.ob); pg.addColorStop(1, dark ? "#232329" : "#c9b98f");
  ctx.fillStyle = pg; ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.fillStyle = "rgba(255,255,255,0.10)"; ctx.fillRect(o.x + 2, o.y + 8, 3, o.h - 16);
  ctx.fillStyle = "rgba(0,0,0,0.20)"; ctx.fillRect(o.x + o.w - 5, o.y + 8, 3, o.h - 16);
  const vseed = Math.floor(o.x * 3 + o.y * 7);
  ctx.strokeStyle = dark ? "rgba(255,255,255,0.12)" : "rgba(110,84,30,0.18)";
  ctx.lineWidth = 1.1;
  for (let vn = 0; vn < 3; vn++) {
    const vx = o.x + o.w * (0.22 + 0.26 * vn) + ((vseed >> (vn * 3)) % 9) - 4;
    ctx.beginPath(); ctx.moveTo(vx, o.y + 10);
    ctx.quadraticCurveTo(vx + (((vseed >> (vn * 5)) % 13) - 6), o.y + o.h * 0.5, vx + (((vseed >> (vn * 2)) % 9) - 4), o.y + o.h - 8);
    ctx.stroke();
  }
  const cap = ctx.createLinearGradient(0, o.y, 0, o.y + 9);
  cap.addColorStop(0, "#ffe98a"); cap.addColorStop(1, "#c49a22");
  ctx.fillStyle = cap; ctx.fillRect(o.x - 1.5, o.y, o.w + 3, 8);
  ctx.fillStyle = dark ? "#26262c" : "#cbb98f"; ctx.fillRect(o.x - 1.5, o.y + o.h - 7, o.w + 3, 7);
  ctx.strokeStyle = pal.obEdge; ctx.lineWidth = 1.2;
  ctx.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
}

interface RoomView {
  bg: HTMLCanvasElement | null;
  obstacles: Obstacle[];
  pickups: Pickup[];
  doorOpen: boolean;
  enemies: Enemy[];
  bolts: Bolt[];
  ebolts: EBolt[];
  boss: Enemy | null;
}
const NO_ENEMIES: Enemy[] = [];
const NO_BOLTS: Bolt[] = [];
const NO_EBOLTS: EBolt[] = [];

/* Draw ONE room (backdrop, walls, door, dressing, foes) at the
   current transform. The caller owns translate/clip — the transit
   passage draws two of these, the live game draws one. */
function drawRoom(g: G, ctx: CanvasRenderingContext2D, room: RoomView) {
  const pal = PAL[g.theme];
  ctx.save();
  if (g.shake > 0) ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
  if (room.bg) ctx.drawImage(room.bg, 0, 0, LW, LH);

  /* walls */
  ctx.fillStyle = pal.wallFace;
  ctx.fillRect(0, 0, LW, WALL); ctx.fillRect(0, LH - WALL, LW, WALL);
  ctx.fillRect(0, 0, WALL, LH); ctx.fillRect(LW - WALL, 0, WALL, LH);
  ctx.strokeStyle = pal.obEdge; ctx.lineWidth = 1.6;
  ctx.strokeRect(WALL, WALL, LW - 2 * WALL, LH - 2 * WALL);
  ctx.strokeStyle = pal.wall; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, LW - 2, LH - 2);
  /* gold wall trim + torch glow (dark theme) */
  ctx.strokeStyle = "rgba(212,175,55,0.55)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, WALL + 4); ctx.lineTo(LW, WALL + 4); ctx.moveTo(0, LH - WALL - 4); ctx.lineTo(LW, LH - WALL - 4); ctx.stroke();
  if (g.theme === "dark") {
    const torchPts = [[52, 52], [LW - 52, 52], [52, LH - 52], [LW - 52, LH - 52]] as const;
    for (let ti = 0; ti < torchPts.length; ti++) {
      const flick = 0.75 + Math.sin(g.timeNow * 9 + ti * 1.7) * 0.25;
      const tg = ctx.createRadialGradient(torchPts[ti]![0], torchPts[ti]![1], 0, torchPts[ti]![0], torchPts[ti]![1], 62 * flick);
      tg.addColorStop(0, "rgba(240,160,50,0.30)"); tg.addColorStop(1, "rgba(240,160,50,0)");
      ctx.fillStyle = tg; ctx.fillRect(torchPts[ti]![0] - 70, torchPts[ti]![1] - 70, 140, 140);
      ctx.fillStyle = "#ffb347"; ctx.beginPath(); ctx.arc(torchPts[ti]![0], torchPts[ti]![1], 4, 0, 6.283); ctx.fill();
    }
  } else {
    /* light theme: soft daylight pools from the same corners */
    const lightPts = [[120, 110], [LW - 120, 110], [120, LH - 110], [LW - 120, LH - 110]] as const;
    for (const [lx, ly] of lightPts) {
      const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 120);
      lg.addColorStop(0, "rgba(255,246,214,0.35)"); lg.addColorStop(1, "rgba(255,246,214,0)");
      ctx.fillStyle = lg; ctx.fillRect(lx - 120, ly - 120, 240, 240);
    }
  }

  drawDoor(g, ctx, room.doorOpen);

  for (const o of room.obstacles) drawObstacle(g, ctx, o);
  for (const pk of room.pickups) drawPickup(g, ctx, pk);

  /* enemy bolts */
  for (const eb of room.ebolts) {
    ctx.fillStyle = "#ff6b5e";
    ctx.shadowColor = "#e5484d"; ctx.shadowBlur = 9;
    ctx.beginPath(); ctx.arc(eb.x, eb.y, eb.r, 0, 6.283); ctx.fill();
    ctx.shadowBlur = 0;
  }

  for (const e of room.enemies) drawEnemy(g, ctx, e);

  /* boss health bar */
  if (room.boss) {
    const bw = 340, bx = LW / 2 - bw / 2, by = WALL + 12;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(bx - 3, by - 3, bw + 6, 15);
    ctx.fillStyle = "#5d0f13";
    ctx.fillRect(bx, by, bw, 9);
    ctx.fillStyle = "#e5484d";
    ctx.fillRect(bx, by, bw * clamp(room.boss.hp / room.boss.maxhp, 0, 1), 9);
    ctx.strokeStyle = "rgba(212,175,55,0.7)"; ctx.lineWidth = 1;
    ctx.strokeRect(bx - 3, by - 3, bw + 6, 15);
    ctx.fillStyle = "#f3e9d2";
    ctx.font = "700 11px Cinzel, serif";
    ctx.textAlign = "center";
    ctx.fillText("THE USURPER", LW / 2, by + 24);
  }

  /* player bolts */
  for (const b of room.bolts) {
    ctx.strokeStyle = "rgba(240,201,79,0.4)"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022);
    ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.fillStyle = "#ffe98a";
    ctx.shadowColor = "#f0c94f"; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.283); ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function render(g: G, ctx: CanvasRenderingContext2D, bg: HTMLCanvasElement | null, bgAlt: HTMLCanvasElement | null, scale: number) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, LW, LH);

  /* ── the door passage: two rooms, one sliding view, no teleport ── */
  if (g.transit) {
    const tr = g.transit;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, tr.camY, LW, LH - tr.camY); ctx.clip();
    ctx.translate(0, tr.camY);
    drawRoom(g, ctx, {
      bg, obstacles: tr.snapObstacles, pickups: tr.snapPickups, doorOpen: true,
      enemies: NO_ENEMIES, bolts: NO_BOLTS, ebolts: NO_EBOLTS, boss: null,
    });
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, LW, Math.max(0.001, tr.camY)); ctx.clip();
    ctx.translate(0, tr.camY - LH);
    drawRoom(g, ctx, {
      bg: bgAlt, obstacles: g.obstacles, pickups: g.pickups, doorOpen: g.doorOpen,
      enemies: g.enemies, bolts: NO_BOLTS, ebolts: NO_EBOLTS, boss: g.boss,
    });
    ctx.restore();
    /* the King, walking the passage in screen space */
    drawKing(g, ctx, tr.kingX, tr.kingY);
    return;
  }

  drawRoom(g, ctx, {
    bg, obstacles: g.obstacles, pickups: g.pickups, doorOpen: g.doorOpen,
    enemies: g.enemies, bolts: g.bolts, ebolts: g.ebolts, boss: g.boss,
  });

  /* dash afterimages — ghost Kings along the dash path */
  for (const ai of g.afterimages) {
    drawKingSprite(g, ctx, ai.x, ai.y, 1.35, 0.32 * (1 - ai.life / 0.3), ai.faceX, ai.faceY);
  }
  drawKing(g, ctx);
  /* MP: the party's Kings share this room (inert solo). */
  if (g.mp) drawRemoteKings(g, ctx);

  /* aim indicator — visible whenever aim input exists, so the manual
     control is seen, not hidden: a gold line + chevron off the King */
  if (g.phase === "playing" && g.aim.on) {
    const P = g.P, ax = g.aim.x, ay = g.aim.y;
    ctx.save();
    ctx.strokeStyle = "rgba(240,201,79,0.55)"; ctx.lineWidth = 2.4;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(P.x + ax * 34, P.y + ay * 34);
    ctx.lineTo(P.x + ax * 54, P.y + ay * 54);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.translate(P.x + ax * 62, P.y + ay * 62);
    ctx.rotate(Math.atan2(ay, ax));
    ctx.fillStyle = "#f0c94f"; ctx.shadowColor = "#f0c94f"; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -5.4); ctx.lineTo(-5, 5.4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* arrow pointing to the open golden door */
  if (g.doorOpen && g.phase === "playing") {
    const P = g.P;
    const dax = LW / 2 - P.x, day = WALL + 10 - P.y, dal = Math.sqrt(dax * dax + day * day) || 1;
    const axp = P.x + (dax / dal) * 56, ayp = P.y + (day / dal) * 56;
    ctx.save(); ctx.translate(axp, ayp); ctx.rotate(Math.atan2(day, dax));
    ctx.fillStyle = "#f0c94f"; ctx.shadowColor = "#f0c94f"; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* particles */
  for (const pt of g.parts) {
    ctx.globalAlpha = 1 - pt.life / pt.max;
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* floaters */
  ctx.textAlign = "center";
  for (const f of g.floats) {
    ctx.globalAlpha = 1 - f.life / 0.9;
    ctx.font = "700 15px 'Alegreya Sans', sans-serif";
    ctx.fillStyle = g.theme === "dark" ? "#f0c94f" : f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

/* ─── pause + joystick state ──────────────────────────────────────────── */
function togglePause(g: G) {
  if (g.phase !== "playing") return;
  g.paused = !g.paused;
  g.ui.paused(g.paused);
}
function hideJoy(g: G) {
  g.joy.on = false; g.joy.id = null; g.joy.dx = 0; g.joy.dy = 0;
  g.aimJoy.on = false; g.aimJoy.id = null; g.aimJoy.dx = 0; g.aimJoy.dy = 0;
}

/* ─── gamepad ─────────────────────────────────────────────────────────────
   Bluetooth & wired controllers via the Gamepad API. Rules learned
   the hard way in the preview Space:
   - NEVER latch a failure. Some hosts throw on getGamepads() before a
     user gesture or while a frame lacks focus, then work fine a
     moment later. A throw is retried on a timer, and any tap/keypress
     re-arms instantly.
   - Browsers hide a Bluetooth pad until ANY button is pressed while
     the page is open, so the start screen always says exactly that.
   - Pick the pad that is actually sending input, not just slot 0.
   - Non-"standard" mappings (common for Bluetooth pads) put the
     D-pad on a hat axis and shuffle menu buttons — so Start OR
     Select OR any face button can begin a run, every face button
     dashes, and the hat axis steers too. */
function padFramed() {
  try { return window.self !== window.top; } catch { return true; }
}
function padPolicyBlocked() {
  /* Chromium exposes the frame's permissions policy: in a frame with
     no gamepad grant this is definitively false, which means
     getGamepads() returns empty slots forever in that frame. */
  try {
    const pp = (document as unknown as { permissionsPolicy?: { allowsFeature?: (f: string) => boolean }; featurePolicy?: { allowsFeature?: (f: string) => boolean } }).permissionsPolicy
      || (document as unknown as { featurePolicy?: { allowsFeature?: (f: string) => boolean } }).featurePolicy;
    if (pp && pp.allowsFeature) return pp.allowsFeature("gamepad") === false;
  } catch { /* API absent — cannot prove a policy block this way */ }
  return false;
}
function padHostState(g: G): "" | "policy" | "silent" {
  /* 'policy' = the frame's own policy forbids gamepads (proven).
     'silent' = framed page, polling for 12s+, and no pad has EVER
     appeared — hosts that swallow the Gamepad channel give exactly
     this silence. An unframed page never earns either verdict. */
  if (g.pad.connected || g.pad.everSeen) return "";
  if (padPolicyBlocked()) return "policy";
  if (padFramed() && g.pad.firstPollAt && performance.now() - g.pad.firstPollAt > 12000) return "silent";
  return "";
}
function shortPadName(id: string) {
  let s = (id || "Controller").replace(/\s*\(.*?standard gamepad.*?\)/i, "").trim();
  if (s.length > 42) s = s.slice(0, 42).trim() + "…";
  return s || "Controller";
}
function refreshPadUI(g: G) {
  let key: string, txt: string;
  if (g.pad.connected) {
    key = "on"; txt = "Controller connected: " + shortPadName(g.pad.name) + " — left stick moves, right stick aims & fires, A dashes, Start pauses.";
  } else if (g.pad.apiState === "blocked") {
    key = "blocked"; txt = "Controllers are blocked in this view — the frame around the game refuses the controller channel. Open Crownfall Run in a full browser tab to play with your controller. Touch and keys work in this window.";
  } else if (padHostState(g) === "policy") {
    key = "policy"; txt = "This window blocks controllers — its frame does not allow gamepad input, so no button press can reach the game here. Open Crownfall Run in a full browser tab to play with your controller. Touch and keys work in this window.";
  } else if (padHostState(g) === "silent") {
    key = "silent"; txt = "Still no controller signal. If your pad is paired and you have pressed its buttons, this window is not passing controller input through — open the game in a full browser tab to use it. Touch and keys work in this window.";
  } else if (g.pad.apiState === "missing") {
    key = "missing"; txt = "This browser does not expose controllers. Try Safari or Chrome to use a Bluetooth pad.";
  } else {
    key = "wait"; txt = "No controller seen yet — pair your Bluetooth pad, then press any button on it.";
  }
  if (key + "|" + txt === g.pad.uiKey) return;
  g.pad.uiKey = key + "|" + txt;
  g.ui.padStatus({ text: txt, waiting: !g.pad.connected }, g.pad.connected);
}
function notePadSeen(g: G, gp: Gamepad) {
  const changed = !g.pad.connected || g.pad.index !== gp.index || g.pad.name !== gp.id;
  g.pad.connected = true; g.pad.everSeen = true; g.pad.name = gp.id; g.pad.index = gp.index;
  if (changed) {
    g.pad.prev = {};
    /* a short rumble confirms the pad is live, where supported */
    try {
      const va = (gp as unknown as { vibrationActuator?: { playEffect?: (t: string, p: unknown) => Promise<void> } }).vibrationActuator;
      if (va && va.playEffect) {
        const pr = va.playEffect("dual-rumble", { duration: 90, strongMagnitude: 0.35, weakMagnitude: 0.35 });
        if (pr && pr.catch) pr.catch(() => {});
      }
    } catch { /* rumble is a nicety, never a blocker */ }
  }
  refreshPadUI(g);
}
function notePadGone(g: G) {
  if (g.pad.connected || g.pad.index !== -1) {
    g.pad.connected = false; g.pad.name = ""; g.pad.index = -1;
    g.padVec.x = 0; g.padVec.y = 0; g.pad.prev = {}; g.padAim.on = false;
  }
  refreshPadUI(g);
}
function readGamepads(g: G): (Gamepad | null)[] | null {
  /* Pads, or null when the API cannot be queried right now. Never
     throws, and a failure is retried — never permanent. */
  const now = performance.now();
  if ((g.pad.apiState === "blocked" || g.pad.apiState === "missing") && now < g.pad.nextRetry) return null;
  let fn: (() => (Gamepad | null)[]) | null = null;
  try {
    const nav = navigator as Navigator & { webkitGetGamepads?: () => (Gamepad | null)[] };
    fn = nav.getGamepads ? nav.getGamepads.bind(nav) : nav.webkitGetGamepads ? nav.webkitGetGamepads.bind(nav) : null;
  } catch { fn = null; }
  if (!fn) {
    if (g.pad.apiState !== "missing") { g.pad.apiState = "missing"; refreshPadUI(g); }
    g.pad.nextRetry = now + 2000;
    return null;
  }
  try {
    const gps = fn();
    g.pad.apiState = "ok";
    return gps || [];
  } catch {
    if (g.pad.apiState !== "blocked") { g.pad.apiState = "blocked"; refreshPadUI(g); }
    g.pad.nextRetry = now + 1500;
    return null;
  }
}
function padHeld(gp: Gamepad, i: number) {
  return !!(gp.buttons && gp.buttons[i] && gp.buttons[i].pressed);
}
function padEdge(g: G, gp: Gamepad, idx: number) {
  const now = padHeld(gp, idx);
  const was = !!g.pad.prev[idx];
  g.pad.prev[idx] = now;
  return now && !was;
}
function padActivity(gp: Gamepad) {
  let s = 0;
  if (gp.axes) for (let i = 0; i < gp.axes.length; i++) s = Math.max(s, Math.abs(gp.axes[i] || 0));
  if (gp.buttons) for (let i = 0; i < gp.buttons.length; i++) if (gp.buttons[i] && gp.buttons[i].pressed) return 2;
  return s;
}
function choosePad(g: G, gps: (Gamepad | null)[]): Gamepad | null {
  /* Prefer a pad sending input right now, then the pad already in
     use, then a standard-mapping pad, then the first live slot. */
  let first: Gamepad | null = null, standard: Gamepad | null = null, active: Gamepad | null = null, current: Gamepad | null = null;
  for (const gp of gps) {
    if (!gp || gp.connected === false) continue;
    if (!first) first = gp;
    if (gp.index === g.pad.index) current = gp;
    if (!standard && gp.mapping === "standard") standard = gp;
    if (!active && padActivity(gp) > 0.35) active = gp;
  }
  return active || current || standard || first;
}
function pollGamepad(g: G, bg: HTMLCanvasElement | null) {
  if (!g.pad.firstPollAt) g.pad.firstPollAt = performance.now();
  const gps = readGamepads(g);
  if (!gps) { g.padVec.x = 0; g.padVec.y = 0; if (!g.pad.connected) refreshPadUI(g); return; }
  const gp = choosePad(g, gps);
  if (!gp) { notePadGone(g); return; }
  notePadSeen(g, gp);

  /* --- axes: left stick with a radial deadzone --- */
  let ax = (gp.axes && gp.axes[0]) || 0, ay = (gp.axes && gp.axes[1]) || 0;
  const mag = Math.sqrt(ax * ax + ay * ay);
  if (mag < 0.16) { ax = 0; ay = 0; }
  else if (mag > 1) { ax /= mag; ay /= mag; }
  let dx = ax, dy = ay;
  /* right stick AIMS (owner ruling): the King fires where it points.
     It never steers — movement is the left stick / D-pad alone. */
  if (gp.axes && gp.axes.length > 3) {
    const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
    const rm = Math.sqrt(rx * rx + ry * ry);
    if (rm >= 0.3) { g.padAim.on = true; g.padAim.x = rx / rm; g.padAim.y = ry / rm; }
    else g.padAim.on = false;
  } else g.padAim.on = false;
  /* D-pad buttons (standard mapping) */
  if (padHeld(gp, 14)) dx = -1;
  if (padHeld(gp, 15)) dx = 1;
  if (padHeld(gp, 12)) dy = -1;
  if (padHeld(gp, 13)) dy = 1;
  /* D-pad hat axes (non-standard / Bluetooth mappings) */
  if (gp.axes && gp.axes.length > 7) {
    const hx = gp.axes[6] || 0, hy = gp.axes[7] || 0;
    if (Math.abs(hx) > 0.5) dx = hx > 0 ? 1 : -1;
    if (Math.abs(hy) > 0.5) dy = hy > 0 ? 1 : -1;
  }
  g.padVec.x = dx; g.padVec.y = dy;

  /* --- button edges: every index is sampled every frame so a held
     button can never register as a phantom fresh press later --- */
  const e0 = padEdge(g, gp, 0), e1 = padEdge(g, gp, 1), e2 = padEdge(g, gp, 2), e3 = padEdge(g, gp, 3);
  const faceEdge = e0 || e1 || e2 || e3;         /* A / B / X / Y */
  const e8 = padEdge(g, gp, 8), e9 = padEdge(g, gp, 9);
  const menuEdge = e8 || e9;                      /* Select / Start */
  const leftEdge = padEdge(g, gp, 14), rightEdge = padEdge(g, gp, 15);

  if (g.phase === "transit") {
    /* the door passage locks input — edges are sampled above so a
       mashed button can't queue anything into the next room */
    g.padVec.x = 0; g.padVec.y = 0;
    return;
  }
  if (g.phase === "upgrade") {
    g.padVec.x = 0; g.padVec.y = 0;
    const stickDir = ax > 0.55 ? 1 : ax < -0.55 ? -1 : 0;
    if (leftEdge || rightEdge || (stickDir !== 0 && g.pad.navCd <= 0)) {
      const dir = leftEdge ? -1 : rightEdge ? 1 : stickDir;
      if (dir !== 0) { setUpgradeHighlight(g, g.upgradeIndex + dir); g.pad.navCd = 0.28; }
    }
    if (faceEdge || menuEdge) pickUpgrade(g, g.upgradeIndex, bg);
    return;
  }
  if (g.paused) {
    if (menuEdge || faceEdge) togglePause(g);
    return;
  }
  if (g.phase === "playing") {
    if (menuEdge) { togglePause(g); return; }
    if (faceEdge) tryDash(g);
    return;
  }
  if (g.phase === "start") {
    if (menuEdge || faceEdge) startRun(g, bg);
    return;
  }
  if (g.phase === "dead") {
    /* the run summary gets its beat first (the preview's 450ms rule) */
    if (g.timeNow - g.deathAt < 0.45) return;
    if (menuEdge || faceEdge) startRun(g, bg);
    return;
  }
}

/* ─── upgrade icons (the preview's own line icons) ────────────────────── */
function UpgradeIcon({ id }: { id: string }) {
  const cls = "h-6 w-6 text-[#C9A84C]";
  const sw = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (id) {
    case "dmg": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><polygon points="13,2 4.5,13.5 10.5,13.5 9,22 19.5,9.5 13.5,9.5" fill="currentColor" stroke="none" /></svg>);
    case "speed": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><path d="M4 6l7 6-7 6M12 6l7 6-7 6" /></svg>);
    case "vit": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><path d="M12 20.5C7.2 16.4 3.5 13.2 3.5 9.3 3.5 6.4 5.6 4.5 8 4.5c1.6 0 3.1.9 4 2.4.9-1.5 2.4-2.4 4-2.4 2.4 0 4.5 1.9 4.5 4.8 0 3.9-3.7 7.1-8.5 11.2z" /></svg>);
    case "rapid": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" /></svg>);
    case "dash": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M21 3.5L17.2 7.4 13.6 5.2" /></svg>);
    case "twin": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><polygon points="9,3 3.5,12 7.5,12 6.5,20 13,10 9,10" fill="currentColor" stroke="none" /><polygon points="16,5 12,12.5 15,12.5 14.2,19 19.5,11 16.2,11" fill="currentColor" stroke="none" /></svg>);
    case "spread": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><path d="M12 21V9M12 9L5 4M12 9l7-5" /><circle cx="12" cy="9" r="1.6" fill="currentColor" stroke="none" /></svg>);
    case "pierce": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><path d="M3 12h16M13 5l7 7-7 7" /></svg>);
    case "magnet": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><path d="M6 4v7a6 6 0 0 0 12 0V4" /><path d="M6 4h4v5H6zM14 4h4v5h-4z" /></svg>);
    default: return null;
  }
}

/* ─── component ───────────────────────────────────────────────────────── */
interface HudSnap {
  floor: number; hp: number; maxhp: number; hpPct: number; low: boolean;
  crowns: number; score: number; kills: number; left: number;
  combo: number; time: string; dashPct: number; cooling: boolean;
}

function createG(ui: UiBridge): G {
  return {
    theme: "dark",
    phase: "start",
    paused: false,
    runSeed: 1,
    depth: 1, crowns: 0, kills: 0,
    P: newPlayer(),
    enemies: [], bolts: [], ebolts: [], pickups: [],
    parts: [], floats: [], obstacles: [], afterimages: [],
    doorOpen: false, doorPulse: 0,
    fireTimer: 0, shake: 0, timeNow: 0,
    bgSeed: 1,
    boss: null,
    combo: 0, comboTimer: 0, bestCombo: 0, comboBonus: 0,
    runTime: 0,
    keys: {},
    joy: { on: false, id: null, bx: 0, by: 0, dx: 0, dy: 0 },
    aimJoy: { on: false, id: null, bx: 0, by: 0, dx: 0, dy: 0 },
    padAim: { on: false, x: 0, y: -1 },
    mouseAim: { x: 0, y: 0, lastAt: -10, inside: false },
    aim: { on: false, x: 0, y: -1 },
    transit: null,
    bgSwap: false,
    padVec: { x: 0, y: 0 },
    pad: {
      index: -1, apiState: "unknown", nextRetry: 0, uiKey: "",
      everSeen: false, firstPollAt: 0, connected: false, name: "", prev: {}, navCd: 0,
    },
    upgradePicks: [],
    upgradeIndex: 0,
    sessionBest: { depth: 0, score: 0 },
    overFired: false,
    deathAt: -10,
    ui,
    mp: null,
    mpDown: false,
    mpRevive: false,
    mpPlacedCount: 0,
  };
}

export default function CrownfallRunGame({
  light,
  onGameOver,
  mp,
}: {
  light: boolean;
  onGameOver: (r: ArcadeRunResult) => void;
  /** Online multiplayer: the party client this game plays through
   *  (lib/crownfall-net.ts). Absent/null = the solo game, unchanged. */
  mp?: CrownfallClient | null;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const bgAltRef = useRef<HTMLCanvasElement | null>(null);
  const aimJoyBaseRef = useRef<HTMLDivElement | null>(null);
  const aimJoyKnobRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const scaleRef = useRef(1);
  const joyBaseRef = useRef<HTMLDivElement | null>(null);
  const joyKnobRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const engagedRef = useRef(false);
  const lightRef = useRef(light);
  const onGameOverRef = useRef(onGameOver);
  const gRef = useRef<G | null>(null);

  const [phase, setPhase] = useState<Phase>("start");
  const [pausedUi, setPausedUi] = useState(false);
  const [hud, setHud] = useState<HudSnap>({
    floor: 1, hp: CROWNFALL.baseHp, maxhp: CROWNFALL.baseHp, hpPct: 100, low: false,
    crowns: 0, score: 0, kills: 0, left: 0, combo: 0, time: "0:00", dashPct: 100, cooling: false,
  });
  const hudPrevRef = useRef("");
  const [msg, setMsg] = useState("");
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [intro, setIntro] = useState<{ depth: number; key: number } | null>(null);
  const introTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [picks, setPicks] = useState<UpgradeDef[]>([]);
  const [hi, setHi] = useState(0);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [deathVisible, setDeathVisible] = useState(false);
  const deathTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [padStatus, setPadStatus] = useState<{ text: string; waiting: boolean } | null>(null);
  const [padLive, setPadLive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sessionBest, setSessionBest] = useState<{ depth: number; score: number }>({ depth: 0, score: 0 });

  if (!gRef.current) {
    gRef.current = createG({
      hud: () => {
        const g = gRef.current;
        if (!g) return;
        const P = g.P;
        const snap: HudSnap = {
          floor: g.depth,
          hp: Math.max(0, Math.ceil(P.hp)),
          maxhp: P.maxhp,
          hpPct: clamp((P.hp / P.maxhp) * 100, 0, 100),
          low: (P.hp / P.maxhp) * 100 <= 30,
          crowns: g.crowns,
          score: scoreOf(g),
          kills: g.kills,
          left: g.enemies.length,
          combo: g.combo,
          time: fmtTime(g.runTime),
          dashPct: Math.round((1 - P.dashCd / P.dashCdMax) * 100),
          cooling: P.dashCd > 0,
        };
        const key = JSON.stringify(snap);
        if (key !== hudPrevRef.current) {
          hudPrevRef.current = key;
          setHud(snap);
        }
      },
      phase: (p) => setPhase(p),
      paused: (p) => setPausedUi(p),
      msg: (t) => {
        setMsg(t);
        if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
        msgTimerRef.current = setTimeout(() => setMsg((cur) => (cur === t ? "" : cur)), 3400);
      },
      intro: (d) => {
        setIntro({ depth: d, key: performance.now() });
        if (introTimerRef.current) clearTimeout(introTimerRef.current);
        introTimerRef.current = setTimeout(() => setIntro(null), 1500);
      },
      upgrades: (p) => setPicks(p),
      highlight: (i) => setHi(i),
      flash: () => {
        const fd = flashRef.current;
        if (!fd) return;
        fd.style.transition = "none";
        fd.style.opacity = "0.85";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            fd.style.transition = "opacity .45s ease";
            fd.style.opacity = "0";
          });
        });
      },
      death: (s) => {
        const g = gRef.current;
        setSummary(s);
        if (g) setSessionBest({ depth: g.sessionBest.depth, score: g.sessionBest.score });
        setDeathVisible(false);
        if (deathTimerRef.current) clearTimeout(deathTimerRef.current);
        deathTimerRef.current = setTimeout(() => setDeathVisible(true), 450);
        if (g && !g.overFired) {
          g.overFired = true;
          onGameOverRef.current({
            game: "crownfall",
            score: s.score,
            durationMs: Math.round(s.timeSec * 1000),
          });
        }
      },
      padStatus: (s, live) => {
        setPadStatus(s);
        setPadLive(live);
      },
    });
  }

  useEffect(() => {
    onGameOverRef.current = onGameOver;
  }, [onGameOver]);

  /* Theme follows the site's light/dark mechanism via the `light`
     prop — same contract as the other arcade games. */
  useEffect(() => {
    lightRef.current = light;
    const g = gRef.current;
    if (!g) return;
    g.theme = light ? "light" : "dark";
    makeBg(g, bgRef.current);
    const ctx = ctxRef.current;
    if (ctx) render(g, ctx, bgRef.current, bgAltRef.current, scaleRef.current);
  }, [light]);

  const startFromUi = useCallback(() => {
    engagedRef.current = true;
    const g = gRef.current;
    if (g) startRun(g, bgRef.current);
  }, []);

  /* MP: hand the party client to the engine state (the loop reads it
     from G every frame; solo runs simply never set it). */
  useEffect(() => {
    const g = gRef.current;
    if (g) g.mp = mp ?? null;
  }, [mp]);

  /* ── boot, loop, and listeners (mount once) ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    const g = gRef.current;
    if (!canvas || !g) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctxRef.current = ctx;
    const SCALE = Math.min(window.devicePixelRatio || 1, 2);
    scaleRef.current = SCALE;
    canvas.width = LW * SCALE;
    canvas.height = LH * SCALE;
    const bg = document.createElement("canvas");
    bg.width = LW * SCALE;
    bg.height = LH * SCALE;
    bgRef.current = bg;
    const bgAlt = document.createElement("canvas");
    bgAlt.width = LW * SCALE;
    bgAlt.height = LH * SCALE;
    bgAltRef.current = bgAlt;

    /* the Visual Buc coin — the site's primary balance coin art.
       Guarded like every host call; the drawn coin is the fallback. */
    try {
      const coin = new Image();
      coin.crossOrigin = "anonymous";
      coin.onload = () => { setCoinImage(coin); const c2 = ctxRef.current; if (c2 && gRef.current) render(gRef.current, c2, bgRef.current, bgAltRef.current, scaleRef.current); };
      coin.onerror = () => setCoinImage(null);
      coin.src = mediaUrl("images/visual-bucs-icon.webp");
    } catch { /* the drawn coin carries the game */ }

    g.theme = lightRef.current ? "light" : "dark";
    genFloor(g, 1, bg);
    refreshPadUI(g);
    render(g, ctx, bg, bgAlt, SCALE); /* paint one frame immediately — never a blank arena */

    const onKeyDown = (ev: KeyboardEvent) => {
      ensureAudio();
      g.pad.nextRetry = 0; /* a keypress re-arms gamepad polling */
      const k = ev.key.toLowerCase();
      if (k === "p") { togglePause(g); return; }
      if (g.phase === "upgrade") {
        if (k === "arrowleft" || k === "a") { setUpgradeHighlight(g, g.upgradeIndex - 1); ev.preventDefault(); return; }
        if (k === "arrowright" || k === "d") { setUpgradeHighlight(g, g.upgradeIndex + 1); ev.preventDefault(); return; }
        if (k === "enter") { pickUpgrade(g, g.upgradeIndex, bgRef.current); return; }
      }
      if (k === "enter" || k === " ") {
        if (g.paused) { togglePause(g); return; }
        if (g.phase === "playing") { tryDash(g); if (k === " ") ev.preventDefault(); return; }
        /* Starting from the keyboard requires a prior tap/click inside
           this game, so a Space press aimed at another arcade game on
           the same page can't start this one from off-screen. */
        if ((g.phase === "start" || g.phase === "dead") && engagedRef.current) {
          if (g.phase === "dead" && g.timeNow - g.deathAt < 0.45) return;
          startRun(g, bgRef.current);
          ev.preventDefault();
          return;
        }
      }
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k) && g.phase === "playing") {
        ev.preventDefault();
      }
      g.keys[k] = true;
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      g.keys[ev.key.toLowerCase()] = false;
    };
    const onBlur = () => { g.keys = {}; hideJoy(g); };
    const onVis = () => {
      if (document.hidden) { g.keys = {}; hideJoy(g); }
    };
    const onPointerDown = (ev: PointerEvent) => {
      ensureAudio();
      g.pad.nextRetry = 0; /* a tap re-arms gamepad polling */
      const root = rootRef.current;
      engagedRef.current = !!(root && ev.target instanceof Node && root.contains(ev.target));
    };
    const onPadConnected = (ev: GamepadEvent) => {
      if (ev && ev.gamepad) notePadSeen(g, ev.gamepad);
    };
    const onPadDisconnected = (ev: GamepadEvent) => {
      if (!ev || !ev.gamepad || ev.gamepad.index === g.pad.index) notePadGone(g);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("gamepadconnected", onPadConnected);
    window.addEventListener("gamepaddisconnected", onPadDisconnected);
    document.addEventListener("visibilitychange", onVis);

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      /* Schedule the next frame FIRST and guard the frame body: if any
         single subsystem throws in some host (gamepad query, audio,
         canvas), the game still gets its next frame instead of dying
         silently with a black, never-painted arena. */
      raf = requestAnimationFrame(loop);
      try {
        const dt = Math.min(0.033, (now - last) / 1000);
        last = now;
        g.pad.navCd = Math.max(0, g.pad.navCd - dt);
        pollGamepad(g, bgRef.current);
        if (!g.paused) update(g, dt, bgRef.current, bgAltRef.current);
        else g.timeNow += dt;
        /* MP: network truth lands between updates (inert solo). */
        if (g.mp) mpTick(g, bgRef.current, bgAltRef.current);
        if (g.bgSwap) {
          /* a door passage just ended: the spare backdrop (the room
             we walked into) is now the current one */
          g.bgSwap = false;
          const cur = bgRef.current;
          bgRef.current = bgAltRef.current;
          bgAltRef.current = cur;
        }
        render(g, ctx, bgRef.current, bgAltRef.current, SCALE);
        /* joystick visuals follow the engine's joystick state */
        const jb = joyBaseRef.current, jk = joyKnobRef.current;
        if (jb && jk) {
          const on = g.joy.on;
          jb.style.display = on ? "block" : "none";
          jk.style.display = on ? "block" : "none";
          if (on) {
            jb.style.left = g.joy.bx + "px";
            jb.style.top = g.joy.by + "px";
            jk.style.left = g.joy.bx + g.joy.dx * 46 + "px";
            jk.style.top = g.joy.by + g.joy.dy * 46 + "px";
          }
        }
        const ab = aimJoyBaseRef.current, ak = aimJoyKnobRef.current;
        if (ab && ak) {
          const on = g.aimJoy.on;
          ab.style.display = on ? "block" : "none";
          ak.style.display = on ? "block" : "none";
          if (on) {
            ab.style.left = g.aimJoy.bx + "px";
            ab.style.top = g.aimJoy.by + "px";
            ak.style.left = g.aimJoy.bx + g.aimJoy.dx * 46 + "px";
            ak.style.top = g.aimJoy.by + g.aimJoy.dy * 46 + "px";
          }
        }
      } catch { /* keep looping — one bad frame must not end the run */ }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("gamepadconnected", onPadConnected);
      window.removeEventListener("gamepaddisconnected", onPadDisconnected);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── touch joystick (stage pointer handlers) ── */
  const stagePoint = (ev: React.PointerEvent) => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0, w: 0, h: 0 };
    const r = stage.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, h: r.height };
  };
  const trackMouseAim = (ev: React.PointerEvent) => {
    const g = gRef.current;
    if (!g) return;
    const p = stagePoint(ev);
    if (p.w <= 0 || p.h <= 0) return;
    g.mouseAim.x = (p.x / p.w) * LW;
    g.mouseAim.y = (p.y / p.h) * LH;
    g.mouseAim.lastAt = g.timeNow;
    g.mouseAim.inside = true;
  };
  const onStagePointerDown = (ev: React.PointerEvent) => {
    const g = gRef.current;
    if (!g || g.phase !== "playing" || g.paused) return;
    if ((ev.target as HTMLElement).closest("[data-overlay]")) return;
    if (ev.pointerType === "mouse") { trackMouseAim(ev); return; }
    if ((ev.target as HTMLElement).closest("[data-dash-btn]")) return;
    const p = stagePoint(ev);
    if (p.x > p.w * 0.62) {
      /* right side: the AIM stick (the dash button guards itself) */
      g.aimJoy.on = true; g.aimJoy.id = ev.pointerId; g.aimJoy.bx = p.x; g.aimJoy.by = p.y; g.aimJoy.dx = 0; g.aimJoy.dy = 0;
    } else {
      g.joy.on = true; g.joy.id = ev.pointerId; g.joy.bx = p.x; g.joy.by = p.y; g.joy.dx = 0; g.joy.dy = 0;
    }
    try { stageRef.current?.setPointerCapture(ev.pointerId); } catch { /* capture is a nicety */ }
    ev.preventDefault();
  };
  const onStagePointerMove = (ev: React.PointerEvent) => {
    const g = gRef.current;
    if (!g) return;
    if (ev.pointerType === "mouse") { trackMouseAim(ev); return; }
    const stick = g.joy.on && ev.pointerId === g.joy.id ? g.joy
      : g.aimJoy.on && ev.pointerId === g.aimJoy.id ? g.aimJoy
      : null;
    if (!stick) return;
    const p = stagePoint(ev);
    let dx = p.x - stick.bx, dy = p.y - stick.by;
    const d = Math.sqrt(dx * dx + dy * dy), max = 46;
    if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
    stick.dx = dx / max; stick.dy = dy / max;
    if (d < 7) { stick.dx = 0; stick.dy = 0; }
    ev.preventDefault();
  };
  const onStagePointerEnd = (ev: React.PointerEvent) => {
    const g = gRef.current;
    if (!g) return;
    if (g.joy.on && ev.pointerId === g.joy.id) { g.joy.on = false; g.joy.id = null; g.joy.dx = 0; g.joy.dy = 0; }
    if (g.aimJoy.on && ev.pointerId === g.aimJoy.id) { g.aimJoy.on = false; g.aimJoy.id = null; g.aimJoy.dx = 0; g.aimJoy.dy = 0; }
  };

  const ink = light ? "text-[#2A1E07]" : "text-white";
  const mutedInk = light ? "text-[#6B5B36]" : "text-white/55";
  const goldInk = light ? "text-[#7A5A12]" : "text-[#f0d878]";
  const panelSoft = light ? "bg-[#7A5A12]/10" : "bg-white/[0.06]";
  const overlayBg = light ? "rgba(250,247,240,0.86)" : "rgba(4,4,4,0.78)";
  const cardCls = light
    ? "border-[#C9A84C]/50 bg-[#FCF7EA] text-[#2A1E07]"
    : "border-[#C9A84C]/30 bg-[#14100a] text-[#f5f1e6]";
  const btnGold = "sticky bottom-2 z-[2] inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-8 py-3 text-base font-black tracking-wide text-black shadow-lg transition hover:brightness-110";
  const bestLine = sessionBest.score > 0
    ? `Best this session: floor ${sessionBest.depth} · score ${sessionBest.score.toLocaleString()}`
    : "Best this session: no runs yet";

  return (
    <div ref={rootRef} className="relative">
      {/* HUD */}
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2 ${cardCls}`}>
        <span className="min-w-[3.2rem]">
          <span className={`block text-[10px] font-bold uppercase tracking-[0.14em] ${mutedInk}`}>Floor</span>
          <span className={`block text-lg font-black leading-tight ${ink}`}>{hud.floor}</span>
        </span>
        <span className="min-w-[6.5rem] flex-1">
          <span className={`block text-[10px] font-bold uppercase tracking-[0.14em] ${mutedInk}`}>
            King&rsquo;s HP · {hud.hp}/{hud.maxhp}
          </span>
          <span className={`mt-1 block h-2.5 overflow-hidden rounded-full ${light ? "bg-[#7A5A12]/15" : "bg-white/10"}`}>
            <span
              className="block h-full rounded-full transition-[width] duration-150"
              style={{
                width: hud.hpPct + "%",
                background: hud.low
                  ? "linear-gradient(90deg,#8f1d20,#e5484d)"
                  : "linear-gradient(90deg,#9a7b1e,#f0c94f)",
              }}
            />
          </span>
        </span>
        <span className="min-w-[3.6rem]">
          <span className={`block text-[10px] font-bold uppercase tracking-[0.14em] ${mutedInk}`}>Bucs coins</span>
          <span className={`block text-lg font-black leading-tight ${goldInk}`}>{hud.crowns}</span>
        </span>
        <span className="min-w-[3.6rem]">
          <span className={`block text-[10px] font-bold uppercase tracking-[0.14em] ${mutedInk}`}>Score</span>
          <span className={`block text-lg font-black leading-tight ${goldInk}`}>{hud.score.toLocaleString()}</span>
        </span>
      </div>
      <div className={`flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 px-1 py-1.5 text-[13px] ${mutedInk}`}>
        <span>Foes felled: <b className={ink}>{hud.kills}</b> · <b className={ink}>{hud.left} left</b></span>
        {padLive && <span className={`font-bold ${goldInk}`}>Controller live</span>}
        {hud.combo >= 2 && <span className={`font-black ${goldInk}`}>Combo x{hud.combo}</span>}
        <span className="font-bold tabular-nums">{hud.time}</span>
        <span className="inline-flex items-center gap-1.5">
          Dash
          <span className={`inline-block h-[7px] w-16 overflow-hidden rounded-full ${light ? "bg-[#7A5A12]/15" : "bg-white/10"}`}>
            <span className="block h-full bg-[#C9A84C]" style={{ width: hud.dashPct + "%" }} />
          </span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <button
            type="button"
            aria-label={muted ? "Unmute sound" : "Mute sound"}
            title="Sound on/off"
            onClick={() => {
              ensureAudio();
              const next = !muted;
              mutedFlag = next;
              setMuted(next);
            }}
            className={`flex h-10 w-10 items-center justify-center rounded-full border ${cardCls}`}
          >
            {muted ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
          </button>
          <button
            type="button"
            aria-label="Pause game"
            title="Pause (P)"
            onClick={() => { const g = gRef.current; if (g) togglePause(g); }}
            className={`flex h-10 w-10 items-center justify-center rounded-full border ${cardCls}`}
          >
            <Pause className="h-[18px] w-[18px]" />
          </button>
        </span>
        {msg && <span className={`w-full text-right font-bold ${goldInk} sm:w-auto sm:flex-1`}>{msg}</span>}
      </div>

      {/* Stage */}
      <div
        ref={stageRef}
        className={`relative touch-none select-none overflow-hidden rounded-xl border ${light ? "border-[#C9A84C]/40 bg-[#f3ecdc]" : "border-[#C9A84C]/25 bg-[#0d0d0d]"}`}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerEnd}
        onPointerCancel={onStagePointerEnd}
        onPointerLeave={() => { const g = gRef.current; if (g) g.mouseAim.inside = false; }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          width={LW}
          height={LH}
          className="block h-auto w-full touch-none select-none"
          data-testid="crownfall-canvas"
        />

        {/* touch joystick visuals */}
        <div
          ref={joyBaseRef}
          aria-hidden="true"
          className="pointer-events-none absolute z-[4] hidden h-[108px] w-[108px] rounded-full border-2 border-[#C9A84C]/50"
          style={{ margin: "-54px 0 0 -54px", background: "radial-gradient(circle, transparent 55%, rgba(201,168,76,0.18))" }}
        />
        <div
          ref={joyKnobRef}
          aria-hidden="true"
          className="pointer-events-none absolute z-[4] hidden h-12 w-12 rounded-full border-2 border-[#9a7b1e] shadow-lg"
          style={{ margin: "-24px 0 0 -24px", background: "radial-gradient(circle at 35% 30%, #f0c94f, #9a7b1e)" }}
        />

        {/* touch AIM joystick visuals (right side) */}
        <div
          ref={aimJoyBaseRef}
          aria-hidden="true"
          className="pointer-events-none absolute z-[4] hidden h-[108px] w-[108px] rounded-full border-2 border-dashed border-[#e5484d]/60"
          style={{ margin: "-54px 0 0 -54px", background: "radial-gradient(circle, transparent 55%, rgba(229,72,77,0.14))" }}
        />
        <div
          ref={aimJoyKnobRef}
          aria-hidden="true"
          className="pointer-events-none absolute z-[4] hidden h-12 w-12 rounded-full border-2 border-[#8f1d20] shadow-lg"
          style={{ margin: "-24px 0 0 -24px", background: "radial-gradient(circle at 35% 30%, #ff8a7a, #c22e35)" }}
        />

        {phase === "playing" && (
          <button
            type="button"
            aria-label="Dash"
            data-dash-btn
            className={`absolute bottom-3.5 right-3.5 z-[4] flex h-[76px] w-[76px] items-center justify-center rounded-full border-2 border-[#9a7b1e] text-sm font-black tracking-wider text-black shadow-xl transition ${hud.cooling ? "opacity-45 saturate-50" : ""}`}
            style={{ background: "radial-gradient(circle at 35% 30%, #f0c94f, #d4af37 60%, #9a7b1e)", touchAction: "none" }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const g = gRef.current;
              if (g) tryDash(g);
            }}
            onClick={(e) => e.preventDefault()}
          >
            DASH
          </button>
        )}

        <div ref={flashRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[6] bg-[#fff8d6] opacity-0" />

        {intro && (
          <div key={intro.key} className="pointer-events-none absolute inset-0 z-[7] flex items-center justify-center">
            <div className={`rounded-xl border px-7 py-4 text-center ${cardCls}`} style={{ background: overlayBg }}>
              <div className={`text-xs font-bold uppercase tracking-[0.12em] ${goldInk}`}>Floor {intro.depth}</div>
              <div className={`text-2xl font-black ${ink}`}>{crownfallFloorName(intro.depth)}</div>
            </div>
          </div>
        )}

        {pausedUi && phase === "playing" && (
          <div data-overlay className="absolute inset-0 z-[5] overflow-y-auto" style={{ background: overlayBg, touchAction: "pan-y" }}>
            <div className="flex min-h-full w-full flex-col items-center justify-center px-4 py-4 text-center">
              <h3 className={`text-3xl font-black ${ink}`}>Paused</h3>
              <p className={`mb-4 mt-1 max-w-[42ch] text-sm ${mutedInk}`}>The deep waits. Press P, Start, or tap Resume to keep going.</p>
              <button type="button" className={btnGold} onClick={() => { const g = gRef.current; if (g) togglePause(g); }}>
                Resume
              </button>
            </div>
          </div>
        )}

        {phase === "start" && (
          <div data-overlay className="absolute inset-0 z-[5] overflow-y-auto" style={{ background: overlayBg, touchAction: "pan-y" }}>
            <div className="flex min-h-full w-full flex-col items-center justify-center px-4 py-3 text-center">
              <svg width="54" height="40" viewBox="0 0 54 40" aria-hidden="true" className="mb-1">
                <path d="M4 32 L4 12 L16 22 L27 6 L38 22 L50 12 L50 32 Z" fill="#f0c94f" stroke="#8a6d1f" strokeWidth="2" />
                <circle cx="27" cy="26" r="3.4" fill="#e5484d" />
              </svg>
              <h3 className={`text-3xl font-black leading-tight ${ink}`}>
                Crownfall <span className={goldInk}>Run</span>
              </h3>
              <p className={`mt-0.5 max-w-[42ch] text-[15px] ${mutedInk}`}>Defend the studio. How deep can the King go?</p>
              <p className={`mb-3 mt-2 max-w-[46ch] text-sm ${mutedInk}`}>
                Bots and glitches are invading the Bow Down Visuals studio — clear each room, grab the gold Bucs coins (score only, +25), and take the golden door down. The Usurper waits every 5th floor.
              </p>
              <div className={`mb-4 w-full max-w-[430px] rounded-xl border px-4 py-3 text-left text-sm ${cardCls}`}>
                <div className="py-0.5"><b className={ink}>Move</b> — WASD or arrow keys · on touch, drag the left side of the arena</div>
                <div className="py-0.5"><b className={ink}>Aim &amp; fire</b> — right stick / mouse / right thumb-stick aims: your shots go where you point. No aim, no shots — every bolt is yours</div>
                <div className="py-0.5"><b className={ink}>Dash</b> — Space · or the gold DASH button — briefly untouchable</div>
                <div className="py-0.5"><b className={ink}>Goal</b> — clear Glitches, Spam Bots and Trolls to open the golden door, then walk through it into the next room</div>
                <div className="py-0.5"><b className={ink}>Controller</b> — Bluetooth or wired: left stick / D-pad to move · right stick aims &amp; fires · A to dash · Start or A to begin · Start pauses</div>
                <div className="py-0.5"><b className={ink}>Pause</b> — P or the pause button</div>
              </div>
              <button type="button" className={btnGold} onClick={startFromUi} data-testid="crownfall-start">
                <Play className="h-4 w-4" /> Start the Run
              </button>
              {padStatus && (
                <p className={`mt-2.5 max-w-[46ch] text-[13px] ${padStatus.waiting ? mutedInk : `font-bold ${goldInk}`}`}>
                  {padStatus.text}
                </p>
              )}
              <p className={`mt-2 text-[13px] ${mutedInk}`}>{bestLine}</p>
            </div>
          </div>
        )}

        {phase === "upgrade" && (
          <div data-overlay className="absolute inset-0 z-[5] overflow-y-auto" style={{ background: overlayBg, touchAction: "pan-y" }}>
            <div className="flex min-h-full w-full flex-col items-center justify-center px-4 py-4 text-center">
              <h3 className={`text-2xl font-black ${ink}`}>Floor <span className={goldInk}>Cleared</span></h3>
              <p className={`mt-1 text-sm ${mutedInk}`}>You walked into the next room. Choose one studio upgrade, then the fight starts.</p>
              <div className="mt-3 grid w-full max-w-[430px] grid-cols-1 gap-2.5 min-[560px]:max-w-none min-[560px]:grid-cols-3">
                {picks.map((u, idx) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => { const g = gRef.current; if (g) pickUpgrade(g, idx, bgRef.current); }}
                    onMouseEnter={() => { const g = gRef.current; if (g) setUpgradeHighlight(g, idx); }}
                    className={`flex min-h-16 items-start gap-3 rounded-xl border p-3.5 text-left transition min-[560px]:flex-col ${cardCls} ${idx === hi ? "shadow-[0_0_0_3px_rgba(240,201,79,0.9)]" : ""}`}
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${panelSoft}`}>
                      <UpgradeIcon id={u.id} />
                    </span>
                    <span>
                      <span className={`block text-base font-black leading-tight ${ink}`}>{u.name}</span>
                      <span className={`mt-0.5 block text-[13px] ${mutedInk}`}>{u.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {phase === "dead" && deathVisible && summary && (
          <div data-overlay className="absolute inset-0 z-[5] overflow-y-auto" style={{ background: overlayBg, touchAction: "pan-y" }}>
            <div className="flex min-h-full w-full flex-col items-center justify-center px-4 py-4 text-center">
              <h3 className={`text-3xl font-black ${ink}`}>The Crown <span className={goldInk}>Falls</span></h3>
              <p className={`mt-1 max-w-[42ch] text-sm ${mutedInk}`}>
                {summary.bossDeath
                  ? "The Usurper wants the throne — and takes it this time."
                  : "The invaders overrun the studio this time."}
              </p>
              <div className="mx-auto mb-4 mt-2 grid w-full max-w-[340px] grid-cols-2 gap-2">
                {[
                  { k: "Depth reached", v: String(summary.depth), gold: false },
                  { k: "Bucs coins (score)", v: String(summary.crowns), gold: false },
                  { k: "Foes felled", v: String(summary.kills), gold: false },
                  { k: "Final score", v: summary.score.toLocaleString(), gold: true },
                  { k: "Best combo", v: "x" + Math.max(1, summary.bestCombo), gold: false },
                  { k: "Time survived", v: fmtTime(summary.timeSec), gold: false },
                ].map((c) => (
                  <div key={c.k} className={`rounded-xl border px-2 py-2.5 ${cardCls}`}>
                    <div className={`text-[11px] font-bold uppercase tracking-[0.13em] ${mutedInk}`}>{c.k}</div>
                    <div className={`text-2xl font-black ${c.gold ? goldInk : ink}`}>{c.v}</div>
                  </div>
                ))}
              </div>
              <p className={`mb-2.5 text-[13px] ${mutedInk}`}>Score includes combo bonus points earned from chained kills.</p>
              {summary.isSessionBest && <div className={`mb-2.5 font-bold ${goldInk}`}>New best run!</div>}
              <button type="button" className={btnGold} onClick={startFromUi} data-testid="crownfall-restart">
                <RotateCcw className="h-4 w-4" /> Run Again
              </button>
              <p className={`mt-2 text-[13px] ${mutedInk}`}>{bestLine}</p>
            </div>
          </div>
        )}
      </div>

      <p className={`px-1 pb-1 pt-3 text-center text-[13px] ${mutedInk}`}>
        Score = depth × 100 + Bucs coins × 25 + foes felled × 10 + combo bonus. Coins are score only — no charge, no wager.
      </p>
    </div>
  );
}
