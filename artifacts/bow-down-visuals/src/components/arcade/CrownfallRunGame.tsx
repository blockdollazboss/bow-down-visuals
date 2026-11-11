import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, Minimize, Pause, Play, RotateCcw, Shield, Volume2, VolumeX } from "lucide-react";
import { mediaUrl } from "@/lib/media-cdn";
import {
  CROWNFALL,
  CROWNFALL_GUNS,
  crownfallBossCycle,
  crownfallBossHp,
  crownfallComboMult,
  crownfallContactBonus,
  crownfallEliteChance,
  crownfallFloorName,
  crownfallFoesForFloor,
  crownfallGun,
  crownfallHpScale,
  crownfallScore,
  crownfallSpeedScale,
  crownfallUpgradePrice,
  type ArcadeRunResult,
  type CrownfallGun,
} from "@/lib/arcade-games";
/* Online multiplayer (CrownfallClient, lib/crownfall-net.ts) rides
   this game through a thin seam: the engine runs unchanged solo, and
   every `g.mp` guard below is inert when no party is connected. */
import type { CrownfallClient } from "@/lib/crownfall-net";
import {
  claimPrestigeTier,
  claimRoyalBounty,
  loadCrownfallMeta,
  loadCrownfallMuted,
  prestigeCoinChance,
  prestigeDamageMult,
  recordRunInMeta,
  saveCrownfallMeta,
  saveCrownfallMuted,
  CROWNFALL_ACHIEVEMENTS,
  PRESTIGE_TIER_CAP,
  type CrownfallMeta,
} from "@/lib/crownfall-meta";

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
   THE USURPER waits every 5th floor, harder each cycle. Permadeath.

   v2 (owner, Nov 10, 2026 — "full screen… pay for upgrades using the
   coins we collect", "a bunch of guns, a bunch of features", "more
   graphics, more entertaining", "bigger maps, more fancy high
   quality premium", "each level should get harder and harder",
   "prestige and a lot more things"):
   - FULLSCREEN: starting a run requests fullscreen on the game
     container; a toggle lives in the HUD. A refused request just
     leaves the run windowed — no fake claim, no broken state, and
     exiting fullscreen mid-run never touches the run.
   - COIN PURSE + SHOP: coins now land in a run-local PURSE (HUD).
     Between floors the upgrade offer is a SHOP — three priced
     upgrade cards plus the gun rack; buy any you can afford (more
     than one), effects apply at once, and DESCEND IS ALWAYS FREE.
     Unaffordable cards show the price and the shortfall honestly.
     At run end the leftover purse converts to score at +25/coin.
     Purse coins are NOT Visual Bucs: they never touch accounts.
   - SIX GUNS (lib/arcade-games.ts CROWNFALL_GUNS): bought in the
     shop, dropped by elites (25%) and always by the boss, switched
     mid-run with keys 1–6, pad LB/RB, or the touch switch control.
     Manual aim + held fire for every gun — auto-shoot stays OFF.
   - BIGGER MAPS: rooms are 1080×1080 world units; the 720×720
     canvas is a camera view that follows the King (eased), with a
     HUD minimap (King, foes, door, pickups). Static dressing is
     pre-rendered to the per-floor offscreen backdrop, as before.
   - DIFFICULTY RAMP: the table in lib/arcade-games.ts — more foes,
     more HP, stepping contact damage, creeping speed, rising elite
     share; Glitch Chargers unlock floor 3, Spam Slingers floor 4;
     boss cycles add summons (2+), a spread shot (3+), speed (4+).
   - EVENT ROOMS: JACKPOT VAULT (coin-rich, guarded) and AMBUSH
     (extra foes, better drops) roll on non-boss floors from floor 2.
   - PRESTIGE + MORE: prestige tiers persist between runs (adapter:
     lib/crownfall-meta.ts — see its persistence-gap note), lifetime
     achievements, a shield pickup, a ×1–×5 combo multiplier, kill
     streak callouts, and the daily Royal Bounty (+50 scrip — scrip
     is shop-spendable but never converts to score, so prestige can
     never inflate a submission; the arcade-rules.ts caps stand).
   Score = depth × 100 + leftover purse × 25 + foes × 10 + combo
   bonus. Aiming changes accuracy only, never the score economy.

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
     a frame; every fullscreen call is likewise guarded (a refusal
     just leaves the run windowed). Storage is touched ONLY through
     the guarded adapter in lib/crownfall-meta.ts (mute preference +
     prestige meta) — every access is try/caught with an in-memory
     fallback, so a hostile host can refuse it and lose nothing.
   - The arena paints one frame immediately at boot and at run start.
   The reported durationMs is PLAY time only (pause + upgrade picks
   excluded) — exactly the clock the server caps in arcade-rules.ts
   are derived against. */

/* World vs view: LW/LH are the WORLD (room) size — every entity,
   obstacle and backdrop lives in world coordinates. VW/VH are the
   canvas view: the camera (g.cam) picks which 720×720 window of the
   world is on screen. */
const LW = CROWNFALL.worldWidth;
const LH = CROWNFALL.worldHeight;
const VW = CROWNFALL.width;
const VH = CROWNFALL.height;
const WALL = CROWNFALL.wall;
/* Hard cap on live particles — juice never gets to eat the frame. */
const PARTICLE_CAP = 240;

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
  buy() { tone(920, 0, 0.08, "sine", 0.06); tone(1380, 0, 0.12, "sine", 0.06, 0.07); tone(1840, 0, 0.16, "sine", 0.045, 0.14); },
  roar() { tone(58, 34, 0.9, "sawtooth", 0.13); tone(87, 51, 0.9, "sawtooth", 0.09, 0.06); noiseBurst(0.5, 0.05, 300); },
  boom() { noiseBurst(0.28, 0.12, 500); tone(72, 36, 0.3, "sine", 0.13); },
  slam() { noiseBurst(0.16, 0.08, 350); tone(90, 45, 0.18, "sine", 0.09); },
  shieldPop() { tone(520, 980, 0.14, "sine", 0.07); noiseBurst(0.08, 0.04, 2400); },
  claim() { tone(1046, 0, 0.09, "triangle", 0.06); tone(1318, 0, 0.11, "triangle", 0.06, 0.07); tone(1568, 0, 0.18, "triangle", 0.06, 0.14); },
};

/* ─── fullscreen (guarded like every host call) ───────────────────────
   Starting a run REQUESTS fullscreen on the game container; browsers
   may refuse (no gesture, iframe policy, a pad start has no transient
   activation) — a refusal is swallowed and the run simply continues
   windowed. Nothing anywhere claims fullscreen that isn't real: the
   HUD toggle reads document.fullscreenElement, and exiting mid-run
   is a pure view change that never touches run state. */
