import { useState, useRef, useEffect } from "react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { X, Send, Loader2, Dices } from "lucide-react";
import { CheatCodeName } from "@/components/pixel-headline";
import { AnimatedSharkIcon } from "@/components/AnimatedSharkIcon";

/* ─── Thy Cheat Code — floating on-site AI chat assistant ─────────────────
   Gold/black luxury theme, mobile-friendly. Mounted in AppShell so it is
   available on every page. Talks to POST /api/chat (no auth required —
   chat is free by default; see CHAT_CREDIT_COST on the server). */

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

export function AiChatWidget() {
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

  return (
    <div className="fixed bottom-5 right-5 z-[9995] flex flex-col items-end gap-3">
      {open && (
        <div
          role="dialog"
          aria-label="Chat with Thy Cheat Code"
          className="flex w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-primary/40 bg-black shadow-[0_8px_40px_rgba(0,0,0,0.7),0_0_24px_rgba(212,175,55,0.15)]"
          style={{ height: "min(70vh, 560px)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-primary/25 bg-gradient-to-r from-[#1a1405] to-black px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 overflow-hidden rounded-full border-2 border-primary/60 shadow-[0_0_12px_rgba(212,175,55,0.4)]">
                <AnimatedSharkIcon className="h-full w-full" />
              </div>
              <div>
                <p className="text-sm font-bold text-primary"><CheatCodeName /> 🦈</p>
                <p className="text-[11px] text-neutral-400">
                  {creditCost
                    ? `AI assistant · ${creditCost} credit${creditCost === 1 ? "" : "s"}/message`
                    : "AI assistant — ask me about the site"}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                const pick = SURPRISE_PROMPTS[Math.floor(Math.random() * SURPRISE_PROMPTS.length)];
                send(pick);
              }}
              disabled={loading}
              aria-label="Surprise me with a random question"
              title="Surprise me 🎲"
              className="rounded-full p-1.5 text-primary/80 transition hover:bg-primary/15 hover:text-primary disabled:opacity-40"
            >
              <Dices className="h-4 w-4" />
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="rounded-full p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className="mr-2 h-7 w-7 shrink-0 overflow-hidden rounded-full border border-primary/50">
                    <AnimatedSharkIcon className="h-full w-full" />
                  </div>
                )}
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm font-medium text-black"
                      : "max-w-[85%] rounded-2xl rounded-bl-md border border-primary/25 bg-[#14100a] px-3.5 py-2.5 text-sm text-neutral-100"
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-primary/25 bg-[#14100a] px-4 py-3">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
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
                  className="rounded-full border border-primary/40 px-3 py-1.5 text-xs text-primary transition hover:bg-primary hover:text-black"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 border-t border-primary/25 bg-[#0d0b06] p-3">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(input); }}
              placeholder="Ask about tools, credits, pricing…"
              maxLength={2000}
              aria-label="Chat message"
              className="min-w-0 flex-1 rounded-full border border-white/10 bg-black px-4 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:border-primary/60 focus:outline-none"
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-black transition hover:brightness-110 disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close AI chat" : "Chat with Thy Cheat Code"}
        className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 border-primary/70 bg-black shadow-[0_4px_20px_rgba(212,175,55,0.45)] transition hover:scale-105 active:scale-95"
      >
        {open ? (
          <X className="h-6 w-6 text-primary" />
        ) : (
          <AnimatedSharkIcon className="h-full w-full" />
        )}
      </button>
    </div>
  );
}
