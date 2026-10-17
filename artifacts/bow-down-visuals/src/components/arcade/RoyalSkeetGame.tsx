import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, Crosshair } from "lucide-react";
import {
  SKEET,
  skeetAccuracy,
  skeetHitPoints,
  skeetSpawnIntervalMs,
  type ArcadeRunResult,
} from "@/lib/arcade-games";
import { gameSfx } from "@/lib/game-sound";
import GameSoundToggle from "@/components/GameSoundToggle";

/* ─── Royal Skeet ("Break the Plates") ────────────────────────────────────
   Canvas skeet in the palace courtyard: 45-second rounds. Gold plates
   launch from the terrace pedestals and arc across the sky on real
   trajectories — click / tap to shatter them mid-flight. A hit scores
   100 + streak bonus (up to +50) in a burst of shards; a shot that
   hits nothing costs 25 and breaks the streak; a plate that sails by
   unbroken costs nothing. Scoring lives in lib/arcade-games.ts — the
   server validates submissions against those same constants (this game
   replaced the Shooter Gallery and carries its contract whole). */

type Phase = "ready" | "playing" | "over";

interface Plate {
  id: number; x: number; y: number; vx: number; vy: number;
  rot: number; vr: number; bornAt: number;
}
interface Shard {
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number; life: number; maxLife: number; size: number;
}
interface Pop { x: number; y: number; at: number; points: number }
interface Ripple { x: number; y: number; at: number }

interface SkeetState {
  startedAt: number;
  plates: Plate[];
  shards: Shard[];
  pops: Pop[];
  ripples: Ripple[];
  nextId: number;
  lastSpawnAt: number;
  score: number;
  streak: number;
  bestStreak: number;
  hits: number;
  shots: number;
  pointer: { x: number; y: number } | null;
  over: boolean;
}

const FLOOR_Y = 486; // top of the courtyard terrace
const GRAVITY = 1500; // px/s^2
const LAUNCHERS = [
  { x: 74, y: FLOOR_Y - 8 },
  { x: SKEET.width - 74, y: FLOOR_Y - 8 },
] as const;

