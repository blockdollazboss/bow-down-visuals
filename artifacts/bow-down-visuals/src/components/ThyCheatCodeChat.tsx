import { useState, useRef, useEffect } from "react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { X, Send, Loader2, Dices } from "lucide-react";
import { CheatCodeName, PixelDivider } from "@/components/pixel-headline";
import { DraggableWidget } from "@/components/draggable-widget";
import {
  hasDownloadedExtension,
  hasOptedOutExtensionPromo,
  optOutExtensionPromo,
} from "@/lib/extension-promo";

/* ─── Thy Cheat Code — on-site AI chat, right-side slide-over drawer ────────
   Gold/black 8-bit luxury theme, mobile-friendly. Mounted globally in
   AppShell; renders nothing until opened via the event bus:

     window.dispatchEvent(new CustomEvent("thy-chat:open", { detail: { prompt } }))

   There is no floating launcher anymore — the in-page ThyCheatCodeHost, its
   collapsed chip, and per-step "Ask about this" buttons open the drawer.
   Talks to POST /api/free-chat. Free via Groq (no credits). */

type ChatRole = "user" | "assistant";
interface ChatMessage { role: ChatRole; content: string }

const QUICK_PROMPTS = [
  "What can this site build?",
  "How do Visual Bucs work?",
  "How much does a song cost?",
];

/* Curated starter prompts for the 🎲 Surprise me button — spans video ideas,
   hooks, thumbnails, pricing/credits questions, and workflows. Pure
   client-side: the pick is sent as the user's chat message. */
const SURPRISE_PROMPTS = [
  "Give me a random video idea for my next release",
  "What's a killer hook for a TikTok promo clip?",
  "How do Visual Bucs work on this site?",
  "How much does a song cost to make?",
  "Give me a thumbnail concept for a music video",
  "Walk me through making a music video here",
  "Give me a random song concept to write about",
  "What's the cheapest way to promote my music here?",
  "Give me a content challenge for this week",
  "How does the Creator Vault work?",
  "Give me a random niche I could own as a creator",
  "What does a promo clip cost in Visual Bucs?",
  "Give me 3 opening lines for my next video",
  "How do I lock my artist's voice for songs?",
  "Surprise me with a thumbnail idea",
  "What's the fastest workflow from song to finished video?",
  "Give me a random video idea — make it weird",
  "How do lip-sync videos work here?",
  "What can I build with 1,000 Visual Bucs?",
  "Give me a hook idea for a behind-the-scenes clip",
];

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "Hey, I'm Thy Cheat Code 🦈 — the King Shark. Ask me anything about Bow Down Visuals: tools, Visual Bucs, pricing, or how to make your next hit.",
};

const MAX_HISTORY = 6;

/* ─── Extension promo inside the chat ───
   Thy Cheat Code mentions the Chrome extension himself until the visitor
   downloads it or tells him to stop. Phrases like "stop promoting it" /
   "don't remind me" opt out permanently; install questions get a direct
   answer without burning API credits. */
