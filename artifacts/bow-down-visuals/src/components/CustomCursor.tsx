import { useEffect, useRef, useState } from "react";
import { getCursorChoice, type CursorId } from "@/lib/cursor-settings";

/* ─── Site-wide custom cursor ───
   Reads the visitor's saved choice from localStorage.
   Disabled on touch devices. Listens for changes. */

function useCursorState() {
  const [cursor, setCursor] = useState<CursorId>("shark-fin");
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
    setCursor(getCursorChoice());
    const onChange = () => setCursor(getCursorChoice());
    window.addEventListener("bdv-cursor-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("bdv-cursor-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return { cursor, isTouch };
}

function useMousePosition(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (ref.current) {
        ref.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, [ref]);
}

function useHoverState() {
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      setHovering(!!t.closest("a, button, [role='button'], input, select, textarea"));
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, []);
  return hovering;
}

function SharkFin() {
  const ref = useRef<HTMLDivElement>(null);
  const hovering = useHoverState();
  const [clicking, setClicking] = useState(false);
  useMousePosition(ref);
  useEffect(() => {
    const down = () => setClicking(true);
    const up = () => setClicking(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("mouseup", up);
    };
  }, []);
  return (
    <div ref={ref} className="fixed top-0 left-0 z-[9999] pointer-events-none" style={{ marginLeft: -12, marginTop: -12 }}>
      <svg width={hovering ? 36 : 28} height={hovering ? 36 : 28} viewBox="0 0 24 24"
        className="transition-all duration-150 drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]"
        style={{ transform: clicking ? "scale(0.85) rotate(-10deg)" : "none" }}>
        <path d="M12 2 C 8 8, 6 14, 4 20 L 12 17 L 20 20 C 18 14, 16 8, 12 2 Z"
          fill="#C9A84C" stroke="#e8c86a" strokeWidth="1" />
      </svg>
    </div>
  );
}

function Crown() {
  const ref = useRef<HTMLDivElement>(null);
  const hovering = useHoverState();
  useMousePosition(ref);
  return (
    <div ref={ref} className="fixed top-0 left-0 z-[9999] pointer-events-none" style={{ marginLeft: -14, marginTop: -10 }}>
      <svg width={hovering ? 36 : 28} height={hovering ? 28 : 22} viewBox="0 0 24 18"
        className="transition-all duration-150"
        style={{ filter: hovering ? "drop-shadow(0 0 12px rgba(201,168,76,1))" : "drop-shadow(0 0 6px rgba(201,168,76,0.6))" }}>
        <path d="M2 16 L 4 6 L 9 11 L 12 3 L 15 11 L 20 6 L 22 16 Z" fill="#C9A84C" stroke="#e8c86a" strokeWidth="1" />
        <rect x="2" y="16" width="20" height="2" fill="#e8c86a" rx="1" />
      </svg>
    </div>
  );
}

function BucsCoin() {
  const ref = useRef<HTMLDivElement>(null);
  const [burst, setBurst] = useState(0);
  const hovering = useHoverState();
  useMousePosition(ref);
  useEffect(() => {
    const down = () => setBurst((b) => b + 1);
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, []);
  return (
    <div ref={ref} className="fixed top-0 left-0 z-[9999] pointer-events-none" style={{ marginLeft: -20, marginTop: -20 }}>
      {/* Gentle float + slow shine, no frantic spin */}
      <div className="animate-[float_3s_ease-in-out_infinite]">
        <img
          src="/images/visual-bucs-coin-transparent.png"
          alt=""
          className="object-contain transition-all duration-200"
          style={{
            width: hovering ? 48 : 40,
            height: hovering ? 48 : 40,
            filter: hovering
              ? "drop-shadow(0 0 16px rgba(232,200,106,1))"
              : "drop-shadow(0 0 8px rgba(201,168,76,0.7))",
          }}
          draggable={false}
        />
      </div>
      {burst > 0 && (
        <span key={burst} className="absolute -top-3 left-1/2 -translate-x-1/2 text-[#e8c86a] text-base font-black animate-ping">+$</span>
      )}
    </div>
  );
}

function GoldTrail() {
  const dotRef = useRef<HTMLDivElement>(null);
  const [trail, setTrail] = useState<{ x: number; y: number; id: number }[]>([]);
  const idRef = useRef(0);
  useEffect(() => {
    let last = 0;
    const move = (e: MouseEvent) => {
      if (dotRef.current) dotRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
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
        <div key={p.id} className="fixed top-0 left-0 z-[9998] pointer-events-none w-2 h-2 rounded-full bg-[#e8c86a]/60"
          style={{ transform: `translate(${p.x}px, ${p.y}px)`, marginLeft: -4, marginTop: -4 }} />
      ))}
      <div ref={dotRef} className="fixed top-0 left-0 z-[9999] pointer-events-none" style={{ marginLeft: -4, marginTop: -4 }}>
        <div className="w-2 h-2 rounded-full bg-[#C9A84C] shadow-[0_0_10px_rgba(201,168,76,1)]" />
      </div>
    </>
  );
}

