import { useEffect, useRef, useState } from "react";
import { Star, ShieldCheck, Loader2 } from "lucide-react";
import { useUserMode, type StarLevel } from "@/contexts/UserModeContext";
import { useAuth } from "@/contexts/AuthContext";
import { STAR_RANKS } from "@/lib/creator-level";

const POS_KEY = "bdv_star_widget_snap";

/* 12 snap slots: 4 columns × 3 rows. Margin keeps the widget fully on screen. */
const COLS = 4;
const ROWS = 3;
const MARGIN = 12;

function widgetSize(el: HTMLElement | null): { w: number; h: number } {
  if (!el) return { w: 76, h: 64 };
  const r = el.getBoundingClientRect();
  return { w: Math.ceil(r.width) || 76, h: Math.ceil(r.height) || 64 };
}

function snapSlots(ww: number, wh: number): { x: number; y: number }[] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const slots: { x: number; y: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = MARGIN + (c / (COLS - 1)) * Math.max(0, w - MARGIN * 2 - ww);
      const y = MARGIN + (r / (ROWS - 1)) * Math.max(0, h - MARGIN * 2 - wh);
      slots.push({ x: Math.round(x), y: Math.round(y) });
    }
  }
  return slots;
}

/** Clamp any position so the widget stays fully inside the viewport. */
function clampToScreen(x: number, y: number, ww: number, wh: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, window.innerWidth - ww - MARGIN)),
    y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, window.innerHeight - wh - MARGIN)),
  };
}

/**
 * Floating draggable creator-level widget — admin only.
 * Snaps to one of 12 screen slots, never leaves the viewport, position persists.
 * Tap to expand and switch the creator level (1–6).
 */
