import { useState, useRef, useEffect, useCallback } from "react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { X, Send, Loader2, Dices, GripVertical } from "lucide-react";
import { CheatCodeName, PixelDivider } from "@/components/pixel-headline";

/* ─── Thy Cheat Code — floating on-site AI chat assistant ─────────────────
   Gold/black luxury theme, mobile-friendly. Mounted in AppShell so it is
   available on every page. Talks to POST /api/chat (no auth required —
   chat is free by default; see CHAT_CREDIT_COST on the server).

   Drag & snap: grab the launcher and drag it anywhere — on release it snaps
   into the nearest of 12 screen slots (4 columns × 3 rows). The slot is
   remembered in localStorage. While dragging, the 12 snap targets glow so
   you can see where it'll land. */

type ChatRole = "user" | "assistant";
interface ChatMessage { role: ChatRole; content: string }

const QUICK_PROMPTS = [
  "What can this site build?",
  "How do credits work?",
  "How much does a song cost?",
];

/* Curated starter prompts for the 🎲 Surprise me button — spans video ideas,
   hooks, thumbnails, pricing/credits questions, and workflows. Pure
   client-side: the pick is sent as the user's chat message. */
const SURPRISE_PROMPTS = [
  "Give me a random video idea for my next release",
  "What's a killer hook for a TikTok promo clip?",
  "How do credits work on this site?",
  "How much does a song cost to make?",
  "Give me a thumbnail concept for a music video",
  "Walk me through making a music video here",
  "Give me a random song concept to write about",
  "What's the cheapest way to promote my music here?",
  "Give me a content challenge for this week",
  "How does the Artist Vault work?",
  "Give me a random niche I could own as a creator",
  "What does a promo clip cost in credits?",
  "Give me 3 opening lines for my next video",
  "How do I lock my artist's voice for songs?",
  "Surprise me with a thumbnail idea",
  "What's the fastest workflow from song to finished video?",
  "Give me a random video idea — make it weird",
  "How do lip-sync videos work here?",
  "What can I build with 10 credits?",
  "Give me a hook idea for a behind-the-scenes clip",
];

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "Hey, I'm Thy Cheat Code 🦈 — the King Shark. Ask me anything about Bow Down Visuals: tools, credits, pricing, or how to make your next hit.",
};

const MAX_HISTORY = 6;

/* ─── Snap grid ───────────────────────────────────────────────────────── */
const SNAP_COLS = 4;
const SNAP_ROWS = 3;
const SNAP_COUNT = SNAP_COLS * SNAP_ROWS; // 12
const EDGE_MARGIN = 20;
const LAUNCHER_SIZE = 64; // h-16 w-16
const SNAP_STORAGE_KEY = "thy-cheat-code-snap-slot";

function slotXY(slot: number): { x: number; y: number } {
  const col = slot % SNAP_COLS;
  const row = Math.floor(slot / SNAP_COLS);
  const w = Math.max(window.innerWidth, LAUNCHER_SIZE + EDGE_MARGIN * 2);
  const h = Math.max(window.innerHeight, LAUNCHER_SIZE + EDGE_MARGIN * 2);
  return {
    x: EDGE_MARGIN + (col / (SNAP_COLS - 1)) * (w - EDGE_MARGIN * 2 - LAUNCHER_SIZE),
    y: EDGE_MARGIN + (row / (SNAP_ROWS - 1)) * (h - EDGE_MARGIN * 2 - LAUNCHER_SIZE),
  };
}

function nearestSlot(x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let s = 0; s < SNAP_COUNT; s++) {
    const p = slotXY(s);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function loadSlot(): number {
  try {
    const raw = window.localStorage.getItem(SNAP_STORAGE_KEY);
    const n = raw === null ? NaN : parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 0 && n < SNAP_COUNT) return n;
  } catch {
    /* storage unavailable — fall through to default */
  }
  return SNAP_COUNT - 1; // bottom-right, the classic spot
}

