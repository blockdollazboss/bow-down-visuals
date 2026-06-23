import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, Plus, ArrowRight, CheckCircle2, User, Palette, Music2, Sparkles } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

export default function ChooseArtist() {
  const { getAccessToken } = useAuth();
  const { activeArtist, setActiveArtist } = useActiveArtist();
  const [, setLocation] = useLocation();

  const [vaults, setVaults] = useState<ArtistVault[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(activeArtist?.id ?? null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/artist-vaults", {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { vaults: ArtistVault[] };
        if (!cancelled) setVaults(data.vaults ?? []);
      } catch {
        /* silently show empty state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getAccessToken]);

  function handleUseArtist() {
    const vault = vaults.find((v) => v.id === selectedId);
    if (!vault) return;
    setActiveArtist(vault);
    setLocation("/dashboard");
  }

  function handleContinueWithout() {
    setActiveArtist(null);
    setLocation("/dashboard");
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-white/[0.04] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-5 md:px-8 py-12 md:py-16">
        <div className="text-center mb-10">
          <div className="h-14 w-14 rounded-2xl bg-white/[0.07] border border-white/[0.18] flex items-center justify-center mx-auto mb-5">
            <User className="h-6 w-6 text-zinc-300" />
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">
            Who Are You Creating For?
          </h1>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Pick an artist profile — we'll automatically match your sound, look, and brand across everything you create. You can skip this and add one later.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-300/50" />
          </div>
        ) : vaults.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-10 text-center space-y-5 mb-6">
            <div className="h-12 w-12 rounded-xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-center mx-auto">
              <User className="h-6 w-6 text-white/20" />
            </div>
            <div>
              <p className="text-white/60 font-semibold mb-1">No artist profiles yet</p>
              <p className="text-sm text-white/35">Set up an artist profile to keep your music and visuals consistent. Takes about 2 minutes — or skip for now and add one later.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {vaults.map((vault) => {
              const isSelected = selectedId === vault.id;
              return (
                <button
                  key={vault.id}
                  type="button"
                  onClick={() => setSelectedId(isSelected ? null : vault.id)}
                  className={`group relative text-left rounded-2xl border p-5 transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? "border-white/40 bg-white/[0.05] shadow-[0_0_30px_rgba(200,200,210,0.15)]"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.03] hover:shadow-[0_0_20px_rgba(200,200,210,0.08)]"
                  }`}
                  data-testid={`artist-card-${vault.id}`}
                >
                  {isSelected && (
                    <span className="absolute top-3 right-3">
                      <CheckCircle2 className="h-5 w-5 text-zinc-300" />
                    </span>
                  )}

                  {/* Avatar */}
                  <div className={`h-16 w-16 rounded-full border-2 flex items-center justify-center mb-4 overflow-hidden ${
                    isSelected ? "border-white/30" : "border-white/10 group-hover:border-white/20"
                  }`}>
                    {vault.photo_url ? (
                      <img src={vault.photo_url} alt={vault.artist_name} className="h-full w-full object-cover" />
                    ) : (
                      <div className={`h-full w-full flex items-center justify-center text-2xl font-black ${
                        isSelected ? "bg-white/[0.12] text-zinc-200" : "bg-white/[0.04] text-white/30"
                      }`}>
                        {vault.artist_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <h3 className="font-black text-white text-lg leading-tight mb-1 truncate">
                    {vault.artist_name}
                  </h3>
                  {vault.artist_type && (
                    <p className="text-xs font-bold text-zinc-300/80 uppercase tracking-wider mb-3">{vault.artist_type}</p>
                  )}

                  <div className="space-y-1.5">
                    {vault.genre && (
                      <div className="flex items-center gap-2 text-xs text-white/45">
                        <Music2 className="h-3 w-3 shrink-0 text-white/25" />
                        <span className="truncate">{vault.genre}</span>
                      </div>
                    )}
                    {vault.visual_style && (
                      <div className="flex items-center gap-2 text-xs text-white/45">
                        <Palette className="h-3 w-3 shrink-0 text-white/25" />
                        <span className="truncate">{vault.visual_style}</span>
                      </div>
                    )}
                  </div>

                  {isSelected && (
                    <div className="mt-3 pt-3 border-t border-white/[0.12]">
                      <p className="text-xs font-bold text-zinc-300">Selected ✓</p>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-3">
          {/* Use Selected Artist */}
          <Button
            onClick={handleUseArtist}
            disabled={!selectedId}
            className="w-full h-14 text-base font-bold gap-3 rounded-2xl disabled:opacity-40"
            style={{ background: selectedId ? "linear-gradient(135deg, #9B7515, #DAA520)" : undefined }}
            data-testid="btn-use-artist"
          >
            <Sparkles className="h-5 w-5" />
            Start Creating with This Artist
            <ArrowRight className="h-5 w-5 ml-auto" />
          </Button>

          {/* Create New Artist */}
          <Link href="/artist-vault">
            <Button
              variant="outline"
              className="w-full h-12 font-bold gap-2 border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.06] hover:border-white/20 rounded-2xl"
              data-testid="btn-create-artist"
            >
              <Plus className="h-4 w-4" />
              Create Artist Profile
            </Button>
          </Link>

          {/* Continue Without Artist */}
          <button
            type="button"
            onClick={handleContinueWithout}
            className="w-full py-3 text-sm text-white/35 hover:text-white/60 transition-colors"
            data-testid="btn-continue-without"
          >
            Skip for now — I'll choose an artist later
          </button>
        </div>
      </div>
    </div>
  );
}
