import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, ArrowBigUp, ArrowBigDown } from "lucide-react";
import {
  RUNNER,
  runnerScore,
  runnerSpeedAt,
  type ArcadeRunResult,
} from "@/lib/arcade-games";

/* ─── Shark King Endless Runner ───────────────────────────────────────────
   Canvas side-scroller. The King (real brand avatar, gold ring) rides a
   gold board over the palace floor: jump crates + spikes, duck banners,
   collect Visual Bucs coins. Speed ramps 420 → 900 px/s. One hit ends
   the run. Controls: Space / ↑ / W or tap to jump, ↓ / S to duck
   (on-screen buttons on touch). Scoring lives in lib/arcade-games.ts —
   the server validates submissions against those same constants. */

type Phase = "ready" | "playing" | "over";

interface Obstacle { x: number; w: number; h: number; kind: "crate" | "spike" | "banner" }
interface Coin { x: number; y: number; taken: boolean }

interface RunState {
  startedAt: number;
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
}

const PLAYER_X = 120;
const PLAYER_W = 62;
const STAND_H = 62;
const DUCK_H = 40;

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
    startedAt: performance.now(),
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
  });

  const jump = () => {
    const s = stateRef.current;
    if (!s || phaseRef.current !== "playing") return;
    const groundTop = RUNNER.groundY - STAND_H;
    if (s.playerY >= groundTop - 0.5 && s.vy === 0) {
      s.vy = -RUNNER.jumpVelocity;
    }
  };

  const start = () => {
    stateRef.current = freshState();
    overFiredRef.current = false;
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
    coin.src = "/visual-bucs-coin-transparent.png";
    coin.onload = () => { imagesRef.current.coin = coin; };
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
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      const W = RUNNER.width;
      const H = RUNNER.height;
      const gY = RUNNER.groundY;

      /* ---- update ---- */
      if (phaseRef.current === "playing" && s && !s.over) {
        const elapsed = now - s.startedAt;
        const speed = runnerSpeedAt(elapsed);
        s.distancePx += speed * dt;
        s.ducking = keysRef.current.duck;

        // Player physics (duck = fast-fall + low profile)
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
        const playerH = s.ducking && s.vy === 0 ? DUCK_H : STAND_H;
        if (s.vy === 0) s.playerY = gY - playerH;

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
        // Move + cull
        for (const ob of s.obstacles) ob.x -= speed * dt;
        s.obstacles = s.obstacles.filter((ob) => ob.x + ob.w > -60);
        for (const c of s.coins) c.x -= speed * dt;
        s.coins = s.coins.filter((c) => c.x > -40 && !c.taken);

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
            s.over = true;
            break;
          }
        }
        for (const c of s.coins) {
          const cx = c.x;
          const cy = c.y;
          if (
            cx > pBox.x - 14 &&
            cx < pBox.x + pBox.w + 14 &&
            cy > pBox.y - 14 &&
            cy < pBox.y + pBox.h + 14
          ) {
            c.taken = true;
            s.coinsCollected += 1;
          }
        }

        if (now - hudAt > 120) {
          hudAt = now;
          setHud({
            score: runnerScore(s.distancePx, s.coinsCollected),
            coins: s.coinsCollected,
          });
        }

        if (s.over && !overFiredRef.current) {
          overFiredRef.current = true;
          const durationMs = Math.round(now - s.startedAt);
          setPhaseBoth("over");
          onGameOver({
            game: "runner",
            score: runnerScore(s.distancePx, s.coinsCollected),
            durationMs,
          });
        }
      }

      /* ---- draw ---- */
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      if (light) {
        sky.addColorStop(0, "#f7ecd2");
        sky.addColorStop(0.75, "#fbf6e9");
        sky.addColorStop(1, "#f4e7c3");
      } else {
        sky.addColorStop(0, "#0d0a04");
        sky.addColorStop(0.75, "#14100a");
        sky.addColorStop(1, "#1a1409");
      }
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Distant palace skyline (slow parallax from distance)
      const par = (s?.distancePx ?? 0) * 0.25;
      ctx.fillStyle = light ? "rgba(201,168,76,0.20)" : "rgba(201,168,76,0.13)";
      for (let i = 0; i < 7; i++) {
        const bw = 90 + (i % 3) * 40;
        const bh = 60 + ((i * 37) % 70);
        const bx = ((i * 210 - (par % 210)) + W + 210) % (W + 210) - 210;
        ctx.fillRect(bx, gY - bh, bw, bh);
        ctx.beginPath();
        ctx.moveTo(bx + bw / 2, gY - bh - 18);
        ctx.lineTo(bx + bw + 8, gY - bh);
        ctx.lineTo(bx - 8, gY - bh);
        ctx.closePath();
        ctx.fill();
      }

      // Ground: marble band + gold trim
      ctx.fillStyle = light ? "#efe0ba" : "#241a0c";
      ctx.fillRect(0, gY, W, H - gY);
      ctx.fillStyle = "#C9A84C";
      ctx.fillRect(0, gY, W, 3);
      const stripeOff = (s?.distancePx ?? 0) % 64;
      ctx.fillStyle = light ? "rgba(122,90,18,0.25)" : "rgba(201,168,76,0.18)";
      for (let x = -stripeOff; x < W; x += 64) {
        ctx.fillRect(x, gY + 22, 30, 3);
      }

      if (s) {
        // Coins
        for (const c of s.coins) {
          const img = imagesRef.current.coin;
          if (img) {
            ctx.drawImage(img, c.x - 15, c.y - 15, 30, 30);
          } else {
            ctx.fillStyle = "#f0d878";
            ctx.beginPath();
            ctx.arc(c.x, c.y, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#7A5A12";
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
        // Obstacles
        for (const ob of s.obstacles) {
          if (ob.kind === "crate") {
            ctx.fillStyle = light ? "#8a6a24" : "#3a2a10";
            ctx.fillRect(ob.x, gY - ob.h, ob.w, ob.h);
            ctx.strokeStyle = "#C9A84C";
            ctx.lineWidth = 2;
            ctx.strokeRect(ob.x + 1, gY - ob.h + 1, ob.w - 2, ob.h - 2);
            ctx.beginPath();
            ctx.moveTo(ob.x, gY - ob.h);
            ctx.lineTo(ob.x + ob.w, gY);
            ctx.moveTo(ob.x + ob.w, gY - ob.h);
            ctx.lineTo(ob.x, gY);
            ctx.stroke();
          } else if (ob.kind === "spike") {
            ctx.fillStyle = "#C9A84C";
            ctx.beginPath();
            ctx.moveTo(ob.x, gY);
            ctx.lineTo(ob.x + ob.w / 2, gY - ob.h);
            ctx.lineTo(ob.x + ob.w, gY);
            ctx.closePath();
            ctx.fill();
          } else {
            // Banner: rod + hanging gold banner with a dark fin cut
            ctx.fillStyle = "#7A5A12";
            ctx.fillRect(ob.x - 4, 0, ob.w + 8, 6);
            const grad = ctx.createLinearGradient(0, 0, 0, gY - 52);
            grad.addColorStop(0, "#e8c86a");
            grad.addColorStop(1, "#b8912f");
            ctx.fillStyle = grad;
            ctx.fillRect(ob.x, 6, ob.w, gY - 52 - 6);
            ctx.fillStyle = "rgba(20,16,10,0.85)";
            ctx.beginPath();
            ctx.moveTo(ob.x + ob.w / 2, 40);
            ctx.lineTo(ob.x + ob.w - 10, gY - 90);
            ctx.lineTo(ob.x + 10, gY - 90);
            ctx.closePath();
            ctx.fill();
          }
        }

        // The King on his gold board
        const playerH = s.ducking && s.vy === 0 ? DUCK_H : STAND_H;
        const bob = s.vy === 0 && phaseRef.current === "playing" ? Math.sin(now / 90) * 1.5 : 0;
        const py = s.playerY + bob;
        ctx.fillStyle = "#C9A84C";
        ctx.beginPath();
        ctx.ellipse(PLAYER_X + PLAYER_W / 2, gY + 8, 40, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = light ? "#d9b84f" : "#a8823a";
        ctx.fillRect(PLAYER_X - 4, gY + 1, PLAYER_W + 10, 5);
        const avatar = imagesRef.current.avatar;
        const r = playerH / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(PLAYER_X + PLAYER_W / 2, py + r, r, 0, Math.PI * 2);
        ctx.clip();
        if (avatar) {
          ctx.drawImage(avatar, PLAYER_X + PLAYER_W / 2 - r, py, playerH, playerH);
        } else {
          // Fallback: gold disc + crown spikes (never a stock emoji)
          ctx.fillStyle = "#1a1409";
          ctx.fillRect(PLAYER_X, py, PLAYER_W, playerH);
          ctx.fillStyle = "#f0d878";
          ctx.beginPath();
          ctx.moveTo(PLAYER_X + 14, py + 22);
          ctx.lineTo(PLAYER_X + 22, py + 8);
          ctx.lineTo(PLAYER_X + 31, py + 20);
          ctx.lineTo(PLAYER_X + 40, py + 8);
          ctx.lineTo(PLAYER_X + 48, py + 22);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = "#C9A84C";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(PLAYER_X + PLAYER_W / 2, py + r, r, 0, Math.PI * 2);
        ctx.stroke();
      }
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
        <span className="rounded-full bg-black/60 px-3 py-1 text-[#f0d878]">
          Score {hud.score.toLocaleString()}
        </span>
        <span className="rounded-full bg-black/60 px-3 py-1 text-white/85">
          Coins {hud.coins}
        </span>
      </div>

      {phase === "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/55 text-center">
          <p className="max-w-sm px-4 text-sm text-white/80">
            Space / tap to jump the crates and spikes. Duck under the gold
            banners. One hit ends the run.
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/60 text-center">
          <p className="text-lg font-black text-[#f0d878]">
            Run over — {hud.score.toLocaleString()} points
          </p>
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
            data-testid="runner-restart"
          >
            <RotateCcw className="h-4 w-4" /> Run it again
          </button>
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
