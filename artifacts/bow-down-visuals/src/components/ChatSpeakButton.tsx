import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, Loader2 } from "lucide-react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import type { ChatVoiceNote } from "@/lib/chat-voice";
import {
  CHAT_SPEAK_CASTING_COPY,
  CHAT_SPEAK_UNAVAILABLE_COPY,
  chatSpeakErrorNote,
  newChatSpeakKey,
  playChatSpeakAudio,
  requestChatSpeak,
  type ChatSpeakFetch,
  type ChatSpeakView,
} from "@/lib/chat-speak";

/* ChatSpeakButton — the per-reply "hear him say it" control in the
 * Thy Cheat Code chat drawer (voice OUT, lib/chat-speak seam).
 *
 * Renders only when the member has flipped the drawer's voice-out
 * toggle on. What it can do is bounded by the server's word, read
 * from GET /api/chat/speak/status by the drawer and passed in as
 * `view` + `creditCost`:
 *  - ready: the button shows the server's price BEFORE anything is
 *    spoken ("Speak · N VB"); tapping runs the codebase's spend
 *    confirmation with that same server figure, then the charged
 *    POST /api/chat/speak. A successful speak is cached on the
 *    button — "Listen again" replays the same audio locally, free.
 *  - casting: the King's voice isn't cast yet (server env unset).
 *    The button says so in plain words and charges nothing — there
 *    is no dead control and no fake speak.
 *  - unavailable / loading: honest chips, nothing tappable into a
 *    charge.
 * Failures surface the server's own message on the drawer's status
 * line (onNote) — never a client-invented explanation, never silent.
 */
type SpeakState = "idle" | "loading" | "playing" | "error";

export function ChatSpeakButton({
  text,
  view,
  creditCost,
  onNote,
}: {
  text: string;
  view: ChatSpeakView;
  creditCost: number;
  onNote?: (note: ChatVoiceNote | null) => void;
}) {
  const { confirmedFetch } = useConfirmedApi();
  const [state, setState] = useState<SpeakState>("idle");
  const keyRef = useRef<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* Unmount (drawer closed / message list reset): stop our playback. */
  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        try {
          el.pause();
        } catch {
          /* already stopped */
        }
        audioRef.current = null;
      }
    };
  }, []);

  const playUrl = (url: string) => {
    const el = playChatSpeakAudio(url);
    audioRef.current = el;
    el.onended = () => {
      if (audioRef.current === el) setState("idle");
    };
    el.onpause = () => {
      /* Another reply started speaking, or the user stopped us. */
      if (audioRef.current === el) setState((s) => (s === "playing" ? "idle" : s));
    };
    setState("playing");
  };

  const speak = async () => {
    if (state === "loading") return;
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }
    /* Already synthesized once — replay is local and free. */
    if (urlRef.current) {
      playUrl(urlRef.current);
      return;
    }
    setState("loading");
    onNote?.(null);
    if (!keyRef.current) keyRef.current = newChatSpeakKey();
    const speakFetch: ChatSpeakFetch = (input, init) =>
      confirmedFetch(input, {
        ...init,
        overrideCost: creditCost,
        overrideFeature: "Hear Thy Cheat Code speak",
      });
    try {
      const result = await requestChatSpeak(speakFetch, text, keyRef.current);
      if (result === null) {
        /* Spend confirmation cancelled — no request, no charge. */
        setState("idle");
        return;
      }
      urlRef.current = result.audioPlayUrl;
      playUrl(result.audioPlayUrl);
    } catch (err) {
      onNote?.(
        chatSpeakErrorNote(
          err instanceof Error
            ? err.message
            : "Thy Cheat Code couldn't speak that reply — please try again.",
        ),
      );
      setState("error");
    }
  };

  const chipClass =
    "flex items-center gap-1.5 border-2 px-2 py-1 text-[10px] uppercase tracking-[0.12em] transition";
  const shadow = { boxShadow: "2px 2px 0 rgba(0,0,0,0.8)" } as const;

  if (view === "casting") {
    return (
      <button
        type="button"
        onClick={() => onNote?.({ tone: "info", text: CHAT_SPEAK_CASTING_COPY })}
        aria-label="Spoken replies are not ready yet — his voice is still being cast"
        className={`${chipClass} border-white/15 text-neutral-400 hover:border-[#C9A84C]/50 hover:text-[#E8C96A]`}
        style={shadow}
      >
        <VolumeX className="h-3 w-3" />
        Voice still being cast
      </button>
    );
  }

  if (view === "unavailable") {
    return (
      <button
        type="button"
        onClick={() =>
          onNote?.({ tone: "error", text: CHAT_SPEAK_UNAVAILABLE_COPY })
        }
        aria-label="Spoken replies are unavailable right now"
        className={`${chipClass} border-white/15 text-neutral-400 hover:border-[#C9A84C]/50 hover:text-[#E8C96A]`}
        style={shadow}
      >
        <VolumeX className="h-3 w-3" />
        Voice unavailable
      </button>
    );
  }

  if (view === "loading") {
    return (
      <span
        className={`${chipClass} border-white/15 text-neutral-500`}
        style={shadow}
        aria-label="Checking whether his voice is ready"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking his voice…
      </span>
    );
  }

  const label =
    state === "loading"
      ? "Speaking…"
      : state === "playing"
        ? "Playing…"
        : urlRef.current
          ? "Listen again"
          : state === "error"
            ? `Try again · ${creditCost} VB`
            : `Speak · ${creditCost} VB`;

  return (
    <button
      type="button"
      onClick={speak}
      disabled={state === "loading"}
      aria-label={
        urlRef.current && state !== "playing"
          ? "Listen to this reply again — no charge"
          : `Hear this reply spoken by Thy Cheat Code — ${creditCost} Visual Bucs`
      }
      title={
        urlRef.current && state !== "playing"
          ? "Replay — no charge"
          : `Hear Thy Cheat Code speak this reply — ${creditCost} Visual Bucs`
      }
      className={`${chipClass} border-[#C9A84C]/60 text-[#E8C96A] hover:bg-[#C9A84C]/15 disabled:opacity-50 ${
        state === "playing" ? "animate-pulse" : ""
      }`}
      style={shadow}
    >
      {state === "loading" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Volume2 className="h-3 w-3" />
      )}
      {label}
    </button>
  );
}