function Lightning() {
  const ref = useRef<HTMLDivElement>(null);
  const [strike, setStrike] = useState(0);
  useMousePosition(ref);
  useEffect(() => {
    const down = () => setStrike((s) => s + 1);
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, []);
  return (
    <div ref={ref} className="fixed top-0 left-0 z-[9999] pointer-events-none" style={{ marginLeft: -10, marginTop: -14 }}>
      <svg width="24" height="32" viewBox="0 0 24 32" className="drop-shadow-[0_0_10px_rgba(232,200,106,0.9)]">
        <path d="M13 2 L 5 18 L 11 18 L 9 30 L 19 12 L 13 12 Z" fill="#e8c86a" stroke="#C9A84C" strokeWidth="1" />
      </svg>
      {strike > 0 && (
        <span key={strike} className="absolute top-0 left-1/2 -translate-x-1/2 text-[#e8c86a] animate-ping">⚡</span>
      )}
    </div>
  );
}

function PixelShark() {
  const ref = useRef<HTMLDivElement>(null);
  const [chomp, setChomp] = useState(false);
  const hovering = useHoverState();
  useMousePosition(ref);
  useEffect(() => {
    const down = () => setChomp(true);
    const up = () => setChomp(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("mouseup", up);
    };
  }, []);
  return (
    <div ref={ref} className="fixed top-0 left-0 z-[9999] pointer-events-none" style={{ marginLeft: -20, marginTop: -20 }}>
      <img
        src="/images/thy-cheat-code-8bit-transparent.png"
        alt=""
        className="object-contain transition-transform duration-100"
        style={{
          width: hovering ? 48 : 40,
          height: hovering ? 48 : 40,
          transform: chomp ? "scale(0.88)" : "scale(1)",
          imageRendering: "pixelated",
          filter: "drop-shadow(0 0 8px rgba(201,168,76,0.6))",
        }}
        draggable={false}
      />
    </div>
  );
}

export function CustomCursor() {
  const { cursor, isTouch } = useCursorState();
  const [hideNative, setHideNative] = useState(false);

  useEffect(() => {
    const shouldHide = !isTouch;
    setHideNative(shouldHide);
    if (shouldHide) {
      const style = document.createElement("style");
      style.id = "bdv-custom-cursor-hide";
      style.textContent = "* { cursor: none !important; }";
      document.head.appendChild(style);
      return () => {
        document.getElementById("bdv-custom-cursor-hide")?.remove();
      };
    }
    return undefined;
  }, [cursor, isTouch]);

  if (isTouch || !hideNative) return null;

  return (
    <>
      {cursor === "shark-fin" && <SharkFin />}
      {cursor === "crown" && <Crown />}
      {cursor === "bucs-coin" && <BucsCoin />}
      {cursor === "gold-trail" && <GoldTrail />}
      {cursor === "lightning" && <Lightning />}
      {cursor === "pixel-shark" && <PixelShark />}
    </>
  );
}
