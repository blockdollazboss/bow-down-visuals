import { Link } from "wouter";
import { ShieldCheck, ChevronRight, RefreshCcw, Pencil, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

interface Props {
  artist: ArtistVault;
  onContinue: () => void;
}

export function ActiveArtistBanner({ artist, onContinue }: Props) {
  const hasImage = !!artist.reference_image_url;

  const highlights = [
    artist.genre          && `Genre: ${artist.genre}`,
    artist.visual_style   && `Style: ${artist.visual_style}`,
    artist.brand_colors   && `Colors: ${artist.brand_colors}`,
    artist.hair           && `Hair: ${artist.hair}`,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      {/* Active artist card */}
      <div className="rounded-2xl border border-primary/30 bg-primary/[0.05] p-5">

        {/* Badge */}
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-black text-primary uppercase tracking-widest">
            Active Artist
          </span>
        </div>

        {/* Artist identity row */}
        <div className="flex items-center gap-4 mb-4">
          {hasImage ? (
            <img
              src={artist.reference_image_url!}
              alt={artist.artist_name}
              className="h-16 w-16 rounded-xl object-cover border-2 border-primary/30 shrink-0"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="h-16 w-16 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <User className="h-7 w-7 text-primary/50" />
            </div>
          )}

          <div className="min-w-0">
            <p className="text-lg font-black text-white leading-tight">
              {artist.artist_name}
            </p>
            {artist.artist_type && (
              <p className="text-xs text-white/40 mt-0.5">{artist.artist_type}</p>
            )}
            {highlights.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {highlights.map((h) => (
                  <span
                    key={h}
                    className="text-[10px] font-semibold text-white/50 bg-white/[0.05] border border-white/[0.08] rounded-full px-2 py-0.5"
                  >
                    {h}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Consistency note */}
        {(artist.consistency_prompt || artist.reference_image_url) && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-primary/[0.07] border border-primary/15 mb-4">
            <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <p className="text-[11px] text-white/55 leading-relaxed">
              Artist Consistency Applied —
              {artist.reference_image_url
                ? " reference image + style rules will guide every AI prompt."
                : " style rules will guide every AI prompt."}
            </p>
          </div>
        )}

        {/* Personality/description preview */}
        {artist.personality && (
          <p className="text-xs text-white/40 leading-relaxed mb-4 line-clamp-2">
            {artist.personality}
          </p>
        )}

        {/* Primary action */}
        <Button
          onClick={onContinue}
          className="gold-glow font-bold gap-2 w-full text-base"
          style={{ height: "48px" }}
          data-testid="btn-continue-active-artist"
        >
          <ChevronRight className="h-5 w-5" />
          Continue With {artist.artist_name}
        </Button>
      </div>

      {/* Secondary actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/choose-artist">
          <button className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-white/20 hover:bg-white/[0.06] transition-all text-sm font-semibold">
            <RefreshCcw className="h-3.5 w-3.5 shrink-0" />
            Change Artist
          </button>
        </Link>
        <Link href="/artist-vault">
          <button className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-white/20 hover:bg-white/[0.06] transition-all text-sm font-semibold">
            <Pencil className="h-3.5 w-3.5 shrink-0" />
            Edit Artist Details
          </button>
        </Link>
      </div>
    </div>
  );
}