export function AiChatWidget() {
  const { confirmedFetch } = useConfirmedApi();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [creditCost, setCreditCost] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── Drag & snap state ── */
  const [slot, setSlot] = useState<number>(() => loadSlot());
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // free-drag px; null = snapped
  const [dragging, setDragging] = useState(false);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  const anchor = pos ?? slotXY(slot);
  const col = slot % SNAP_COLS;
  const row = Math.floor(slot / SNAP_COLS);
  const panelBelow = row === 0; // top row → chat opens downward
  const alignLeft = col <= 1; // left half → panel hugs the left

  const persistSlot = useCallback((s: number) => {
    setSlot(s);
    try {
      window.localStorage.setItem(SNAP_STORAGE_KEY, String(s));
    } catch {
      /* ignore */
    }
  }, []);

  /* Re-anchor on window resize so the widget never ends up off-screen. */
  useEffect(() => {
    const onResize = () => {
      setPos(null);
      setHoverSlot(null);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const a = pos ?? slotXY(slot);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: a.x,
      originY: a.y,
      moved: false,
    };
    launcherRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 6) return; // still a click
    d.moved = true;
    if (!dragging) setDragging(true);
    const maxX = Math.max(window.innerWidth - LAUNCHER_SIZE - 4, 0);
    const maxY = Math.max(window.innerHeight - LAUNCHER_SIZE - 4, 0);
    const nx = Math.min(Math.max(d.originX + dx, 0), maxX);
    const ny = Math.min(Math.max(d.originY + dy, 0), maxY);
    setPos({ x: nx, y: ny });
    setHoverSlot(nearestSlot(nx, ny));
  }

  function endDrag(e: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.pointerId !== e.pointerId) return;
    try {
      launcherRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (!d.moved) {
      // Treat as a click: toggle the chat.
      setOpen((v) => !v);
      return;
    }
    const target = hoverSlot ?? nearestSlot(pos?.x ?? 0, pos?.y ?? 0);
    setDragging(false);
    setHoverSlot(null);
    setPos(null);
    persistSlot(target);
  }

  /* Fetch the per-message price once so the header can show it upfront. */
  useEffect(() => {
    if (!open || creditCost !== null) return;
    fetch("/api/chat/status")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.creditCost === "number") setCreditCost(d.creditCost);
      })
      .catch(() => {});
  }, [open, creditCost]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open ]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const history = [...messages, userMsg]
      .filter((m) => m !== GREETING)
      .slice(-MAX_HISTORY);
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await confirmedFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets loading)
      const data = await res.json().catch(() => ({}));
      if (typeof data.creditCost === "number") setCreditCost(data.creditCost);
      let reply: string;
      if (res.status === 401) {
        reply =
          "Sign in to chat with me — it's 1 credit per message. 🦈";
      } else if (res.status === 402) {
        reply =
          data.message ||
          "You're out of credits — top up to keep chatting with Thy Cheat Code.";
      } else {
        reply =
          data.reply ||
          data.error ||
          "My fins slipped — could you ask that again? 🦈";
      }
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Couldn't reach the surface — check your connection and try again. 🦈" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  /* GuideMe integration: "Ask Thy Cheat Code" opens chat with a prefilled question. */
  useEffect(() => {
    const handler = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question;
      setOpen(true);
      if (q && q.trim()) window.setTimeout(() => send(q.trim()), 150);
    };
    window.addEventListener("guideme:ask", handler);
    return () => window.removeEventListener("guideme:ask", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* Snap-target overlay, visible only while dragging */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[9994]">
          {Array.from({ length: SNAP_COUNT }, (_, s) => {
            const p = slotXY(s);
            const active = s === hoverSlot;
            return (
              <div
                key={s}
                className="absolute flex items-center justify-center rounded-full transition-all duration-150"
                style={{
                  left: p.x,
                  top: p.y,
                  width: LAUNCHER_SIZE,
                  height: LAUNCHER_SIZE,
                  border: `2px dashed ${active ? "rgba(212,175,55,0.9)" : "rgba(212,175,55,0.25)"}`,
                  background: active ? "rgba(212,175,55,0.18)" : "rgba(212,175,55,0.05)",
                  boxShadow: active ? "0 0 24px rgba(212,175,55,0.45)" : "none",
                  transform: active ? "scale(1.12)" : "scale(1)",
                }}
              >
                <span
                  className="text-[10px] font-bold"
                  style={{ color: active ? "#d4af37" : "rgba(212,175,55,0.35)" }}
                >
                  {s + 1}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div
        className={`fixed z-[9995] flex flex-col gap-3 ${panelBelow ? "" : "flex-col-reverse"} ${alignLeft ? "items-start" : "items-end"}`}
        style={{
          left: anchor.x,
          top: anchor.y,
          transition: dragging ? "none" : "left 0.28s cubic-bezier(0.34, 1.4, 0.64, 1), top 0.28s cubic-bezier(0.34, 1.4, 0.64, 1)",
          touchAction: "none",
        }}
      >
        {open && (
          <div
            role="dialog"
            aria-label="Chat with Thy Cheat Code"
            className="flex w-[min(92vw,380px)] flex-col overflow-hidden border-4 border-[#C9A84C] bg-black"
            style={{
              height: "min(70vh, 560px)",
              boxShadow: "8px 8px 0 rgba(0,0,0,0.85), 8px 8px 0 2px rgba(201,168,76,0.35)",
              imageRendering: "pixelated",
            }}
          >
            {/* Header */}
            <div className="border-b-4 border-[#C9A84C]/60 bg-gradient-to-r from-[#1a1405] to-black px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="h-12 w-12 shrink-0 overflow-hidden border-2 border-[#C9A84C] bg-black"
                    style={{ boxShadow: "3px 3px 0 rgba(0,0,0,0.9)" }}
                  >
                    <img
                      src="/cheat-code-avatar.webp"
                      alt="Thy Cheat Code avatar"
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-bold"><CheatCodeName /></p>
                    <p className="pixel-display mt-1.5 text-[8px] uppercase tracking-[0.2em] text-neutral-400">
                      {creditCost
                        ? `${creditCost} credit${creditCost === 1 ? "" : "s"}/msg`
                        : "AI assistant"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const pick = SURPRISE_PROMPTS[Math.floor(Math.random() * SURPRISE_PROMPTS.length)];
                      send(pick);
                    }}
                    disabled={loading}
                    aria-label="Surprise me with a random question"
                    title="Surprise me 🎲"
                    className="border-2 border-transparent p-1.5 text-[#C9A84C] transition hover:border-[#C9A84C]/60 hover:bg-[#C9A84C]/15 disabled:opacity-40"
                  >
                    <Dices className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    aria-label="Close chat"
                    className="border-2 border-transparent p-1.5 text-neutral-400 transition hover:border-white/40 hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <PixelDivider count={16} align="left" className="mt-2.5" />
            </div>

            {/* Messages */}
            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" && (
                    <div
                      className="mr-2 h-8 w-8 shrink-0 overflow-hidden border-2 border-[#C9A84C]/70 bg-black"
                      style={{ boxShadow: "2px 2px 0 rgba(0,0,0,0.9)" }}
                    >
                      <img
                        src="/cheat-code-avatar.webp"
                        alt="Thy Cheat Code"
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    </div>
                  )}
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] border-2 border-[#8A6B1F] bg-[#C9A84C] px-3.5 py-2.5 text-sm font-medium text-black"
                        : "max-w-[85%] border-2 border-[#C9A84C]/40 bg-[#14100a] px-3.5 py-2.5 text-sm text-neutral-100"
                    }
                    style={{ boxShadow: "3px 3px 0 rgba(0,0,0,0.75)" }}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div
                    className="flex items-center gap-1.5 border-2 border-[#C9A84C]/40 bg-[#14100a] px-4 py-3"
                    style={{ boxShadow: "3px 3px 0 rgba(0,0,0,0.75)" }}
                  >
                    <span className="h-2 w-2 animate-bounce bg-[#C9A84C]" />
                    <span className="h-2 w-2 animate-bounce bg-[#C9A84C] [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce bg-[#C9A84C] [animation-delay:300ms]" />
                  </div>
                </div>
              )}
            </div>

            {/* Quick prompts */}
            {messages.length <= 1 && !loading && (
              <div className="flex flex-wrap gap-2 px-4 pb-2">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="pixel-display border-2 border-[#C9A84C]/60 px-2.5 py-2 text-[8px] uppercase tracking-[0.12em] text-[#C9A84C] transition hover:bg-[#C9A84C] hover:text-black"
                    style={{ boxShadow: "2px 2px 0 rgba(0,0,0,0.8)" }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="flex items-center gap-2 border-t-4 border-[#C9A84C]/60 bg-[#0d0b06] p-3">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") send(input); }}
                placeholder="Ask about tools, credits, pricing…"
                maxLength={2000}
                aria-label="Chat message"
                className="min-w-0 flex-1 border-2 border-white/15 bg-black px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:border-[#C9A84C] focus:outline-none"
              />
              <button
                onClick={() => send(input)}
                disabled={loading || !input.trim()}
                aria-label="Send message"
                className="pixel-display flex h-10 w-10 shrink-0 items-center justify-center border-2 border-[#8A6B1F] bg-[#C9A84C] text-black transition hover:brightness-110 disabled:opacity-40"
                style={{ boxShadow: "3px 3px 0 rgba(0,0,0,0.85)" }}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        {/* Launcher — drag to move, click to open */}
        <button
          ref={launcherRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-label={open ? "Close AI chat" : "Chat with Thy Cheat Code — drag to move"}
          title="Drag to move · click to chat"
          className={`relative flex h-16 w-16 items-center justify-center border-4 bg-black transition-transform hover:scale-105 active:scale-95 ${
            dragging
              ? "cursor-grabbing border-[#F5DE8E]"
              : "cursor-grab border-[#C9A84C]"
          }`}
          style={{
            touchAction: "none",
            boxShadow: dragging
              ? "6px 6px 0 rgba(0,0,0,0.9), 0 0 0 2px rgba(245,222,142,0.5)"
              : "5px 5px 0 rgba(0,0,0,0.9), 5px 5px 0 2px rgba(201,168,76,0.35)",
            imageRendering: "pixelated",
          }}
        >
          {open && !dragging ? (
            <X className="h-6 w-6 text-[#C9A84C]" />
          ) : (
            <img
              src="/cheat-code-avatar.webp"
              alt="Chat with Thy Cheat Code"
              className="h-full w-full object-cover"
              draggable={false}
            />
          )}
          {/* Drag hint grip, fades in on hover */}
          <span className="pointer-events-none absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[#C9A84C]/0 transition group-hover:text-[#C9A84C]/60">
            <GripVertical className="h-3 w-3" />
          </span>
        </button>
      </div>
    </>
  );
}
