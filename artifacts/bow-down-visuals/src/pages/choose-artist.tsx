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
                    border: isSelected ? `1.5px solid ${G(0.5)}` : "1px solid rgba(255,255,255,0.07)",
                    background: isSelected ? "#0a0800" : "rgba(255,255,255,0.02)",
                    boxShadow: isSelected ? `0 0 50px ${G(0.15)}, 0 8px 32px rgba(0,0,0,0.6)` : "none",
                    padding: 0,
                    cursor: "pointer",
                    position: "relative",
                    overflow: "hidden",
                    transition: "all 0.2s ease",
                    display: "block",
                    width: "100%",
                  }}
                >
                  {/* Gold left bar when selected */}
                  {isSelected && (
                    <div style={{
                      position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                      background: `linear-gradient(to bottom, ${GOLD}, ${G(0)})`,
                      zIndex: 2,
                    }} />
                  )}

                  {/* Top image / avatar band */}
                  <div style={{
                    height: 140,
                    background: vault.reference_image_url
                      ? `url(${vault.reference_image_url}) top center/cover no-repeat`
                      : isSelected
                        ? "linear-gradient(135deg, #1a1200 0%, #0d0800 60%, #000 100%)"
                        : "linear-gradient(135deg, #111 0%, #0a0a0a 100%)",
                    position: "relative",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <div style={{
                      position: "absolute", inset: 0,
                      background: "linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.75) 100%)",
                    }} />
                    {isSelected && (
                      <div style={{
                        position: "absolute", top: "10%", left: "20%",
                        width: 140, height: 140, borderRadius: "50%",
                        background: `radial-gradient(circle, ${G(0.1)} 0%, transparent 70%)`,
                        pointerEvents: "none",
                      }} />
                    )}

                    {!vault.reference_image_url && (
                      <div style={{
                        position: "relative",
                        width: 64, height: 64, borderRadius: "50%",
                        background: isSelected ? `linear-gradient(135deg, ${G(0.25)}, ${G(0.06)})` : "rgba(255,255,255,0.06)",
                        border: isSelected ? `2px solid ${G(0.5)}` : "1px solid rgba(255,255,255,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: isSelected ? `0 0 24px ${G(0.35)}` : "none",
                      }}>
                        <span style={{
                          fontFamily: "Georgia, serif",
                          fontSize: 20, fontWeight: 900,
                          color: isSelected ? GOLD : "rgba(255,255,255,0.35)",
                          letterSpacing: "0.04em",
                        }}>{initials}</span>
                      </div>
                    )}

                    {/* Selected badge */}
                    {isSelected && (
                      <div style={{
                        position: "absolute", top: 10, right: 10,
                        display: "flex", alignItems: "center", gap: 4,
                        background: G(0.15), border: `1px solid ${G(0.4)}`,
                        borderRadius: 7, padding: "3px 8px",
                        backdropFilter: "blur(8px)",
                      }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: GOLD, boxShadow: `0 0 5px ${GOLD}` }} />
                        <span style={{ fontSize: 8.5, fontWeight: 900, color: GOLD, letterSpacing: "0.14em" }}>SELECTED</span>
                      </div>
                    )}

                    {/* Name overlaid */}
                    <div style={{ position: "absolute", bottom: 10, left: 14, right: 14 }}>
                      <p style={{
                        fontFamily: isSelected ? "Georgia, serif" : "inherit",
                        fontSize: isSelected ? 15 : 14,
                        fontWeight: 900, color: "#fff",
                        letterSpacing: isSelected ? "0.04em" : 0,
                        textShadow: "0 2px 8px rgba(0,0,0,0.9)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{vault.artist_name}</p>
                      {vault.artist_type && (
                        <p style={{ fontSize: 9.5, color: isSelected ? G(0.75) : "rgba(255,255,255,0.4)", marginTop: 1, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                          {vault.artist_type}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Body */}
                  <div style={{ padding: "12px 14px 14px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                      {[vault.genre, vault.visual_style].filter(Boolean).map((trait, i) => (
                        <span key={String(trait)} style={{
                          fontSize: 9.5, fontWeight: 700,
                          color: i === 0 && isSelected ? GOLD : "rgba(255,255,255,0.4)",
                          background: i === 0 && isSelected ? G(0.08) : "rgba(255,255,255,0.04)",
                          border: `1px solid ${i === 0 && isSelected ? G(0.22) : "rgba(255,255,255,0.07)"}`,
                          borderRadius: 5, padding: "2px 7px",
                        }}>{trait}</span>
                      ))}
                    </div>

                    <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                      {vault.genre && (
                        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>
                          <Music2 className="h-3 w-3" style={{ flexShrink: 0, opacity: 0.5 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vault.genre}</span>
                        </div>
                      )}
                      {vault.visual_style && (
                        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "rgba(255,255,255,0.35)" }}>
                          <Palette className="h-3 w-3" style={{ flexShrink: 0, opacity: 0.4 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vault.visual_style}</span>
                        </div>
                      )}
                    </div>
                  </div>
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