function requestGameFullscreen(el: HTMLElement | null) {
  try {
    if (!el || typeof document === "undefined" || document.fullscreenElement) return;
    const p = el.requestFullscreen?.();
    if (p && typeof p.catch === "function") p.catch(() => { /* refused — windowed it is */ });
  } catch { /* refused — windowed it is */ }
}
function exitGameFullscreen() {
  try {
    if (typeof document !== "undefined" && document.fullscreenElement) {
      const p = document.exitFullscreen?.();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  } catch { /* nothing to exit */ }
}
function toggleGameFullscreen(el: HTMLElement | null) {
  try {
    if (typeof document !== "undefined" && document.fullscreenElement) exitGameFullscreen();
    else requestGameFullscreen(el);
  } catch { /* the toggle is a nicety, never a blocker */ }
}

/* ─── game state ──────────────────────────────────────────────────────── */
type Phase = "start" | "playing" | "upgrade" | "dead" | "transit";
type EnemyType = "chaser" | "shooter" | "dasher" | "charger" | "spambot" | "boss";
type EventKind = "none" | "jackpot" | "ambush";

interface Player {
  x: number; y: number; r: number;
  hp: number; maxhp: number;
  speed: number; dmg: number; fireRate: number; multishot: number;
  faceX: number; faceY: number;
  dashCdMax: number; dashCd: number; dashT: number; dashDX: number; dashDY: number;
  invuln: number; flash: number;
  spread: boolean; pierce: boolean; magnet: number; moveMag: number;
  /* v2: the arsenal, Thorn Sash, Second Wind, bubble shield */
  guns: string[]; gun: string;
  thorn: number; secondWind: boolean; shield: boolean;
}
interface Enemy {
  /* MP: the foe's index within its floor — its party-wide identity
     (the floor is deterministic, so every client agrees). */
  id: number;
  type: EnemyType; x: number; y: number; vx: number; vy: number; kx: number; ky: number;
  state: string; t: number; fireT: number;
  lockX: number; lockY: number; wob: number; flash: number; elite: boolean;
  r: number; hp: number; maxhp: number; speed: number; dmg: number;
  thornT: number;      /* Thorn Sash tick cooldown (per foe) */
  summons: number;     /* boss only: summon waves already used */
}
interface Bolt {
  x: number; y: number; vx: number; vy: number; r: number; dmg: number;
  pierceLeft: number; hit: Enemy[];
  life: number;        /* seconds of flight left (Infinity = until a wall) */
  splash: number;      /* blast radius on impact (0 = single target) */
  kind: "bolt" | "shell" | "rail";
  tint: string;
}
interface EBolt { x: number; y: number; vx: number; vy: number; r: number; dmg: number }
interface Pickup {
  x: number; y: number; r: number;
  kind: "crown" | "scrip" | "heart" | "shield" | "gun";
  bob: number;
  gunId?: string;      /* kind === "gun": the arsenal drop to claim */
  /* MP: the server's coin id (`f<depth>:p<i>` placed, `f<depth>:d<n>`
     dropped) — claims and removals are arbitrated by it. Absent on
     solo pickups (drops, hearts, shields, guns are local there). */
  mpId?: string | null;
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

/* One row of the between-floor shop: an upgrade card, a gun on the
   rack, or the always-free Descend. Prices and shortfalls are real:
   an unaffordable row says exactly how many coins are missing. */
export interface ShopItemSnap {
  key: string;
  kind: "upgrade" | "gun" | "descend";
  id: string;
  name: string;
  desc: string;
  price: number;
  affordable: boolean;
  shortfall: number;
  owned: boolean;
  equipped: boolean;
  tint?: string;
}
export interface ShopSnap {
  purse: number;   /* score coins held */
  scrip: number;   /* prestige/bounty scrip held (spends first) */
  total: number;   /* purse + scrip — what the shop can spend */
  depth: number;
  items: ShopItemSnap[];
}

interface UiBridge {
  hud: () => void;
  phase: (p: Phase) => void;
  paused: (p: boolean) => void;
  msg: (t: string) => void;
  intro: (depth: number, info: { name: string; event: EventKind; boss: boolean }) => void;
  shop: (s: ShopSnap | null) => void;
  highlight: (i: number) => void;
  flash: () => void;
  death: (summary: RunSummary) => void;
  padStatus: (s: { text: string; waiting: boolean } | null, live: boolean) => void;
}

export interface RunSummary {
  depth: number; crowns: number; kills: number; score: number;
  bestCombo: number; timeSec: number; bossDeath: boolean; isSessionBest: boolean;
  /* v2: purse conversion, armory, prestige + achievements */
  coinScore: number;         /* crowns × 25 — the purse's score line */
  armory: string[];          /* gun names owned at run end */
  bossKills: number;
  prestigeTier: number;      /* tier held when the run ended */
  canPrestige: boolean;      /* a boss fell this run and tier < cap */
  achievementsNew: string[]; /* ids earned by this run */
  achievementsAll: string[]; /* ids earned lifetime (incl. this run) */
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
  camY: number;         /* current view slide, 0..VH (screen space) */
  kingX: number; kingY: number; /* King's screen-space draw position */
  done: boolean;
  snapObstacles: Obstacle[];
  snapPickups: Pickup[];
  camFromX: number; camFromY: number; /* old room's camera at passage start */
  camDoorX: number; camDoorY: number; /* old room's camera centred on the door */
  viewCamX: number; viewCamY: number; /* old room's camera THIS frame (eased) */
}
const TRANSIT_WALK_SEC = 0.32;
const TRANSIT_SLIDE_SEC = 0.78; /* total passage ≈ 1.1s */

interface G {
  theme: ThemeName;
  phase: Phase;
  paused: boolean;
  runSeed: number;
  depth: number; crowns: number; kills: number;
  /* v2 run economy: purse = score coins held (converts at run end);
     scrip = prestige/bounty coins (spendable, never converts) */
  purse: number; scrip: number;
  cam: { x: number; y: number };
  event: EventKind;
  bossKills: number;
  callout: { text: string; t: number } | null;
  fountainT: number;      /* run-end coin fountain timer (win flourish) */
  spawnQueue: EnemyType[]; /* boss summons, drained outside the foe loop */
  addEnemyAt: ((type: EnemyType, x?: number, y?: number) => void) | null;
  meta: CrownfallMeta;
  shopIndex: number;
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
  /** MP: the highest server purse tally already folded into the
   *  local purse — the tally is a running total, so only the delta
   *  over this mark is new money (shop spends are never refunded
   *  by a sync). */
  mpPurseSeen: number;
}

function newPlayer(tier = 0): Player {
  return {
    x: LW / 2, y: LH - 110, r: 22,
    hp: CROWNFALL.baseHp, maxhp: CROWNFALL.baseHp,
    speed: CROWNFALL.baseSpeed,
    /* prestige is power, not score: +5% bolt damage per tier,
       applied to the base stat before guns/upgrades multiply it */
    dmg: CROWNFALL.baseDamage * prestigeDamageMult(tier),
    fireRate: CROWNFALL.baseFireRate, multishot: 1,
    faceX: 0, faceY: -1,
    dashCdMax: CROWNFALL.dashCooldownSec, dashCd: 0, dashT: 0, dashDX: 0, dashDY: -1,
    invuln: 0, flash: 0,
    spread: false, pierce: false, magnet: CROWNFALL.baseMagnet, moveMag: 0,
    guns: ["blaster"], gun: "blaster",
    thorn: 0, secondWind: false, shield: false,
  };
}

/* Mid-run score: the purse has NOT converted yet, so the coin term
   is 0 — the HUD score is depth + kills + combo, honestly pending. */
function scoreOf(g: G) {
  return crownfallScore(g.depth, 0, g.kills, g.comboBonus);
}
/* Run-end score: the leftover purse converts at +25 per coin.
   Scrip NEVER converts (prestige stays power + status only). */
function finalScoreOf(g: G) {
  return crownfallScore(g.depth, g.purse, g.kills, g.comboBonus);
}
function camSnapToPlayer(g: G) {
  g.cam.x = clamp(g.P.x - VW / 2, 0, LW - VW);
  g.cam.y = clamp(g.P.y - VH / 2, 0, LH - VH);
}
function todayLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}
function enemyName(e: Enemy) {
  const base = e.type === "chaser" ? "Glitch"
    : e.type === "shooter" ? "Spam Bot"
    : e.type === "dasher" ? "Troll"
    : e.type === "charger" ? "Glitch Charger"
    : e.type === "spambot" ? "Spam Slinger"
    : "The Usurper";
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
  g.enemies = []; g.doorOpen = false; g.boss = null; g.fireTimer = 0.3; g.spawnQueue = [];

  /* event rooms (floor 2+, never on a boss floor): the JACKPOT VAULT
     is coin-rich and elite-guarded; an AMBUSH packs in extra foes
     with better drops. The floor-intro banner announces the roll. */
  g.event = "none";
  if (d >= 2 && d % 5 !== 0) {
    const er = rng();
    if (er < 0.12) g.event = "jackpot";
    else if (er < 0.24) g.event = "ambush";
  }

  /* obstacles — more of them in the bigger rooms (5..9); keep spawn
     (bottom centre) and door (top centre) clear */
  const want = 5 + Math.floor(rng() * 5);
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

  /* coin pickups: 4..7 on a normal floor, 8..14 in the JACKPOT VAULT */
  const nc = g.event === "jackpot" ? 8 + Math.floor(rng() * 7) : 4 + Math.floor(rng() * 4);
  guard = 0;
  while (g.pickups.length < nc && guard++ < 200) {
    const px = WALL + 40 + rng() * (LW - 2 * WALL - 80);
    const py = WALL + 40 + rng() * (LH - 2 * WALL - 80);
    if (pointInRects(g, px, py, 22)) continue;
    g.pickups.push({ x: px, y: py, r: 11, kind: "crown", bob: rng() * 6.28, mpId: "f" + d + ":p" + g.pickups.length });
  }
  g.mpPlacedCount = g.pickups.length;

  /* player back to the entrance; the camera snaps with him */
  const P = g.P;
  P.x = LW / 2; P.y = LH - 110; P.invuln = Math.max(P.invuln, 0.6);
  P.dashCd = 0; P.dashT = 0;
  camSnapToPlayer(g);

  /* enemies — stats from the shared difficulty table
     (lib/arcade-games.ts): HP/speed scales, contact-damage steps,
     elite share, unlock floors. */
  const hpScale = crownfallHpScale(d);
  const spScale = crownfallSpeedScale(d);
  const contactBonus = crownfallContactBonus(d);
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
  function addEnemy(type: EnemyType, atX?: number, atY?: number) {
    const s = atX !== undefined && atY !== undefined ? { x: atX, y: atY } : spawnPos();
    const e: Enemy = {
      id: g.enemies.length,
      type, x: s.x, y: s.y, vx: 0, vy: 0, kx: 0, ky: 0,
      state: "stalk", t: 0, fireT: 1 + rng() * 1.2,
      lockX: 0, lockY: 0, wob: rng() * 6.28, flash: 0, elite: false,
      r: 15, hp: 1, maxhp: 1, speed: 100, dmg: 10,
      thornT: 0, summons: 0,
    };
    if (type === "chaser") { e.r = 16; e.hp = e.maxhp = 26 * hpScale; e.speed = 106 * spScale; e.dmg = 12 + contactBonus; }
    if (type === "shooter") { e.r = 15; e.hp = e.maxhp = 20 * hpScale; e.speed = 92 * spScale; e.dmg = 10 + contactBonus; }
    if (type === "dasher") { e.r = 15; e.hp = e.maxhp = 22 * hpScale; e.speed = 100 * spScale; e.dmg = 14 + contactBonus; }
    /* Glitch Charger (floor 3+): pauses, telegraphs, then charges */
    if (type === "charger") { e.r = 16; e.hp = e.maxhp = 30 * hpScale; e.speed = 104 * spScale; e.dmg = 14 + contactBonus; }
    /* Spam Slinger (floor 4+): keeps its distance, lobs slow bolts */
    if (type === "spambot") { e.r = 15; e.hp = e.maxhp = 22 * hpScale; e.speed = 96 * spScale; e.dmg = 10 + contactBonus; e.fireT = 1.4 + rng(); }
    if (type !== "boss" && rng() < crownfallEliteChance(d) + (g.event === "jackpot" ? 0.15 : 0)) {
      e.elite = true; e.hp = e.maxhp = e.hp * 1.9; e.r += 2; e.speed *= 1.06;
    }
    if (type === "boss") {
      const cycle = crownfallBossCycle(d);
      e.r = 36; e.hp = e.maxhp = crownfallBossHp(d);
      e.speed = 72 * spScale * (cycle >= 4 ? 1.2 : 1); e.dmg = 20 + contactBonus;
      e.x = LW / 2; e.y = 210;
      g.boss = e;
    }
    g.enemies.push(e);
  }
  g.addEnemyAt = addEnemy;
  if (d % 5 === 0) {
    addEnemy("boss");
    if (d >= 10) { addEnemy("chaser"); addEnemy("shooter"); }
  } else {
    const base = crownfallFoesForFloor(d);
    const n = g.event === "ambush" ? Math.ceil(base * 1.5) : base;
    for (let k = 0; k < n; k++) {
      const roll = rng();
      let type: EnemyType = roll < 0.45 ? "chaser" : roll < 0.75 ? "shooter" : "dasher";
      if (d < 2 && k > 1) type = "chaser";
      if (d < 3 && type === "dasher") type = "shooter";
      /* unlocks (never earlier): Chargers from floor 3, Slingers from 4 */
      if (d >= 3 && rng() < 0.22) type = "charger";
      if (d >= 4 && rng() < 0.22) type = "spambot";
      addEnemy(type);
    }
  }
  makeBg(g, bg);
  const evLine = g.event === "jackpot" ? " — JACKPOT VAULT!" : g.event === "ambush" ? " — AMBUSH!" : " — clear the invaders";
  g.ui.msg(d % 5 === 0 ? "Floor " + d + " — The Usurper wants the throne." : "Floor " + d + " · " + crownfallFloorName(d) + evLine);
  if (g.phase === "playing") {
    g.ui.intro(d, { name: crownfallFloorName(d), event: g.event, boss: d % 5 === 0 });
    if (d % 5 === 0) { sfx.boss(); sfx.roar(); }
  }
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
  /* floor sheen — one soft diagonal light wash over the stone, so
     the bigger floors read premium instead of flat */
  const sheen = b.createLinearGradient(0, 0, LW, LH);
  sheen.addColorStop(0, g.theme === "dark" ? "rgba(255,244,200,0.05)" : "rgba(255,255,255,0.20)");
  sheen.addColorStop(0.5, "rgba(0,0,0,0)");
  sheen.addColorStop(1, g.theme === "dark" ? "rgba(0,0,0,0.10)" : "rgba(120,90,20,0.06)");
  b.fillStyle = sheen;
  b.fillRect(0, 0, LW, LH);
  /* soft stone blotches */
  for (i = 0; i < 16; i++) {
    x = rng() * LW; y = rng() * LH;
    const gr = b.createRadialGradient(x, y, 0, x, y, 120 + rng() * 160);
    gr.addColorStop(0, pal.blotch); gr.addColorStop(1, "rgba(0,0,0,0)");
    b.fillStyle = gr;
    b.fillRect(0, 0, LW, LH);
  }
  /* pale-gold marble veins carried across the whole floor — the
     centre included, fainter there so the room still reads calm */
  for (i = 0; i < 36; i++) {
    const edge = rng();
    if (edge < 0.45) { x = rng() < 0.5 ? rng() * 120 : LW - rng() * 120; y = rng() * LH; }
    else if (edge < 0.7) { x = rng() * LW; y = rng() < 0.5 ? rng() * 120 : LH - rng() * 120; }
    else { x = 140 + rng() * (LW - 280); y = 140 + rng() * (LH - 280); }
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
  for (i = 1; i < 12; i++) {
    b.beginPath(); b.moveTo(i * 90, WALL); b.lineTo(i * 90, LH - WALL); b.stroke();
    b.beginPath(); b.moveTo(WALL, i * 90); b.lineTo(LW - WALL, i * 90); b.stroke();
  }
  /* studio rug in the centre — filled, patterned, thin gold border */
  b.save();
  const rx0 = LW / 2 - 190, ry0 = LH / 2 - 140, rw0 = 380, rh0 = 280;
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
    for (let cp = 0; cp < 12; cp++) {
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
    for (const [lx, ly] of [[190, 210], [890, 210], [190, 870], [890, 870]] as const) {
      const lg = b.createRadialGradient(lx, ly, 0, lx, ly, 120);
      lg.addColorStop(0, dark ? "rgba(96,165,250,0.13)" : "rgba(96,140,220,0.10)"); lg.addColorStop(1, "rgba(0,0,0,0)");
      b.fillStyle = lg; b.fillRect(lx - 120, ly - 120, 240, 240);
    }
    b.strokeStyle = dark ? "rgba(120,130,150,0.25)" : "rgba(90,100,120,0.22)"; b.lineWidth = 3;
    for (const cx3 of [150, 930]) {
      b.beginPath(); b.moveTo(cx3, WALL); b.lineTo(cx3, LH - WALL); b.stroke();
    }
  }
  if (kind === "lobby") {
    /* gold inlay diamonds in the floor corners — a lobby's welcome */
    b.strokeStyle = dark ? "rgba(212,175,55,0.35)" : "rgba(138,109,31,0.35)"; b.lineWidth = 1.6;
    for (const [ix2, iy2] of [[150, 160], [930, 160], [150, 920], [930, 920]] as const) {
      b.beginPath();
      b.moveTo(ix2, iy2 - 17); b.lineTo(ix2 + 17, iy2); b.lineTo(ix2, iy2 + 17); b.lineTo(ix2 - 17, iy2);
      b.closePath(); b.stroke();
      b.fillStyle = dark ? "rgba(240,201,79,0.5)" : "rgba(160,120,35,0.5)";
      b.beginPath(); b.arc(ix2, iy2, 2.6, 0, 6.283); b.fill();
    }
  }
  /* ── clutter pass: flat floor dressing scattered through the
     bigger rooms (all non-collision, all pre-rendered here so the
     frame loop never pays for it) — cable runs, tape marks, scuffs,
     gold dust. Density is the point: a 1080 room must not feel empty
     between its collision pieces. ── */
  for (let ci = 0; ci < 16; ci++) {
    const cx4 = WALL + 60 + rng() * (LW - 2 * WALL - 120);
    const cy4 = WALL + 60 + rng() * (LH - 2 * WALL - 120);
    const pick = rng();
    if (pick < 0.34) {
      /* a cable run: two lazy arcs */
      b.strokeStyle = dark ? "rgba(140,145,160,0.16)" : "rgba(90,80,55,0.16)"; b.lineWidth = 2.4;
      b.beginPath(); b.moveTo(cx4, cy4);
      b.quadraticCurveTo(cx4 + (rng() - 0.5) * 190, cy4 + (rng() - 0.5) * 190, cx4 + (rng() - 0.5) * 260, cy4 + (rng() - 0.5) * 260);
      b.stroke();
    } else if (pick < 0.62) {
      /* gaffer-tape X marks */
      b.strokeStyle = dark ? "rgba(240,201,79,0.20)" : "rgba(138,109,31,0.22)"; b.lineWidth = 3;
      const s4 = 9 + rng() * 6;
      b.beginPath();
      b.moveTo(cx4 - s4, cy4 - s4); b.lineTo(cx4 + s4, cy4 + s4);
      b.moveTo(cx4 + s4, cy4 - s4); b.lineTo(cx4 - s4, cy4 + s4);
      b.stroke();
    } else if (pick < 0.84) {
      /* a worn scuff patch */
      b.fillStyle = dark ? "rgba(255,255,255,0.03)" : "rgba(120,90,20,0.05)";
      b.beginPath(); b.ellipse(cx4, cy4, 22 + rng() * 30, 9 + rng() * 12, rng() * 3, 0, 6.283); b.fill();
    } else {
      /* spilled gold dust */
      b.fillStyle = dark ? "rgba(240,201,79,0.13)" : "rgba(170,130,40,0.14)";
      for (let gd = 0; gd < 6; gd++) {
        b.beginPath(); b.arc(cx4 + (rng() - 0.5) * 44, cy4 + (rng() - 0.5) * 26, 1.4 + rng() * 2.2, 0, 6.283); b.fill();
      }
    }
  }
  /* NOTE: no vignette in the backdrop — with a moving camera it is
     drawn in VIEW space by render(), so it hugs the screen. */
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
    if (g.parts.length >= PARTICLE_CAP) return; /* juice is capped, always */
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
  /* the bubble shield absorbs exactly one hit, whole */
  if (P.shield) {
    P.shield = false;
    P.invuln = 0.7;
    sfx.shieldPop();
    floater(g, P.x, P.y - 30, "SHIELD DOWN", "#8ae2ff");
    burst(g, P.x, P.y, "#8ae2ff", 14, 170);
    g.ui.hud();
    return;
  }
  P.hp -= dmg; sfx.hurt();
  P.invuln = 0.9; P.flash = 0.25; g.shake = Math.max(g.shake, 9);
  burst(g, P.x, P.y, "#e5484d", 10, 150);
  g.ui.hud();
  if (P.hp <= 0) {
    /* Second Wind: one revive per run at 50% HP, if bought and unused */
    if (P.secondWind) {
      P.secondWind = false;
      P.hp = Math.floor(P.maxhp * 0.5);
      P.invuln = 1.6; P.flash = 0;
      g.shake = Math.max(g.shake, 12);
      sfx.claim();
      floater(g, P.x, P.y - 34, "SECOND WIND!", "#f0c94f");
      burst(g, P.x, P.y, "#f0c94f", 30, 230);
      burst(g, P.x, P.y, "#fff3c4", 14, 150);
      g.ui.msg("Second Wind — the King refuses to fall!");
      g.ui.hud();
      return;
    }
    P.hp = 0; die(g, bg);
  }
}
/* Coin drops: every dropped score coin also rolls the prestige
   scrip chance — a bonus SCRIP coin (spendable, never converts). */
function dropCoins(g: G, x: number, y: number, count: number) {
  const scripChance = prestigeCoinChance(g.meta.tier);
  for (let i = 0; i < count; i++) {
    const ox = (Math.random() - 0.5) * 26, oy = (Math.random() - 0.5) * 20;
    g.pickups.push({ x: x + ox, y: y + oy, r: 11, kind: "crown", bob: Math.random() * 6.28 });
    if (Math.random() < scripChance) {
      g.pickups.push({ x: x - ox, y: y - oy, r: 11, kind: "scrip", bob: Math.random() * 6.28 });
    }
  }
}
function dropGunPickup(g: G, x: number, y: number) {
  const unowned = CROWNFALL_GUNS.filter((gun) => !g.P.guns.includes(gun.id));
  if (!unowned.length) return;
  const gun = unowned[(Math.random() * unowned.length) | 0]!;
  g.pickups.push({ x, y, r: 13, kind: "gun", bob: Math.random() * 6.28, gunId: gun.id });
  floater(g, x, y - 26, gun.name + " dropped!", gun.tint);
}
function killEnemy(g: G, e: Enemy) {
  g.kills++; sfx.die();
  if (g.comboTimer > 0) g.combo++; else g.combo = 1;
  g.comboTimer = CROWNFALL.comboWindowSec;
  if (g.combo > g.bestCombo) g.bestCombo = g.combo;
  /* the combo MULTIPLIER: this kill scores 10 × mult; the excess
     over the base 10 accrues as combo bonus (≤ 40 per kill). */
  const mult = crownfallComboMult(g.combo);
  if (mult > 1) g.comboBonus += (mult - 1) * CROWNFALL.killPoints;
  if (g.combo >= 2) floater(g, e.x, e.y - 20, "Combo ×" + mult, "#c49a22");
  /* kill-streak callouts at chain 5 / 10 / 20 */
  if (g.combo === 5) g.callout = { text: "ON A TEAR", t: 0 };
  else if (g.combo === 10) g.callout = { text: "RAMPAGE", t: 0 };
  else if (g.combo === 20) g.callout = { text: "UNSTOPPABLE", t: 0 };
  if (e.type === "boss") g.shake = Math.max(g.shake, 14);
  burst(g, e.x, e.y, "#f0c94f", e.type === "boss" ? 42 : 16, 190);
  burst(g, e.x, e.y, "#e5484d", 8, 130);
  if (e.type === "boss") g.bossKills++;
  /* MP: drops are rolled by the server and arrive as coin.spawn
     events — the local drop table below is solo-only. */
  if (!g.mp) {
    const dropMul = g.event === "jackpot" ? 2 : 1;
    if (e.type === "boss") {
      dropCoins(g, e.x, e.y, 2 * dropMul);
      dropGunPickup(g, e.x, e.y + 16); /* the boss ALWAYS drops a gun (while any remain) */
      /* a small coin fountain where the Usurper fell */
      burst(g, e.x, e.y - 10, "#f0c94f", 22, 260);
      burst(g, e.x, e.y - 10, "#fff3c4", 10, 190);
    } else if (e.elite) {
      dropCoins(g, e.x, e.y, 2 * dropMul);
      if (Math.random() < 0.25) dropGunPickup(g, e.x, e.y);
      if (Math.random() < 0.18 && !g.P.shield) {
        g.pickups.push({ x: e.x - 16, y: e.y + 10, r: 11, kind: "shield", bob: Math.random() * 6.28 });
      }
    } else if (Math.random() < (g.event === "ambush" ? 0.45 : 0.3)) {
      dropCoins(g, e.x, e.y, 1 * dropMul);
    }
    if (Math.random() < 0.12 && g.P.hp < g.P.maxhp) {
      g.pickups.push({ x: e.x + 14, y: e.y - 10, r: 10, kind: "heart", bob: 0 });
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
    /* the mouse lives in VIEW coordinates; the King in world ones */
    const dx = ma.x + g.cam.x - P.x, dy = ma.y + g.cam.y - P.y;
    const m = Math.sqrt(dx * dx + dy * dy);
    if (m > 10) { g.aim.on = true; g.aim.x = dx / m; g.aim.y = dy / m; return; }
  }
  g.aim.on = false;
}

/* ─── guns: switching never touches the fire rules ──────────────────── */
function switchGun(g: G, id: string) {
  const P = g.P;
  if (!P.guns.includes(id) || P.gun === id) return;
  P.gun = id;
  sfx.claim();
  floater(g, P.x, P.y - 30, crownfallGun(id).name, crownfallGun(id).tint);
  g.ui.hud();
}
function cycleGun(g: G, dir: number) {
  const P = g.P;
  if (P.guns.length < 2) return;
  const idx = P.guns.indexOf(P.gun);
  const next = P.guns[((idx + dir) % P.guns.length + P.guns.length) % P.guns.length]!;
  switchGun(g, next);
}

function fireBolts(g: G) {
  const P = g.P;
  if (!g.aim.on) return; /* no aim, no shots — the player's call alone */
  const gun = crownfallGun(P.gun);
  const base = Math.atan2(g.aim.y, g.aim.x);
  P.faceX = Math.cos(base); P.faceY = Math.sin(base);
  sfx.shoot();
  burst(g, P.x + Math.cos(base) * 20, P.y + Math.sin(base) * 20, gun.tint, 2, 60);
  /* streams: the multishot upgrade adds parallel streams of the
     gun's own pattern; Triple Upload fans a single-stream gun */
  let shots: number[] = [];
  for (let k = 0; k < P.multishot; k++) shots.push(P.multishot === 1 ? 0 : (k - (P.multishot - 1) / 2) * 0.14);
  if (P.spread) { if (shots.length === 1) shots = [-0.22, 0, 0.22]; else shots = shots.concat([-0.24, 0.24]); }
  const dmg = P.dmg * gun.dmgMul;
  const life = gun.range > 0 ? gun.range / gun.boltSpeed : Infinity;
  const kind: Bolt["kind"] = gun.splash > 0 ? "shell" : gun.id === "rail" ? "rail" : "bolt";
  const push = (a: number, px: number, py: number) => {
    g.bolts.push({
      x: P.x + Math.cos(a) * 18 + px, y: P.y + Math.sin(a) * 18 + py,
      vx: Math.cos(a) * gun.boltSpeed, vy: Math.sin(a) * gun.boltSpeed,
      r: gun.boltR, dmg, pierceLeft: gun.pierce + (P.pierce ? 2 : 0), hit: [],
      life, splash: gun.splash, kind, tint: gun.tint,
    });
  };
  for (const off of shots) {
    const a = base + off;
    if (gun.pattern === "twin") {
      /* two parallel bolts, offset across the aim axis */
      const px = Math.cos(a + Math.PI / 2), py = Math.sin(a + Math.PI / 2);
      push(a, px * 7, py * 7);
      push(a, px * -7, py * -7);
    } else if (gun.pattern === "scatter") {
      for (const fan of [-0.34, -0.17, 0, 0.17, 0.34]) push(a + fan, 0, 0);
    } else {
      push(a, 0, 0);
    }
  }
}

/* Crown Mortar blast: full damage to every foe inside the radius.
   Kills reap through the same path as bolt kills. */
function explode(g: G, x: number, y: number, radius: number, dmg: number) {
  sfx.boom();
  g.shake = Math.max(g.shake, 7);
  burst(g, x, y, "#ff9a3c", 18, 240);
  burst(g, x, y, "#f0c94f", 10, 170);
  for (let j = g.enemies.length - 1; j >= 0; j--) {
    const e = g.enemies[j]!;
    if (dist2(x, y, e.x, e.y) < (radius + e.r) * (radius + e.r)) {
      /* MP: the blast is reported like any other hit — the server
         adjudicates; local HP is visual only and never reaches 0
         here, so the kill line below stays solo-only in effect. */
      if (g.mp) {
        g.mp.reportHit(e.id, dmg, e.x, e.y);
        e.hp = Math.max(1, e.hp - dmg);
      } else {
        e.hp -= dmg;
      }
      e.flash = 0.16;
      floater(g, e.x + (Math.random() * 14 - 7), e.y - e.r - 6, "" + Math.round(dmg), "#ffb08a");
      if (e.hp <= 0) { g.enemies.splice(j, 1); killEnemy(g, e); }
    }
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
  e.thornT = Math.max(0, e.thornT - dt);
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
  } else if (e.type === "charger") {
    /* GLITCH CHARGER: stalks, PAUSES to telegraph (locking its line
       — dodge sideways), then charges in a straight line. */
    e.t -= dt;
    if (e.state === "stalk") {
      moveCircle(g, e, ux * e.speed * dt, uy * e.speed * dt);
      if (d < 340 && e.t <= 0) { e.state = "tele"; e.t = 0.55; e.lockX = ux; e.lockY = uy; }
    } else if (e.state === "tele") {
      e.lockX = ux; e.lockY = uy; /* tracks while winding up, like the Troll */
      if (e.t <= 0) { e.state = "charge"; e.t = 0.52; burst(g, e.x, e.y, "#67e8f9", 6, 120); }
    } else if (e.state === "charge") {
      moveCircle(g, e, e.lockX * 470 * dt, e.lockY * 470 * dt);
      if (e.t <= 0) { e.state = "rest"; e.t = 0.8; }
    } else { /* rest */
      if (e.t <= 0) { e.state = "stalk"; e.t = 0.5; }
    }
  } else if (e.type === "spambot") {
    /* SPAM SLINGER: holds ~300px, strafes, and lobs SLOW bolts the
       King can dodge — or dash straight through. Player bolts and
       enemy bolts never interact (no cancel rule, by design). */
    const want = 300;
    const radial = d > want + 30 ? 1 : d < want - 30 ? -1 : 0;
    const strafe = Math.sin(e.wob * 0.5) > 0 ? 1 : -1;
    mx = ux * radial + -uy * strafe * 0.6;
    my = uy * radial + ux * strafe * 0.6;
    const ml3 = Math.sqrt(mx * mx + my * my) || 1;
    moveCircle(g, e, (mx / ml3) * e.speed * dt, (my / ml3) * e.speed * dt);
    e.fireT -= dt;
    if (e.fireT <= 0 && d < 520) { enemyShoot(g, e, 185, 9 + crownfallContactBonus(g.depth), 0); e.fireT = 2.3; }
  } else if (e.type === "boss") {
    /* THE USURPER, harder every cycle (cycle = ⌊floor/5⌋): cycle 2+
       summons minion waves at ⅔ and ⅓ HP (2 per wave, 3 per wave
       from cycle 4 — never more than 6 extra foes); cycle 3+ fires
       a 3-bolt spread instead of a single bolt; cycle 4+ also moves
       20% faster (applied at spawn). */
    const cycle = crownfallBossCycle(g.depth);
    e.t -= dt;
    e.fireT -= dt;
    /* MP: summons stay solo-only in v1 — the referee's roster is the
       floor's opening line-up and has no registration path for
       mid-fight arrivals (their local ids could also collide with
       roster ids after deaths splice the array). The party boss
       keeps its spread-shot cycles; it just calls no court. */
    if (!g.mp && cycle >= 2 && e.summons < 2) {
      const frac = e.hp / e.maxhp;
      const threshold = e.summons === 0 ? 2 / 3 : 1 / 3;
      if (frac <= threshold) {
        e.summons++;
        const perWave = cycle >= 4 ? 3 : 2;
        for (let s2 = 0; s2 < perWave; s2++) g.spawnQueue.push("chaser");
        floater(g, e.x, e.y - e.r - 16, "The Usurper calls his court!", "#ff8a7a");
        burst(g, e.x, e.y, "#e5484d", 14, 180);
      }
    }
    if (e.state === "stalk") {
      moveCircle(g, e, ux * e.speed * dt, uy * e.speed * dt);
      if (e.t <= 0 && d < 430) { e.state = "aim"; e.t = 0.45; e.lockX = ux; e.lockY = uy; }
      if (e.fireT <= 0) {
        enemyShoot(g, e, 285, 12, 0, T.x, T.y);
        if (cycle >= 3) { enemyShoot(g, e, 285, 12, 0.3, T.x, T.y); enemyShoot(g, e, 285, 12, -0.3, T.x, T.y); }
        e.fireT = 2.3;
      }
    } else if (e.state === "aim") {
      e.lockX = ux; e.lockY = uy;
      if (e.t <= 0) { e.state = "lunge"; e.t = 0.5; burst(g, e.x, e.y, "#e5484d", 8, 120); }
    } else if (e.state === "lunge") {
      moveCircle(g, e, e.lockX * 480 * dt, e.lockY * 480 * dt);
      if (e.t <= 0) {
        e.state = "stalk"; e.t = 2.6 + Math.random() * 1.4;
        /* the slam landing: dust + a shake the room feels (no extra
           damage — contact rules are contact rules) */
        if (d < 230) { g.shake = Math.max(g.shake, 9); sfx.slam(); }
        burst(g, e.x, e.y + e.r * 0.6, "#cbb98f", 10, 130);
      }
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
     tracks the party target, which may be somebody else's King).
     The Thorn Sash hurts back on that same local contact. */
  const pd = Math.sqrt(dist2(e.x, e.y, P.x, P.y));
  if (pd < e.r + P.r - 2) {
    if (P.thorn > 0 && e.thornT <= 0 && e.type !== "boss") {
      if (g.mp) {
        /* MP: thorn damage is reported like any other hit — the
           server adjudicates; local HP is visual only and never
           reaches 0 here. */
        g.mp.reportHit(e.id, P.thorn, e.x, e.y);
        e.hp = Math.max(1, e.hp - P.thorn);
      } else {
        e.hp -= P.thorn;
      }
      e.thornT = 0.4;
      e.flash = Math.max(e.flash, 0.1);
      burst(g, e.x, e.y, "#c49a22", 3, 110);
      floater(g, e.x, e.y - e.r - 4, "" + Math.round(P.thorn), "#e8cf8e");
      /* a thorn kill reaps in update()'s foe loop, not mid-brain */
    }
    damagePlayer(g, e.dmg, bg);
  }
}

/* ─── upgrades + the between-floor SHOP ─────────────────────────────────
   The upgrade offer is now a shop (owner, Nov 10): three priced
   upgrade cards plus the gun rack, paid from the coin purse. Prices
   live in lib/arcade-games.ts (upgrade prices scale +5%/floor; guns
   are flat). Buying applies at once and the shop STAYS OPEN — buy
   as many as you can afford; DESCEND is a separate, always-free
   action, so a broke King is never trapped. Unaffordable items
   stay visible with their price and the exact shortfall. */
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
  { id: "dash2", name: "Dash Recharge", desc: "Dash recharges 30% faster still. In, out, untouchable.", apply: (p) => { p.dashCdMax *= 0.7; } },
  { id: "twin", name: "Twin Bolts", desc: "Fire one extra bolt stream with every shot.", apply: (p) => { p.multishot += 1; } },
  { id: "spread", name: "Triple Upload", desc: "Spread shot: bolts fan out in a triple burst.", apply: (p) => { p.spread = true; } },
  { id: "pierce", name: "Royal Pierce", desc: "Bolts pierce through two extra foes.", apply: (p) => { p.pierce = true; } },
  { id: "magnet", name: "Bucs Magnet", desc: "Coins pull in from much farther away.", apply: (p) => { p.magnet = Math.max(p.magnet, 165); } },
  { id: "magnet2", name: "Coin Magnet+", desc: "A royal treasury pull: coins fly in from across the room.", apply: (p) => { p.magnet = Math.max(p.magnet, 235); } },
  { id: "thorn", name: "Thorn Sash", desc: "The King's sash bites back: foes that touch him take damage.", apply: (p) => { p.thorn = 9; } },
  { id: "secondwind", name: "Second Wind", desc: "Once per run, death itself gets refused: revive at 50% HP.", apply: (p) => { p.secondWind = true; } },
];
/* One-time upgrades leave the offer pool once they are in effect —
   the shop never sells a King a second copy of what he already has. */
function upgradeOfferable(g: G, u: UpgradeDef): boolean {
  const P = g.P;
  if (u.id === "spread") return !P.spread;
  if (u.id === "pierce") return !P.pierce;
  if (u.id === "magnet") return P.magnet < 165;
  if (u.id === "magnet2") return P.magnet < 235;
  if (u.id === "thorn") return P.thorn <= 0;
  if (u.id === "secondwind") return !P.secondWind;
  return true;
}
function purseTotal(g: G) {
  return g.purse + g.scrip;
}
/* Spending burns SCRIP first: score coins are spent only after the
   never-converting bucket is gone, so shopping hurts score least. */
function spendPurse(g: G, price: number) {
  const fromScrip = Math.min(g.scrip, price);
  g.scrip -= fromScrip;
  g.purse -= price - fromScrip;
}
function buildShopSnap(g: G): ShopSnap {
  const P = g.P;
  const total = purseTotal(g);
  const items: ShopItemSnap[] = [];
  for (const u of g.upgradePicks) {
    const price = crownfallUpgradePrice(u.id, g.depth);
    items.push({
      key: "up-" + u.id, kind: "upgrade", id: u.id, name: u.name, desc: u.desc,
      price, affordable: total >= price, shortfall: Math.max(0, price - total),
      owned: false, equipped: false,
    });
  }
  for (const gun of CROWNFALL_GUNS) {
    const owned = P.guns.includes(gun.id);
    items.push({
      key: "gun-" + gun.id, kind: "gun", id: gun.id, name: gun.name, desc: gun.desc,
      price: gun.price,
      affordable: owned || total >= gun.price,
      shortfall: owned ? 0 : Math.max(0, gun.price - total),
      owned, equipped: P.gun === gun.id, tint: gun.tint,
    });
  }
  items.push({
    key: "descend", kind: "descend", id: "descend",
    name: "Descend to Floor " + (g.depth + 1),
    desc: "Free — always. The deep isn't going anywhere.",
    price: 0, affordable: true, shortfall: 0, owned: false, equipped: false,
  });
  return { purse: g.purse, scrip: g.scrip, total, depth: g.depth, items };
}
function shopItemCount(g: G) {
  return g.upgradePicks.length + CROWNFALL_GUNS.length + 1;
}
function setShopHighlight(g: G, i: number) {
  const n = shopItemCount(g);
  if (!n) return;
  g.shopIndex = ((i % n) + n) % n;
  g.ui.highlight(g.shopIndex);
}
function refreshShop(g: G) {
  g.shopIndex = clamp(g.shopIndex, 0, Math.max(0, shopItemCount(g) - 1));
  g.ui.shop(buildShopSnap(g));
  g.ui.highlight(g.shopIndex);
  g.ui.hud();
}
function openShop(g: G) {
  const pool = UPGRADES.filter((u) => upgradeOfferable(g, u));
  g.upgradePicks = [];
  while (g.upgradePicks.length < 3 && pool.length) {
    g.upgradePicks.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]!);
  }
  g.shopIndex = 0;
  g.ui.shop(buildShopSnap(g));
  g.ui.highlight(0);
}
function descend(g: G) {
  if (g.phase !== "upgrade") return;
  g.upgradePicks = [];
  /* The next floor was already generated and walked into during the
     door passage — descending simply starts the fight there. */
  g.phase = "playing";
  g.ui.phase("playing");
  g.ui.shop(null);
  g.ui.hud();
}
function shopActivate(g: G, idx: number, _bg: HTMLCanvasElement | null) {
  if (g.phase !== "upgrade") return;
  const snap = buildShopSnap(g);
  const item = snap.items[clamp(idx, 0, snap.items.length - 1)];
  if (!item) return;
  g.shopIndex = clamp(idx, 0, snap.items.length - 1);
  if (item.kind === "descend") { descend(g); return; }
  if (item.kind === "gun") {
    if (item.owned) { switchGun(g, item.id); refreshShop(g); return; }
    if (!item.affordable) {
      g.ui.msg(item.name + " costs " + item.price + " — you need " + item.shortfall + " more coins.");
      return;
    }
    spendPurse(g, item.price);
    g.P.guns.push(item.id);
    g.P.gun = item.id; /* a bought gun equips on purchase */
    sfx.buy();
    g.ui.msg(item.name + " — yours. Equipped.");
    refreshShop(g);
    return;
  }
  /* upgrade card */
  const u = g.upgradePicks.find((x) => x.id === item.id);
  if (!u) { refreshShop(g); return; }
  if (!item.affordable) {
    g.ui.msg(item.name + " costs " + item.price + " — you need " + item.shortfall + " more coins. Descending is free.");
    return;
  }
  spendPurse(g, item.price);
  sfx.buy();
  u.apply(g.P);
  g.upgradePicks = g.upgradePicks.filter((x) => x !== u);
  g.ui.msg(item.name + " — bought for " + item.price + " coins.");
  refreshShop(g);
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
  const camFromX = g.cam.x, camFromY = g.cam.y;
  g.depth++;
  g.phase = "transit";
  g.ui.phase("transit");
  genFloor(g, g.depth, bgAlt); /* also snaps g.cam to the NEW room's entrance */
  g.transit = {
    t: 0, fromX, fromY, camY: 0, kingX: fromX - camFromX, kingY: fromY - camFromY,
    done: false, snapObstacles, snapPickups,
    camFromX, camFromY,
    camDoorX: clamp(LW / 2 - VW / 2, 0, LW - VW), camDoorY: 0,
    viewCamX: camFromX, viewCamY: camFromY,
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
    /* the old room's camera glides to centre the door while the
       King's WORLD position walks to it; his screen position is the
       difference — the same visible walk as v1, on a bigger stage */
    const camX = tr.camFromX + (tr.camDoorX - tr.camFromX) * e;
    const camY2 = tr.camFromY + (tr.camDoorY - tr.camFromY) * e;
    tr.viewCamX = camX; tr.viewCamY = camY2;
    const wx = tr.fromX + (LW / 2 - tr.fromX) * e;
    const wy = tr.fromY + (WALL + 6 - tr.fromY) * e;
    tr.kingX = wx - camX;
    tr.kingY = wy - camY2;
    return;
  }
  tr.viewCamX = tr.camDoorX; tr.viewCamY = tr.camDoorY;
  const k = clamp((tr.t - TRANSIT_WALK_SEC) / TRANSIT_SLIDE_SEC, 0, 1);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; /* easeInOutCubic */
  tr.camY = e * VH;
  tr.kingX = LW / 2 - tr.camDoorX;
  const doorScreenY = WALL + 6 - tr.camDoorY;
  const spawnScreenY = (LH - 110) - g.cam.y;
  tr.kingY = doorScreenY + (spawnScreenY - doorScreenY) * e;
  if (k >= 1) {
    g.transit = null;
    g.bgSwap = true; /* the component now treats the spare bg as current */
    g.P.x = LW / 2; g.P.y = LH - 110; /* genFloor's entrance, exactly */
    camSnapToPlayer(g);
    g.phase = "upgrade";
    g.ui.phase("upgrade");
    g.ui.intro(g.depth, { name: crownfallFloorName(g.depth), event: g.event, boss: g.depth % 5 === 0 });
    openShop(g);
    g.ui.hud();
  }
}

/* ─── run flow ────────────────────────────────────────────────────────── */
function startRun(g: G, bg: HTMLCanvasElement | null) {
  /* MP: a run starts only on the server's word (the tick consumes a
     start directive) — a death-screen restart inside a party room
     must never spin up a phantom local run. */
  if (g.mp && !g.mp.started) return;
  ensureAudio();
  g.meta = loadCrownfallMeta();
  /* MP: the seed is the room's — every King in the party generates
     the identical descent from it. */
  g.runSeed = g.mp ? g.mp.seed : ((Math.random() * 1000000000) | 0);
  g.depth = 1; g.crowns = 0; g.kills = 0;
  g.purse = 0; g.scrip = 0; g.mpPurseSeen = 0;
  g.bossKills = 0; g.callout = null; g.fountainT = 0; g.spawnQueue = [];
  /* the Royal Bounty: the first run of the day starts +50 scrip
     (shop money only — scrip never converts to score) */
  const bounty = claimRoyalBounty(g.meta, todayLocal());
  if (bounty.granted > 0) {
    g.scrip += bounty.granted;
    g.meta = bounty.meta;
    saveCrownfallMeta(g.meta);
  }
  g.combo = 0; g.comboTimer = 0; g.bestCombo = 0; g.comboBonus = 0; g.runTime = 0;
  g.paused = false; g.afterimages = [];
  g.mpDown = false; g.mpRevive = false;
  g.overFired = false;
  g.P = newPlayer(g.meta.tier);
  g.phase = "playing";
  g.ui.paused(false);
  g.ui.phase("playing");
  genFloor(g, 1, bg);
  if (bounty.granted > 0) g.ui.msg("Royal Bounty: +" + bounty.granted + " purse coins for today's first run!");
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
  /* the leftover purse converts NOW — and only now — at +25/coin */
  const sc = finalScoreOf(g);
  const isSessionBest = sc > g.sessionBest.score;
  if (isSessionBest) g.sessionBest.score = sc;
  g.sessionBest.depth = Math.max(g.sessionBest.depth, g.depth);
  /* fold the run into the lifetime meta (achievements ride along) */
  const before = g.meta;
  const recorded = recordRunInMeta(before, { kills: g.kills, depth: g.depth, bossKills: g.bossKills });
  const newly = recorded.achievements.filter((a) => !before.achievements.includes(a));
  g.meta = recorded;
  saveCrownfallMeta(recorded);
  if (g.bossKills > 0) g.fountainT = 1.8; /* the win flourish: a coin fountain */
  sfx.sting();
  g.ui.phase("dead");
  g.ui.death({
    depth: g.depth, crowns: g.purse, kills: g.kills, score: sc,
    bestCombo: g.bestCombo, timeSec: g.runTime,
    bossDeath: g.boss !== null || g.depth % 5 === 0,
    isSessionBest,
    coinScore: g.purse * CROWNFALL.coinPoints,
    armory: g.P.guns.map((id) => crownfallGun(id).name),
    bossKills: g.bossKills,
    prestigeTier: recorded.tier,
    canPrestige: g.bossKills > 0 && recorded.tier < PRESTIGE_TIER_CAP,
    achievementsNew: newly,
    achievementsAll: recorded.achievements,
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

  /* ── tallies are the server's: fold new earnings into the purse ──
     The server tally is a running total, so only the DELTA over the
     last tally seen is new money — it lands in the same purse the
     shop spends from, and a spend is never refunded by a sync. (A
     resync restarts the run state locally, so the full tally folds
     back in — the server's total is the floor the purse returns
     to.) Kills sync outright: the server's count is the truth. */
  if (mp.myPurse > g.mpPurseSeen) {
    const gained = mp.myPurse - g.mpPurseSeen;
    g.mpPurseSeen = mp.myPurse;
    g.purse += gained;
    if (g.phase === "playing") {
      sfx.crown();
      floater(g, g.P.x, g.P.y - 24, "+" + gained + (gained === 1 ? " coin" : " coins"), "#c49a22");
    }
  }
  g.crowns = g.purse;
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
  if (g.callout) {
    g.callout.t += dt;
    if (g.callout.t > 1.5) g.callout = null;
  }
  /* run-end flourish: a boss-beating run ends in a coin fountain
     over the fallen King (particles keep drifting in "dead") */
  if (g.phase === "dead" && g.fountainT > 0) {
    g.fountainT -= dt;
    if (g.parts.length < PARTICLE_CAP - 4) {
      const a = Math.random() * 6.283, r = 12 + Math.random() * 26;
      g.parts.push({
        x: g.P.x + Math.cos(a) * r, y: g.P.y - 6, vx: Math.cos(a) * 30,
        vy: -190 - Math.random() * 150, life: 0, max: 0.9 + Math.random() * 0.5,
        color: Math.random() < 0.7 ? "#f0c94f" : "#fff3c4", size: 2.6 + Math.random() * 2.4,
      });
    }
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
    /* the prestige gold trail: deeper tiers shed a richer aura
       behind a moving King (power + status, made visible) */
    if (g.meta.tier > 0 && g.parts.length < PARTICLE_CAP && Math.random() < 0.14 + g.meta.tier * 0.05) {
      g.parts.push({
        x: P.x + (Math.random() - 0.5) * 16, y: P.y + 12 + Math.random() * 8,
        vx: -ix * 26, vy: 12, life: 0, max: 0.4 + g.meta.tier * 0.03,
        color: "#f0c94f", size: 1.8 + g.meta.tier * 0.22,
      });
    }
  }

  /* ---- the camera: eased follow, clamped to the room ---- */
  {
    const tx = clamp(P.x - VW / 2, 0, LW - VW);
    const ty = clamp(P.y - VH / 2, 0, LH - VH);
    const ease = 1 - Math.pow(0.0001, dt); /* smooth, frame-rate independent */
    g.cam.x += (tx - g.cam.x) * ease;
    g.cam.y += (ty - g.cam.y) * ease;
  }

  /* ---- manual fire: bolts fly only while the player aims ---- */
  resolveAim(g);
  if (g.aim.on) { P.faceX = g.aim.x; P.faceY = g.aim.y; }
  g.fireTimer -= dt;
  if (g.fireTimer <= 0) {
    if (g.aim.on && g.enemies.length) { fireBolts(g); g.fireTimer = 1 / (P.fireRate * crownfallGun(P.gun).rateMul); }
    else g.fireTimer = 0; /* ready the instant aim is given */
  }

  /* ---- player bolts ---- */
  for (i = g.bolts.length - 1; i >= 0; i--) {
    const b = g.bolts[i]!;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.life !== Infinity) {
      b.life -= dt;
      if (b.life <= 0) {
        if (b.splash > 0) explode(g, b.x, b.y, b.splash, b.dmg);
        g.bolts.splice(i, 1);
        continue;
      }
    }
    if (boltBlocked(g, b.x, b.y)) {
      if (b.splash > 0) explode(g, b.x, b.y, b.splash, b.dmg);
      g.bolts.splice(i, 1);
      continue;
    }
    for (let j = 0; j < g.enemies.length; j++) {
      const e = g.enemies[j]!;
      if (b.hit.indexOf(e) >= 0) continue;
      if (dist2(b.x, b.y, e.x, e.y) < (e.r + b.r) * (e.r + b.r)) {
        if (b.splash > 0) {
          /* a mortar shell detonates on first contact — the blast,
             not the shell, does the work */
          explode(g, b.x, b.y, b.splash, b.dmg);
          g.bolts.splice(i, 1);
          break;
        }
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

  /* ---- enemies (backwards: the Thorn Sash reaps its kills here) ---- */
  for (i = g.enemies.length - 1; i >= 0; i--) {
    const e = g.enemies[i]!;
    updateEnemy(g, e, dt, bg);
    if (e.hp <= 0 && g.enemies.indexOf(e) >= 0) {
      g.enemies.splice(g.enemies.indexOf(e), 1);
      killEnemy(g, e);
    }
    if (g.phase !== "playing") return; /* the King fell mid-loop */
  }
  /* boss summons arrive outside the foe loop */
  while (g.spawnQueue.length) {
    const t = g.spawnQueue.shift()!;
    if (g.boss && g.addEnemyAt) {
      g.addEnemyAt(t, g.boss.x + (Math.random() - 0.5) * 190, g.boss.y + (Math.random() - 0.5) * 150);
    }
  }
  /* the Usurper's aura: a slow burn of red sparks while he lives */
  if (g.boss && Math.random() < 0.3) {
    const a = Math.random() * 6.283;
    burst(g, g.boss.x + Math.cos(a) * g.boss.r, g.boss.y + Math.sin(a) * g.boss.r, "#e5484d", 1, 40);
  }

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
    const magnetR = pk.kind === "crown" || pk.kind === "scrip" ? P.magnet : 74;
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
          /* into the PURSE — score only when the run ends unspent.
             (MP: the claim above is all this screen does — the server
             credits the winner's purse and the tick folds the new
             tally into the local purse.) */
          g.purse++; sfx.crown();
          floater(g, P.x, P.y - 24, "+1 coin", "#c49a22");
          burst(g, pk.x, pk.y, "#f0c94f", 12, 140);
          burst(g, pk.x, pk.y, "#fff3c4", 5, 90);
        }
      } else if (pk.kind === "scrip") {
        g.scrip++; sfx.crown();
        floater(g, P.x, P.y - 24, "+1 scrip", "#7ad9c2");
        burst(g, pk.x, pk.y, "#7ad9c2", 8, 120);
      } else if (pk.kind === "shield") {
        P.shield = true; sfx.shieldPop();
        floater(g, P.x, P.y - 24, "SHIELD UP", "#8ae2ff");
        burst(g, pk.x, pk.y, "#8ae2ff", 10, 130);
      } else if (pk.kind === "gun" && pk.gunId) {
        /* claim the dropped gun into the arsenal — and equip it */
        if (!P.guns.includes(pk.gunId)) P.guns.push(pk.gunId);
        P.gun = pk.gunId;
        sfx.claim();
        floater(g, P.x, P.y - 28, crownfallGun(pk.gunId).name + "!", crownfallGun(pk.gunId).tint);
        burst(g, pk.x, pk.y, crownfallGun(pk.gunId).tint, 16, 160);
        g.ui.msg(crownfallGun(pk.gunId).name + " claimed and equipped.");
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
  /* the sash's loose end — a cloak tail that sways as he moves */
  const swayTail = Math.sin(g.timeNow * (4.2 + (P.moveMag || 0) * 5)) * (1.6 + (P.moveMag || 0) * 2.6);
  ctx.fillStyle = "#57101b";
  ctx.beginPath();
  ctx.moveTo(-6, 12);
  ctx.quadraticCurveTo(-11 + swayTail * 0.4, 17, -13 + swayTail, 23);
  ctx.quadraticCurveTo(-7 + swayTail * 0.5, 19, -1, 14.5);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(196,154,34,0.7)"; ctx.lineWidth = 0.9; ctx.stroke();
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
  /* prestige aura: a gold ring under the King that deepens per tier */
  if (g.meta.tier > 0 && ox === undefined) {
    ctx.save();
    ctx.strokeStyle = "rgba(240,201,79," + (0.25 + g.meta.tier * 0.05) + ")";
    ctx.lineWidth = 1.6 + g.meta.tier * 0.22;
    ctx.beginPath(); ctx.ellipse(P.x, P.y + 39, 30 + g.meta.tier * 1.1, 9.5, 0, 0, 6.283); ctx.stroke();
    ctx.restore();
  }
  drawKingSprite(g, ctx, ox ?? P.x, oy ?? P.y, 1.35, blink ? 0.35 : 1);
  /* the bubble shield, while held: one hit lives in this ring */
  if (P.shield && ox === undefined) {
    ctx.save();
    const pulse = 0.75 + Math.sin(g.timeNow * 4) * 0.25;
    const sg = ctx.createRadialGradient(P.x, P.y, P.r + 4, P.x, P.y, P.r + 16);
    sg.addColorStop(0, "rgba(138,226,255,0)");
    sg.addColorStop(0.8, "rgba(138,226,255," + 0.13 * pulse + ")");
    sg.addColorStop(1, "rgba(138,226,255,0)");
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(P.x, P.y, P.r + 16, 0, 6.283); ctx.fill();
    ctx.strokeStyle = "rgba(138,226,255," + 0.65 * pulse + ")"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(P.x, P.y, P.r + 9, 0, 6.283); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath(); ctx.arc(P.x - 12, P.y - 16, 2.4, 0, 6.283); ctx.fill();
    ctx.restore();
  }
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
  /* walk bob — every foe but the boss moves with a little life */
  if (e.type !== "boss") ctx.translate(0, Math.sin(g.timeNow * 9 + e.wob * 2) * 1.6);
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
  } else if (e.type === "charger") {
    /* GLITCH CHARGER — a violet shard with chevron gills; its
       telegraph paints the charge line so the dodge is fair */
    if (e.state === "tele") {
      ctx.save();
      ctx.rotate(Math.atan2(e.lockY, e.lockX));
      ctx.strokeStyle = Math.floor(g.timeNow * 12) % 2 === 0 ? "rgba(255,80,90,0.75)" : "rgba(255,190,80,0.6)";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(e.r + 4, 0); ctx.lineTo(330, 0); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,80,90,0.9)"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, 0, e.r + 6 + Math.sin(g.timeNow * 30) * 1.6, 0, 6.283); ctx.stroke();
    }
    if (e.state === "charge") {
      /* speed streaks behind the shard */
      ctx.strokeStyle = "rgba(167,139,250,0.55)"; ctx.lineWidth = 2.4;
      const back = Math.atan2(e.lockY, e.lockX) + Math.PI;
      for (const off of [-7, 0, 7]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(back) * e.r + Math.cos(back + Math.PI / 2) * off, Math.sin(back) * e.r + Math.sin(back + Math.PI / 2) * off);
        ctx.lineTo(Math.cos(back) * (e.r + 22) + Math.cos(back + Math.PI / 2) * off, Math.sin(back) * (e.r + 22) + Math.sin(back + Math.PI / 2) * off);
        ctx.stroke();
      }
    }
    const shardG = ctx.createLinearGradient(0, -e.r, 0, e.r);
    shardG.addColorStop(0, flash ? "#e9d5ff" : "#7c3aed"); shardG.addColorStop(1, flash ? "#c4b5fd" : "#3b1173");
    ctx.fillStyle = shardG;
    ctx.beginPath();
    const pts = 7;
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * 6.283 + e.wob * 0.2;
      const rr = e.r * (i % 2 ? 0.7 : 1.14);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = flash ? "#ffffff" : "#a78bfa"; ctx.lineWidth = 1.6; ctx.stroke();
    /* chevron gills — it is a Glitch, but a faster breed */
    ctx.strokeStyle = "#e9d5ff"; ctx.lineWidth = 2;
    for (let ci = 0; ci < 2; ci++) {
      const cxo = -3 + ci * 6;
      ctx.beginPath(); ctx.moveTo(cxo - 3.4, -4); ctx.lineTo(cxo + 2.4, 0); ctx.lineTo(cxo - 3.4, 4); ctx.stroke();
    }
    ctx.fillStyle = "#ffdf6b";
    ctx.beginPath(); ctx.arc(6, -1, 2.6, 0, 6.283); ctx.fill();
  } else if (e.type === "spambot") {
    /* SPAM SLINGER — rust-orange bot, twin antennae, bolt tubes */
    const r = e.r;
    const bodyG2 = ctx.createLinearGradient(0, -r, 0, r);
    bodyG2.addColorStop(0, flash ? "#ffe1b8" : "#b35c17"); bodyG2.addColorStop(1, flash ? "#e8a558" : "#6e3408");
    ctx.fillStyle = bodyG2;
    ctx.beginPath(); ctx.roundRect(-r * 0.92, -r * 0.7, r * 1.84, r * 1.46, 5); ctx.fill();
    ctx.strokeStyle = OL; ctx.lineWidth = 1.5; ctx.stroke();
    for (const ax of [-r * 0.45, r * 0.45]) {
      ctx.strokeStyle = "#9aa3ab"; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(ax, -r * 0.7); ctx.lineTo(ax * 1.25, -r * 1.2); ctx.stroke();
      const on = Math.floor(g.timeNow * 3 + e.wob + ax) % 2 === 0;
      ctx.fillStyle = on ? "#ffb347" : "#7a4a12";
      ctx.beginPath(); ctx.arc(ax * 1.25, -r * 1.26, 2.8, 0, 6.283); ctx.fill();
    }
    /* the one big eye, tracking the King */
    ctx.fillStyle = "#170b02";
    ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.44, 0, 6.283); ctx.fill();
    const look2 = Math.atan2(P.y - e.y, P.x - e.x);
    ctx.fillStyle = "#ffb347";
    ctx.beginPath(); ctx.arc(Math.cos(look2) * 2.6, -r * 0.1 + Math.sin(look2) * 2.6, r * 0.19, 0, 6.283); ctx.fill();
    /* three bolt tubes — it slings from these */
    ctx.fillStyle = "#2b1606";
    for (let ti = -1; ti <= 1; ti++) {
      ctx.beginPath(); ctx.roundRect(ti * r * 0.42 - 3.2, r * 0.42, 6.4, r * 0.34, 2); ctx.fill();
    }
    ctx.fillStyle = "rgba(255,179,71,0.85)";
    ctx.font = "900 6.5px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("SPAM", 0, r * 0.32);
  } else if (e.type === "boss") {
    /* the Usurper's aura — a slow red burn around the stolen throne */
    const aura = 0.6 + Math.sin(g.timeNow * 2.6) * 0.25;
    const ag = ctx.createRadialGradient(0, 0, e.r * 0.7, 0, 0, e.r * 1.75);
    ag.addColorStop(0, "rgba(229,72,77," + 0.20 * aura + ")"); ag.addColorStop(1, "rgba(229,72,77,0)");
    ctx.fillStyle = ag;
    ctx.beginPath(); ctx.arc(0, 0, e.r * 1.75, 0, 6.283); ctx.fill();
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
  } else if (pk.kind === "scrip") {
    /* SCRIP coin: the same royal coin, ringed in teal — prestige's
       shop money, visibly NOT a score coin */
    ctx.shadowColor = "rgba(122,217,194,0.9)"; ctx.shadowBlur = 12;
    if (coinImg && coinImg.complete && coinImg.naturalWidth > 0) {
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, 6.283); ctx.clip();
      ctx.drawImage(coinImg, -11, -11, 22, 22);
    } else {
      const cg3 = ctx.createLinearGradient(0, -10, 0, 10);
      cg3.addColorStop(0, "#ffe98a"); cg3.addColorStop(1, "#c49a22");
      ctx.fillStyle = cg3; ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, 6.283); ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#2fae8f"; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(0, 0, 11.4, 0, 6.283); ctx.stroke();
    ctx.fillStyle = "#2fae8f";
    ctx.font = "900 8px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("S", 0, 8.5);
  } else if (pk.kind === "shield") {
    /* bubble shield pickup: a glass bubble with a shield heart */
    const pulse = 0.8 + Math.sin(g.timeNow * 4 + pk.bob) * 0.2;
    ctx.strokeStyle = "rgba(138,226,255," + 0.85 * pulse + ")"; ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(138,226,255,0.16)";
    ctx.beginPath(); ctx.arc(0, 0, 11.5, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#bdeaff";
    ctx.beginPath();
    ctx.moveTo(0, -6.4); ctx.lineTo(5.4, -4.2); ctx.lineTo(5.4, 0.6);
    ctx.quadraticCurveTo(5.4, 4.8, 0, 7); ctx.quadraticCurveTo(-5.4, 4.8, -5.4, 0.6);
    ctx.lineTo(-5.4, -4.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath(); ctx.arc(-4.4, -5.4, 2, 0, 6.283); ctx.fill();
  } else if (pk.kind === "gun") {
    /* a dropped gun: a dark case banded in the gun's own tint, its
       name floating over it — walk over it to claim */
    const gun = pk.gunId ? crownfallGun(pk.gunId) : null;
    const tint = gun ? gun.tint : "#f0c94f";
    ctx.shadowColor = tint; ctx.shadowBlur = 13;
    ctx.fillStyle = "#17130a";
    ctx.beginPath(); ctx.roundRect(-15, -9, 30, 18, 5); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = tint; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.moveTo(-6, 4.4); ctx.lineTo(1.4, -4.8); ctx.lineTo(3.4, -1.2); ctx.lineTo(7.4, -1.2); ctx.lineTo(0.6, 5.6); ctx.lineTo(-0.6, 1.2); ctx.lineTo(-4.6, 1.2);
    ctx.closePath(); ctx.fill();
    if (gun) {
      ctx.font = "700 8.5px sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = tint;
      ctx.fillText(gun.name.toUpperCase(), 0, -15);
    }
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
        const wy = o.y + mh / 2 + Math.sin(wi * 1.7 + seed + g.timeNow * 2.3) * mh * 0.22;
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

/* Draw ONE room (backdrop, walls, door, dressing, foes) in WORLD
   coordinates, viewed through the camera at (camX, camY). The
   caller owns clip — the transit passage draws two of these, the
   live game draws one. Screen shake is the caller's translate. */
function drawRoom(g: G, ctx: CanvasRenderingContext2D, room: RoomView, camX: number, camY: number) {
  const pal = PAL[g.theme];
  ctx.save();
  ctx.translate(-camX, -camY);
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

  /* player bolts — each gun tints and shapes its own fire */
  for (const b of room.bolts) {
    const trail = b.kind === "rail" ? 0.05 : 0.022;
    ctx.strokeStyle = b.tint; ctx.globalAlpha = 0.45; ctx.lineWidth = b.kind === "shell" ? 2 : 3;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * trail, b.y - b.vy * trail);
    ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = b.kind === "shell" ? "#ffb08a" : b.tint;
    ctx.shadowColor = b.tint; ctx.shadowBlur = b.kind === "shell" ? 14 : 10;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.283); ctx.fill();
    ctx.shadowBlur = 0;
    if (b.kind === "shell") {
      ctx.fillStyle = "#fff3c4";
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.45, 0, 6.283); ctx.fill();
    }
  }
  ctx.restore();
}

/* ─── view-space overlays: boss bar, minimap, vignette, callouts ────── */
function drawBossBar(g: G, ctx: CanvasRenderingContext2D) {
  const boss = g.boss;
  if (!boss || g.transit) return;
  const bw = 340, bx = VW / 2 - bw / 2, by = 14;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(bx - 3, by - 3, bw + 6, 15);
  ctx.fillStyle = "#5d0f13";
  ctx.fillRect(bx, by, bw, 9);
  ctx.fillStyle = "#e5484d";
  ctx.fillRect(bx, by, bw * clamp(boss.hp / boss.maxhp, 0, 1), 9);
  ctx.strokeStyle = "rgba(212,175,55,0.7)"; ctx.lineWidth = 1;
  ctx.strokeRect(bx - 3, by - 3, bw + 6, 15);
  ctx.fillStyle = "#f3e9d2";
  ctx.font = "700 11px Cinzel, serif";
  ctx.textAlign = "center";
  const cycle = crownfallBossCycle(g.depth);
  ctx.fillText(cycle > 1 ? "THE USURPER — CYCLE " + cycle : "THE USURPER", VW / 2, by + 24);
  ctx.restore();
}

function drawMinimap(g: G, ctx: CanvasRenderingContext2D) {
  if (g.phase !== "playing" && g.phase !== "transit") return;
  const mw = 128, mh = 128, mx = VW - mw - 10, my = 46;
  const sx = mw / LW, sy = mh / LH;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = g.theme === "dark" ? "rgba(8,8,10,0.82)" : "rgba(250,246,230,0.9)";
  ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, 6); ctx.fill();
  ctx.strokeStyle = "rgba(212,175,55,0.65)"; ctx.lineWidth = 1.4; ctx.stroke();
  /* the camera's window on the world */
  ctx.strokeStyle = "rgba(240,201,79,0.35)"; ctx.lineWidth = 1;
  ctx.strokeRect(mx + g.cam.x * sx, my + g.cam.y * sy, VW * sx, VH * sy);
  /* the golden door (top-centre of the world) */
  ctx.fillStyle = g.doorOpen ? "#ffe98a" : "#8a6d1f";
  ctx.fillRect(mx + (LW / 2) * sx - 6, my + 1.5, 12, 3.4);
  /* pickups */
  for (const pk of g.pickups) {
    ctx.fillStyle = pk.kind === "crown" ? "#f0c94f"
      : pk.kind === "scrip" ? "#7ad9c2"
      : pk.kind === "heart" ? "#ff8a9a"
      : pk.kind === "shield" ? "#8ae2ff" : "#ffffff";
    ctx.beginPath(); ctx.arc(mx + pk.x * sx, my + pk.y * sy, pk.kind === "gun" ? 3 : 2, 0, 6.283); ctx.fill();
  }
  /* foes */
  for (const e of g.enemies) {
    ctx.fillStyle = e.type === "boss" ? "#ff5347" : e.elite ? "#f0c94f" : "#e5484d";
    ctx.beginPath(); ctx.arc(mx + e.x * sx, my + e.y * sy, e.type === "boss" ? 4 : 2.4, 0, 6.283); ctx.fill();
  }
  /* the King */
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#f0c94f"; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(mx + g.P.x * sx, my + g.P.y * sy, 3.4, 0, 6.283); ctx.fill(); ctx.stroke();
  ctx.restore();
}

