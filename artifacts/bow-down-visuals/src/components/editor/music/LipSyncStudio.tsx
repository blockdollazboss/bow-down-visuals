import { Mic2, ImageIcon, Music4, Captions, Info, User } from "lucide-react";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

interface LipSyncStudioProps {
  audioUrl: string | null;
  transcriptText: string | null;
  activeArtist: ArtistVault | null;
}

interface ConceptPillProps {
  label: string;
  desc: string;
  highlight?: boolean;
}

function ConceptPill({ label, desc, highlight }: ConceptPillProps) {
  return (
    <div
      className={`flex-1 min-w-[120px] rounded-xl border p-3 text-center ${
        highlight
          ? "border-primary/25 bg-primary/[0.05]"
          : "border-white/[0.08] bg-white/[0.02]"
      }`}
    >
      <p className={`text-xs font-black ${highlight ? "text-primary" : "text-white/75"}`}>
        {label}
      </p>
      <p className="text-[10px] text-white/40 mt-0.5 leading-relaxed">{desc}</p>
    </div>
  );
}

interface ReadyRowProps {
  icon: React.ReactNode;
  label: string;
  ready: boolean;
  value?: string;
  hint: string;
}

function ReadyRow({ icon, label, ready, value, hint }: ReadyRowProps) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${
          ready ? "bg-green-500/15 text-green-400" : "bg-white/[0.04] text-white/25"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-bold ${ready ? "text-white/80" : "text-white/40"}`}>
          {label}
          {value ? `: ${value}` : ""}
        </p>
        {!ready && <p className="text-[10px] text-white/30">{hint}</p>}
      </div>
      <div
        className={`h-2 w-2 rounded-full shrink-0 ${ready ? "bg-green-400" : "bg-white/15"}`}
      />
    </div>
  );
}

export function LipSyncStudio({ audioUrl, transcriptText, activeArtist }: LipSyncStudioProps) {
  const songReady = !!audioUrl;
  const lyricsReady = !!transcriptText;
  const artistReady = !!activeArtist;

  return (
    <div className="space-y-4">
      {/* Concept glossary */}
      <div className="flex flex-wrap gap-2">
        <ConceptPill label="Scene Clips" desc="Silent visual scenes from Runway" />
        <ConceptPill label="Song Audio" desc="Your uploaded music track" />
        <ConceptPill label="Lip Sync" desc="Artist mouth synced to song" highlight />
        <ConceptPill label="Captions" desc="Lyric text overlaid on screen" />
      </div>

      {/* Explanation */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-2">
        <p className="text-xs font-black text-white/90">What is Lip Sync?</p>
        <p className="text-[11px] text-white/55 leading-relaxed">
          Normal Runway scene clips are{" "}
          <span className="text-white/75 font-semibold">silent visual clips</span> — the artist
          looks great but doesn't perform the song. Lip Sync is a separate step that uses your
          uploaded song audio to{" "}
          <span className="text-white/75 font-semibold">
            animate the artist's mouth in sync with the lyrics
          </span>
          , creating a performance clip where the artist appears to sing the song.
        </p>
      </div>

      {/* Readiness checklist */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
        <p className="text-[10px] font-black text-white/40 uppercase tracking-wide">
          Lip Sync Readiness
        </p>
        <div className="space-y-2.5">
          <ReadyRow
            icon={<ImageIcon className="h-3 w-3" />}
            label="Artist image"
            ready={artistReady}
            value={artistReady ? activeArtist!.artist_name : undefined}
            hint="Set an Active Artist with a reference photo"
          />
          <ReadyRow
            icon={<Music4 className="h-3 w-3" />}
            label="Song audio"
            ready={songReady}
            hint="Upload a song — it appears in Music Mixer"
          />
          <ReadyRow
            icon={<Captions className="h-3 w-3" />}
            label="Song lyrics"
            ready={lyricsReady}
            hint='Click "Get Lyrics From Song" in the Song Ready card above'
          />
        </div>
      </div>

      {/* Active artist card */}
      {activeArtist ? (
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
          {activeArtist.reference_image_url ? (
            <img
              src={activeArtist.reference_image_url}
              alt={activeArtist.artist_name}
              className="h-12 w-12 rounded-lg object-cover shrink-0 border border-white/10"
            />
          ) : (
            <div className="h-12 w-12 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <User className="h-5 w-5 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-black text-white/90 truncate">{activeArtist.artist_name}</p>
            {(activeArtist.artist_type || activeArtist.genre) && (
              <p className="text-[10px] text-white/40">
                {[activeArtist.artist_type, activeArtist.genre].filter(Boolean).join(" · ")}
              </p>
            )}
            <p className="text-[10px] text-green-400/80 mt-0.5">
              Will be used as the performing artist
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
          <div className="h-8 w-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
            <User className="h-4 w-4 text-white/25" />
          </div>
          <div>
            <p className="text-xs font-bold text-white/40">No active artist</p>
            <p className="text-[10px] text-white/25">
              Select an artist from the Artist Vault to enable lip sync
            </p>
          </div>
        </div>
      )}

      {/* Lip sync actions */}
      <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Mic2 className="h-4 w-4 text-primary" />
          <p className="text-sm font-black text-white/90">Create Lip Sync Clip</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            disabled
            data-testid="btn-lipsync-from-image"
            className="h-11 flex items-center justify-start gap-2 px-4 rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm font-bold text-white/30 cursor-not-allowed"
          >
            <Mic2 className="h-4 w-4 shrink-0" />
            Create Lip Sync From Artist Image
          </button>

          <button
            type="button"
            disabled
            data-testid="btn-lipsync-from-clip"
            className="h-11 flex items-center justify-start gap-2 px-4 rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm font-bold text-white/30 cursor-not-allowed"
          >
            <Mic2 className="h-4 w-4 shrink-0" />
            Lip Sync Selected Video Clip
          </button>
        </div>

        {/* Not connected notice */}
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5">
          <Info className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-xs font-black text-amber-300">Lip Sync not connected yet</p>
            <p className="text-[11px] text-amber-200/70 leading-relaxed">
              {songReady && lyricsReady
                ? "Your uploaded song and lyrics are ready. Connect a lip sync service (Hedra, Sync.so, D-ID, or HeyGen) to animate the artist's mouth to the song."
                : "Upload your song and extract lyrics first — then connect a lip sync service to animate the artist's performance."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
