import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, ArrowBigUp, ArrowBigDown } from "lucide-react";
import {
  RUNNER,
  runnerScore,
  runnerSpeedAt,
  type ArcadeRunResult,
} from "@/lib/arcade-games";
import { gameSfx } from "@/lib/game-sound";
import GameSoundToggle from "@/components/GameSoundToggle";

/* ─── Shark King Endless Runner ───────────────────────────────────────────
   Canvas side-scroller. The King (real brand avatar, gold ring) rides a
   gold board down a palace colonnade: jump the marble crates and gold
   spikes, duck the velvet banners, collect spinning Visual Bucs coins.
   Speed ramps 420 → 900 px/s. One hit ends the run — in a flash, a
   shake and a beat of slow motion before the score card. Controls:
   Space / ↑ / W or tap to jump, ↓ / S to duck (on-screen buttons on
   touch). Scoring lives in lib/arcade-games.ts — the server validates
   submissions against those same constants.

   The physics run on an accumulated SIMULATED clock (simMs): the
   death slow-mo stretches real time, never simulated time, so the
   reported (score, durationMs) pair stays exactly what an honest run
   of that duration produces under the shared constants. */

type Phase = "ready" | "playing" | "over";

interface Obstacle { x: number; w: number; h: number; kind: "crate" | "spike" | "banner" }
interface Coin { x: number; y: number; taken: boolean }
interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number;
  kind: "dust" | "spark" | "shard";
}

interface RunState {
  simMs: number;
  distancePx: number;
  coinsCollected: number;
  playerY: number; // top of the player box
  vy: number;
  ducking: boolean;
  obstacles: Obstacle[];
  coins: Coin[];
  nextObstacleInPx: number;
  lastCoinAt: number;
  over: boolean;
  /* Presentation state (never feeds scoring) */
  airborne: boolean;
  landRealAt: number;
  dying: boolean;
  hitRealAt: number;
  sprayAt: number;
}

const PLAYER_X = 120;
const PLAYER_W = 62;
const STAND_H = 62;
const DUCK_H = 40;
const DEATH_BEAT_MS = 650;

