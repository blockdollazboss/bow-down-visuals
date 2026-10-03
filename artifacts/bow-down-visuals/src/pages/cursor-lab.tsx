import { useEffect, useState } from "react";
import { CURSOR_OPTIONS, getCursorChoice, setCursorChoice, type CursorId } from "@/lib/cursor-settings";

/* ─── Cursor Settings ───
   Permanent page where visitors choose their cursor.
   Choice is saved to localStorage and applied site-wide. */

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
