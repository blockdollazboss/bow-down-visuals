import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, Crosshair } from "lucide-react";
import {
  GALLERY,
  galleryAccuracy,
  galleryHitPoints,
  gallerySpawnIntervalMs,
  type ArcadeRunResult,
} from "@/lib/arcade-games";

/* ─── Shooter Gallery ─────────────────────────────────────────────────────
   Canvas target gallery: 45-second rounds. Gold fin targets pop up in
   three rows; click / tap to shoot. Hit = 100 + streak bonus (up to
   +50); a miss costs 25 and breaks the streak. Scoring lives in
   lib/arcade-games.ts — the server validates against those constants. */

type Phase = "ready" | "playing" | "over";

interface Target { id: number; x: number; y: number; bornAt: number; expiresAt: number }
interface Pop { x: number; y: number; at: number; points: number }

interface GalleryState {
  startedAt: number;
  targets: Target[];
  pops: Pop[];
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

const COLS = [140, 320, 500, 680, 860];
const ROWS = [150, 300, 450];

export default function ShooterGalleryGame({
  light,
  onGameOver,
}: {
  light: boolean;
  onGameOver: (r: ArcadeRunResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GalleryState | null>(null);
  const phaseRef = useRef<Phase>("ready");
  const overFiredRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("ready");
  const [hud, setHud] = useState({ score: 0, streak: 0, timeLeft: GALLERY.roundMs / 1000, accuracy: 0 });

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const start = () => {
    stateRef.current = {
      startedAt: performance.now(),
      targets: [],
      pops: [],
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
    setHud({ score: 0, streak: 0, timeLeft: GALLERY.roundMs / 1000, accuracy: 0 });
    setPhaseBoth("playing");
  };

  const toLogical = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * GALLERY.width,
      y: ((e.clientY - rect.top) / rect.height) * GALLERY.height,
    };
  };

  const shoot = (e: React.PointerEvent) => {
    const s = stateRef.current;
    if (!s || phaseRef.current !== "playing" || s.over) return;
    const { x, y } = toLogical(e);
    const now = performance.now();
    s.shots += 1;
    // Newest targets first — they're visually on top.
    const idx = [...s.targets]
      .reverse()
      .findIndex((t) => Math.hypot(t.x - x, t.y - y) <= GALLERY.targetRadius);
    if (idx >= 0) {
      const realIdx = s.targets.length - 1 - idx;
      const [hit] = s.targets.splice(realIdx, 1);
      const points = galleryHitPoints(s.streak);
      s.score += points;
      s.streak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      s.hits += 1;
      if (hit) s.pops.push({ x: hit.x, y: hit.y, at: now, points });
    } else {
      s.streak = 0;
      s.score = Math.max(0, s.score - GALLERY.missPenalty);
      s.pops.push({ x, y, at: now, points: -GALLERY.missPenalty });
    }
    setHud({
      score: s.score,
      streak: s.streak,
      timeLeft: Math.max(0, Math.ceil((GALLERY.roundMs - (now - s.startedAt)) / 1000)),
      accuracy: galleryAccuracy(s.hits, s.shots),
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let hudAt = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const s = stateRef.current;
      const W = GALLERY.width;
      const H = GALLERY.height;

      /* ---- update ---- */
      if (phaseRef.current === "playing" && s && !s.over) {
        const elapsed = now - s.startedAt;
        if (elapsed >= GALLERY.roundMs) {
          s.over = true;
          if (!overFiredRef.current) {
            overFiredRef.current = true;
            setPhaseBoth("over");
            onGameOver({
              game: "gallery",
              score: s.score,
              durationMs: Math.round(elapsed),
            });
          }
        } else {
          if (elapsed - s.lastSpawnAt >= gallerySpawnIntervalMs(elapsed)) {
            s.lastSpawnAt = elapsed;
            const occupied = new Set(s.targets.map((t) => `${t.x}:${t.y}`));
            const free: { x: number; y: number }[] = [];
            for (const x of COLS) for (const y of ROWS) {
              if (!occupied.has(`${x}:${y}`)) free.push({ x, y });
            }
            const slot = free[Math.floor(Math.random() * free.length)];
            if (slot) {
              s.targets.push({
                id: s.nextId++,
                x: slot.x,
                y: slot.y,
                bornAt: now,
                expiresAt: now + GALLERY.targetLifetimeMs,
              });
            }
          }
          s.targets = s.targets.filter((t) => t.expiresAt > now);
          s.pops = s.pops.filter((p) => now - p.at < 600);
          if (now - hudAt > 200) {
            hudAt = now;
            setHud({
              score: s.score,
              streak: s.streak,
              timeLeft: Math.max(0, Math.ceil((GALLERY.roundMs - elapsed) / 1000)),
              accuracy: galleryAccuracy(s.hits, s.shots),
            });
          }
        }
      }

      /* ---- draw ---- */
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      if (light) {
        bg.addColorStop(0, "#fbf6e9");
        bg.addColorStop(1, "#f4e7c3");
      } else {
        bg.addColorStop(0, "#14100a");
        bg.addColorStop(1, "#0d0a04");
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Gallery stands (three rows)
      for (const y of ROWS) {
        ctx.fillStyle = light ? "#e7d29c" : "#241a0c";
        ctx.fillRect(40, y + 44, W - 80, 14);
        ctx.fillStyle = "#C9A84C";
        ctx.fillRect(40, y + 44, W - 80, 2);
      }

      if (s) {
        // Targets: gold ring + shark-fin silhouette
        for (const t of s.targets) {
          const life = 1 - (t.expiresAt - now) / GALLERY.targetLifetimeMs;
          const scale = Math.min(1, (now - t.bornAt) / 120);
          const r = GALLERY.targetRadius * scale;
          ctx.save();
          ctx.globalAlpha = life > 0.8 ? 1 - (life - 0.8) * 2.5 : 1;
          const ring = ctx.createRadialGradient(t.x, t.y, r * 0.2, t.x, t.y, r);
          ring.addColorStop(0, "#f7e08a");
          ring.addColorStop(0.75, "#C9A84C");
          ring.addColorStop(1, "#7A5A12");
          ctx.fillStyle = ring;
          ctx.beginPath();
          ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(20,16,10,0.9)";
          ctx.beginPath();
          ctx.arc(t.x, t.y, r * 0.62, 0, Math.PI * 2);
          ctx.fill();
          // Fin
          ctx.fillStyle = "#f0d878";
          ctx.beginPath();
          ctx.moveTo(t.x - r * 0.34, t.y + r * 0.3);
          ctx.quadraticCurveTo(t.x + r * 0.05, t.y - r * 0.5, t.x + r * 0.4, t.y + r * 0.28);
          ctx.quadraticCurveTo(t.x + r * 0.1, t.y + r * 0.36, t.x - r * 0.34, t.y + r * 0.3);
          ctx.fill();
          ctx.restore();
        }
        // Hit/miss pops
        for (const p of s.pops) {
          const age = (now - p.at) / 600;
          ctx.save();
          ctx.globalAlpha = 1 - age;
          ctx.fillStyle = p.points >= 0 ? "#f0d878" : "#e0654f";
          ctx.font = "black 22px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            p.points >= 0 ? `+${p.points}` : `${p.points}`,
            p.x,
            p.y - 30 - age * 24,
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
        const frac = Math.max(0, 1 - (now - s.startedAt) / GALLERY.roundMs);
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
        width={GALLERY.width}
        height={GALLERY.height}
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
        data-testid="gallery-canvas"
      />
      <div className="pointer-events-none absolute left-3 top-4 flex flex-wrap gap-2 text-xs font-bold">
        <span className="rounded-full bg-black/60 px-3 py-1 text-[#f0d878]">
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

      {phase === "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/55 text-center">
          <p className="max-w-sm px-4 text-sm text-white/80">
            Gold fins pop up for a split second — click or tap to shoot.
            Hits build your streak bonus. Misses cost 25 and break it.
          </p>
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
            data-testid="gallery-start"
          >
            <Play className="h-4 w-4" /> Start round
          </button>
        </div>
      )}
      {phase === "over" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/60 text-center">
          <p className="inline-flex items-center gap-2 text-lg font-black text-[#f0d878]">
            <Crosshair className="h-5 w-5" /> Round over — {hud.score.toLocaleString()} points
          </p>
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#f0d878] to-[#C9A84C] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110"
            data-testid="gallery-restart"
          >
            <RotateCcw className="h-4 w-4" /> Shoot again
          </button>
        </div>
      )}
    </div>
  );
}
