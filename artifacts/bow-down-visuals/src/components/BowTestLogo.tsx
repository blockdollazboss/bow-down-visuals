import { useEffect, useRef, useState } from "react";

/* ── TEST ONLY: click-to-bow sign-in logo ──────────────────────────
   Reuses the hero bow sprite sheets (102 frames of the shark king
   bowing). Click the logo → he bows down and back up. Bow count is kept
   in localStorage for test purposes only — the production version will
   track per-account in the database. */

const FRAMES = 102;
const BOW_END = 4.2;
const SHEETS = 3;
const COLS = 6;
const PER_SHEET = 36;
const FS = 600;
const COUNT_KEY = "bdv-bow-test-count";

export function BowTestLogo() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const posterRef = useRef<HTMLImageElement | null>(null);
  const [bows, setBows] = useState(() => {
    try {
      return parseInt(localStorage.getItem(COUNT_KEY) || "0", 10) || 0;
    } catch {
      return 0;
    }
  });
  const [bowing, setBowing] = useState(false);
  const bowState = useRef({ target: 0, current: 0, animating: false });

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

    const loop = () => {
      if (cancelled) return;
      st.current += (st.target - st.current) * 0.25;
      if (Math.abs(st.target - st.current) < 0.02) st.current = st.target;
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
    // Bow down, hold briefly, come back up.
    st.target = BOW_END;
    setTimeout(() => {
      st.target = 0;
      setTimeout(() => {
        st.animating = false;
        setBowing(false);
        setBows((n) => {
          const next = n + 1;
          try {
            localStorage.setItem(COUNT_KEY, String(next));
          } catch {
            /* ignore */
          }
          return next;
        });
      }, 900);
    }, 900);
  };

  const base = import.meta.env.BASE_URL;

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
      <p className="mt-1 text-[11px] tracking-widest uppercase text-white/40">
        Bows: <span className="text-[#c9a84c] font-semibold">{bows}</span>
        <span className="text-white/25"> · test</span>
      </p>
    </div>
  );
}
