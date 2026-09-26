import { useEffect, useRef, useState } from "react";

/* Click-to-bow shark: reuses the hero bow sprite sheets (102 frames).
   Click → smooth timed bow (down, hold, up). */

const FRAMES = 102;
const BOW_END = 4.2;
const SHEETS = 3;
const COLS = 6;
const PER_SHEET = 36;
const FS = 600;

export function BowTestLogo({ compact = false }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const posterRef = useRef<HTMLImageElement | null>(null);
  const [bowing, setBowing] = useState(false);
  const bowState = useRef({
    current: 0,
    animating: false,
    phase: "idle" as "idle" | "down" | "hold" | "up",
    phaseStart: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === "undefined") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const base = import.meta.env.BASE_URL;
    const sheets: (HTMLImageElement | null)[] = new Array(SHEETS).fill(null);
    let sheetsReady = 0;
    let drawnFrame = -1;
    let raf = 0;
    let cancelled = false;
    const st = bowState.current;

    const drawFrame = (f: number) => {
      if (f === drawnFrame) return;
      const sheet = sheets[Math.floor(f / PER_SHEET)];
      if (!sheet) return;
      const k = f % PER_SHEET;
      const sx = (k % COLS) * FS;
      const sy = Math.floor(k / COLS) * FS;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(sheet, sx, sy, FS, FS, 0, 0, canvas.width, canvas.height);
      drawnFrame = f;
      if (posterRef.current) posterRef.current.style.display = "none";
    };

    const frameFor = (t: number) =>
      Math.min(FRAMES - 1, Math.max(0, Math.round((t / BOW_END) * (FRAMES - 1))));

    for (let s = 0; s < SHEETS; s++) {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        sheets[s] = img;
        sheetsReady++;
        if (sheetsReady === 1) drawFrame(frameFor(st.current));
      };
      img.src = `${base}hero-bow-sheet-${s}.webp`;
      if (img.complete && img.naturalWidth > 0) {
        sheets[s] = img;
        sheetsReady++;
      }
    }
    if (sheets[0]) drawFrame(0);

    const DOWN_MS = 1100;
    const HOLD_MS = 450;
    const UP_MS = 1100;
    const easeInOut = (t: number) =>
      t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    const loop = (now: number) => {
      if (cancelled) return;
      if (st.phase !== "idle") {
        const elapsed = now - st.phaseStart;
        if (st.phase === "down") {
          const p = Math.min(1, elapsed / DOWN_MS);
          st.current = easeInOut(p) * BOW_END;
          if (p >= 1) { st.phase = "hold"; st.phaseStart = now; }
        } else if (st.phase === "hold") {
          st.current = BOW_END;
          if (elapsed >= HOLD_MS) { st.phase = "up"; st.phaseStart = now; }
        } else if (st.phase === "up") {
          const p = Math.min(1, elapsed / UP_MS);
          st.current = (1 - easeInOut(p)) * BOW_END;
          if (p >= 1) {
            st.phase = "idle"; st.current = 0; st.animating = false;
            setBowing(false);
          }
        }
      }
      drawFrame(frameFor(st.current));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  const doBow = () => {
    const st = bowState.current;
    if (st.animating) return;
    st.animating = true;
    setBowing(true);
    st.phase = "down";
    st.phaseStart = performance.now();
  };

  const base = import.meta.env.BASE_URL;

  if (compact) {
    return (
      <button
        type="button"
        onClick={doBow}
        aria-label="Make the shark king bow"
        title="Click me — I bow"
        className="relative h-11 w-11 shrink-0 cursor-pointer rounded-full transition-transform duration-300 hover:scale-105"
      >
        <img
          ref={posterRef}
          src={`${base}hero-bow-poster.webp`}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover rounded-full"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          width={FS}
          height={FS}
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label="Thy Cheat Code shark king"
        />
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={doBow}
        aria-label="Make the shark king bow"
        className={`relative w-28 h-28 cursor-pointer transition-transform duration-300 ${bowing ? "" : "hover:scale-105"}`}
      >
        <img
          ref={posterRef}
          src={`${base}hero-bow-poster.webp`}
          alt="Thy Cheat Code"
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover rounded-full"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          width={FS}
          height={FS}
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label="Thy Cheat Code shark king"
        />
      </button>
    </div>
  );
}