let vignetteCache: { theme: ThemeName; grad: CanvasGradient } | null = null;
function drawVignette(g: G, ctx: CanvasRenderingContext2D) {
  if (!vignetteCache || vignetteCache.theme !== g.theme) {
    const grad = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.44, VW / 2, VH / 2, VH * 0.8);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, PAL[g.theme].vign);
    vignetteCache = { theme: g.theme, grad };
  }
  ctx.fillStyle = vignetteCache.grad;
  ctx.fillRect(0, 0, VW, VH);
}

function drawCallout(g: G, ctx: CanvasRenderingContext2D) {
  const c = g.callout;
  if (!c) return;
  const t = c.t / 1.5;
  const alpha = t < 0.18 ? t / 0.18 : t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.font = "900 34px Cinzel, serif";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(20,12,2,0.85)";
  const y = VH * 0.3;
  ctx.strokeText(c.text, VW / 2, y);
  ctx.fillStyle = "#f0c94f";
  ctx.fillText(c.text, VW / 2, y);
  ctx.restore();
}

function render(g: G, ctx: CanvasRenderingContext2D, bg: HTMLCanvasElement | null, bgAlt: HTMLCanvasElement | null, scale: number) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, VW, VH);
  const shakeX = g.shake > 0 ? (Math.random() - 0.5) * g.shake : 0;
  const shakeY = g.shake > 0 ? (Math.random() - 0.5) * g.shake : 0;

  /* ── the door passage: two rooms, one sliding view, no teleport ── */
  if (g.transit) {
    const tr = g.transit;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, tr.camY, VW, VH - tr.camY); ctx.clip();
    ctx.translate(0, tr.camY);
    drawRoom(g, ctx, {
      bg, obstacles: tr.snapObstacles, pickups: tr.snapPickups, doorOpen: true,
      enemies: NO_ENEMIES, bolts: NO_BOLTS, ebolts: NO_EBOLTS, boss: null,
    }, tr.viewCamX, tr.viewCamY);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, VW, Math.max(0.001, tr.camY)); ctx.clip();
    ctx.translate(0, tr.camY - VH);
    drawRoom(g, ctx, {
      bg: bgAlt, obstacles: g.obstacles, pickups: g.pickups, doorOpen: g.doorOpen,
      enemies: g.enemies, bolts: NO_BOLTS, ebolts: NO_EBOLTS, boss: g.boss,
    }, g.cam.x, g.cam.y);
    ctx.restore();
    /* the King, walking the passage in screen space */
    drawKing(g, ctx, tr.kingX, tr.kingY);
    drawVignette(g, ctx);
    drawMinimap(g, ctx);
    return;
  }

  /* ── the live room, through the camera ── */
  ctx.save();
  ctx.translate(shakeX, shakeY);
  drawRoom(g, ctx, {
    bg, obstacles: g.obstacles, pickups: g.pickups, doorOpen: g.doorOpen,
    enemies: g.enemies, bolts: g.bolts, ebolts: g.ebolts, boss: g.boss,
  }, g.cam.x, g.cam.y);

  ctx.translate(-g.cam.x, -g.cam.y);
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
  ctx.restore(); /* back to view space */

  /* ── view-space overlays ── */
  drawBossBar(g, ctx);
  drawVignette(g, ctx);
  drawMinimap(g, ctx);
  drawCallout(g, ctx);
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
  const upEdge = padEdge(g, gp, 12), downEdge = padEdge(g, gp, 13);
  const lbEdge = padEdge(g, gp, 4), rbEdge = padEdge(g, gp, 5); /* LB / RB */

  if (g.phase === "transit") {
    /* the door passage locks input — edges are sampled above so a
       mashed button can't queue anything into the next room */
    g.padVec.x = 0; g.padVec.y = 0;
    return;
  }
  if (g.phase === "upgrade") {
    g.padVec.x = 0; g.padVec.y = 0;
    const stickDir = ax > 0.55 ? 1 : ax < -0.55 ? -1 : 0;
    if (leftEdge || rightEdge || upEdge || downEdge || (stickDir !== 0 && g.pad.navCd <= 0)) {
      const dir = leftEdge ? -1 : rightEdge ? 1 : upEdge ? -3 : downEdge ? 3 : stickDir;
      if (dir !== 0) { setShopHighlight(g, g.shopIndex + dir); g.pad.navCd = 0.28; }
    }
    if (faceEdge || menuEdge) shopActivate(g, g.shopIndex, bg);
    return;
  }
  if (g.paused) {
    if (menuEdge || faceEdge) togglePause(g);
    return;
  }
  if (g.phase === "playing") {
    if (menuEdge) { togglePause(g); return; }
    /* LB / RB cycle the arsenal — switching never adds auto-fire */
    if (lbEdge) cycleGun(g, -1);
    if (rbEdge) cycleGun(g, 1);
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
    case "magnet2": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><path d="M6 4v7a6 6 0 0 0 12 0V4" /><path d="M6 4h4v5H6zM14 4h4v5h-4z" /><path d="M12 15v6M9.5 18.5h5" /></svg>);
    case "dash2": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M21 3.5L17.2 7.4 13.6 5.2" /><path d="M10 9.5L8 13h3l-1.8 3.5" /></svg>);
    case "thorn": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><path d="M12 3l2 5 5-1.5L16 11l5 2-5 2 3 4.5L14 18l-2 5-2-5-5 1.5L8 15 3 13l5-2L5 6.5 10 8z" /></svg>);
    case "secondwind": return (<svg viewBox="0 0 24 24" className={cls} {...sw}><path d="M4 14c4-1 5-6 9-6 3 0 4 2 4 4" /><path d="M17 8v4h-4" /><path d="M4 19c5-1 6-5 11-5 2.4 0 4 1.2 5 3" /></svg>);
    default: return null;
  }
}

