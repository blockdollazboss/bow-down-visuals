import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PixelSprite } from "@/components/pixel-headline";
import { cn } from "@/lib/utils";

/**
 * Cheat-code easter egg — a custom Konami-style secret for the 8-bit era.
 *
 * The code: type `cheatcode` anywhere on the page (outside text fields).
 * The reward: a Shark King coin-burst celebration with an 8-bit power-up
 * arpeggio. Pure theater — no real credits change hands.
 */

const SECRET_CODE = "cheatcode";
const COOLDOWN_MS = 10_000;

/** Tiny 8-bit power-up arpeggio — square wave, zero assets. */
function playPowerUp() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.16);
    });
    window.setTimeout(() => void ctx.close(), 900);
  } catch {
    /* audio is garnish — never break the page over it */
  }
}

type BurstCoin = {
  x: number;
  y: number;
  delay: number;
  pixel: number;
  spin: number;
};

function CoinBurst() {
  const coins = useMemo<BurstCoin[]>(
    () =>
      Array.from({ length: 26 }).map((_, i) => {
        const angle = (i / 26) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 130 + Math.random() * 190;
        return {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist - 60,
          delay: Math.random() * 0.25,
          pixel: 4 + Math.floor(Math.random() * 4),
          spin: Math.random() > 0.5 ? 1 : -1,
        };
      }),
    [],
  );
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {coins.map((c, i) => (
        <span
          key={i}
          className="pixel-coin-burst absolute"
          style={
            {
              "--burst-x": `${c.x}px`,
              "--burst-y": `${c.y}px`,
              animationDelay: `${c.delay}s`,
            } as React.CSSProperties
          }
        >
          <PixelSprite name="coin" pixel={c.pixel} />
        </span>
      ))}
    </div>
  );
}

export function CheatCodeEasterEgg() {
  const [fired, setFired] = useState(false);
  const buffer = useRef("");
  const lastFire = useRef(0);

  const dismiss = useCallback(() => setFired(false), []);

  useEffect(() => {
    if (!fired) return;
    const t = window.setTimeout(dismiss, 7000);
    return () => window.clearTimeout(t);
  }, [fired, dismiss]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        dismiss();
        return;
      }
      if (e.key.length !== 1) return;
      buffer.current = (buffer.current + e.key.toLowerCase()).slice(
        -SECRET_CODE.length,
      );
      if (
        buffer.current === SECRET_CODE &&
        Date.now() - lastFire.current > COOLDOWN_MS
      ) {
        lastFire.current = Date.now();
        buffer.current = "";
        setFired(true);
        playPowerUp();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  if (!fired) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cheat code accepted"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
      onClick={dismiss}
    >
      <CoinBurst />
      <div className="pixel-overlay-pop relative text-center">
        <div className="pixel-crown-bob mb-8 flex justify-center">
          <PixelSprite name="crown" pixel={11} />
        </div>
        <p className="pixel-display pixel-gold-text text-lg sm:text-2xl leading-[1.8]">
          Cheat Code
          <br />
          Accepted!
        </p>
        <div className="pixel-divider my-6 justify-center" aria-hidden="true">
          {Array.from({ length: 14 }).map((_, i) => (
            <span key={i} />
          ))}
        </div>
        <p className="text-white/70 text-sm sm:text-base max-w-sm mx-auto leading-relaxed">
          The King Shark bows to you.
          <br />
          You found the secret buried in the arcade.
        </p>
        <p
          className="pixel-display mt-5 text-[10px] sm:text-xs tracking-[0.2em] text-[#C9A84C] uppercase"
          style={{ textShadow: "2px 2px 0 rgba(0,0,0,0.9)" }}
        >
          +1,000,000 style points
        </p>
        <p className="mt-6 text-white/30 text-xs">
          (no actual credits were harmed)
        </p>
        <button
          type="button"
          onClick={dismiss}
          className={cn(
            "pixel-display mt-8 rounded-none border-2 border-[#C9A84C] bg-[#C9A84C]/10",
            "px-6 py-3 text-[10px] uppercase tracking-[0.2em] text-[#F5DE8E]",
            "hover:bg-[#C9A84C]/25 transition-colors",
          )}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
