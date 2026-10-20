import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import {
  chatVoiceNote,
  createChatVoiceSession,
  isChatVoiceSupported,
  type ChatVoiceErrorKind,
  type ChatVoiceNote,
  type ChatVoiceSession,
  type ChatVoiceState,
} from "@/lib/chat-voice";

/* ChatVoiceButton — the mic for the Thy Cheat Code chat drawer.
 *
 * Transport only, via lib/chat-voice: tap → listen → the finished
 * transcript is handed to onTranscript, and the drawer sends it
 * through the exact same send() a typed message uses. Interim words
 * stream into the input box (onInterim) so the user watches what was
 * heard before it sends.
 *
 * Honest states, per the seam: listening and transcribing show a
 * status line (via onNoteChange, rendered under the input bar);
 * permission denied explains itself in plain words and typing keeps
 * working; a capture that hears nothing says so and offers the mic
 * again — it never invents a transcript and never fails silently.
 * On a browser with no speech recognition the button still renders,
 * and tapping it explains that instead of vanishing.
 *
 * There is deliberately no speaker control on the mic itself: spoken
 * replies are the sibling ChatSpeakButton (lib/chat-speak), rendered
 * per reply by the drawer — a separate, server-priced rail.
 */
export function ChatVoiceButton({
  onTranscript,
  onInterim,
  onNoteChange,
  disabled = false,
}: {
  onTranscript: (text: string) => void;
  onInterim?: (text: string) => void;
  onNoteChange?: (note: ChatVoiceNote | null) => void;
  /** Blocks STARTING a capture (e.g. a reply is loading); never blocks stopping one. */
  disabled?: boolean;
}) {
  const [state, setState] = useState<ChatVoiceState>("idle");
  const [error, setError] = useState<ChatVoiceErrorKind | null>(null);
  const [supported] = useState<boolean>(() => isChatVoiceSupported());
  const sessionRef = useRef<ChatVoiceSession | null>(null);

  /* Closing the drawer unmounts the button — tear the capture down
     silently so no late callback lands on an unmounted tree. */
  useEffect(() => {
    return () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, []);

  /* The status line lives under the input bar (the drawer owns that
     layout); this button just reports what it should say. */
  useEffect(() => {
    onNoteChange?.(chatVoiceNote(state, error));
  }, [state, error, onNoteChange]);

  const toggle = () => {
    if (state === "listening") {
      sessionRef.current?.stop();
      return;
    }
    if (state === "transcribing") return;
    if (disabled) return;
    if (!supported) {
      setError("unsupported");
      return;
    }
    setError(null);
    if (!sessionRef.current) {
      sessionRef.current = createChatVoiceSession({
        onState: setState,
        onInterim: (text) => onInterim?.(text),
        onFinal: (text) => {
          setError(null);
          onTranscript(text);
        },
        onError: (kind) => setError(kind),
      });
    }
    sessionRef.current.start();
  };

  const listening = state === "listening";
  const transcribing = state === "transcribing";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled && !listening}
      aria-pressed={listening}
      aria-label={
        listening
          ? "Stop listening"
          : transcribing
            ? "Transcribing your voice"
            : "Voice input — speak your message"
      }
      title={
        listening
          ? "Stop listening"
          : transcribing
            ? "Transcribing…"
            : "Voice input — speak your message"
      }
      className={
        listening
          ? "flex h-10 w-10 shrink-0 animate-pulse items-center justify-center border-2 border-red-400/70 bg-red-500/20 text-red-300 transition"
          : "flex h-10 w-10 shrink-0 items-center justify-center border-2 border-transparent text-[#C9A84C] transition hover:border-[#C9A84C]/60 hover:bg-[#C9A84C]/15 disabled:opacity-40"
      }
      style={{ boxShadow: "3px 3px 0 rgba(0,0,0,0.85)" }}
    >
      {transcribing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : listening ? (
        <MicOff className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  );
}