/* A gun's shop swatch: a bolt glyph in the gun's own tint. */
function GunSwatch({ id, tint }: { id: string; tint: string }) {
  const common = { fill: tint, stroke: "rgba(20,14,2,0.55)", strokeWidth: 0.8 } as const;
  switch (id) {
    case "twinfang": return (<svg viewBox="0 0 24 24" className="h-6 w-6"><polygon points="8,3 4,12 7,12 6,20 12,10 9,10" {...common} /><polygon points="16,5 12.5,12 15,12 14.2,19 19.5,11 16.6,11" {...common} /></svg>);
    case "scatter": return (<svg viewBox="0 0 24 24" className="h-6 w-6"><circle cx="12" cy="15" r="2" {...common} /><circle cx="5" cy="8" r="1.8" {...common} /><circle cx="9.5" cy="5.5" r="1.8" {...common} /><circle cx="14.5" cy="5.5" r="1.8" {...common} /><circle cx="19" cy="8" r="1.8" {...common} /></svg>);
    case "rail": return (<svg viewBox="0 0 24 24" className="h-6 w-6"><polygon points="12,1 14.5,10 21,12 14.5,14 12,23 9.5,14 3,12 9.5,10" {...common} /></svg>);
    case "rapid": return (<svg viewBox="0 0 24 24" className="h-6 w-6"><polygon points="7,4 3.5,12 6.5,12 5.5,19 11,10 8,10" {...common} /><polygon points="13,4 9.5,12 12.5,12 11.5,19 17,10 14,10" {...common} /><polygon points="19,4 15.5,12 18.5,12 17.5,19 21,13" {...common} /></svg>);
    case "mortar": return (<svg viewBox="0 0 24 24" className="h-6 w-6"><circle cx="12" cy="13" r="6.5" {...common} /><path d="M12 6.5c0-2 1-3.4 2.8-4.2" fill="none" stroke={tint} strokeWidth="1.8" strokeLinecap="round" /><circle cx="12" cy="13" r="2.2" fill="rgba(255,243,196,0.9)" /></svg>);
    default: return (<svg viewBox="0 0 24 24" className="h-6 w-6"><polygon points="13,2 4.5,13.5 10.5,13.5 9,22 19.5,9.5 13.5,9.5" {...common} /></svg>);
  }
}