export function FloatingStarLevel() {
  const { stars, maxStars, setStars } = useUserMode();
  const { profile, getAccessToken, refreshProfile } = useAuth();
  const [slot, setSlot] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw !== null) {
        const n = parseInt(raw, 10);
        if (n >= 0 && n < COLS * ROWS) return n;
      }
    } catch { /* ignore */ }
    return 7; /* default: middle-right */
  });
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<"level" | "admin">("level");
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const elRef = useRef<HTMLDivElement>(null);

  /* Admin quick tools */
  const [tierEmail, setTierEmail] = useState("");
  const [tierValue, setTierValue] = useState("6");
  const [tierBusy, setTierBusy] = useState(false);
  const [tierMsg, setTierMsg] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState("50");
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditMsg, setCreditMsg] = useState<string | null>(null);

  /* Only the site owner (admin) sees this. */
  const isAdmin = profile?.plan === "studio";

  useEffect(() => {
    try { localStorage.setItem(POS_KEY, String(slot)); } catch { /* ignore */ }
  }, [slot]);

  /* Re-clamp on viewport changes so it can never end up off screen. */
  useEffect(() => {
    const onResize = () => setSlot((s) => s);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  if (!isAdmin) return null;

  const { w: ww, h: wh } = widgetSize(elRef.current);
  const slots = snapSlots(ww, wh);
  const base = slots[Math.min(Math.max(0, slot), slots.length - 1)];
  const p = dragPos ?? clampToScreen(base.x, base.y, ww, wh);

  function nearestSlotIndex(x: number, y: number): number {
    let best = 0;
    let bestDist = Infinity;
    slots.forEach((s, i) => {
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      origX: p.x, origY: p.y, moved: false,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 8) d.moved = true;
    if (d.moved) {
      const { w, h } = widgetSize(elRef.current);
      setDragPos(clampToScreen(d.origX + dx, d.origY + dy, w, h));
    }
  }
  function onPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) {
      setExpanded((v) => !v);
      setDragPos(null);
    } else if (dragPos) {
      setSlot(nearestSlotIndex(dragPos.x, dragPos.y));
      setDragPos(null);
    }
  }

  async function handleTierSet() {
    const t = parseInt(tierValue, 10);
    if (!tierEmail.trim() || !(t >= 1 && t <= 6) || tierBusy) return;
    setTierBusy(true);
    setTierMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/admin/plan/set", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ tier: t, email: tierEmail.trim() }),
      });
      const data = await res.json() as { tier?: number; rank?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not set tier.");
      setTierMsg(`✓ ${tierEmail.trim()} → ${data.rank} (tier ${data.tier})`);
      setTierEmail("");
    } catch (e) {
      setTierMsg(`✗ ${e instanceof Error ? e.message : "Failed."}`);
    } finally {
      setTierBusy(false);
    }
  }

  async function handleCreditGrant() {
    const n = parseInt(creditAmount, 10);
    if (!(n > 0) || creditBusy) return;
    setCreditBusy(true);
    setCreditMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/admin/credits/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ amount: n }),
      });
      const data = await res.json() as { granted?: number; credits?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Grant failed.");
      setCreditMsg(`✓ Granted ${data.granted}. Balance: ${data.credits}.`);
      await refreshProfile();
    } catch (e) {
      setCreditMsg(`✗ ${e instanceof Error ? e.message : "Failed."}`);
    } finally {
      setCreditBusy(false);
    }
  }

  return (
    <div
      ref={elRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="fixed z-[9999] select-none touch-none"
      style={{
        left: p.x,
        top: p.y,
        transition: dragPos ? "none" : "left 0.18s ease-out, top 0.18s ease-out",
      }}
      data-testid="floating-star-level"
      title="Creator level — drag to move, tap to change level"
    >
      <div className="flex flex-col items-center gap-1 rounded-2xl border border-primary/40 bg-black/90 px-2.5 py-2 shadow-[0_0_20px_rgba(218,165,32,0.4)] backdrop-blur cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-0.5">
          {([1, 2, 3, 4, 5, 6] as const).map((s) => (
            <Star
              key={s}
              className={`h-3.5 w-3.5 ${s <= stars ? "fill-primary text-primary" : "text-white/20"}`}
            />
          ))}
        </div>
        <span className="text-[10px] font-black text-primary uppercase leading-none whitespace-nowrap">
          Lv {stars} · {STAR_RANKS[stars - 1]}
        </span>
        {expanded && (
          <div onPointerDown={(e) => e.stopPropagation()} className="w-56">
            {/* Tabs */}
            <div className="flex gap-1 pt-1 pb-1">
              <button
                type="button"
                onClick={() => setTab("level")}
                className={`flex-1 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wide transition-all ${
                  tab === "level" ? "bg-primary/20 text-primary" : "text-white/40 hover:text-white/70"
                }`}
              >
                Level
              </button>
              <button
                type="button"
                onClick={() => setTab("admin")}
                className={`flex-1 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wide transition-all flex items-center justify-center gap-1 ${
                  tab === "admin" ? "bg-primary/20 text-primary" : "text-white/40 hover:text-white/70"
                }`}
              >
                <ShieldCheck className="h-3 w-3" /> Admin
              </button>
            </div>

            {tab === "level" ? (
              <div className="flex items-center justify-center gap-1 pb-1">
                {([1, 2, 3, 4, 5, 6] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { if (s <= maxStars) { setStars(s as StarLevel); setExpanded(false); } }}
                    disabled={s > maxStars}
                    className={`h-7 w-7 rounded-full text-xs font-black transition-all ${
                      s === stars
                        ? "bg-primary text-black"
                        : s > maxStars
                          ? "text-white/20 cursor-not-allowed"
                          : "text-white/60 hover:bg-white/10"
                    }`}
                    aria-label={`Set level ${s}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-2 pb-1">
                {/* Set user tier */}
                <div>
                  <p className="text-[9px] font-black text-white/40 uppercase tracking-wide mb-1">Upgrade user tier</p>
                  <input
                    type="email"
                    placeholder="user@email.com"
                    value={tierEmail}
                    onChange={(e) => setTierEmail(e.target.value)}
                    className="w-full rounded-lg bg-black/40 border border-white/10 px-2 py-1.5 text-xs text-white outline-none focus:border-primary/50 mb-1"
                  />
                  <div className="flex gap-1">
                    <select
                      value={tierValue}
                      onChange={(e) => setTierValue(e.target.value)}
                      className="flex-1 rounded-lg bg-black/40 border border-white/10 px-2 py-1.5 text-xs text-white outline-none"
                      style={{ colorScheme: "dark" }}
                    >
                      {([1, 2, 3, 4, 5, 6] as const).map((t) => (
                        <option key={t} value={String(t)}>{t} — {STAR_RANKS[t - 1]}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => { void handleTierSet(); }}
                      disabled={tierBusy}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-black hover:opacity-90 disabled:opacity-40"
                    >
                      {tierBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Set"}
                    </button>
                  </div>
                  {tierMsg && <p className="text-[10px] mt-1 text-white/60">{tierMsg}</p>}
                </div>
                {/* Grant credits */}
                <div>
                  <p className="text-[9px] font-black text-white/40 uppercase tracking-wide mb-1">Grant credits (self)</p>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      min="1"
                      value={creditAmount}
                      onChange={(e) => setCreditAmount(e.target.value)}
                      className="flex-1 rounded-lg bg-black/40 border border-white/10 px-2 py-1.5 text-xs text-white outline-none focus:border-primary/50"
                    />
                    <button
                      type="button"
                      onClick={() => { void handleCreditGrant(); }}
                      disabled={creditBusy}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-black hover:opacity-90 disabled:opacity-40"
                    >
                      {creditBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Grant"}
                    </button>
                  </div>
                  {creditMsg && <p className="text-[10px] mt-1 text-white/60">{creditMsg}</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
