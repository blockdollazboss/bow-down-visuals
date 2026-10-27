import { useState } from "react";
import {
  Clapperboard, Copy, Check, Loader2, AlertTriangle, Sparkles,
} from "lucide-react";
import { VisualBucsIcon } from "@/components/VisualBucsIcon";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Podcast Multiplier (#163 delta) ───────────────────────────────────
   One tap turns the finished episode in the Podcast Studio into a
   publish kit: up to three shorts cut from real moments of the episode,
   a square audiogram video per short on a generated cover, show notes,
   and the cover art itself. The server resolves the transcript before
   charging (300 VB, charge-after-transcript, auto-refund if the kit
   can't be built). */

export const PODCAST_MULTIPLIER_COST = 300;

interface MultiplyShort {
  startSec: number;
  endSec: number;
  title: string;
  quote: string;
  audioUrl: string;
  audiogramUrl: string;
}

interface MultiplyResponse {
  kitId?: string;
  shorts?: MultiplyShort[];
  coverArtUrl?: string;
  showNotes?: string;
  summaryIncluded?: boolean;
  timingsEstimated?: boolean;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PodcastMultiplyPanel(props: {
  episodeAudioUrl: string;
  title: string;
  description?: string;
  transcript?: string;
  chapters?: Array<{ title: string; startSeconds: number }>;
}) {
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [building, setBuilding] = useState(false);
  const [kit, setKit] = useState<MultiplyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [notesCopied, setNotesCopied] = useState(false);

  async function buildKit() {
    if (building || !props.episodeAudioUrl) return;
    setBuilding(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/podcast/multiply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeAudioUrl: props.episodeAudioUrl,
          title: props.title,
          description: props.description ?? "",
          transcript: props.transcript,
          chapters: props.chapters ?? [],
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as MultiplyResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.kitId) {
        setError(data.error || data.message || "The publish kit couldn't be built — nothing was charged for a kit you didn't get.");
        return;
      }
      setKit(data);
      refreshProfile();
    } catch {
      setError("Network hiccup — the kit wasn't built.");
    } finally {
      setBuilding(false);
    }
  }

  async function copyNotes() {
    if (!kit?.showNotes) return;
    try {
      await navigator.clipboard.writeText(kit.showNotes);
      setNotesCopied(true);
      setTimeout(() => setNotesCopied(false), 2500);
    } catch {
      /* clipboard blocked — the notes are selectable below */
    }
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-3 space-y-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/60">
        <Clapperboard className="h-3.5 w-3.5 text-primary" />
        Podcast Multiplier — publish kit
      </h3>
      <p className="text-xs leading-relaxed text-white/45">
        One tap turns this episode into shorts, audiogram videos, show notes and cover
        art — all cut from the episode itself.
      </p>

      {!kit && (
        <button
          type="button"
          onClick={() => void buildKit()}
          disabled={building || !props.episodeAudioUrl}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-bold text-black transition hover:bg-primary/90 disabled:opacity-50"
        >
          {building ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Building your kit…</>
          ) : (
            <><Sparkles className="h-4 w-4" /> Build the publish kit — {PODCAST_MULTIPLIER_COST} <VisualBucsIcon className="h-4 w-4" /></>
          )}
        </button>
      )}

      {outOfCredits && (
        <p className="text-xs text-amber-300">
          Not enough Visual Bucs for the kit ({PODCAST_MULTIPLIER_COST} needed). Top up and it builds in one tap.
        </p>
      )}
      {error && (
        <p className="flex items-start gap-2 text-xs text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {kit && (
        <div className="space-y-4">
          {kit.coverArtUrl && (
            <img
              src={kit.coverArtUrl}
              alt="Episode cover art from the publish kit"
              className="w-full rounded-lg border border-white/10"
            />
          )}

          {(kit.shorts ?? []).map((short, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-white/10 bg-black/40 p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-xs font-semibold text-white">{short.title}</p>
                <span className="shrink-0 font-mono text-[11px] text-primary">
                  {fmt(short.startSec)}–{fmt(short.endSec)}
                </span>
              </div>
              {short.quote && (
                <p className="text-[11px] italic leading-relaxed text-white/45">“{short.quote}”</p>
              )}
              <audio src={short.audioUrl} controls className="w-full" />
              <video
                src={short.audiogramUrl}
                poster={kit.coverArtUrl}
                controls
                preload="metadata"
                className="w-full rounded-md"
              />
              <div className="flex gap-2">
                <a
                  href={short.audioUrl}
                  download
                  className="flex-1 rounded-md border border-white/15 px-2 py-1.5 text-center text-[11px] font-medium transition hover:border-primary/50 hover:text-primary"
                >
                  Short MP3
                </a>
                <a
                  href={short.audiogramUrl}
                  download
                  className="flex-1 rounded-md border border-white/15 px-2 py-1.5 text-center text-[11px] font-medium transition hover:border-primary/50 hover:text-primary"
                >
                  Audiogram MP4
                </a>
              </div>
            </div>
          ))}

          {kit.showNotes && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-white/50">Show notes</p>
                <button
                  type="button"
                  onClick={() => void copyNotes()}
                  className="flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] font-medium transition hover:border-primary/50 hover:text-primary"
                >
                  {notesCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {notesCopied ? "Copied" : "Copy notes"}
                </button>
              </div>
              <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-3 text-[11px] leading-relaxed text-white/60">
                {kit.showNotes}
              </pre>
              {!kit.summaryIncluded && (
                <p className="text-[11px] text-white/35">
                  Notes ship without an AI summary this time — chapters and moments are all there.
                </p>
              )}
            </div>
          )}

          <p className="text-[11px] text-white/35">
            {kit.timingsEstimated
              ? "Short timings come from your script's word rate — close, not frame-exact. "
              : ""}
            Kit built for {kit.creditsUsed ?? PODCAST_MULTIPLIER_COST} Visual Bucs.
          </p>
        </div>
      )}
    </div>
  );
}
