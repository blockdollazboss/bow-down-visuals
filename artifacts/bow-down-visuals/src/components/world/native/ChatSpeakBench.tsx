/**
 * ChatSpeakBench — Chat Speak's native bench on the
 * in-World Thy/operator surface (Stack 400 world parity,
 * census B-08), stacked at the My Studio board with the
 * other project desks: the operator's voice, in the room.
 *
 * The 2D chat drawer's own flow on its own rail (lib/world/
 * chat-speak-bench.ts over lib/chat-speak): the bench reads
 * GET /api/chat/speak/status — readiness AND the price come
 * from the server, never a client constant — and the speak
 * itself runs through confirmedFetch with that server
 * figure, so the member confirms the exact spend before
 * anything is spoken. Declining sends nothing and charges
 * nothing; a successful speak is cached, and listening again
 * replays it locally for free.
 *
 * Charged only when it plays: until the King's voice is
 * cast the server refuses and never charges, and the bench
 * shows the drawer's own "still being cast" words — there
 * is no dead control and no fake speak. One client key per
 * speak intent (a retry of the same tap can't
 * double-charge), and playback rides the drawer's one-voice
 * coordinator — the King never talks over himself, in the
 * World or out of it.
 *
 * Copy rides the worldChatSpeakBench.* namespace; the
 * casting/unavailable lines are the drawer's own strings.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import {
  CHAT_SPEAK_CASTING_COPY,
  CHAT_SPEAK_UNAVAILABLE_COPY,
  chatSpeakView,
  fetchChatSpeakStatus,
  newChatSpeakKey,
  playChatSpeakAudio,
  requestChatSpeak,
  type ChatSpeakFetch,
  type ChatSpeakStatus,
} from "@/lib/chat-speak";
import { deskInputCls, useDeskAuthHeaders } from "./CreateDeskLeaf";
import { NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  WORLD_SPEAK_FEATURE,
  WORLD_SPEAK_TEXT_MAX,
  speakOutcomeOf,
  speakTextReady,
} from "@/lib/world/chat-speak-bench";

type SpeakPhase = "idle" | "working" | "playing" | "error";

export function ChatSpeakBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const authHeaders = useDeskAuthHeaders();

  const [status, setStatus] = useState<ChatSpeakStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [statusNonce, setStatusNonce] = useState(0);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<SpeakPhase>("idle");
  const [note, setNote] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const labelCls = `text-[11px] font-bold uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;

  /* The status read — readiness + the server's price. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const headers = await authHeaders();
        const s = await fetchChatSpeakStatus((input, init) =>
          fetch(input, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } }),
        );
        if (!alive) return;
        setStatus(s);
        setStatusFailed(false);
      } catch {
        if (alive) setStatusFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusNonce]);

  /* Unmount: stop our playback (the drawer's rule). */
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

  const view = chatSpeakView(status, statusFailed);
  const cost = status?.creditCost ?? 0;
  const ready = speakTextReady(text);

  const playUrl = (url: string) => {
    const el = playChatSpeakAudio(url);
    audioRef.current = el;
    el.onended = () => {
      if (audioRef.current === el) setPhase("idle");
    };
    el.onpause = () => {
      if (audioRef.current === el) setPhase((p) => (p === "playing" ? "idle" : p));
    };
    setPhase("playing");
  };

  const speak = async () => {
    if (phase === "working") return;
    if (phase === "playing") {
      audioRef.current?.pause();
      setPhase("idle");
      return;
    }
    /* Already synthesized once — replay is local and free. */
    if (urlRef.current) {
      playUrl(urlRef.current);
      return;
    }
    if (!ready || view !== "ready") return;
    setPhase("working");
    setNote(null);
    if (!keyRef.current) keyRef.current = newChatSpeakKey();
    const speakFetch: ChatSpeakFetch = (input, init) =>
      confirmedFetch(input, {
        ...init,
        overrideCost: cost,
        overrideFeature: WORLD_SPEAK_FEATURE,
      });
    try {
      const result = await requestChatSpeak(speakFetch, text.trim(), keyRef.current);
      if (result === null) {
        /* Spend confirmation cancelled — no request, no charge. */
        setPhase("idle");
        return;
      }
      const outcome = speakOutcomeOf(result);
      if (!outcome) {
        setNote(t("worldChatSpeakBench.failed"));
        setPhase("error");
        return;
      }
      urlRef.current = outcome.audioPlayUrl;
      refreshProfile();
      playUrl(outcome.audioPlayUrl);
    } catch (err) {
      setNote(
        err instanceof Error ? err.message : t("worldChatSpeakBench.failed"),
      );
      setPhase("error");
    }
  };

  return (
    <section data-testid="world-chat-speak-bench" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Volume2 className="h-4 w-4 text-[#d4af37]" />
        <h3 className={`text-sm font-black uppercase tracking-wider ${strong}`}>
          {t("worldChatSpeakBench.title")}
        </h3>
        {view === "ready" ? (
          <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-[#d4af37]">
            {t("worldChatSpeakBench.costBadge", { cost })}
          </span>
        ) : null}
      </div>
      <p className={`text-xs ${muted}`}>{t("worldChatSpeakBench.subtitle")}</p>

      <label className="block">
        <span className={`mb-1 block ${labelCls}`}>{t("worldChatSpeakBench.textLabel")}</span>
        <textarea
          aria-label={t("worldChatSpeakBench.textLabel")}
          value={text}
          onChange={(e) => {
            setText(e.target.value.slice(0, WORLD_SPEAK_TEXT_MAX));
            /* A new text is a new speak intent: fresh key,
               no cached audio from the old words. */
            keyRef.current = null;
            urlRef.current = null;
          }}
          placeholder={t("worldChatSpeakBench.textPlaceholder")}
          className={`${deskInputCls(isLight)} min-h-[80px] resize-none`}
        />
      </label>

      {view === "loading" ? (
        <NativeLoadingState isLight={isLight} message={t("worldChatSpeakBench.checking")} />
      ) : statusFailed ? (
        <NativeErrorState
          isLight={isLight}
          message={CHAT_SPEAK_UNAVAILABLE_COPY}
          onRetry={() => {
            setStatusFailed(false);
            setStatus(null);
            setStatusNonce((n) => n + 1);
          }}
        />
      ) : view === "casting" ? (
        <div
          data-testid="world-chat-speak-casting"
          className="flex items-start gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3"
        >
          <VolumeX className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/80" />
          <p className={`text-xs leading-relaxed ${muted}`}>{CHAT_SPEAK_CASTING_COPY}</p>
        </div>
      ) : view === "unavailable" ? (
        <p className={`text-xs leading-relaxed ${muted}`}>{CHAT_SPEAK_UNAVAILABLE_COPY}</p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void speak()}
            disabled={!ready && phase === "idle"}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-black text-black transition hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-50 bdv-touch-target"
          >
            {phase === "working" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
            {phase === "playing"
              ? t("worldChatSpeakBench.stop")
              : urlRef.current
                ? t("worldChatSpeakBench.listenAgain")
                : t("worldChatSpeakBench.speak", { cost })}
          </button>
          {note ? (
            <p data-testid="world-chat-speak-note" className={`text-xs font-bold ${strong}`}>
              {note}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
