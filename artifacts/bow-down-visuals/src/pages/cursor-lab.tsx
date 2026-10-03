import { useEffect, useRef, useState } from "react";

/* ─── Custom Cursor Lab ───
   Live demo of cursor options. User picks their favorite.
   Each cursor is disabled on touch devices. */

type CursorId = "shark-fin" | "bucs-coin" | "crown" | "gold-trail";

const CURSORS: { id: CursorId; name: string; description: string }[] = [
  {
    id: "shark-fin",
    name: "Shark Fin",
    description: "A sleek gold shark fin that cuts through the page. Glows on hover, bites on click.",
  },
  {
    id: "bucs-coin",
    name: "Visual Bucs Coin",
    description: "A spinning Visual Bucs coin follows your cursor. Bursts into coins on click.",
  },
  {
    id: "crown",
    name: "King's Crown",
    description: "A tiny gold crown — you're the Kingpin. Expands with a royal glow on hover.",
  },
  {
    id: "gold-trail",
    name: "Gold Trail",
    description: "Minimal dot cursor with a luxurious gold particle trail. Subtle, premium.",
  },
];

function useIsTouch() {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);
  return isTouch;
}

function SharkFinCursor() {
  const ref = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);
  const [clicking, setClicking] = useState(false);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (ref.current) {
        ref.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }
      const t = e.target as HTMLElement;
      setHovering(!!t.closest("a, button, [role='button']"));
    };
    const down = () => setClicking(true);
    const up = () => setClicking(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mousedown", down);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mousedown", down);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  return (
    <div ref={ref} className="fixed top-0 left-0 z-[9999] pointer-events-none" style={{ marginLeft: -12, marginTop: -12 }}>
      <svg
        width={hovering ? 36 : 28}
        height={hovering ? 36 : 28}
        viewBox="0 0 24 24"
        className="transition-all duration-150 drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]"
        style={{ transform: clicking ? "scale(0.85) rotate(-10deg)" : "none" }}
      >
        <path
          d="M12 2 C 8 8, 6 14, 4 20 L 12 17 L 20 20 C 18 14, 16 8, 12 2 Z"
          fill="#C9A84C"
          stroke="#e8c86a"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}

function BucsCoinCursor() {
  const ref = useRef<HTMLDivElement>(null);
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (ref.current) {
        ref.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }
    };
    const down = () => setBurst((b) => b + 1);
    window.addEventListener("mousemove", move);
    window.addEventListener("mousedown", down);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mousedown", down);
    };
  }, []);

  return (
    <div ref={ref} className="fixed top-0 left-0 z-[9999] pointer-events-none" style={{ marginLeft: -16, marginTop: -16 }}>
      <div className="animate-spin" style={{ animationDuration: "2s" }}>
        <img
          src="/images/visual-bucs-icon.webp"
          alt=""
          className="w-8 h-8 object-contain drop-shadow-[0_0_10px_rgba(201,168,76,0.9)]"
          draggable={false}
        />
      </div>
      {burst > 0 && (
        <span key={burst} className="absolute -top-2 left-1/2 -translate-x-1/2 text-[#e8c86a] text-sm font-bold animate-ping">
          +$
        </span>
      )}
    </div>
  );
}

function CrownCursor() {
  const ref = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (ref.current) {
        ref.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }
      const t = e.target as HTMLElement;
      setHovering(!!t.closest("a, button, [role='button']"));
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, []);

  return (
    <div ref={ref} className="fixed top-0 left-0 z-[9999] pointer-events-none" style={{ marginLeft: -14, marginTop: -10 }}>
      <svg
        width={hovering ? 36 : 28}
        height={hovering ? 28 : 22}
        viewBox="0 0 24 18"
        className="transition-all duration-150"
        style={{ filter: hovering ? "drop-shadow(0 0 12px rgba(201,168,76,1))" : "drop-shadow(0 0 6px rgba(201,168,76,0.6))" }}
      >
        <path
          d="M2 16 L 4 6 L 9 11 L 12 3 L 15 11 L 20 6 L 22 16 Z"
          fill="#C9A84C"
          stroke="#e8c86a"
          strokeWidth="1"
        />
        <rect x="2" y="16" width="20" height="2" fill="#e8c86a" rx="1" />
      </svg>
    </div>
  );
}

function GoldTrailCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const [trail, setTrail] = useState<{ x: number; y: number; id: number }[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    let last = 0;
    const move = (e: MouseEvent) => {
      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }
      const now = Date.now();
      if (now - last > 30) {
        last = now;
        const id = ++idRef.current;
        setTrail((t) => [...t.slice(-12), { x: e.clientX, y: e.clientY, id }]);
        setTimeout(() => setTrail((t) => t.filter((p) => p.id !== id)), 500);
      }
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, []);

  return (
    <>
      {trail.map((p) => (
        <div
          key={p.id}
          className="fixed top-0 left-0 z-[9998] pointer-events-none w-2 h-2 rounded-full bg-[#e8c86a]/60"
          style={{ transform: `translate(${p.x}px, ${p.y}px)`, marginLeft: -4, marginTop: -4 }}
        />
      ))}
      <div ref={dotRef} className="fixed top-0 left-0 z-[9999] pointer-events-none" style={{ marginLeft: -4, marginTop: -4 }}>
        <div className="w-2 h-2 rounded-full bg-[#C9A84C] shadow-[0_0_10px_rgba(201,168,76,1)]" />
      </div>
    </>
  );
}

export default function CursorLab() {
  const [active, setActive] = useState<CursorId | null>(null);
  const isTouch = useIsTouch();

  useEffect(() => {
    // Hide the native cursor when a custom one is active
    if (active && !isTouch) {
      document.body.style.cursor = "none";
      const style = document.createElement("style");
      style.id = "cursor-lab-hide";
      style.textContent = "* { cursor: none !important; }";
      document.head.appendChild(style);
      return () => {
        document.body.style.cursor = "";
        document.getElementById("cursor-lab-hide")?.remove();
      };
    }
    return undefined;
  }, [active, isTouch]);

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <h1 className="text-3xl font-bold text-[#e8c86a] mb-2">Cursor Lab</h1>
      <p className="text-white/60 mb-8">Try each cursor. Move around, hover buttons, click. Pick your favorite.</p>

      {isTouch && (
        <p className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6 text-yellow-200 text-sm">
          You're on a touch device — custom cursors only work with a mouse. Open this page on desktop to try them.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {CURSORS.map((c) => (
          <button
            key={c.id}
            onClick={() => setActive(active === c.id ? null : c.id)}
            className={`text-left rounded-2xl border p-6 transition-all ${
              active === c.id
                ? "border-[#C9A84C] bg-[#C9A84C]/10 shadow-[0_0_30px_rgba(201,168,76,0.3)]"
                : "border-white/10 bg-white/[0.03] hover:border-white/25"
            }`}
          >
            <h3 className="text-xl font-bold text-[#e8c86a] mb-2">{c.name}</h3>
            <p className="text-sm text-white/60">{c.description}</p>
            <p className="text-xs text-white/40 mt-3">{active === c.id ? "✓ Active — move your mouse" : "Click to try"}</p>
          </button>
        ))}
      </div>

      {active && (
        <button
          onClick={() => setActive(null)}
          className="rounded-xl border border-white/20 px-6 py-3 text-sm font-bold hover:bg-white/10 transition"
        >
          Turn off custom cursor
        </button>
      )}

      {/* Demo area with buttons to hover */}
      <div className="mt-12 rounded-2xl border border-white/10 bg-white/[0.02] p-8">
        <h2 className="text-lg font-bold mb-4 text-white/80">Test area — hover and click these</h2>
        <div className="flex flex-wrap gap-3">
          <button className="rounded-xl bg-[#C9A84C] px-6 py-3 font-bold text-black">Gold Button</button>
          <button className="rounded-xl border border-white/20 px-6 py-3 font-bold">Ghost Button</button>
          <a href="#" onClick={(e) => e.preventDefault()} className="rounded-xl border border-[#C9A84C]/40 px-6 py-3 text-[#e8c86a]">
            Link
          </a>
        </div>
      </div>

      {active === "shark-fin" && <SharkFinCursor />}
      {active === "bucs-coin" && <BucsCoinCursor />}
      {active === "crown" && <CrownCursor />}
      {active === "gold-trail" && <GoldTrailCursor />}
    </div>
  );
}