export default function RoyalSkeetGame({
  light,
  onGameOver,
}: {
  light: boolean;
  onGameOver: (r: ArcadeRunResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<SkeetState | null>(null);
  const phaseRef = useRef<Phase>("ready");
  const overFiredRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("ready");
  const [hud, setHud] = useState({ score: 0, streak: 0, timeLeft: SKEET.roundMs / 1000, accuracy: 0 });

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const start = () => {
    stateRef.current = {
      startedAt: performance.now(),
      plates: [],
      shards: [],
      pops: [],
      ripples: [],
      nextId: 1,
      lastSpawnAt: 0,
      score: 0,
      streak: 0,
      bestStreak: 0,
      hits: 0,
      shots: 0,
      pointer: null,
      over: false,
    };
    overFiredRef.current = false;
    setHud({ score: 0, streak: 0, timeLeft: SKEET.roundMs / 1000, accuracy: 0 });
    setPhaseBoth("playing");
  };

  const toLogical = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SKEET.width,
      y: ((e.clientY - rect.top) / rect.height) * SKEET.height,
    };
  };

  const shatter = (s: SkeetState, plate: Plate) => {
    for (let i = 0; i < 12; i++) {
      if (s.shards.length > 260) break;
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 260;
      s.shards.push({
        x: plate.x, y: plate.y,
        vx: plate.vx * 0.35 + Math.cos(a) * v,
        vy: plate.vy * 0.3 + Math.sin(a) * v - 60,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 14,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.5,
        size: 4 + Math.random() * 8,
      });
    }
  };

  const shoot = (e: React.PointerEvent) => {
    const s = stateRef.current;
    if (!s || phaseRef.current !== "playing" || s.over) return;
    const { x, y } = toLogical(e);
    const now = performance.now();
    s.shots += 1;
    gameSfx.shot();
    // Newest plates first — they're visually on top.
    const idx = [...s.plates]
      .reverse()
      .findIndex((p) => Math.hypot(p.x - x, p.y - y) <= SKEET.plateRadius);
    if (idx >= 0) {
      const realIdx = s.plates.length - 1 - idx;
      const [hit] = s.plates.splice(realIdx, 1);
      const points = skeetHitPoints(s.streak);
      s.score += points;
      s.streak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      s.hits += 1;
      if (hit) {
        shatter(s, hit);
        s.pops.push({ x: hit.x, y: hit.y, at: now, points });
        gameSfx.shatter();
      }
    } else {
      s.streak = 0;
      s.score = Math.max(0, s.score - SKEET.missPenalty);
      s.pops.push({ x, y, at: now, points: -SKEET.missPenalty });
      s.ripples.push({ x, y, at: now });
      gameSfx.thud();
    }
    setHud({
      score: s.score,
      streak: s.streak,
      timeLeft: Math.max(0, Math.ceil((SKEET.roundMs - (now - s.startedAt)) / 1000)),
      accuracy: skeetAccuracy(s.hits, s.shots),
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let hudAt = 0;
    let last = performance.now();

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      const W = SKEET.width;
      const H = SKEET.height;

      /* ---- update ---- */
      if (phaseRef.current === "playing" && s && !s.over) {
        const elapsed = now - s.startedAt;
        if (elapsed >= SKEET.roundMs) {
          s.over = true;
          if (!overFiredRef.current) {
            overFiredRef.current = true;
            setPhaseBoth("over");
            onGameOver({
              game: "skeet",
              score: s.score,
              durationMs: Math.round(elapsed),
            });
          }
        } else {
          if (elapsed - s.lastSpawnAt >= skeetSpawnIntervalMs(elapsed)) {
            s.lastSpawnAt = elapsed;
            const fromLeft = Math.random() < 0.5;
            const L = fromLeft ? LAUNCHERS[0] : LAUNCHERS[1];
            const dir = fromLeft ? 1 : -1;
            s.plates.push({
              id: s.nextId++,
              x: L.x,
              y: L.y,
              vx: dir * (250 + Math.random() * 140),
              vy: -(740 + Math.random() * 170),
              rot: Math.random() * Math.PI,
              vr: (Math.random() - 0.5) * 3.2,
              bornAt: now,
            });
          }
          for (const p of s.plates) {
            p.vy += GRAVITY * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
          }
          // Plates that land on the terrace are gone — no penalty.
          s.plates = s.plates.filter((p) => p.y < FLOOR_Y + 30 && p.x > -70 && p.x < W + 70);
          for (const sh of s.shards) {
            sh.life += dt;
            sh.vy += GRAVITY * 0.55 * dt;
            sh.x += sh.vx * dt;
            sh.y += sh.vy * dt;
            sh.rot += sh.vr * dt;
          }
          s.shards = s.shards.filter((sh) => sh.life < sh.maxLife && sh.y < FLOOR_Y + 16);
          s.pops = s.pops.filter((p) => now - p.at < 650);
          s.ripples = s.ripples.filter((r) => now - r.at < 320);
          if (now - hudAt > 200) {
            hudAt = now;
            setHud({
              score: s.score,
              streak: s.streak,
              timeLeft: Math.max(0, Math.ceil((SKEET.roundMs - elapsed) / 1000)),
              accuracy: skeetAccuracy(s.hits, s.shots),
            });
          }
        }
      }

      /* ---- draw: the palace courtyard ---- */
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      if (light) {
        sky.addColorStop(0, "#f2e2b8");
        sky.addColorStop(0.55, "#f7ecd2");
        sky.addColorStop(1, "#fbf6e9");
      } else {
        sky.addColorStop(0, "#070503");
        sky.addColorStop(0.55, "#0d0a04");
        sky.addColorStop(1, "#1a1409");
      }
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Warm glow
      const glow = ctx.createRadialGradient(W * 0.5, 30, 10, W * 0.5, 30, 420);
      glow.addColorStop(0, light ? "rgba(255,214,120,0.45)" : "rgba(240,216,120,0.16)");
      glow.addColorStop(1, "rgba(240,216,120,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, FLOOR_Y);

      // Palace backdrop: silhouette + colonnade row
      ctx.fillStyle = light ? "rgba(176,137,47,0.25)" : "rgba(201,168,76,0.10)";
      ctx.fillRect(150, 84, 660, FLOOR_Y - 84);
      ctx.beginPath();
      ctx.arc(480, 84, 92, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(474, 20, 12, 34);
      for (let cx = 190; cx <= 740; cx += 55) {
        ctx.fillStyle = light ? "rgba(122,90,18,0.30)" : "rgba(201,168,76,0.16)";
        ctx.fillRect(cx, 190, 13, FLOOR_Y - 190);
        ctx.fillStyle = "rgba(240,216,120,0.5)";
        ctx.fillRect(cx + 11, 190, 2, FLOOR_Y - 190);
      }
      // Balustrade line above the terrace
      ctx.fillStyle = light ? "rgba(122,90,18,0.35)" : "rgba(201,168,76,0.25)";
      ctx.fillRect(0, FLOOR_Y - 26, W, 4);
      for (let bx = 14; bx < W; bx += 30) {
        ctx.fillRect(bx, FLOOR_Y - 22, 5, 18);
      }

      // Terrace floor
      const floorGrad = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
      if (light) {
        floorGrad.addColorStop(0, "#f4e7c3");
        floorGrad.addColorStop(1, "#e2cd93");
      } else {
        floorGrad.addColorStop(0, "#2a1e0c");
        floorGrad.addColorStop(1, "#14100a");
      }
      ctx.fillStyle = floorGrad;
      ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
      ctx.fillStyle = "#C9A84C";
      ctx.fillRect(0, FLOOR_Y, W, 3);
      ctx.fillStyle = light ? "rgba(122,90,18,0.22)" : "rgba(201,168,76,0.16)";
      for (let x = 30; x < W; x += 96) {
        ctx.beginPath();
        ctx.moveTo(x, H - 4);
        ctx.lineTo(x + 42, FLOOR_Y + 8);
        ctx.lineTo(x + 62, FLOOR_Y + 8);
        ctx.lineTo(x + 20, H - 4);
        ctx.closePath();
        ctx.fill();
      }

      // Launcher pedestals
      for (const L of LAUNCHERS) {
        ctx.fillStyle = light ? "#e9d9ac" : "#33270f";
        ctx.beginPath();
        ctx.moveTo(L.x - 26, FLOOR_Y + 2);
        ctx.lineTo(L.x - 12, FLOOR_Y - 22);
        ctx.lineTo(L.x + 12, FLOOR_Y - 22);
        ctx.lineTo(L.x + 26, FLOOR_Y + 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#C9A84C";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#C9A84C";
        ctx.beginPath();
        ctx.arc(L.x, FLOOR_Y - 24, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (s) {
        // Flight-path ghosts: a faint dotted arc for the youngest plate
        // makes the physics readable at a glance.
        const youngest = s.plates[s.plates.length - 1];
        if (youngest && now - youngest.bornAt < 420) {
          ctx.fillStyle = light ? "rgba(122,90,18,0.30)" : "rgba(240,216,120,0.30)";
          let gx = youngest.x;
          let gy = youngest.y;
          let gvx = youngest.vx;
          let gvy = youngest.vy;
          for (let i = 0; i < 9; i++) {
            gvy += GRAVITY * 0.09;
            gx += gvx * 0.09;
            gy += gvy * 0.09;
            ctx.beginPath();
            ctx.arc(gx, gy, 2.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Plates: gold discs with a fin emblem, tumbling slowly
        for (const p of s.plates) {
          // Soft shadow tracking on the terrace while the plate is low
          if (p.y > FLOOR_Y - 190) {
            const shScale = 1 - Math.min(1, (FLOOR_Y - p.y) / 190) * 0.5;
            ctx.fillStyle = `rgba(0,0,0,${0.20 * shScale})`;
            ctx.beginPath();
            ctx.ellipse(p.x, FLOOR_Y + 10, SKEET.plateRadius * shScale, 5, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          const r = SKEET.plateRadius;
          const disc = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.15, 0, 0, r);
          disc.addColorStop(0, "#fbeea4");
          disc.addColorStop(0.62, "#e8c86a");
          disc.addColorStop(0.88, "#C9A84C");
          disc.addColorStop(1, "#7A5A12");
          ctx.fillStyle = disc;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#7A5A12";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.68, 0, Math.PI * 2);
          ctx.stroke();
          // Fin emblem
          ctx.fillStyle = "rgba(20,16,10,0.88)";
          ctx.beginPath();
          ctx.moveTo(-r * 0.34, r * 0.3);
          ctx.quadraticCurveTo(r * 0.05, -r * 0.52, r * 0.42, r * 0.27);
          ctx.quadraticCurveTo(r * 0.1, r * 0.38, -r * 0.34, r * 0.3);
          ctx.fill();
          // Rim light tick
          ctx.strokeStyle = "rgba(255,246,200,0.8)";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, 0, r - 2, -2.4, -1.5);
          ctx.stroke();
          ctx.restore();
        }

        // Shards: tumbling gold fragments
        for (const sh of s.shards) {
          const a = 1 - sh.life / sh.maxLife;
          ctx.save();
          ctx.globalAlpha = a;
          ctx.translate(sh.x, sh.y);
          ctx.rotate(sh.rot);
          ctx.fillStyle = "#e8c86a";
          ctx.beginPath();
          ctx.moveTo(-sh.size / 2, -sh.size / 3);
          ctx.lineTo(sh.size / 2, -sh.size / 4);
          ctx.lineTo(sh.size / 4, sh.size / 2);
          ctx.lineTo(-sh.size / 3, sh.size / 3);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "#7A5A12";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        }

        // Miss ripples
        for (const rp of s.ripples) {
          const age = (now - rp.at) / 320;
          ctx.save();
          ctx.globalAlpha = 1 - age;
          ctx.strokeStyle = "#e0654f";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(rp.x, rp.y, 6 + age * 20, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Score pops
        for (const p of s.pops) {
          const age = (now - p.at) / 650;
          ctx.save();
          ctx.globalAlpha = 1 - age;
          ctx.fillStyle = p.points >= 0 ? "#b8912f" : "#e0654f";
          ctx.font = "900 22px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            p.points >= 0 ? `+${p.points}` : `${p.points}`,
            p.x,
            p.y - 34 - age * 26,
          );
          ctx.restore();
        }

        // Crosshair
        if (s.pointer && phaseRef.current === "playing") {
          ctx.strokeStyle = light ? "#7A5A12" : "#f0d878";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(s.pointer.x, s.pointer.y, 16, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(s.pointer.x - 24, s.pointer.y);
          ctx.lineTo(s.pointer.x - 8, s.pointer.y);
          ctx.moveTo(s.pointer.x + 8, s.pointer.y);
          ctx.lineTo(s.pointer.x + 24, s.pointer.y);
          ctx.moveTo(s.pointer.x, s.pointer.y - 24);
          ctx.lineTo(s.pointer.x, s.pointer.y - 8);
          ctx.moveTo(s.pointer.x, s.pointer.y + 8);
          ctx.lineTo(s.pointer.x, s.pointer.y + 24);
          ctx.stroke();
        }
      }

      // Timer bar
      if (phaseRef.current === "playing" && s) {
        const frac = Math.max(0, 1 - (now - s.startedAt) / SKEET.roundMs);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, W, 8);
        ctx.fillStyle = "#C9A84C";
        ctx.fillRect(0, 0, W * frac, 8);
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
        width={SKEET.width}
        height={SKEET.height}
        className="block h-auto w-full cursor-crosshair touch-none select-none rounded-xl"
        onPointerDown={shoot}
        onPointerMove={(e) => {
          const s = stateRef.current;
          if (s) s.pointer = toLogical(e);
        }}
        onPointerLeave={() => {
          const s = stateRef.current;
          if (s) s.pointer = null;
        }}
        data-testid="skeet-canvas"
      />
      <div className="pointer-events-none absolute left-3 top-4 flex flex-wrap gap-2 text-xs font-bold">
        <span className={`rounded-full bg-black/60 px-3 py-1 ${light ? "text-[#7A5A12]" : "text-[#f0d878]"}`}>
          Score {hud.score.toLocaleString()}
        </span>
        <span className="rounded-full bg-black/60 px-3 py-1 text-white/85">
          {hud.timeLeft}s left
        </span>
        <span className="rounded-full bg-black/60 px-3 py-1 text-white/85">
          Streak {hud.streak}
        </span>
        <span className="rounded-full bg-black/60 px-3 py-1 text-white/85">
          Accuracy {hud.accuracy}%
        </span>
      </div>
      <div className="absolute right-3 top-4">
        <GameSoundToggle light={light} />
      </div>

      {phase === "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/55 text-center">
          <p className="max-w-sm px-4 text-sm text-white/80">
            Gold plates arc across the courtyard — click or tap to shatter
            them mid-flight. Hits build your streak bonus. A shot that hits
            nothing costs 25 and breaks it.
          </p>
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
            data-testid="skeet-start"
          >
            <Play className="h-4 w-4" /> Start round
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
            <p className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.25em] opacity-70">
              <Crosshair className="h-4 w-4" /> Round over
            </p>
            <p className="mt-1 text-4xl font-black text-[#b8912f] dark:text-[#f0d878]">
              {hud.score.toLocaleString()}
            </p>
            <p className="mt-1 text-xs font-semibold opacity-75">
              {hud.accuracy}% accuracy this round
            </p>
            <button
              type="button"
              onClick={start}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
              data-testid="skeet-restart"
            >
              <RotateCcw className="h-4 w-4" /> Shoot again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