export default function SharkRunnerGame({
  light,
  onGameOver,
}: {
  light: boolean;
  onGameOver: (r: ArcadeRunResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<RunState | null>(null);
  const phaseRef = useRef<Phase>("ready");
  const overFiredRef = useRef(false);
  const keysRef = useRef({ duck: false });
  const fxRef = useRef<Particle[]>([]);
  const imagesRef = useRef<{ avatar: HTMLImageElement | null; coin: HTMLImageElement | null }>({
    avatar: null,
    coin: null,
  });
  const [phase, setPhase] = useState<Phase>("ready");
  const [hud, setHud] = useState({ score: 0, coins: 0 });

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const freshState = (): RunState => ({
    simMs: 0,
    distancePx: 0,
    coinsCollected: 0,
    playerY: RUNNER.groundY - STAND_H,
    vy: 0,
    ducking: false,
    obstacles: [],
    coins: [],
    nextObstacleInPx: 620,
    lastCoinAt: 0,
    over: false,
    airborne: false,
    landRealAt: 0,
    dying: false,
    hitRealAt: 0,
    sprayAt: 0,
  });

  const burst = (x: number, y: number, kind: Particle["kind"], n: number, spread = 160) => {
    const fx = fxRef.current;
    for (let i = 0; i < n; i++) {
      if (fx.length > 240) break;
      const a = Math.random() * Math.PI * 2;
      const v = 30 + Math.random() * spread;
      fx.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (kind === "dust" ? 24 : 0),
        life: 0,
        maxLife: 0.35 + Math.random() * 0.45,
        size: kind === "dust" ? 3 + Math.random() * 5 : 1.5 + Math.random() * 2.5,
        kind,
      });
    }
  };

  const jump = () => {
    const s = stateRef.current;
    if (!s || phaseRef.current !== "playing" || s.dying) return;
    const groundTop = RUNNER.groundY - STAND_H;
    if (s.playerY >= groundTop - 0.5 && s.vy === 0) {
      s.vy = -RUNNER.jumpVelocity;
      gameSfx.jump();
      burst(PLAYER_X + 16, RUNNER.groundY, "dust", 6, 90);
    }
  };

  const start = () => {
    stateRef.current = freshState();
    overFiredRef.current = false;
    fxRef.current = [];
    setHud({ score: 0, coins: 0 });
    setPhaseBoth("playing");
  };

  /* ── Input ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        if (phaseRef.current === "ready") start();
        else jump();
      }
      if (e.code === "ArrowDown" || e.code === "KeyS") {
        keysRef.current.duck = e.type === "keydown";
        if (e.type === "keydown") e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Images (brand assets; shape fallback if a load fails) ── */
  useEffect(() => {
    const avatar = new Image();
    avatar.src = "/cheat-code-avatar.webp";
    avatar.onload = () => { imagesRef.current.avatar = avatar; };
    const coin = new Image();
    coin.src = "/images/visual-bucs-coin-transparent.png";
    coin.onload = () => { imagesRef.current.coin = coin; };
    // A standing state so the ready screen shows the King in the hall.
    if (!stateRef.current) stateRef.current = freshState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Main loop ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let hudAt = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const rawDt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      const W = RUNNER.width;
      const H = RUNNER.height;
      const gY = RUNNER.groundY;
      const fx = fxRef.current;

      /* ---- particles always breathe (real time) ---- */
      for (const p of fx) {
        p.life += rawDt;
        p.x += p.vx * rawDt;
        p.y += p.vy * rawDt;
        p.vy += (p.kind === "spark" ? 260 : 40) * rawDt;
      }
      fxRef.current = fx.filter((p) => p.life < p.maxLife);

      /* ---- update ---- */
      if (phaseRef.current === "playing" && s) {
        // Simulated clock: slow-mo stretches real time only.
        const timeScale = s.dying ? 0.25 : 1;
        const dt = rawDt * timeScale;
        s.simMs += dt * 1000;
        const elapsed = s.simMs;
        const speed = runnerSpeedAt(elapsed);
        s.distancePx += speed * dt;
        s.ducking = keysRef.current.duck;

        // Player physics (duck = fast-fall + low profile)
        const wasAirborne = s.airborne;
        const targetH = s.ducking ? DUCK_H : STAND_H;
        const groundTop = gY - targetH;
        if (s.vy !== 0 || s.playerY < gY - STAND_H) {
          s.vy += RUNNER.gravity * (s.ducking ? 2.2 : 1) * dt;
          s.playerY += s.vy * dt;
          const standTop = gY - STAND_H;
          if (s.playerY >= standTop && s.vy > 0) {
            // Landed; when ducking, settle to duck height.
            s.playerY = s.ducking ? gY - DUCK_H : standTop;
            s.vy = 0;
          }
        } else {
          s.playerY = groundTop;
        }
        s.airborne = s.vy !== 0;
        if (wasAirborne && !s.airborne && !s.dying) {
          s.landRealAt = now;
          gameSfx.land();
          burst(PLAYER_X + PLAYER_W / 2, gY - 2, "dust", 8, 110);
        }
        const playerH = s.ducking && s.vy === 0 ? DUCK_H : STAND_H;
        if (s.vy === 0) s.playerY = gY - playerH;

        if (!s.dying) {
          // Spawn obstacles by distance gap
          s.nextObstacleInPx -= speed * dt;
          if (s.nextObstacleInPx <= 0) {
            const kinds: Obstacle["kind"][] = ["crate", "spike", "banner"];
            const kind = kinds[Math.floor(Math.random() * kinds.length)]!;
            const ob: Obstacle =
              kind === "crate"
                ? { x: W + 40, w: 46, h: 46, kind }
                : kind === "spike"
                  ? { x: W + 40, w: 36, h: 30, kind }
                  : { x: W + 40, w: 54, h: 108, kind };
            s.obstacles.push(ob);
            s.nextObstacleInPx = 480 + Math.random() * 320 + speed * 0.25;
          }
          // Spawn coins (single, ≥1.25s apart — server cap headroom)
          if (elapsed - s.lastCoinAt >= RUNNER.coinSpawnIntervalMs) {
            s.lastCoinAt = elapsed;
            const high = Math.random() < 0.5;
            s.coins.push({
              x: W + 30,
              y: high ? gY - 128 : gY - 30,
              taken: false,
            });
          }
        }
        // Move + cull
        for (const ob of s.obstacles) ob.x -= speed * dt;
        s.obstacles = s.obstacles.filter((ob) => ob.x + ob.w > -60);
        for (const c of s.coins) c.x -= speed * dt;
        s.coins = s.coins.filter((c) => c.x > -40 && !c.taken);

        // Board spray while grounded at speed
        if (!s.airborne && !s.dying && now - s.sprayAt > 50) {
          s.sprayAt = now;
          fx.push({
            x: PLAYER_X + 2, y: gY - 2,
            vx: -60 - Math.random() * 60, vy: -20 - Math.random() * 40,
            life: 0, maxLife: 0.3 + Math.random() * 0.2,
            size: 2 + Math.random() * 3, kind: "dust",
          });
        }

        if (!s.dying) {
          // Collisions (forgiving insets)
          const pBox = {
            x: PLAYER_X + 8,
            y: s.playerY + 6,
            w: PLAYER_W - 16,
            h: playerH - 8,
          };
          for (const ob of s.obstacles) {
            const oBox =
              ob.kind === "banner"
                ? { x: ob.x + 5, y: 0, w: ob.w - 10, h: gY - 52 }
                : { x: ob.x + 5, y: gY - ob.h + 4, w: ob.w - 10, h: ob.h - 4 };
            if (
              pBox.x < oBox.x + oBox.w &&
              pBox.x + pBox.w > oBox.x &&
              pBox.y < oBox.y + oBox.h &&
              pBox.y + pBox.h > oBox.y
            ) {
              s.dying = true;
              s.hitRealAt = now;
              gameSfx.crash();
              burst(PLAYER_X + PLAYER_W / 2, s.playerY + playerH / 2, "shard", 14, 240);
              break;
            }
          }
          if (!s.dying) {
            for (const c of s.coins) {
              if (
                c.x > pBox.x - 14 &&
                c.x < pBox.x + pBox.w + 14 &&
                c.y > pBox.y - 14 &&
                c.y < pBox.y + pBox.h + 14
              ) {
                c.taken = true;
                s.coinsCollected += 1;
                gameSfx.coin();
                burst(c.x, c.y, "spark", 7, 130);
              }
            }
          }
        }

        if (now - hudAt > 120) {
          hudAt = now;
          setHud({
            score: runnerScore(s.distancePx, s.coinsCollected),
            coins: s.coinsCollected,
          });
        }

        // The death beat: slow-mo, flash and shake play out in real
        // time, then the run closes on the SIMULATED duration.
        if (s.dying && !overFiredRef.current && now - s.hitRealAt >= DEATH_BEAT_MS) {
          overFiredRef.current = true;
          setHud({
            score: runnerScore(s.distancePx, s.coinsCollected),
            coins: s.coinsCollected,
          });
          setPhaseBoth("over");
          onGameOver({
            game: "runner",
            score: runnerScore(s.distancePx, s.coinsCollected),
            durationMs: Math.round(s.simMs),
          });
        }
      }

      /* ---- draw ---- */
      ctx.save();
      // Screen shake during the death beat
      if (s?.dying) {
        const t = (now - s.hitRealAt) / DEATH_BEAT_MS;
        if (t < 0.7) {
          const mag = 9 * (1 - t);
          ctx.translate(Math.sin(now * 0.11) * mag, Math.cos(now * 0.13) * mag * 0.6);
        }
      }

      const sky = ctx.createLinearGradient(0, 0, 0, H);
      if (light) {
        sky.addColorStop(0, "#f2e2b8");
        sky.addColorStop(0.6, "#f7ecd2");
        sky.addColorStop(1, "#fbf6e9");
      } else {
        sky.addColorStop(0, "#070503");
        sky.addColorStop(0.6, "#0d0a04");
        sky.addColorStop(1, "#1a1409");
      }
      ctx.fillStyle = sky;
      ctx.fillRect(-16, -16, W + 32, H + 32);

      // Warm light source (sun in light theme, throne-room glow in dark)
      const glow = ctx.createRadialGradient(W * 0.78, 40, 10, W * 0.78, 40, 300);
      glow.addColorStop(0, light ? "rgba(255,214,120,0.55)" : "rgba(240,216,120,0.20)");
      glow.addColorStop(1, "rgba(240,216,120,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, gY);

      const dist = s?.distancePx ?? 0;

      // Far layer: palace silhouette with domes (parallax 0.15)
      const farOff = (dist * 0.15) % 340;
      ctx.fillStyle = light ? "rgba(176,137,47,0.28)" : "rgba(201,168,76,0.10)";
      for (let bx = -farOff - 340; bx < W + 340; bx += 340) {
        ctx.fillRect(bx + 30, gY - 118, 280, 118);
        ctx.beginPath();
        ctx.arc(bx + 170, gY - 118, 62, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(bx + 166, gY - 208, 8, 30);
        ctx.beginPath();
        ctx.arc(bx + 60, gY - 118, 34, Math.PI, 0);
        ctx.arc(bx + 280, gY - 118, 34, Math.PI, 0);
        ctx.fill();
      }

      // Mid layer: the colonnade (parallax 0.45) — marble columns with
      // gold rim light, joined by arches
      const colSpacing = 168;
      const colOff = (dist * 0.45) % colSpacing;
      for (let cx = -colOff - colSpacing; cx < W + colSpacing; cx += colSpacing) {
        // Arch to the next column
        ctx.strokeStyle = light ? "rgba(122,90,18,0.35)" : "rgba(201,168,76,0.28)";
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(cx + colSpacing / 2 + 9, gY - 196, colSpacing / 2 - 4, Math.PI, 0);
        ctx.stroke();
        // Column shaft
        const shaft = ctx.createLinearGradient(cx, 0, cx + 20, 0);
        if (light) {
          shaft.addColorStop(0, "#e9d9ac");
          shaft.addColorStop(0.75, "#f7ecd2");
          shaft.addColorStop(1, "#d9bd7f");
        } else {
          shaft.addColorStop(0, "#241a0c");
          shaft.addColorStop(0.75, "#33270f");
          shaft.addColorStop(1, "#171106");
        }
        ctx.fillStyle = shaft;
        ctx.fillRect(cx, gY - 196, 20, 196);
        // Gold rim light on the sun side
        ctx.fillStyle = "rgba(240,216,120,0.85)";
        ctx.fillRect(cx + 18, gY - 196, 2, 196);
        // Capital + base
        ctx.fillStyle = light ? "#d9bd7f" : "#3a2a10";
        ctx.fillRect(cx - 4, gY - 204, 28, 10);
        ctx.fillRect(cx - 4, gY - 12, 28, 12);
        ctx.fillStyle = "#C9A84C";
        ctx.fillRect(cx - 4, gY - 196, 28, 3);
      }

      // Floor: marble with a moving sheen and a gold trim line
      const floorGrad = ctx.createLinearGradient(0, gY, 0, H);
      if (light) {
        floorGrad.addColorStop(0, "#f4e7c3");
        floorGrad.addColorStop(1, "#e8d5a0");
      } else {
        floorGrad.addColorStop(0, "#2a1e0c");
        floorGrad.addColorStop(1, "#171106");
      }
      ctx.fillStyle = floorGrad;
      ctx.fillRect(-16, gY, W + 32, H - gY + 16);
      ctx.fillStyle = "#C9A84C";
      ctx.fillRect(-16, gY, W + 32, 3);
      // Sheen sweep
      const sheenX = ((now / 14) % (W + 400)) - 200;
      const sheen = ctx.createLinearGradient(sheenX, gY, sheenX + 180, H);
      sheen.addColorStop(0, "rgba(255,255,255,0)");
      sheen.addColorStop(0.5, light ? "rgba(255,255,255,0.20)" : "rgba(240,216,120,0.07)");
      sheen.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(0, gY + 3, W, H - gY);
      // Inlaid floor stripes scroll at full speed
      const stripeOff = dist % 64;
      ctx.fillStyle = light ? "rgba(122,90,18,0.30)" : "rgba(201,168,76,0.22)";
      for (let x = -stripeOff; x < W; x += 64) {
        ctx.fillRect(x, gY + 22, 30, 3);
      }

      // Speed lines once the run is flying
      const curSpeed = s && phaseRef.current === "playing" ? runnerSpeedAt(s.simMs) : 0;
      if (curSpeed > 740 && !s?.dying) {
        ctx.strokeStyle = `rgba(240,216,120,${0.10 + (curSpeed - 740) / 160 * 0.22})`;
        ctx.lineWidth = 2;
        for (let i = 0; i < 7; i++) {
          const ly = 30 + ((i * 53 + Math.floor(now / 90) * (29 + i * 7)) % (gY - 60));
          const lx = (i * 197 + Math.floor(now / 2.2) * (i + 3)) % (W + 160) - 160;
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx + 44 + (curSpeed - 740) / 4, ly);
          ctx.stroke();
        }
      }

      if (s) {
        // Coins: real coin art, spinning (squash by spin phase), soft
        // glow shadow beneath
        for (const c of s.coins) {
          const spin = Math.abs(Math.cos(now / 190 + c.x * 0.012));
          const wCoin = 8 + 22 * spin;
          ctx.fillStyle = "rgba(0,0,0,0.18)";
          ctx.beginPath();
          ctx.ellipse(c.x, Math.min(c.y + 26, gY - 2), 12, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          const img = imagesRef.current.coin;
          if (img) {
            ctx.drawImage(img, c.x - wCoin / 2, c.y - 15, wCoin, 30);
          } else {
            ctx.fillStyle = "#f0d878";
            ctx.beginPath();
            ctx.arc(c.x, c.y, 12 * Math.max(spin, 0.35), 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#7A5A12";
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
        // Obstacles
        for (const ob of s.obstacles) {
          // Contact shadow
          ctx.fillStyle = "rgba(0,0,0,0.22)";
          ctx.beginPath();
          ctx.ellipse(ob.x + ob.w / 2, gY + 6, ob.w * 0.55, 4, 0, 0, Math.PI * 2);
          ctx.fill();
          if (ob.kind === "crate") {
            // Gold-trimmed marble block with a carved diamond
            const top = gY - ob.h;
            const body = ctx.createLinearGradient(ob.x, top, ob.x, gY);
            if (light) {
              body.addColorStop(0, "#fbf6e9");
              body.addColorStop(1, "#e6d29c");
            } else {
              body.addColorStop(0, "#4a3a1c");
              body.addColorStop(1, "#2a1e0c");
            }
            ctx.fillStyle = body;
            ctx.fillRect(ob.x, top, ob.w, ob.h);
            ctx.fillStyle = light ? "rgba(255,255,255,0.5)" : "rgba(240,216,120,0.16)";
            ctx.fillRect(ob.x, top, ob.w, 5);
            ctx.strokeStyle = "#C9A84C";
            ctx.lineWidth = 2.5;
            ctx.strokeRect(ob.x + 1, top + 1, ob.w - 2, ob.h - 2);
            ctx.strokeStyle = light ? "rgba(122,90,18,0.55)" : "rgba(240,216,120,0.5)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(ob.x + ob.w / 2, top + 9);
            ctx.lineTo(ob.x + ob.w - 9, top + ob.h / 2);
            ctx.lineTo(ob.x + ob.w / 2, top + ob.h - 9);
            ctx.lineTo(ob.x + 9, top + ob.h / 2);
            ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = "#C9A84C";
            for (const [sx, sy] of [[5, 5], [ob.w - 5, 5], [5, ob.h - 5], [ob.w - 5, ob.h - 5]] as const) {
              ctx.beginPath();
              ctx.arc(ob.x + sx, top + sy, 2, 0, Math.PI * 2);
              ctx.fill();
            }
          } else if (ob.kind === "spike") {
            // Gold spikes on a base bar
            ctx.fillStyle = light ? "#8a6a24" : "#3a2a10";
            ctx.fillRect(ob.x - 3, gY - 6, ob.w + 6, 6);
            const spikeGrad = ctx.createLinearGradient(ob.x, 0, ob.x + ob.w, 0);
            spikeGrad.addColorStop(0, "#b8912f");
            spikeGrad.addColorStop(0.5, "#f0d878");
            spikeGrad.addColorStop(1, "#b8912f");
            ctx.fillStyle = spikeGrad;
            const thirds = ob.w / 3;
            for (let i = 0; i < 3; i++) {
              ctx.beginPath();
              ctx.moveTo(ob.x + i * thirds, gY - 5);
              ctx.lineTo(ob.x + i * thirds + thirds / 2, gY - ob.h);
              ctx.lineTo(ob.x + (i + 1) * thirds, gY - 5);
              ctx.closePath();
              ctx.fill();
            }
          } else {
            // Velvet banner on a gold rod — cloth ripples as it hangs;
            // a gold fin emblem rides the middle (never a flat slab).
            const sway = Math.sin(now / 320 + ob.x * 0.02) * 3;
            ctx.fillStyle = "#7A5A12";
            ctx.fillRect(ob.x - 6, 0, ob.w + 12, 6);
            ctx.fillStyle = "#f0d878";
            ctx.beginPath();
            ctx.arc(ob.x - 6, 3, 4, 0, Math.PI * 2);
            ctx.arc(ob.x + ob.w + 6, 3, 4, 0, Math.PI * 2);
            ctx.fill();
            const hemY = gY - 52;
            const cloth = ctx.createLinearGradient(ob.x, 0, ob.x + ob.w, 0);
            cloth.addColorStop(0, "#57101d");
            cloth.addColorStop(0.5, "#8c1d2f");
            cloth.addColorStop(1, "#57101d");
            ctx.fillStyle = cloth;
            ctx.beginPath();
            ctx.moveTo(ob.x, 6);
            ctx.lineTo(ob.x + ob.w, 6);
            ctx.quadraticCurveTo(ob.x + ob.w - 2, hemY - 18, ob.x + ob.w - 4 + sway, hemY);
            ctx.lineTo(ob.x + 4 + sway, hemY);
            ctx.quadraticCurveTo(ob.x + 2, hemY - 18, ob.x, 6);
            ctx.fill();
            // Gold fringe along the hem
            ctx.fillStyle = "#C9A84C";
            for (let fx2 = 4; fx2 < ob.w - 2; fx2 += 8) {
              ctx.beginPath();
              ctx.moveTo(ob.x + fx2, hemY - 1);
              ctx.lineTo(ob.x + fx2 + 4, hemY - 1);
              ctx.lineTo(ob.x + fx2 + 2 + sway * 0.4, hemY + 6);
              ctx.closePath();
              ctx.fill();
            }
            // Fin emblem (a shark fin cut in gold cloth)
            ctx.fillStyle = "rgba(240,216,120,0.92)";
            ctx.beginPath();
            ctx.moveTo(ob.x + ob.w / 2, hemY - 74);
            ctx.quadraticCurveTo(ob.x + ob.w / 2 + 16, hemY - 52, ob.x + ob.w / 2 + 12, hemY - 34);
            ctx.lineTo(ob.x + ob.w / 2 - 12, hemY - 34);
            ctx.quadraticCurveTo(ob.x + ob.w / 2 - 4, hemY - 54, ob.x + ob.w / 2, hemY - 74);
            ctx.fill();
          }
        }

        // The King on his gold board
        const playerH = s.ducking && s.vy === 0 ? DUCK_H : STAND_H;
        const bob = s.vy === 0 ? Math.sin(now / 90) * 1.5 : 0;
        const py = s.playerY + bob;
        // Board shadow + board
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.beginPath();
        ctx.ellipse(PLAYER_X + PLAYER_W / 2, gY + 9, 42, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        const boardGrad = ctx.createLinearGradient(PLAYER_X, 0, PLAYER_X + PLAYER_W, 0);
        boardGrad.addColorStop(0, "#a8823a");
        boardGrad.addColorStop(0.5, "#f0d878");
        boardGrad.addColorStop(1, "#a8823a");
        ctx.fillStyle = boardGrad;
        const boardY = py + playerH - 2;
        ctx.beginPath();
        ctx.roundRect(PLAYER_X - 6, boardY, PLAYER_W + 14, 6, 3);
        ctx.fill();

        // Body: lean with velocity, squash on duck/landing, tumble when hit
        const cx = PLAYER_X + PLAYER_W / 2;
        const cy = py + playerH / 2;
        let tilt = 0;
        let squashX = 1;
        let squashY = 1;
        if (s.dying) {
          tilt = Math.min(1.15, (now - s.hitRealAt) / 500 * 1.15);
        } else if (s.airborne) {
          tilt = Math.max(-0.42, Math.min(0.5, s.vy * 0.00038));
        } else if (s.ducking) {
          squashY = 0.8;
          squashX = 1.14;
        } else if (now - s.landRealAt < 130 && s.landRealAt > 0) {
          squashY = 0.86;
          squashX = 1.12;
        }
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.scale(squashX, squashY);
        const avatar = imagesRef.current.avatar;
        const r = playerH / 2;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.clip();
        if (avatar) {
          ctx.drawImage(avatar, -r, -r, playerH, playerH);
        } else {
          // Fallback: dark disc + crown spikes (never a stock emoji)
          ctx.fillStyle = "#1a1409";
          ctx.fillRect(-r, -r, playerH, playerH);
          ctx.fillStyle = "#f0d878";
          ctx.beginPath();
          ctx.moveTo(-r + 14, 4);
          ctx.lineTo(-r + 22, -10);
          ctx.lineTo(-r + 31, 2);
          ctx.lineTo(-r + 40, -10);
          ctx.lineTo(-r + 48, 4);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.strokeStyle = "#C9A84C";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Particles on top of the scene
      for (const p of fxRef.current) {
        const a = 1 - p.life / p.maxLife;
        if (p.kind === "dust") {
          ctx.fillStyle = light ? `rgba(176,148,92,${0.35 * a})` : `rgba(201,168,76,${0.30 * a})`;
        } else if (p.kind === "spark") {
          ctx.fillStyle = `rgba(255,224,130,${0.9 * a})`;
        } else {
          ctx.fillStyle = `rgba(240,216,120,${0.85 * a})`;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.kind === "dust" ? 1 + p.life * 2 : 1), 0, Math.PI * 2);
        ctx.fill();
      }

      // Hit flash: red vignette that blooms and dies with the beat
      if (s?.dying) {
        const t = (now - s.hitRealAt) / 520;
        if (t < 1) {
          const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
          vg.addColorStop(0, "rgba(180,20,30,0)");
          vg.addColorStop(1, `rgba(180,20,30,${0.5 * (1 - t)})`);
          ctx.fillStyle = vg;
          ctx.fillRect(0, 0, W, H);
        }
      }
      ctx.restore();
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [light]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={RUNNER.width}
        height={RUNNER.height}
        className="block h-auto w-full touch-none select-none rounded-xl"
        onPointerDown={() => {
          if (phaseRef.current === "playing") jump();
        }}
        data-testid="runner-canvas"
      />
      {/* HUD */}
      <div className="pointer-events-none absolute left-3 top-3 flex gap-2 text-xs font-bold">
        <span className={`rounded-full bg-black/60 px-3 py-1 ${light ? "text-[#7A5A12]" : "text-[#f0d878]"}`}>
          Score {hud.score.toLocaleString()}
        </span>
        <span className="rounded-full bg-black/60 px-3 py-1 text-white/85">
          Coins {hud.coins}
        </span>
      </div>
      <div className="absolute right-3 top-3">
        <GameSoundToggle light={light} />
      </div>

      {phase === "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/55 text-center">
          <p className="max-w-sm px-4 text-sm text-white/80">
            Space / tap to jump the marble crates and gold spikes. Duck
            under the velvet banners. One hit ends the run.
          </p>
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
            data-testid="runner-start"
          >
            <Play className="h-4 w-4" /> Start run
          </button>
        </div>
      )}
      {phase === "over" && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60 p-4">
          <div
            className={`w-full max-w-xs rounded-2xl border p-5 text-center shadow-2xl ${
              light
                ? "border-[#C9A84C]/50 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] text-[#2A1E07]"
                : "border-primary/30 bg-gradient-to-b from-[#14100a] to-[#0d0a04] text-[#f5f1e6]"
            }`}
          >
            <p className="text-[11px] font-black uppercase tracking-[0.25em] opacity-70">
              Run over
            </p>
            <p className="mt-1 text-4xl font-black text-[#b8912f] dark:text-[#f0d878]">
              {hud.score.toLocaleString()}
            </p>
            <p className="mt-1 text-xs font-semibold opacity-75">
              {hud.coins} Visual Bucs coins collected
            </p>
            <button
              type="button"
              onClick={start}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
              data-testid="runner-restart"
            >
              <RotateCcw className="h-4 w-4" /> Run it again
            </button>
          </div>
        </div>
      )}

      {/* Touch controls */}
      {phase === "playing" && (
        <div className="absolute bottom-3 right-3 flex gap-2 sm:hidden">
          <button
            type="button"
            aria-label="Duck"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-[#f0d878]"
            onPointerDown={(e) => { e.preventDefault(); keysRef.current.duck = true; }}
            onPointerUp={() => { keysRef.current.duck = false; }}
            onPointerLeave={() => { keysRef.current.duck = false; }}
          >
            <ArrowBigDown className="h-6 w-6" />
          </button>
          <button
            type="button"
            aria-label="Jump"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-[#f0d878]"
            onPointerDown={(e) => { e.preventDefault(); jump(); }}
          >
            <ArrowBigUp className="h-6 w-6" />
          </button>
        </div>
      )}
    </div>
  );
}
