import { useEffect, useRef, useState } from "react";
import { Captions, Loader2, Mic, MicOff, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/social-api";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  SpeechCaptionSource,
  getCaptionLanguages,
  getCaptionTrack,
  postCaptionSegment,
  setCaptionTrack,
  type CaptionLanguageOption,
  type FetchJson,
} from "@/lib/live-captions-client";

/* ─── Live captions — the STREAMER side of #160 ─────────────────────────
   Docked in the Broadcast Studio next to chat and widgets: the
   streamer opens the caption track, names the language they're
   speaking, and captions run from there — viewers each pick their
   own language on the watch page. The caption SOURCE is the
   streamer's real speech: their browser's speech recognizer
   transcribes the mic and posts final lines only. A browser with
   no recognizer says so plainly and offers the typed-line box (the
   streamer typing what they say — a real caption source), never a
   fake "auto-captions on" claim. Captions are a house feature of
   going live: free for the creator, free for viewers (owner ruling,
   Oct 25) — the panel says so instead of showing a price. */

export default function LiveCaptionsStudioPanel({ streamId }: { streamId: string | null }) {
  const { getAccessToken } = useAuth();
  const isLight = useIsLightTheme();
  const [, setTick] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [sourceLanguages, setSourceLanguages] = useState<CaptionLanguageOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [typedLine, setTypedLine] = useState("");
  const [posting, setPosting] = useState(false);
  const [lastPosted, setLastPosted] = useState<string | null>(null);
  const sourceRef = useRef<SpeechCaptionSource | null>(null);

  const fetchJson: FetchJson = async (path, init) => {
    const res = await apiFetch(getAccessToken, path, init);
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const fetchJsonRef = useRef(fetchJson);
  fetchJsonRef.current = fetchJson;

  /* Load the track state + the rail's language catalog. */
  useEffect(() => {
    if (!streamId) {
      setLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [track, catalog] = await Promise.all([
        getCaptionTrack(fetchJsonRef.current, streamId),
        getCaptionLanguages(fetchJsonRef.current),
      ]);
      if (cancelled) return;
      if (track) {
        setEnabled(track.settings.enabled);
        setSourceLanguage(track.settings.sourceLanguage);
      }
      if (catalog) setSourceLanguages(catalog.sourceLanguages);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [streamId]);

  /* The speech source lives for the panel; its final lines post to
     this stream. Rebuilt if the spoken language changes. */
  useEffect(() => {
    if (!streamId) return;
    const source = new SpeechCaptionSource({
      lang: sourceLanguage,
      onFinalLine: (text) => {
        void postCaptionSegment(fetchJsonRef.current, streamId, text).then((r) => {
          if (r.ok) {
            setLastPosted(text);
            setNote(null);
          } else if (r.error) {
            setNote(r.error);
          }
        });
      },
      onChange: () => setTick((t) => t + 1),
    });
    sourceRef.current = source;
    return () => {
      source.stop();
      if (sourceRef.current === source) sourceRef.current = null;
    };
  }, [streamId, sourceLanguage]);

  const panel = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const sub = isLight ? "text-[#6B5B36]" : "text-white/40";
  const heading = isLight ? "text-[#7A5A12]" : "text-[#fbbf24]";
  const inputCls = isLight
    ? "rounded-xl border border-[#C9A84C]/40 bg-white/70 px-3 py-2 text-sm text-[#2A1E07] focus:outline-none focus:border-[#C9A84C]"
    : "rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none focus:border-amber-400/60";

  if (!streamId) {
    return (
      <div className={`rounded-2xl border p-5 md:p-6 ${panel}`} data-testid="live-captions-studio">
        <h3 className={`flex items-center gap-2 text-sm font-black uppercase tracking-widest ${heading}`}>
          <Captions className="h-4 w-4" /> Live captions
        </h3>
        <p className={`mt-1 text-xs ${sub}`}>
          Captions open with your stream — go live and you can caption your speech here, translated live into every
          viewer's own language. Free: captions are part of going live, not an add-on.
        </p>
      </div>
    );
  }

  const source = sourceRef.current;
  const speechState = source?.state ?? "idle";

  async function applyTrack(patch: { enabled?: boolean; sourceLanguage?: string }) {
    if (!streamId || saving) return;
    setSaving(true);
    const r = await setCaptionTrack(fetchJsonRef.current, streamId, patch);
    setSaving(false);
    if (r.ok && r.settings) {
      setEnabled(r.settings.enabled);
      setSourceLanguage(r.settings.sourceLanguage);
      setNote(null);
    } else {
      setNote(r.error ?? "Caption settings couldn't save.");
    }
  }

  async function sendTypedLine() {
    if (!streamId || posting || !typedLine.trim()) return;
    setPosting(true);
    const r = await postCaptionSegment(fetchJsonRef.current, streamId, typedLine);
    setPosting(false);
    if (r.ok) {
      setLastPosted(typedLine.trim());
      setTypedLine("");
      setNote(null);
    } else {
      setNote(r.error ?? "That caption line didn't go through.");
    }
  }

  return (
    <div className={`rounded-2xl border p-5 md:p-6 ${panel}`} data-testid="live-captions-studio">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className={`flex items-center gap-2 text-sm font-black uppercase tracking-widest ${heading}`}>
            <Captions className="h-4 w-4" /> Live captions — every language
          </h3>
          <p className={`mt-1 max-w-lg text-xs ${sub}`}>
            Turn captions on and your speech runs as live captions under the stream. Every viewer picks their own
            language and reads you in it. Free — captions are part of going live, not an add-on.
          </p>
        </div>
        <button
          type="button"
          disabled={!loaded || saving}
          onClick={() => void applyTrack({ enabled: !enabled })}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${
            enabled ? "bg-amber-400 text-black" : isLight ? "border border-[#C9A84C]/50 text-[#6B5B36]" : "border border-white/15 text-white/70"
          }`}
          data-testid="btn-caption-track-toggle"
          aria-pressed={enabled}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Captions {enabled ? "on" : "off"}
        </button>
      </div>

      {enabled && (
        <div className="mt-4 flex flex-col gap-4">
          <label className={`flex flex-wrap items-center gap-2 text-xs font-bold ${sub}`}>
            I'm speaking
            <select
              value={sourceLanguage}
              onChange={(e) => void applyTrack({ sourceLanguage: e.target.value })}
              className={inputCls}
              data-testid="select-caption-source-language"
            >
              {(sourceLanguages.length ? sourceLanguages : [{ code: "en", label: "English" }]).map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30 bg-white/50" : "border-white/10 bg-black/30"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => (speechState === "listening" ? source?.stop() : source?.start())}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black transition ${
                  speechState === "listening" ? "bg-red-500 text-white" : "bg-amber-400 text-black hover:scale-105"
                }`}
                data-testid="btn-caption-mic"
              >
                {speechState === "listening" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {speechState === "listening" ? "Stop listening" : "Caption my mic"}
              </button>
              <span className={`text-xs font-semibold ${sub}`} data-testid="caption-source-state">
                {speechState === "listening" && "Listening — your speech becomes captions as you talk."}
                {speechState === "idle" && "Mic captions are off. Start listening and speak — final lines post as captions."}
                {speechState === "unsupported" &&
                  "This browser can't transcribe speech, so mic captions aren't available here — type your lines below instead; they post as captions exactly as written."}
                {speechState === "blocked" &&
                  "The mic was refused — allow microphone access for this site, or type your lines below."}
                {speechState === "error" && "Speech transcription hit a problem in this browser — type your lines below instead."}
              </span>
            </div>
            {speechState === "listening" && source?.interim && (
              <p className={`mt-2 text-sm italic ${sub}`} data-testid="caption-interim">
                Hearing: {source.interim}…
              </p>
            )}
            {lastPosted && (
              <p className={`mt-2 text-sm ${sub}`} data-testid="caption-last-posted">
                Last caption sent: <span className={isLight ? "text-[#2A1E07]" : "text-white/85"}>{lastPosted}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input aria-label="Type a caption line — posts exactly as written"
              value={typedLine}
              onChange={(e) => setTypedLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendTypedLine();
              }}
              placeholder="Type a caption line — posts exactly as written"
              maxLength={300}
              className={`min-w-0 flex-1 ${inputCls}`}
              data-testid="input-caption-typed-line"
            />
            <button
              type="button"
              onClick={() => void sendTypedLine()}
              disabled={posting || !typedLine.trim()}
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-4 py-2 text-xs font-black text-black transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="btn-caption-send-line"
            >
              {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send line
            </button>
          </div>
        </div>
      )}

      {note && (
        <p className="mt-3 text-xs font-semibold text-red-400" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}
