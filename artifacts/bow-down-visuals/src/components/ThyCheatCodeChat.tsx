import { useState, useRef, useEffect } from "react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { X, Send, Loader2, Dices } from "lucide-react";
import { CheatCodeName, PixelDivider } from "@/components/pixel-headline";

/* ─── Thy Cheat Code — on-site AI chat, right-side slide-over drawer ────────
   Gold/black 8-bit luxury theme, mobile-friendly. Mounted globally in
   AppShell; renders nothing until opened via the event bus:

     window.dispatchEvent(new CustomEvent("thy-chat:open", { detail: { prompt } }))

   There is no floating launcher anymore — the in-page ThyCheatCodeHost, its
   collapsed chip, and per-step "Ask about this" buttons open the drawer.
   Talks to POST /api/chat. 1 credit/message via the credit-confirm flow. */

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

/** Open the Thy Cheat Code chat drawer, optionally with a prefilled prompt. */
export function openThyChat(prompt?: string) {
  window.dispatchEvent(
    new CustomEvent("thy-chat:open", { detail: { prompt } })
  );
}

export function ThyCheatCodeChat() {
  const { confirmedFetch } = useConfirmedApi();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [creditCost, setCreditCost] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
  }, [open]);

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Chat with Thy Cheat Code"
        title="Chat with Thy Cheat Code"
        className="fixed bottom-5 right-5 z-[9990] flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-[#C9A84C] bg-black shadow-[0_0_24px_rgba(201,168,76,0.35)] transition-transform hover:scale-110 active:scale-95"
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
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9994] bg-black/60 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      {/* Slide-over drawer */}
      <div
        role="dialog"
        aria-label="Chat with Thy Cheat Code"
        className="animate-tcc-drawer-in fixed inset-y-0 right-0 z-[9995] w-[min(420px,94vw)]"
      >
        <div
          className="flex h-full w-full flex-col overflow-hidden border-l-4 border-[#C9A84C] bg-black"
          style={{
            boxShadow: "-8px 0 0 rgba(0,0,0,0.85), -8px 0 0 2px rgba(201,168,76,0.35)",
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
      </div>
    </>
  );
}