const STOP_PROMO_RE =
  /(stop (promoting|telling|mentioning)|don't remind|do not remind|no more (promo|remind)|stop.*(extension|promo).*remind|enough.*extension)/i;
const EXT_INSTALL_RE =
  /(chrome extension|browser extension)/i;
const EXT_NUDGE_SESSION_KEY = "bdv-extension-chat-nudge";

const EXT_NUDGE: ChatMessage = {
  role: "assistant",
  content:
    "🦈 Quick one — I also live in your Chrome toolbar as an extension: AI chat, every site tool, daily bonuses, one-click saving. Download: bowdownvisuals.com/bow-down-visuals-extension-v2.zip — then unzip, go to chrome://extensions, turn on Developer mode, hit Load unpacked, pick the folder. Done in 30 seconds. (You can also install this site as a Chrome app from your browser menu. Say “stop promoting it” anytime and I'll never mention it again.)",
};

const EXT_INSTALL_ANSWER: ChatMessage = {
  role: "assistant",
  content:
    "Easy — hit the gold Download button on the /extension page, unzip the file, then in Chrome go to chrome://extensions → turn on Developer mode → “Load unpacked” → pick the unzipped folder. Pin the 🦈 icon and you're set. Full step-by-step is on the /extension page too.",
};

/** Open the Thy Cheat Code chat drawer, optionally with a prefilled prompt. */
export function openThyChat(prompt?: string) {
  window.dispatchEvent(
    new CustomEvent("thy-chat:open", { detail: { prompt } })
  );
}

export function ThyCheatCodeChat() {
  // Free version: direct fetch to /api/free-chat (no credits)
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // creditCost removed: chat is now free
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Free version: no credit check needed */

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /* Proactive extension nudge: once per session, shortly after the drawer
     opens, Thy Cheat Code mentions the extension himself — unless the
     visitor already downloaded it or told him to stop. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    try {
      if (sessionStorage.getItem(EXT_NUDGE_SESSION_KEY) === "1") return;
    } catch { /* private mode */ }
    if (hasDownloadedExtension() || hasOptedOutExtensionPromo()) return;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      setMessages((prev) => [...prev, EXT_NUDGE]);
      try { sessionStorage.setItem(EXT_NUDGE_SESSION_KEY, "1"); } catch { /* ignore */ }
    }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
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

    // "Stop promoting it" → permanent opt-out, no API call.
    if (STOP_PROMO_RE.test(trimmed) && !hasDownloadedExtension()) {
      optOutExtensionPromo();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Got it — I'll stop mentioning the extension. 🦈 It's on the /extension page if you ever want it." },
      ]);
      return;
    }
    // Extension install questions → direct answer, no API call.
    if (EXT_INSTALL_RE.test(trimmed) && /(install|download|get|how|where)/i.test(trimmed)) {
      setMessages((prev) => [...prev, EXT_INSTALL_ANSWER]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/free-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      // Free version: no confirmation dialog
      const data = await res.json().catch(() => ({}));
      // Free version: no credit tracking
      let reply: string;
      if (!res.ok) {
        reply =
          data.error ||
          "My fins slipped — could you ask that again? 🦈";
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

  /* Event bus: the in-page coach host, its collapsed chip, and per-step
     "Ask about this" buttons open the drawer, optionally with a prefilled
     question. `guideme:ask` is the legacy event from the GuideMe tour card. */
  useEffect(() => {
    const openHandler = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      setOpen(true);
      if (prompt && prompt.trim()) window.setTimeout(() => send(prompt.trim()), 150);
    };
    const legacyHandler = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question;
      setOpen(true);
      if (q && q.trim()) window.setTimeout(() => send(q.trim()), 150);
    };
    window.addEventListener("thy-chat:open", openHandler);
    window.addEventListener("guideme:ask", legacyHandler);
    return () => {
      window.removeEventListener("thy-chat:open", openHandler);
      window.removeEventListener("guideme:ask", legacyHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) {
    return (
      <DraggableWidget id="chat-button" defaultAnchor={{ x: 0.94, y: 0.92 }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Chat with Thy Cheat Code"
          title="Chat with Thy Cheat Code"
          className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-[#C9A84C] bg-black shadow-[0_0_24px_rgba(201,168,76,0.35)] transition-transform hover:scale-110 active:scale-95"
        >
          <video
            src="/thy-cheat-code-idle.mp4"
            autoPlay
            muted
            loop
            playsInline
            aria-hidden="true"
            className="h-full w-full object-cover"
          />
        </button>
      </DraggableWidget>
    );
  }

  return (
    <>
      {/* Small floating popup — no screen-blurring backdrop */}
      <div
        role="dialog"
        aria-label="Chat with Thy Cheat Code"
        className="animate-tcc-drawer-in fixed bottom-24 right-5 z-[9995] h-[min(520px,70vh)] w-[min(340px,90vw)]"
      >
        <div
          className="flex h-full w-full flex-col overflow-hidden rounded-2xl border-4 border-[#C9A84C] bg-black"
          style={{
            boxShadow: "0 12px 48px rgba(0,0,0,0.8), 0 0 24px rgba(201,168,76,0.2)",
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
                  <video
                    src="/thy-cheat-code-working.mp4"
                    autoPlay
                    muted
                    loop
                    playsInline
                    aria-label="Thy Cheat Code avatar"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <p className="tcc-display text-sm tracking-wide"><CheatCodeName /></p>
                  <p className="tcc-accent mt-1.5 text-[10px] uppercase tracking-[0.2em] text-neutral-400">
                    Free AI assistant
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
          <div ref={listRef} className="relative flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {/* 8-bit King Shark watermark background */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.07]"
            >
              <img
                src="/thy-cheat-code-8bit.webp"
                alt=""
                draggable={false}
                className="h-64 w-64 object-cover"
                style={{ imageRendering: "pixelated" }}
              />
            </div>
            {messages.map((m, i) => (
              <div key={i} className={`relative flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div
                    className="mr-2 h-8 w-8 shrink-0 overflow-hidden border-2 border-[#C9A84C]/70 bg-black"
                    style={{ boxShadow: "2px 2px 0 rgba(0,0,0,0.9)" }}
                  >
                    <video
                      src="/thy-cheat-code-working.mp4"
                      autoPlay
                      muted
                      loop
                      playsInline
                      aria-label="Thy Cheat Code"
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] border-2 border-[#8A6B1F] bg-[#C9A84C] px-3.5 py-2.5 text-sm font-medium text-black"
                      : "tcc-chat max-w-[85%] border-2 border-[#C9A84C]/40 bg-[#14100a] px-3.5 py-2.5 text-lg leading-snug text-neutral-100"
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
              placeholder="Ask about tools, Visual Bucs, pricing…"
              maxLength={2000}
              aria-label="Chat message"
              className="tcc-chat min-w-0 flex-1 border-2 border-white/15 bg-black px-3 py-2.5 text-lg text-white placeholder:text-neutral-500 focus:border-[#C9A84C] focus:outline-none"
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
      </div>
    </>
  );
}
