import { useState } from "react";
import { FogSprites } from "@/components/fog-lab/FogSprites";
import { FogCanvas } from "@/components/fog-lab/FogCanvas";
import { FogSettled } from "@/components/SettledFog";

/* ─────────── /fog-lab — hero fog comparison lab ─────────── */
/* Hidden staging-only preview: the same stage backdrop under both fog
   approaches so they can be judged side by side. A = photographic smoke
   sprites (DOM), B = canvas particle simulation. Move the mouse through
   the fog to compare the streaming. */

type Mode = "sprites" | "canvas" | "settled";

function StageBackdrop() {
  return (
    <div aria-hidden className="absolute inset-0">
      {/* Base: near-black with a warm floor glow. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 40% at 50% 108%, rgba(212,175,55,0.22), transparent 70%)," +
            "radial-gradient(ellipse 55% 35% at 50% -6%, rgba(212,175,55,0.14), transparent 70%)," +
            "linear-gradient(#060606 0%, #0a0805 55%, #050403 100%)",
        }}
      />
      {/* Spotlight beams from the top. */}
      {[18, 38, 58, 78].map((left, i) => (
        <div
          key={i}
          className="absolute top-0 h-[75%] w-[13%]"
          style={{
            left: `${left}%`,
            transform: `skewX(${i % 2 === 0 ? -7 : 7}deg)`,
            background:
              "linear-gradient(to bottom, rgba(255,215,130,0.20), rgba(255,215,130,0.05) 60%, transparent)",
            filter: "blur(18px)",
          }}
        />
      ))}
      {/* Floor line. */}
      <div
        className="absolute inset-x-0 bottom-[30%] h-px"
        style={{ background: "linear-gradient(to right, transparent, rgba(212,175,55,0.35), transparent)" }}
      />
      {/* A stand-in "performer" silhouette so the fog has something to pool around. */}
      <div
        className="absolute bottom-[16%] left-1/2 h-[46%] w-[16%] -translate-x-1/2 rounded-t-full"
        style={{
          background: "linear-gradient(to bottom, #1a1a1c, #0b0b0d)",
          filter: "blur(2px)",
          boxShadow: "0 0 90px rgba(212,175,55,0.18)",
        }}
      />
    </div>
  );
}

export default function FogLab() {
  const [mode, setMode] = useState<Mode>("settled");

  const hint: Record<Mode, string> = {
    sprites: "A: photographic smoke puffs, DOM-animated.",
    canvas: "B: live particle simulation on canvas.",
    settled: "C: thin layer settled at the bottom — whip through it hard.",
  };

  const btn = (active: boolean) =>
    `rounded-full px-5 py-2 text-sm font-semibold tracking-wide transition ${
      active
        ? "bg-amber-300 text-black shadow-[0_0_24px_rgba(252,211,77,0.45)]"
        : "bg-white/10 text-amber-100/80 hover:bg-white/20"
    }`;

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black text-white">
      <StageBackdrop />

      {/* Fog under test — same footprint as the homepage hero fog. */}
      <div className="absolute inset-x-0 bottom-0 h-[46%]">
        {mode === "sprites" ? (
          <FogSprites className="inset-0 h-full w-full" />
        ) : mode === "canvas" ? (
          <FogCanvas className="inset-0 h-full w-full" />
        ) : (
          <FogSettled className="inset-0 h-full w-full" />
        )}
      </div>

      {/* Controls */}
      <div className="absolute left-1/2 top-6 z-10 flex -translate-x-1/2 flex-col items-center gap-3">
        <div className="flex gap-2 rounded-full bg-black/60 p-1 backdrop-blur">
          <button className={btn(mode === "sprites")} onClick={() => setMode("sprites")}>
            A · Smoke sprites
          </button>
          <button className={btn(mode === "canvas")} onClick={() => setMode("canvas")}>
            B · Particle canvas
          </button>
          <button className={btn(mode === "settled")} onClick={() => setMode("settled")}>
            C · Settled layer
          </button>
        </div>
        <p className="text-center text-sm text-white/60">
          Sweep your mouse through the fog — whip it to stir. {hint[mode]}
        </p>
      </div>

      <a
        href="/"
        className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 text-xs text-white/40 underline hover:text-white/70"
      >
        back to homepage
      </a>
    </div>
  );
}
