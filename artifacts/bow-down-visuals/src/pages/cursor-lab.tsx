import { useEffect, useState } from "react";
import { CURSOR_OPTIONS, getCursorChoice, setCursorChoice, type CursorId } from "@/lib/cursor-settings";

/* ─── Cursor Settings ───
   Permanent page where visitors choose their cursor.
   Choice is saved to localStorage and applied site-wide. */

/* Visual preview of each cursor — rendered statically in the selection card
   so visitors can see what they're picking without clicking first. */
function CursorPreview({ id }: { id: CursorId }) {
  const base = "flex items-center justify-center h-20 rounded-xl bg-black/40 border border-white/5 mb-4";
  switch (id) {
    case "shark-fin":
      return (
        <div className={base}>
          <svg width="36" height="36" viewBox="0 0 24 24" className="drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]">
            <path d="M12 2 C 8 8, 6 14, 4 20 L 12 17 L 20 20 C 18 14, 16 8, 12 2 Z" fill="#C9A84C" stroke="#e8c86a" strokeWidth="1" />
          </svg>
        </div>
      );
    case "crown":
      return (
        <div className={base}>
          <svg width="40" height="30" viewBox="0 0 24 18" className="drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]">
            <path d="M2 16 L 4 6 L 9 11 L 12 3 L 15 11 L 20 6 L 22 16 Z" fill="#C9A84C" stroke="#e8c86a" strokeWidth="1" />
            <rect x="2" y="16" width="20" height="2" fill="#e8c86a" rx="1" />
          </svg>
        </div>
      );
    case "bucs-coin":
      return (
        <div className={base}>
          <img src="/images/visual-bucs-coin-transparent.png" alt="" className="w-12 h-12 object-contain drop-shadow-[0_0_10px_rgba(201,168,76,0.9)]" draggable={false} />
        </div>
      );
    case "gold-trail":
      return (
        <div className={base}>
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-[#e8c86a]/40" />
            <div className="w-1.5 h-1.5 rounded-full bg-[#e8c86a]/60" />
            <div className="w-1.5 h-1.5 rounded-full bg-[#e8c86a]/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#C9A84C] shadow-[0_0_10px_rgba(201,168,76,1)]" />
          </div>
        </div>
      );
    case "lightning":
      return (
        <div className={base}>
          <svg width="24" height="36" viewBox="0 0 24 32" className="drop-shadow-[0_0_10px_rgba(232,200,106,0.9)]">
            <path d="M13 2 L 5 18 L 11 18 L 9 30 L 19 12 L 13 12 Z" fill="#e8c86a" stroke="#C9A84C" strokeWidth="1" />
          </svg>
        </div>
      );
    case "pixel-shark":
      return (
        <div className={base}>
          <img src="/images/thy-cheat-code-8bit-transparent.png" alt="" className="w-14 h-14 object-contain" style={{ imageRendering: "pixelated" }} draggable={false} />
        </div>
      );
    case "flame":
      return (
        <div className={base}>
          <svg width="28" height="40" viewBox="0 0 24 32" className="drop-shadow-[0_0_10px_rgba(232,200,106,0.9)]">
            <path d="M12 2 C 8 10, 4 14, 4 22 C 4 28, 8 30, 12 30 C 16 30, 20 28, 20 22 C 20 14, 16 10, 12 2 Z" fill="#e8c86a" stroke="#C9A84C" strokeWidth="1" />
          </svg>
        </div>
      );
    case "diamond":
      return (
        <div className={base}>
          <svg width="36" height="30" viewBox="0 0 32 28" className="drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]">
            <path d="M8 4 L 24 4 L 30 12 L 16 26 L 2 12 Z" fill="#e8c86a" stroke="#C9A84C" strokeWidth="1.5" />
          </svg>
        </div>
      );
    case "star":
      return (
        <div className={base}>
          <svg width="36" height="36" viewBox="0 0 24 24" className="drop-shadow-[0_0_10px_rgba(201,168,76,0.8)]">
            <path d="M12 2 L 14.5 8.5 L 21 9 L 16 13.5 L 17.5 20 L 12 16.5 L 6.5 20 L 8 13.5 L 3 9 L 9.5 8.5 Z" fill="#C9A84C" stroke="#e8c86a" strokeWidth="1" />
          </svg>
        </div>
      );
    case "money-bag":
      return (
        <div className={base}>
          <svg width="36" height="40" viewBox="0 0 36 40" className="drop-shadow-[0_0_10px_rgba(201,168,76,0.8)]">
            <path d="M10 10 L 26 10 L 32 28 C 32 34, 26 38, 18 38 C 10 38, 4 34, 4 28 Z" fill="#C9A84C" stroke="#e8c86a" strokeWidth="1.5" />
            <text x="18" y="28" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#000">$</text>
          </svg>
        </div>
      );
    case "gold-key":
      return (
        <div className={base}>
          <svg width="32" height="32" viewBox="0 0 32 32" className="drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]">
            <circle cx="10" cy="10" r="6" fill="none" stroke="#C9A84C" strokeWidth="3" />
            <path d="M14 14 L 26 26 M22 22 L 26 18" stroke="#C9A84C" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      );
    case "trophy":
      return (
        <div className={base}>
          <svg width="32" height="36" viewBox="0 0 32 36" className="drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]">
            <path d="M10 4 L 22 4 L 20 18 L 12 18 Z" fill="#C9A84C" stroke="#e8c86a" strokeWidth="1" />
            <path d="M10 6 C 4 6, 4 14, 10 14 M22 6 C 28 6, 28 14, 22 14" fill="none" stroke="#C9A84C" strokeWidth="2" />
            <rect x="10" y="26" width="12" height="4" rx="2" fill="#e8c86a" />
          </svg>
        </div>
      );
    case "rocket":
      return (
        <div className={base}>
          <svg width="28" height="36" viewBox="0 0 28 36" className="drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]">
            <path d="M14 2 C 20 8, 22 16, 20 24 L 14 22 L 8 24 C 6 16, 8 8, 14 2 Z" fill="#C9A84C" stroke="#e8c86a" strokeWidth="1" />
          </svg>
        </div>
      );
    case "crosshair":
      return (
        <div className={base}>
          <svg width="40" height="40" viewBox="0 0 40 40" className="drop-shadow-[0_0_6px_rgba(201,168,76,0.8)]">
            <circle cx="20" cy="20" r="14" fill="none" stroke="#C9A84C" strokeWidth="2" />
            <circle cx="20" cy="20" r="3" fill="#e8c86a" />
            <path d="M20 2 L 20 10 M20 30 L 20 38 M2 20 L 10 20 M30 20 L 38 20" stroke="#C9A84C" strokeWidth="2" />
          </svg>
        </div>
      );
    case "music-note":
      return (
        <div className={base}>
          <svg width="28" height="36" viewBox="0 0 28 36" className="drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]">
            <ellipse cx="7" cy="28" rx="5" ry="4" fill="#C9A84C" />
            <ellipse cx="21" cy="24" rx="5" ry="4" fill="#e8c86a" />
            <path d="M10 28 L 10 6 L 24 2 L 24 24" fill="none" stroke="#C9A84C" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      );
    case "gamepad":
      return (
        <div className={base}>
          <svg width="40" height="28" viewBox="0 0 40 28" className="drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]">
            <path d="M8 4 L 32 4 C 36 4, 38 10, 36 16 L 34 24 C 33 27, 28 27, 27 24 L 26 20 L 14 20 L 13 24 C 12 27, 7 27, 6 24 L 4 16 C 2 10, 4 4, 8 4 Z" fill="#C9A84C" stroke="#e8c86a" strokeWidth="1" />
          </svg>
        </div>
      );
    case "wand":
      return (
        <div className={base}>
          <svg width="32" height="32" viewBox="0 0 32 32" style={{ transform: "rotate(-30deg)" }} className="drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]">
            <path d="M6 26 L 22 10" stroke="#8a6d2b" strokeWidth="3" strokeLinecap="round" />
            <path d="M22 10 L 24 4 L 26 10 L 30 12 L 26 14 L 24 20 L 22 14 L 18 12 Z" fill="#e8c86a" />
          </svg>
        </div>
      );
    case "camera":
      return (
        <div className={base}>
          <svg width="36" height="28" viewBox="0 0 36 28" className="drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]">
            <rect x="2" y="8" width="32" height="18" rx="4" fill="#C9A84C" stroke="#e8c86a" strokeWidth="1" />
            <circle cx="18" cy="17" r="6" fill="#0a0a0a" stroke="#e8c86a" strokeWidth="1.5" />
          </svg>
        </div>
      );
    case "anchor":
      return (
        <div className={base}>
          <svg width="32" height="36" viewBox="0 0 32 36" className="drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]">
            <circle cx="16" cy="6" r="4" fill="none" stroke="#C9A84C" strokeWidth="2.5" />
            <path d="M16 10 L 16 30 M8 22 C 8 28, 12 32, 16 32 C 20 32, 24 28, 24 22" fill="none" stroke="#C9A84C" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
      );
    case "compass":
      return (
        <div className={base}>
          <svg width="36" height="36" viewBox="0 0 36 36" className="drop-shadow-[0_0_8px_rgba(201,168,76,0.8)]">
            <circle cx="18" cy="18" r="15" fill="#0a0a0a" stroke="#C9A84C" strokeWidth="2" />
            <path d="M18 8 L 21 18 L 18 28 L 15 18 Z" fill="#e8c86a" />
          </svg>
        </div>
      );
    default:
      return null;
  }
}

export default function CursorLab() {
  const [active, setActive] = useState<CursorId>("shark-fin");
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    setActive(getCursorChoice());
    setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
    const onChange = () => setActive(getCursorChoice());
    window.addEventListener("bdv-cursor-changed", onChange);
    return () => window.removeEventListener("bdv-cursor-changed", onChange);
  }, []);

  const choose = (id: CursorId) => {
    setCursorChoice(id);
    setActive(id);
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <h1 className="text-3xl font-bold text-[#e8c86a] mb-2">Cursor Style</h1>
      <p className="text-white/60 mb-8">
        Pick your cursor. It's saved and follows you across the whole site.
      </p>

      {isTouch && (
        <p className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6 text-yellow-200 text-sm">
          You're on a touch device — custom cursors only work with a mouse. Open this page on desktop to try them.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {CURSOR_OPTIONS.map((c) => (
          <button
            key={c.id}
            onClick={() => choose(c.id)}
            className={`text-left rounded-2xl border p-6 transition-all ${
              active === c.id
                ? "border-[#C9A84C] bg-[#C9A84C]/10 shadow-[0_0_30px_rgba(201,168,76,0.3)]"
                : "border-white/10 bg-white/[0.03] hover:border-white/25"
            }`}
          >
            <CursorPreview id={c.id} />
            <h3 className="text-xl font-bold text-[#e8c86a] mb-2">{c.name}</h3>
            <p className="text-sm text-white/60">{c.description}</p>
            <p className="text-xs mt-3 font-bold ${active === c.id ? 'text-[#e8c86a]' : 'text-white/40'}">
              {active === c.id ? "✓ Active" : "Click to select"}
            </p>
          </button>
        ))}
      </div>

      {/* Demo area */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8">
        <h2 className="text-lg font-bold mb-4 text-white/80">Test area — hover and click these</h2>
        <div className="flex flex-wrap gap-3">
          <button className="rounded-xl bg-[#C9A84C] px-6 py-3 font-bold text-black">Gold Button</button>
          <button className="rounded-xl border border-white/20 px-6 py-3 font-bold">Ghost Button</button>
          <a href="#" onClick={(e) => e.preventDefault()} className="rounded-xl border border-[#C9A84C]/40 px-6 py-3 text-[#e8c86a]">
            Link
          </a>
        </div>
        <p className="text-xs text-white/40 mt-4">
          Your choice is live across the entire site right now. Change it anytime.
        </p>
      </div>
    </div>
  );
}
