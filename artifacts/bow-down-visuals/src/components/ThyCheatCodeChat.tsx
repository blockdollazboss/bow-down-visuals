import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { ChatVoiceButton } from "@/components/ChatVoiceButton";
import { ChatSpeakButton } from "@/components/ChatSpeakButton";
import type { ChatVoiceNote } from "@/lib/chat-voice";
import {
  CHAT_SPEAK_CASTING_COPY,
  chatSpeakView,
  fetchChatSpeakStatus,
  loadChatSpeakEnabled,
  saveChatSpeakEnabled,
  type ChatSpeakStatus,
} from "@/lib/chat-speak";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import {
  parseChatDoors,
  startGuideOnArrival,
  type ChatDoor,
} from "@/lib/chat-doors";
import { X, Send, Loader2, Dices, Volume2, VolumeX, DoorOpen, Footprints } from "lucide-react";
import { CheatCodeName, PixelDivider } from "@/components/pixel-headline";
import { mediaUrl } from "@/lib/media-cdn";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  hasDownloadedExtension,
  hasOptedOutExtensionPromo,
  optOutExtensionPromo,
  markExtensionDownloaded,
} from "@/lib/extension-promo";
import {
  isAndroidDevice,
  hasDownloadedAndroidApp,
  hasOptedOutAndroidPromo,
  optOutAndroidPromo,
} from "@/lib/android-promo";

/* ─── Thy Cheat Code — on-site AI chat, right-side slide-over drawer ────────
   Gold/black 8-bit luxury theme, mobile-friendly. Mounted globally in
   AppShell; renders nothing until opened via the event bus:

     window.dispatchEvent(new CustomEvent("thy-chat:open", { detail: { prompt } }))

   There is no floating launcher anymore — the in-page ThyCheatCodeHost, its
   collapsed chip, and per-step "Ask about this" buttons open the drawer.
   Talks to POST /api/free-chat. Free via Groq (no credits).

   Voice OUT (lib/chat-speak): a header toggle (persisted per user)
   gives every reply a speak control priced by the server
   (GET /api/chat/speak/status) — POST /api/chat/speak charges per
   spoken reply. Until his voice is cast the control says so and
   charges nothing. */

type ChatRole = "user" | "assistant";
interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Tier 1 doors (Lane C): server-attached navigation for this reply,
      present only when the member's message matched a real feature. */
  doors?: ChatDoor[];
}

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

/* ─── Promo system inside the chat ───
   Thy Cheat Code promotes three things himself, rotating across
   sessions (one nudge per session, shortly after the drawer opens):
   the Chrome extension, the Android app (Android visitors only), and
   the paid ad Takeovers (Spotlight + Loading Screen). Each promo
   stops when its goal is done (downloaded) or the visitor says
   "stop promoting it" / "don't remind me" — that opts out of ALL
   promos permanently. Direct questions get canned answers without
   burning API credits. */
