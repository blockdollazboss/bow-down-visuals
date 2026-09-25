import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, Plus, ArrowRight, CheckCircle2, User, Palette, Music2, Sparkles, Crown, Star, Aperture, Camera } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import type { ArtistVault } from "@/components/ArtistVaultSelector";
import { usePageTitle } from "@/hooks/use-page-title";

export default function ChooseArtist() {
  usePageTitle("Choose Artist", "Pick the artist profile you're creating for.");
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

  /* Top 3 featured (active artist first, then most recent), max 10 total. */
  const sortedVaults = [...vaults].sort((a, b) => {
    if (a.id === activeArtist?.id) return -1;
    if (b.id === activeArtist?.id) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const featuredVaults = sortedVaults.slice(0, 3);
  const remainingVaults = sortedVaults.slice(3, 10);
  const hiddenCount = sortedVaults.length - 10;

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">
      <TopBar />

      {/* Photography studio lighting — overhead softbox beams */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 left-[15%] w-[300px] h-[500px] bg-gradient-to-b from-[#C9A84C]/[0.07] to-transparent blur-[60px] -rotate-12 origin-top" />
        <div className="absolute top-0 right-[15%] w-[300px] h-[500px] bg-gradient-to-b from-[#C9A84C]/[0.07] to-transparent blur-[60px] rotate-12 origin-top" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-white/[0.03] rounded-full blur-[100px]" />
        {/* Studio floor reflection */}
        <div className="absolute bottom-0 left-0 right-0 h-[200px] bg-gradient-to-t from-[#C9A84C]/[0.04] to-transparent" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-5 md:px-8 py-12 md:py-16">
        <div className="text-center mb-10">
          {/* ON SET indicator */}
          <div className="inline-flex items-center gap-2 mb-5 rounded-full border border-red-500/40 bg-red-500/10 px-4 py-1.5">
            <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-400 text-[11px] font-bold uppercase tracking-[0.25em]">On set</span>
          </div>
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-[#C9A84C]/20 to-[#C9A84C]/5 border border-[#C9A84C]/40 flex items-center justify-center mx-auto mb-5 shadow-[0_0_30px_rgba(201,168,76,0.25)]">
            <Aperture className="h-7 w-7 text-[#C9A84C]" />
          </div>
          <p className="text-[#C9A84C] text-xs font-bold uppercase tracking-[0.3em] mb-3">
            Bow Down Visuals Studio
          </p>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">
            Who's In Front of the Camera?
          </h1>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Pick your artist — lights, camera, and we'll match their look, sound, and brand across everything you create.
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
          <>
            {/* Featured top 3 — studio spotlight */}
            <div className="flex items-center justify-center gap-2 mb-4">
              <Camera className="h-4 w-4 text-[#C9A84C]" />
              <p className="text-[#C9A84C] text-[11px] font-bold uppercase tracking-[0.25em]">
                In the spotlight
              </p>
              <Camera className="h-4 w-4 text-[#C9A84C]" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {featuredVaults.map((vault, index) => {
              const isSelected = selectedId === vault.id;
              const G = (o: number) => `rgba(201,168,76,${o})`;
              const GOLD = "#C9A84C";
              const initials = vault.artist_name.split(" ").slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join("");
              return (
                <button
                  key={vault.id}
                  type="button"
                  onClick={() => setSelectedId(isSelected ? null : vault.id)}
                  data-testid={`artist-card-${vault.id}`}
                  style={{
                    textAlign: "left",
                    borderRadius: 20,
                    border: isSelected ? `2px solid ${G(0.6)}` : "1px solid rgba(255,255,255,0.07)",
                    boxShadow: isSelected ? `0 0 40px ${G(0.2)}, 0 8px 32px rgba(0,0,0,0.6)` : "none",
                    padding: 0,
                    cursor: "pointer",
                    position: "relative",
                    overflow: "hidden",
                    transition: "all 0.2s ease",
                    display: "block",
                    width: "100%",
                    height: 240,
                    background: vault.reference_image_url
                      ? `url(${vault.reference_image_url}) top center/cover no-repeat`
                      : isSelected
                        ? "linear-gradient(135deg, #1a1200 0%, #0d0800 60%, #000 100%)"
                        : "linear-gradient(135deg, #111 0%, #0a0a0a 100%)",
                  }}
                >
                  {/* Initials avatar (no photo) */}
                  {!vault.reference_image_url && (
                    <div style={{
                      position: "absolute", inset: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <div style={{
                        width: 72, height: 72, borderRadius: "50%",
                        background: isSelected ? `linear-gradient(135deg, ${G(0.25)}, ${G(0.06)})` : "rgba(255,255,255,0.06)",
                        border: isSelected ? `2px solid ${G(0.5)}` : "1px solid rgba(255,255,255,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: isSelected ? `0 0 28px ${G(0.35)}` : "none",
                      }}>
                        <span style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 900, color: isSelected ? GOLD : "rgba(255,255,255,0.35)" }}>{initials}</span>
                      </div>
                    </div>
                  )}

                  {/* VIP rank badge */}
                  <div style={{
                    position: "absolute", top: 10, left: 10, zIndex: 3,
                    display: "flex", alignItems: "center", gap: 5,
                    background: "linear-gradient(135deg, rgba(201,168,76,0.25), rgba(201,168,76,0.08))",
                    border: `1px solid ${G(0.6)}`,
                    borderRadius: 8, padding: "4px 10px",
                    backdropFilter: "blur(8px)",
                    boxShadow: `0 0 15px ${G(0.3)}`,
                  }}>
                    <Crown className="h-3 w-3" style={{ color: GOLD }} />
                    <span style={{ fontSize: 9, fontWeight: 900, color: GOLD, letterSpacing: "0.12em" }}>
                      #{index + 1} SPOTLIGHT
                    </span>
                  </div>

                  {/* Viewfinder focus corners */}
                  {[
                    { top: 8, left: 8, borderTop: `2px solid ${G(0.8)}`, borderLeft: `2px solid ${G(0.8)}`, borderTopLeftRadius: 6 },
                    { top: 8, right: 8, borderTop: `2px solid ${G(0.8)}`, borderRight: `2px solid ${G(0.8)}`, borderTopRightRadius: 6 },
                    { bottom: 8, left: 8, borderBottom: `2px solid ${G(0.8)}`, borderLeft: `2px solid ${G(0.8)}`, borderBottomLeftRadius: 6 },
                    { bottom: 8, right: 8, borderBottom: `2px solid ${G(0.8)}`, borderRight: `2px solid ${G(0.8)}`, borderBottomRightRadius: 6 },
                  ].map((corner, ci) => (
                    <div key={ci} style={{ position: "absolute", width: 22, height: 22, zIndex: 2, pointerEvents: "none", ...corner }} />
                  ))}

                  {/* SELECTED badge */}
                  {isSelected && (
                    <div style={{
                      position: "absolute", top: 10, right: 10, zIndex: 3,
                      display: "flex", alignItems: "center", gap: 4,
                      background: "rgba(0,0,0,0.55)", border: `1px solid ${G(0.5)}`,
                      borderRadius: 7, padding: "3px 8px",
                      backdropFilter: "blur(8px)",
                    }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: GOLD, boxShadow: `0 0 5px ${GOLD}` }} />
                      <span style={{ fontSize: 8.5, fontWeight: 900, color: GOLD, letterSpacing: "0.14em" }}>SELECTED</span>
                    </div>
                  )}

                  {/* Bottom name strip — only covers bottom 20% */}
                  <div style={{
                    position: "absolute", left: 0, right: 0, bottom: 0,
                    background: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.82) 100%)",
                    padding: "32px 14px 12px",
                  }}>
                    <p style={{
                      fontFamily: "Georgia, serif",
                      fontSize: 15, fontWeight: 900, color: "#fff",
                      letterSpacing: "0.03em",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      textShadow: "0 1px 6px rgba(0,0,0,0.8)",
                    }}>{vault.artist_name}</p>
                    {vault.artist_type && (
                      <p style={{ fontSize: 9.5, color: isSelected ? G(0.85) : "rgba(255,255,255,0.55)", marginTop: 1, letterSpacing: "0.07em", textTransform: "uppercase" }}>
                        {vault.artist_type}
                      </p>
                    )}
                  </div>

                  {/* Gold border glow on selected */}
                  {isSelected && (
                    <div style={{
                      position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                      background: `linear-gradient(to bottom, ${GOLD}, ${G(0.3)})`,
                      zIndex: 2,
                    }} />
                  )}
                </button>
              );
            })}
            </div>

            {/* Remaining artists (up to 7 more, max 10 total) */}
            {remainingVaults.length > 0 && (
              <>
                <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
                  More artists
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
                  {remainingVaults.map((vault) => {
                    const isSelected = selectedId === vault.id;
                    const initials = vault.artist_name.split(" ").slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join("");
                    return (
                      <button
                        key={vault.id}
                        type="button"
                        onClick={() => setSelectedId(isSelected ? null : vault.id)}
                        className={`rounded-xl border p-3 text-left transition ${
                          isSelected
                            ? "border-primary/60 bg-primary/[0.08]"
                            : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          {vault.reference_image_url ? (
                            <img src={vault.reference_image_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-sm font-bold text-white/50">
                              {initials}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{vault.artist_name}</p>
                            {vault.genre && <p className="truncate text-xs text-white/40">{vault.genre}</p>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {hiddenCount > 0 && (
              <p className="mb-6 text-center text-sm text-white/35">
                +{hiddenCount} more artist{hiddenCount === 1 ? "" : "s"} — showing your top 10
              </p>
            )}
          </>
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