/* ─── component ───────────────────────────────────────────────────────── */
interface HudSnap {
  floor: number; hp: number; maxhp: number; hpPct: number; low: boolean;
  crowns: number; score: number; kills: number; left: number;
  combo: number; time: string; dashPct: number; cooling: boolean;
  purse: number; scrip: number;
  gunName: string; gunTint: string; gunsOwned: number;
  comboMult: number; shield: boolean; prestige: number;
}

function createG(ui: UiBridge): G {
  return {
    theme: "dark",
    phase: "start",
    paused: false,
    runSeed: 1,
    depth: 1, crowns: 0, kills: 0,
    purse: 0, scrip: 0,
    cam: { x: 0, y: LH - VH },
    event: "none",
    bossKills: 0,
    callout: null,
    fountainT: 0,
    spawnQueue: [],
    addEnemyAt: null,
    meta: loadCrownfallMeta(),
    shopIndex: 0,
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
    sessionBest: { depth: 0, score: 0 },
    overFired: false,
    deathAt: -10,
    ui,
    mp: null,
    mpDown: false,
    mpRevive: false,
    mpPlacedCount: 0,
    mpPurseSeen: 0,
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
    purse: 0, scrip: 0, gunName: "Royal Bolt Blaster", gunTint: "#f0c94f", gunsOwned: 1,
    comboMult: 1, shield: false, prestige: 0,
  });
  const hudPrevRef = useRef("");
  const [msg, setMsg] = useState("");
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [intro, setIntro] = useState<{ depth: number; key: number; name: string; event: EventKind; boss: boolean } | null>(null);
  const introTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shopSnap, setShopSnap] = useState<ShopSnap | null>(null);
  const [hi, setHi] = useState(0);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [deathVisible, setDeathVisible] = useState(false);
  const deathTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [padStatus, setPadStatus] = useState<{ text: string; waiting: boolean } | null>(null);
  const [padLive, setPadLive] = useState(false);
  /* the mute preference persists (guarded adapter — see crownfall-meta) */
  const [muted, setMuted] = useState<boolean>(() => {
    const m = loadCrownfallMuted();
    mutedFlag = m;
    return m;
  });
  const [fsActive, setFsActive] = useState(false);
  const [metaUi, setMetaUi] = useState<CrownfallMeta>(() => loadCrownfallMeta());
  const [prestigeClaimed, setPrestigeClaimed] = useState(false);
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
          purse: g.purse,
          scrip: g.scrip,
          gunName: crownfallGun(P.gun).name,
          gunTint: crownfallGun(P.gun).tint,
          gunsOwned: P.guns.length,
          comboMult: crownfallComboMult(g.combo),
          shield: P.shield,
          prestige: g.meta.tier,
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
      intro: (d, info) => {
        setIntro({ depth: d, key: performance.now(), name: info.name, event: info.event, boss: info.boss });
        if (introTimerRef.current) clearTimeout(introTimerRef.current);
        introTimerRef.current = setTimeout(() => setIntro(null), info.boss ? 2100 : 1500);
      },
      shop: (s) => setShopSnap(s),
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
        setPrestigeClaimed(false);
        if (g) {
          setSessionBest({ depth: g.sessionBest.depth, score: g.sessionBest.score });
          setMetaUi(g.meta);
        }
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
    /* starting a run asks for the full screen (owner ruling); a
       refusal just leaves the run windowed — see the guarded helper */
    requestGameFullscreen(rootRef.current);
    const g = gRef.current;
    if (g) startRun(g, bgRef.current);
  }, []);

  /* MP: hand the party client to the engine state (the loop reads it
     from G every frame; solo runs simply never set it). */
  useEffect(() => {
    const g = gRef.current;
    if (g) g.mp = mp ?? null;
  }, [mp]);

  /* the fullscreen toggle's truth is the document's, never a guess */
  useEffect(() => {
    const onFsChange = () => {
      try { setFsActive(!!document.fullscreenElement); } catch { /* view state only */ }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    onFsChange();
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  /* PRESTIGE: bank the boss-beating run, claim the next tier. Power
     + status only — the recorded score is never touched. */
  const claimPrestige = useCallback(() => {
    const g = gRef.current;
    if (!g || prestigeClaimed) return;
    const next = claimPrestigeTier(g.meta);
    if (next === g.meta) return;
    g.meta = next;
    saveCrownfallMeta(next);
    setMetaUi(next);
    setPrestigeClaimed(true);
    sfx.claim();
    g.ui.hud();
  }, [prestigeClaimed]);

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
    canvas.width = VW * SCALE;
    canvas.height = VH * SCALE;
    /* backdrops are WORLD-sized; their render scale is capped at
       1.5× so two 1080² canvases stay memory-sane on modest GPUs */
    const BGSCALE = Math.min(SCALE, 1.5);
    const bg = document.createElement("canvas");
    bg.width = LW * BGSCALE;
    bg.height = LH * BGSCALE;
    bgRef.current = bg;
    const bgAlt = document.createElement("canvas");
    bgAlt.width = LW * BGSCALE;
    bgAlt.height = LH * BGSCALE;
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
        if (k === "arrowleft" || k === "a") { setShopHighlight(g, g.shopIndex - 1); ev.preventDefault(); return; }
        if (k === "arrowright" || k === "d") { setShopHighlight(g, g.shopIndex + 1); ev.preventDefault(); return; }
        if (k === "arrowup" || k === "w") { setShopHighlight(g, g.shopIndex - 3); ev.preventDefault(); return; }
        if (k === "arrowdown" || k === "s") { setShopHighlight(g, g.shopIndex + 3); ev.preventDefault(); return; }
        if (k === "enter") { shopActivate(g, g.shopIndex, bgRef.current); return; }
      }
      /* number keys 1–6 switch guns mid-run (owned only) */
      if (g.phase === "playing" && k >= "1" && k <= "6") {
        const gun = CROWNFALL_GUNS[Number(k) - 1];
        if (gun) switchGun(g, gun.id);
        return;
      }
      if (k === "enter" || k === " ") {
        if (g.paused) { togglePause(g); return; }
        if (g.phase === "playing") { tryDash(g); if (k === " ") ev.preventDefault(); return; }
        /* Starting from the keyboard requires a prior tap/click inside
           this game, so a Space press aimed at another arcade game on
           the same page can't start this one from off-screen. */
        if ((g.phase === "start" || g.phase === "dead") && engagedRef.current) {
          if (g.phase === "dead" && g.timeNow - g.deathAt < 0.45) return;
          requestGameFullscreen(rootRef.current);
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
    g.mouseAim.x = (p.x / p.w) * VW;
    g.mouseAim.y = (p.y / p.h) * VH;
    g.mouseAim.lastAt = g.timeNow;
    g.mouseAim.inside = true;
  };
  const onStagePointerDown = (ev: React.PointerEvent) => {
    const g = gRef.current;
    if (!g || g.phase !== "playing" || g.paused) return;
    if ((ev.target as HTMLElement).closest("[data-overlay]")) return;
    if (ev.pointerType === "mouse") { trackMouseAim(ev); return; }
    if ((ev.target as HTMLElement).closest("[data-dash-btn]")) return;
    if ((ev.target as HTMLElement).closest("[data-gun-btn]")) return;
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
    <div
      ref={rootRef}
      className={fsActive ? "flex flex-col p-3" : "relative"}
      style={fsActive ? { height: "100dvh", width: "100dvw", background: light ? "#f3ecdc" : "#0a0a0b" } : undefined}
    >
      {/* HUD */}
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2 ${cardCls}`}>
        <span className="min-w-[3.2rem]">
          <span className={`block text-[10px] font-bold uppercase tracking-[0.14em] ${mutedInk}`}>Floor</span>
          <span className={`block text-lg font-black leading-tight ${ink}`}>{hud.floor}</span>
        </span>
        {hud.prestige > 0 && (
          <span className="min-w-[3.4rem]">
            <span className={`block text-[10px] font-bold uppercase tracking-[0.14em] ${mutedInk}`}>Prestige</span>
            <span className="block text-sm font-black leading-tight text-[#C9A84C]" aria-label={"Prestige tier " + hud.prestige}>
              {"♛".repeat(Math.min(hud.prestige, 5))}{hud.prestige > 5 ? " ×" + hud.prestige : ""}
            </span>
          </span>
        )}
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
        <span className="min-w-[4.4rem]">
          <span className={`block text-[10px] font-bold uppercase tracking-[0.14em] ${mutedInk}`}>Coin purse</span>
          <span className={`flex items-center gap-1.5 text-lg font-black leading-tight ${goldInk}`}>
            <img src={mediaUrl("images/visual-bucs-icon.webp")} alt="" className="h-5 w-5 rounded-full" draggable={false} />
            {hud.purse + hud.scrip}
            {hud.scrip > 0 && <span className="text-[11px] font-bold text-[#2fae8f]">(+{hud.scrip} scrip)</span>}
          </span>
        </span>
        <span className="min-w-[5.2rem]">
          <span className={`block text-[10px] font-bold uppercase tracking-[0.14em] ${mutedInk}`}>Gun · {hud.gunsOwned}/6</span>
          <span className="block truncate text-[15px] font-black leading-tight" style={{ color: hud.gunTint }}>{hud.gunName}</span>
        </span>
        <span className="min-w-[3.6rem]">
          <span className={`block text-[10px] font-bold uppercase tracking-[0.14em] ${mutedInk}`}>Score</span>
          <span className={`block text-lg font-black leading-tight ${goldInk}`}>{hud.score.toLocaleString()}</span>
        </span>
      </div>
      <div className={`flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 px-1 py-1.5 text-[13px] ${mutedInk}`}>
        <span>Foes felled: <b className={ink}>{hud.kills}</b> · <b className={ink}>{hud.left} left</b></span>
        {padLive && <span className={`font-bold ${goldInk}`}>Controller live</span>}
        {hud.combo >= 2 && <span className={`font-black ${goldInk}`}>Combo ×{hud.comboMult} · {hud.combo} chain</span>}
        {hud.shield && (
          <span className="inline-flex items-center gap-1 font-black text-[#58b7dd]">
            <Shield className="h-4 w-4" /> Shield up
          </span>
        )}
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
            data-testid="crownfall-mute"
            onClick={() => {
              ensureAudio();
              const next = !muted;
              mutedFlag = next;
              setMuted(next);
              saveCrownfallMuted(next); /* the preference persists */
            }}
            className={`flex h-10 w-10 items-center justify-center rounded-full border ${cardCls}`}
          >
            {muted ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
          </button>
          <button
            type="button"
            aria-label={fsActive ? "Exit fullscreen" : "Enter fullscreen"}
            title={fsActive ? "Exit fullscreen" : "Fullscreen"}
            data-testid="crownfall-fullscreen"
            onClick={() => toggleGameFullscreen(rootRef.current)}
            className={`flex h-10 w-10 items-center justify-center rounded-full border ${cardCls}`}
          >
            {fsActive ? <Minimize className="h-[18px] w-[18px]" /> : <Maximize className="h-[18px] w-[18px]" />}
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

      {/* Stage — in fullscreen it grows to fill the screen height,
          the square arena centred with the HUD still attached */}
      <div
        ref={stageRef}
        className={`relative touch-none select-none overflow-hidden rounded-xl border ${light ? "border-[#C9A84C]/40 bg-[#f3ecdc]" : "border-[#C9A84C]/25 bg-[#0d0d0d]"} ${fsActive ? "mx-auto my-auto" : ""}`}
        style={fsActive ? { width: "min(100%, calc(100dvh - 178px))" } : undefined}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerEnd}
        onPointerCancel={onStagePointerEnd}
        onPointerLeave={() => { const g = gRef.current; if (g) g.mouseAim.inside = false; }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          width={VW}
          height={VH}
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

        {phase === "playing" && hud.gunsOwned > 1 && (
          <div className="absolute bottom-3.5 left-3.5 z-[4] flex items-center gap-1.5" data-gun-btn>
            <button
              type="button"
              aria-label="Previous gun"
              data-testid="crownfall-gun-prev"
              className={`flex h-11 w-11 items-center justify-center rounded-full border text-lg font-black ${cardCls}`}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); const g = gRef.current; if (g) cycleGun(g, -1); }}
              onClick={(e) => e.preventDefault()}
            >
              ‹
            </button>
            <span className={`max-w-[7.5rem] truncate rounded-full border px-2.5 py-1.5 text-[11px] font-black ${cardCls}`} style={{ color: hud.gunTint }}>
              {hud.gunName}
            </span>
            <button
              type="button"
              aria-label="Next gun"
              data-testid="crownfall-gun-next"
              className={`flex h-11 w-11 items-center justify-center rounded-full border text-lg font-black ${cardCls}`}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); const g = gRef.current; if (g) cycleGun(g, 1); }}
              onClick={(e) => e.preventDefault()}
            >
              ›
            </button>
          </div>
        )}

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
            {intro.boss ? (
              /* the boss title card */
              <div className="rounded-xl border-2 border-[#e5484d]/70 px-8 py-5 text-center" style={{ background: "rgba(10,2,2,0.88)" }}>
                <div className="text-xs font-bold uppercase tracking-[0.3em] text-[#ff8a7a]">Floor {intro.depth} · The Boss</div>
                <div className="mt-1 text-4xl font-black tracking-wide text-[#ffd9da]">THE USURPER</div>
                <div className="mt-1 text-[13px] font-bold text-[#ff8a7a]">He wants the throne. Take a gun off him instead.</div>
              </div>
            ) : (
              <div className={`rounded-xl border px-7 py-4 text-center ${cardCls}`} style={{ background: overlayBg }}>
                <div className={`text-xs font-bold uppercase tracking-[0.12em] ${goldInk}`}>Floor {intro.depth}</div>
                <div className={`text-2xl font-black uppercase ${ink}`}>{intro.name}</div>
                {intro.event === "jackpot" && <div className="mt-1 text-sm font-black text-[#C9A84C]">★ JACKPOT VAULT — coins everywhere, elites on guard ★</div>}
                {intro.event === "ambush" && <div className="mt-1 text-sm font-black text-[#e5484d]">⚠ AMBUSH — extra invaders, better drops ⚠</div>}
              </div>
            )}
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
                Bots and glitches are invading the Bow Down Visuals studio — clear each big room, fill your coin purse, and take the golden door down. Between floors, spend purse coins in the shop on upgrades and guns. The Usurper waits every 5th floor — beat him and prestige is yours.
              </p>
              <div className={`mb-4 w-full max-w-[430px] rounded-xl border px-4 py-3 text-left text-sm ${cardCls}`}>
                <div className="py-0.5"><b className={ink}>Move</b> — WASD or arrow keys · on touch, drag the left side of the arena</div>
                <div className="py-0.5"><b className={ink}>Aim &amp; fire</b> — right stick / mouse / right thumb-stick aims: your shots go where you point. No aim, no shots — every bolt is yours</div>
                <div className="py-0.5"><b className={ink}>Dash</b> — Space · or the gold DASH button — briefly untouchable</div>
                <div className="py-0.5"><b className={ink}>Coins</b> — pickups fill your purse. Unspent coins become score (+25 each) when the run ends — spend them or bank them</div>
                <div className="py-0.5"><b className={ink}>Guns</b> — keys 1–6, controller LB/RB, or the on-screen switcher. Elites and the boss drop guns too</div>
                <div className="py-0.5"><b className={ink}>Goal</b> — clear each room to open the golden door, then walk through it. The shop is between floors; descending is always free</div>
                <div className="py-0.5"><b className={ink}>Controller</b> — Bluetooth or wired: left stick / D-pad to move · right stick aims &amp; fires · A to dash · Start or A to begin · Start pauses</div>
                <div className="py-0.5"><b className={ink}>Pause</b> — P or the pause button</div>
              </div>
              {metaUi.tier > 0 && (
                <p className={`mb-2 text-[13px] font-bold ${goldInk}`}>
                  Prestige tier {metaUi.tier} — +{metaUi.tier * 5}% bolt damage, +{metaUi.tier * 10}% coin drops, every run.
                </p>
              )}
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

        {phase === "upgrade" && shopSnap && (
          <div data-overlay className="absolute inset-0 z-[5] overflow-y-auto" style={{ background: overlayBg, touchAction: "pan-y" }}>
            <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col items-center px-4 py-4 text-center">
              <h3 className={`text-2xl font-black ${ink}`}>Floor Cleared — <span className={goldInk}>The Shop</span></h3>
              <p className={`mt-1 flex items-center gap-1.5 text-sm ${mutedInk}`}>
                Purse:
                <img src={mediaUrl("images/visual-bucs-icon.webp")} alt="" className="h-[18px] w-[18px] rounded-full" draggable={false} />
                <b className={goldInk}>{shopSnap.total} coins</b>
                {shopSnap.scrip > 0 && <span className="text-[#2fae8f]">({shopSnap.scrip} scrip — spends first)</span>}
                <span>· buy anything you can afford, then descend — descending is free</span>
              </p>

              <div className={`mt-2 self-start text-[11px] font-bold uppercase tracking-[0.16em] ${mutedInk}`}>Upgrades</div>
              <div className="mt-1.5 grid w-full grid-cols-1 gap-2 min-[560px]:grid-cols-3">
                {shopSnap.items.map((item, idx) => item.kind !== "upgrade" ? null : (
                  <button
                    key={item.key}
                    type="button"
                    data-testid={"crownfall-shop-" + item.id}
                    onClick={() => { const g = gRef.current; if (g) shopActivate(g, idx, bgRef.current); }}
                    onMouseEnter={() => { const g = gRef.current; if (g) setShopHighlight(g, idx); }}
                    className={`flex min-h-16 flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition ${cardCls} ${idx === hi ? "shadow-[0_0_0_3px_rgba(240,201,79,0.9)]" : ""}`}
                    style={{ borderColor: "rgba(201,168,76,0.55)", backgroundImage: "linear-gradient(160deg, rgba(240,201,79,0.10), transparent 55%)" }}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${panelSoft}`}>
                        <UpgradeIcon id={item.id} />
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-black ${item.affordable ? goldInk : "text-[#e5484d]"}`}>
                        <img src={mediaUrl("images/visual-bucs-icon.webp")} alt="" className="h-3.5 w-3.5 rounded-full" draggable={false} />
                        {item.price}
                      </span>
                    </span>
                    <span className={`block text-[15px] font-black leading-tight ${ink}`}>{item.name}</span>
                    <span className={`block text-[12.5px] leading-snug ${mutedInk}`}>{item.desc}</span>
                    {!item.affordable && (
                      <span className="block text-[12px] font-bold text-[#e5484d]">Need {item.shortfall} more coins</span>
                    )}
                  </button>
                ))}
              </div>

              <div className={`mt-3 self-start text-[11px] font-bold uppercase tracking-[0.16em] ${mutedInk}`}>The Armory — guns</div>
              <div className="mt-1.5 grid w-full grid-cols-1 gap-2 min-[560px]:grid-cols-2">
                {shopSnap.items.map((item, idx) => item.kind !== "gun" ? null : (
                  <button
                    key={item.key}
                    type="button"
                    data-testid={"crownfall-shop-" + item.id}
                    onClick={() => { const g = gRef.current; if (g) shopActivate(g, idx, bgRef.current); }}
                    onMouseEnter={() => { const g = gRef.current; if (g) setShopHighlight(g, idx); }}
                    className={`flex items-start gap-2.5 rounded-xl border-2 p-3 text-left transition ${cardCls} ${idx === hi ? "shadow-[0_0_0_3px_rgba(240,201,79,0.9)]" : ""} ${item.equipped ? "ring-2 ring-[#C9A84C]" : ""}`}
                    style={{ borderColor: "rgba(201,168,76,0.45)", backgroundImage: "linear-gradient(160deg, rgba(240,201,79,0.08), transparent 55%)" }}
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${panelSoft}`}>
                      <GunSwatch id={item.id} tint={item.tint ?? "#f0c94f"} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[15px] font-black leading-tight ${ink}`}>{item.name}</span>
                      <span className={`block text-[12.5px] leading-snug ${mutedInk}`}>{item.desc}</span>
                      <span className="mt-0.5 block text-[12.5px] font-black">
                        {item.equipped
                          ? <span className={goldInk}>EQUIPPED</span>
                          : item.owned
                            ? <span className={goldInk}>OWNED — tap to equip</span>
                            : item.affordable
                              ? <span className={`inline-flex items-center gap-1 ${goldInk}`}><img src={mediaUrl("images/visual-bucs-icon.webp")} alt="" className="h-3.5 w-3.5 rounded-full" draggable={false} />{item.price} coins</span>
                              : <span className="text-[#e5484d]">{item.price} coins — need {item.shortfall} more</span>}
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              {shopSnap.items.map((item, idx) => item.kind !== "descend" ? null : (
                <button
                  key={item.key}
                  type="button"
                  data-testid="crownfall-descend"
                  onClick={() => { const g = gRef.current; if (g) shopActivate(g, idx, bgRef.current); }}
                  onMouseEnter={() => { const g = gRef.current; if (g) setShopHighlight(g, idx); }}
                  className={`${btnGold} mt-4 w-full max-w-[430px] ${idx === hi ? "shadow-[0_0_0_3px_rgba(240,201,79,0.9)]" : ""}`}
                >
                  {item.name} — FREE ↓
                </button>
              ))}
              <p className={`mt-2 text-[12px] ${mutedInk}`}>Unspent coins become score (+25 each) when the run ends. Scrip never does — spend it here.</p>
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
              <div className="mx-auto mb-3 mt-2 grid w-full max-w-[340px] grid-cols-2 gap-2">
                {[
                  { k: "Depth reached", v: String(summary.depth), gold: false },
                  { k: "Leftover purse → score", v: summary.crowns + " × 25 = " + summary.coinScore, gold: false },
                  { k: "Foes felled", v: String(summary.kills), gold: false },
                  { k: "Final score", v: summary.score.toLocaleString(), gold: true },
                  { k: "Best combo chain", v: String(Math.max(1, summary.bestCombo)), gold: false },
                  { k: "Time survived", v: fmtTime(summary.timeSec), gold: false },
                ].map((c) => (
                  <div key={c.k} className={`rounded-xl border px-2 py-2.5 ${cardCls}`}>
                    <div className={`text-[11px] font-bold uppercase tracking-[0.13em] ${mutedInk}`}>{c.k}</div>
                    <div className={`text-2xl font-black ${c.gold ? goldInk : ink}`}>{c.v}</div>
                  </div>
                ))}
              </div>
              <p className={`mb-1 max-w-[46ch] text-[13px] ${mutedInk}`}>
                <b className={ink}>Armory:</b> {summary.armory.join(" · ")}
              </p>
              {/* the trophy row: lifetime achievements, this run's new ones lit */}
              <div className="mb-3 mt-1 flex flex-wrap items-center justify-center gap-1.5">
                {CROWNFALL_ACHIEVEMENTS.map((a) => {
                  const earned = summary.achievementsAll.includes(a.id);
                  const isNew = summary.achievementsNew.includes(a.id);
                  return (
                    <span
                      key={a.id}
                      title={a.name + " — " + a.desc}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-bold ${earned ? "border-[#C9A84C] text-[#C9A84C]" : `${cardCls} opacity-45`}`}
                    >
                      🏆 {a.name}{isNew ? " — NEW!" : ""}
                    </span>
                  );
                })}
              </div>
              {summary.canPrestige && !prestigeClaimed && (
                <div className={`mb-3 w-full max-w-[430px] rounded-xl border-2 border-[#C9A84C] px-4 py-3 ${cardCls}`}>
                  <div className={`text-base font-black ${goldInk}`}>👑 The Usurper fell — PRESTIGE is yours</div>
                  <p className={`mt-0.5 text-[13px] ${mutedInk}`}>
                    Bank this run and claim Prestige tier {summary.prestigeTier + 1} of {PRESTIGE_TIER_CAP}: +5% bolt damage and +10% coin drops on every future run, forever. Power and status only — your score above never changes.
                  </p>
                  <button type="button" className={`${btnGold} mt-2 w-full`} data-testid="crownfall-prestige" onClick={claimPrestige}>
                    Claim Prestige Tier {summary.prestigeTier + 1}
                  </button>
                </div>
              )}
              {prestigeClaimed && (
                <div className={`mb-3 font-black ${goldInk}`}>♛ Prestige tier {metaUi.tier} claimed — the crown remembers.</div>
              )}
              <p className={`mb-2.5 text-[13px] ${mutedInk}`}>Score = depth × 100 + leftover purse × 25 + foes × 10 + combo bonus (chained kills multiply up to ×5).</p>
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
        Score = depth × 100 + leftover purse coins × 25 + foes felled × 10 + combo bonus. Purse coins are run-local — no charge, no wager, never Visual Bucs.
      </p>
    </div>
  );
}