const STOP_PROMO_RE =
  /(stop (promoting|telling|mentioning)|don't remind|do not remind|no more (promo|remind|ads)|stop.*(extension|promo|ad).*remind|enough.*(extension|promos|ads))/i;
const EXT_INSTALL_RE =
  /(chrome extension|browser extension)/i;
const ANDROID_RE =
  /(android app|mobile app|phone app|android|apk)/i;
const ADS_RE =
  /(advertis|spotlight|takeover|ad placement|sponsor|promote my (brand|business|product|music)|get my (brand|business|product|music) (in front|on))/i;
const PROMO_NUDGE_SESSION_KEY = "bdv-chat-promo-nudge";
const PROMO_ROTATION_KEY = "bdv-chat-promo-rotation";
const ADS_OPTOUT_KEY = "bdv-chat-ads-optout";

function hasOptedOutAds(): boolean {
  try {
    return localStorage.getItem(ADS_OPTOUT_KEY) === "1";
  } catch {
    return false;
  }
}

const EXT_NUDGE: ChatMessage = {
  role: "assistant",
  content:
    "Quick one — I also live in your Chrome toolbar as an extension: AI chat, every site tool, daily bonuses, one-click saving. Download: bowdownvisuals.com/bow-down-visuals-extension-v2.zip — then unzip, go to chrome://extensions, turn on Developer mode, hit Load unpacked, pick the folder. Done in 30 seconds. (You can also install this site as a Chrome app from your browser menu. Say “stop promoting it” anytime and I'll never mention it again.)",
};

const ANDROID_NUDGE: ChatMessage = {
  role: "assistant",
  content:
    "Quick one — you're on Android, so grab the Bow Down Visuals app: every tool in your pocket, same account, same Visual Bucs. It's free — get it at bowdownvisuals.com/download and install the APK in under a minute. (Say “stop promoting it” anytime and I'll never mention it again.)",
};

const ADS_NUDGE: ChatMessage = {
  role: "assistant",
  content:
    "Quick one for brands and creators — I sell two takeover spots on this site. Spotlight Takeover: your video becomes the full-screen background on the sign-in and sign-up screens — $1,000 for 7 days. Loading Screen Takeover: your brand on every loading screen — $2,500 for 7 days. Tap the “Your video here” badge on the sign-in screen to send an inquiry; every placement is approved personally before anything charges. (Say “stop promoting it” anytime and I'll never mention it again.)",
};

const EXT_INSTALL_ANSWER: ChatMessage = {
  role: "assistant",
  content:
    "Easy — hit the gold Download button on the /extension page, unzip the file, then in Chrome go to chrome://extensions → turn on Developer mode → “Load unpacked” → pick the unzipped folder. Pin the extension icon and you're set. Full step-by-step is on the /extension page too.",
};

const ANDROID_ANSWER: ChatMessage = {
  role: "assistant",
  content:
    "Yes — there's a free Android app. Head to bowdownvisuals.com/download, tap Download APK, and install it (Android may ask you to allow installs from your browser — that's normal for a direct APK). Same account, same Visual Bucs, every tool in your pocket.",
};

const ADS_ANSWER: ChatMessage = {
  role: "assistant",
  content:
    "Two takeover spots put your brand in front of every Bow Down Visuals visitor. Spotlight Takeover — $1,000 for 7 days: your video (1080p MP4, up to 30s, muted loop) becomes the full-screen background on the sign-in and sign-up screens, with your link on the Ad badge. Loading Screen Takeover — $2,500 for 7 days: your brand on every loading screen site-wide. To book, tap the “Your video here” badge on the sign-in screen (or a takeover card on any loading screen) and send the inquiry — every placement is reviewed and approved before anything charges.",
};

/** Pick the next eligible promo nudge, rotating across sessions so
 *  repeat visitors don't get the same one every time. */
function pickPromoNudge(): ChatMessage | null {
  const eligible: ChatMessage[] = [];
  if (!hasDownloadedExtension() && !hasOptedOutExtensionPromo()) eligible.push(EXT_NUDGE);
  if (isAndroidDevice() && !hasDownloadedAndroidApp() && !hasOptedOutAndroidPromo()) eligible.push(ANDROID_NUDGE);
  if (!hasOptedOutAds() && !hasOptedOutExtensionPromo()) eligible.push(ADS_NUDGE);
  if (eligible.length === 0) return null;
  let rotation = 0;
  try {
    rotation = Number(localStorage.getItem(PROMO_ROTATION_KEY) ?? 0) || 0;
    localStorage.setItem(PROMO_ROTATION_KEY, String(rotation + 1));
  } catch { /* private mode — always first eligible */ }
  return eligible[rotation % eligible.length]!;
}

/** Render assistant text with tappable links — a promo whose URL can't
 *  be tapped doesn't convert (the extension ZIP used to render as
 *  plain text). Only assistant bubbles are linkified. */
function renderRich(content: string) {
  const parts = content.split(/(https?:\/\/[^\s)]+|bowdownvisuals\.com\/[^\s)]+)/g);
  return parts.map((part, i) => {
    if (!/^(https?:\/\/|bowdownvisuals\.com\/)/.test(part)) {
      return <span key={i}>{part}</span>;
    }
    const href = part.startsWith("http") ? part : `https://${part}`;
    return (
      <a
        key={i}
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={part.includes("extension-v2.zip") ? () => markExtensionDownloaded() : undefined}
        className="text-[#E8C96A] underline underline-offset-2 hover:text-[#F5DE8E]"
      >
        {part}
      </a>
    );
  });
}

/** Open the Thy Cheat Code chat drawer, optionally with a prefilled prompt. */
export function openThyChat(prompt?: string) {
  window.dispatchEvent(
    new CustomEvent("thy-chat:open", { detail: { prompt } })
  );
}

export function ThyCheatCodeChat() {
  // Free version: direct fetch to /api/free-chat (no credits)
  const isLight = useIsLightTheme();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [voiceNote, setVoiceNote] = useState<ChatVoiceNote | null>(null);
  /* Voice out: the per-user toggle (persisted) + the server's word on
     readiness and price, read fresh each time the drawer opens. */
  const [voiceOut, setVoiceOut] = useState<boolean>(() => loadChatSpeakEnabled());
  const [speakStatus, setSpeakStatus] = useState<ChatSpeakStatus | null>(null);
  const [speakStatusFailed, setSpeakStatusFailed] = useState(false);
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

  /* Voice-out status: readiness + price come from the server, never
     from a client constant. Refetched on each open so a voice cast
     (or a price change) lands without a page reload. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchChatSpeakStatus()
      .then((status) => {
        if (cancelled) return;
        setSpeakStatus(status);
        setSpeakStatusFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSpeakStatusFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const speakView = chatSpeakView(speakStatus, speakStatusFailed);

  const toggleVoiceOut = () => {
    const next = !voiceOut;
    setVoiceOut(next);
    saveChatSpeakEnabled(next);
    if (next && speakView === "casting") {
      setVoiceNote({ tone: "info", text: CHAT_SPEAK_CASTING_COPY });
    }
  };

  /* Proactive promo nudge: once per session, shortly after the drawer
     opens, Thy Cheat Code promotes one thing himself — rotating across
     the extension, the Android app, and the ad Takeovers — unless the
     visitor already grabbed it or told him to stop. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    try {
      if (sessionStorage.getItem(PROMO_NUDGE_SESSION_KEY) === "1") return;
    } catch { /* private mode */ }
    const nudge = pickPromoNudge();
    if (!nudge) return;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      setMessages((prev) => [...prev, nudge]);
      try { sessionStorage.setItem(PROMO_NUDGE_SESSION_KEY, "1"); } catch { /* ignore */ }
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

    // "Stop promoting it" → permanent opt-out of ALL chat promos, no API call.
    if (STOP_PROMO_RE.test(trimmed)) {
      optOutExtensionPromo();
      optOutAndroidPromo();
      try { localStorage.setItem(ADS_OPTOUT_KEY, "1"); } catch { /* ignore */ }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Got it — no more promos from me. The extension, the Android app, and the ad spots stay on the /download and sign-in pages if you ever want them." },
      ]);
      return;
    }
    // Android app questions → direct answer, no API call.
    if (ANDROID_RE.test(trimmed) && /(app|install|download|get|how|where|apk)/i.test(trimmed)) {
      setMessages((prev) => [...prev, ANDROID_ANSWER]);
      return;
    }
    // Advertising / takeover questions → direct answer, no API call.
    if (ADS_RE.test(trimmed)) {
      setMessages((prev) => [...prev, ADS_ANSWER]);
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
          "My fins slipped — could you ask that again?";
      } else {
        reply =
          data.reply ||
          data.error ||
          "My fins slipped — could you ask that again?";
      }
      /* Tier 1 doors ride successful replies only — an error body
         never carries any, and parseChatDoors drops anything malformed. */
      const doors = res.ok ? parseChatDoors(data) : [];
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply, ...(doors.length ? { doors } : {}) },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Couldn't reach the surface — check your connection and try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  /* Tier 1 doors: he walks you there. The drawer closes, the router
     lands on the door's exact path (the knowledge base's own deep
     link), and a guide door starts that page's "Walk me through it"
     tour once the landing settles. A signed-out member's door is a
     plain navigation — the site's sign-in gate answers as usual. */
  const followDoor = (door: ChatDoor) => {
    setOpen(false);
    navigate(door.path);
    if (door.kind === "guide") startGuideOnArrival(door.path);
  };

  /* Voice input (lib/chat-voice transport): interim words stream into
     the input box so the user sees what was heard; the finished
     transcript goes through the very same send() a typed message uses —
     same request, same payload shape, nothing voice-specific reaches
     the server. If a reply is already loading, send() would refuse the
     message, so the transcript waits in the input box instead of
     being lost. */
  const handleVoiceInterim = (text: string) => setInput(text);
  const handleVoiceFinal = (text: string) => {
    if (loading) {
      setInput(text);
      return;
    }
    send(text);
  };

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
    /* No floating launcher — the in-page ThyCheatCodeHost (slim chip and
       "CHAT WITH ME" / "ASK ABOUT THIS" buttons) opens the drawer. */
    return null;
  }

  return (
    <>
      {/* Small floating popup — no screen-blurring backdrop.
          Raised well above the bottom edge (was bottom-24, sat too low)
          with safe-area clearance for mobile home indicators. */}
      <div
        role="dialog"
        aria-label="Chat with Thy Cheat Code"
        className="animate-tcc-drawer-in fixed right-5 z-[9995] h-[min(520px,70vh)] w-[min(340px,90vw)]"
        style={{ bottom: "max(7rem, calc(env(safe-area-inset-bottom, 0px) + 6rem))" }}
      >
        <div
          className={`flex h-full w-full flex-col overflow-hidden rounded-2xl border-4 border-[#C9A84C] ${isLight ? "bg-[#FDFBF5]" : "bg-[#14100a]"}`}
          style={{
            boxShadow: "0 12px 48px rgba(0,0,0,0.8), 0 0 24px rgba(201,168,76,0.2)",
            imageRendering: "pixelated",
          }}
        >
          {/* Header */}
          <div className={`${isLight ? "border-b-4 border-[#C9A84C]/60 bg-gradient-to-r from-[#F7ECD2] to-[#FCF7EA] px-4 py-3" : "border-b-4 border-[#C9A84C]/60 bg-gradient-to-r from-[#1a1405] to-[#0d0a04] px-4 py-3"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="h-12 w-12 shrink-0 overflow-hidden border-2 border-[#C9A84C] bg-black"
                  style={{ boxShadow: "3px 3px 0 rgba(0,0,0,0.9)" }}
                >
                  <video
                    src={mediaUrl(isLight ? "thy-cheat-code-working-8bit-light.mp4" : "thy-cheat-code-working-8bit.mp4")}
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
                  onClick={toggleVoiceOut}
                  aria-pressed={voiceOut}
                  aria-label={
                    voiceOut
                      ? "Turn off spoken replies"
                      : "Turn on spoken replies — hear Thy Cheat Code out loud"
                  }
                  title={
                    !voiceOut
                      ? "Hear his replies out loud"
                      : speakView === "ready"
                        ? `Spoken replies: ${speakStatus?.creditCost ?? 0} Visual Bucs each`
                        : speakView === "casting"
                          ? "His voice is still being cast"
                          : "Spoken replies"
                  }
                  className={`border-2 p-1.5 transition ${
                    voiceOut
                      ? "border-[#C9A84C]/60 bg-[#C9A84C]/15 text-[#E8C96A]"
                      : "border-transparent text-neutral-400 hover:border-[#C9A84C]/60 hover:bg-[#C9A84C]/15 hover:text-[#E8C96A]"
                  }`}
                >
                  {voiceOut ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
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
                src={mediaUrl("thy-cheat-code-8bit.webp")}
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
                      src={mediaUrl(isLight ? "thy-cheat-code-working-8bit-light.mp4" : "thy-cheat-code-working-8bit.mp4")}
                      autoPlay
                      muted
                      loop
                      playsInline
                      aria-label="Thy Cheat Code"
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                {m.role === "user" ? (
                  <div
                    className="max-w-[85%] border-2 border-[#8A6B1F] bg-[#C9A84C] px-3.5 py-2.5 text-sm font-medium text-black"
                    style={{ boxShadow: "3px 3px 0 rgba(0,0,0,0.75)" }}
                  >
                    {m.content}
                  </div>
                ) : (
                  <div className="flex max-w-[85%] flex-col items-start">
                    <div
                      className="tcc-assistant-bubble tcc-chat border-2 border-[#C9A84C]/40 bg-[#14100a] px-3.5 py-2.5 text-lg leading-snug text-neutral-100"
                      style={{ boxShadow: "3px 3px 0 rgba(0,0,0,0.75)" }}
                    >
                      {renderRich(m.content)}
                    </div>
                    {voiceOut && (
                      <div className="mt-1.5">
                        <ChatSpeakButton
                          text={m.content}
                          view={speakView}
                          creditCost={speakStatus?.creditCost ?? 0}
                          onNote={setVoiceNote}
                        />
                      </div>
                    )}
                    {m.doors && m.doors.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {m.doors.map((door) => (
                          <button
                            key={door.kind}
                            onClick={() => followDoor(door)}
                            className="pixel-display inline-flex items-center gap-1.5 border-2 border-[#C9A84C]/60 bg-[#C9A84C]/10 px-2.5 py-2 text-[9px] uppercase tracking-[0.12em] text-[#E8C96A] transition hover:bg-[#C9A84C] hover:text-black"
                            style={{ boxShadow: "2px 2px 0 rgba(0,0,0,0.8)" }}
                          >
                            {door.kind === "guide" ? (
                              <Footprints className="h-3 w-3" />
                            ) : (
                              <DoorOpen className="h-3 w-3" />
                            )}
                            {door.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
          <div className="border-t-4 border-[#C9A84C]/60 bg-[#0d0b06]">
            <div className="flex items-center gap-2 p-3">
            <ChatVoiceButton
              onTranscript={handleVoiceFinal}
              onInterim={handleVoiceInterim}
              onNoteChange={setVoiceNote}
              disabled={loading}
            />
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
            {voiceNote && (
              <p
                role="status"
                className={`px-3 pb-3 text-[11px] leading-snug ${
                  voiceNote.tone === "error" ? "text-red-300" : "text-[#E8C96A]"
                }`}
              >
                {voiceNote.text}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
