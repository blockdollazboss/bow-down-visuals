import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, Plus, ArrowRight, Sparkles, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

const GOLD = "#C9A84C";
const gold = (o: number) => `rgba(201,168,76,${o})`;

/** Gold rope divider — a velvet-rope flourish with a diamond clasp. */
function RopeDivider({ width = "w-28" }: { width?: string }) {
  return (
    <div className="flex items-center gap-3 justify-center" aria-hidden="true">
      <div className={`h-px ${width} bg-gradient-to-r from-transparent via-[rgba(201,168,76,0.15)] to-[rgba(201,168,76,0.7)]`} />
      <div className="h-[7px] w-[7px] rotate-45 border border-[rgba(201,168,76,0.9)] bg-gradient-to-br from-[#E8C96A] to-[#8A6B1F] shadow-[0_0_10px_rgba(201,168,76,0.8)]" />
      <div className={`h-px ${width} bg-gradient-to-l from-transparent via-[rgba(201,168,76,0.15)] to-[rgba(201,168,76,0.7)]`} />
    </div>
  );
}

/** Theater light cone — a soft gold beam falling onto a card. */
function SpotlightCone({ opacity = 0.5, className = "" }: { opacity?: number; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute -top-28 left-1/2 h-44 w-[130%] -translate-x-1/2 ${className}`}
      style={
        {
          "--bd-spotlight-opacity": opacity,
          clipPath: "polygon(34% 0, 66% 0, 100% 100%, 0 100%)",
          background: `linear-gradient(to bottom, ${gold(0.34)}, ${gold(0.1)} 55%, transparent 100%)`,
          filter: "blur(14px)",
        } as React.CSSProperties
      }
    />
  );
}

/** A few drifting gold-dust motes for the lobby air. */
function GoldDust() {
  const motes = [
    { left: "8%", top: "22%", size: 3, delay: "0s" },
    { left: "16%", top: "58%", size: 2, delay: "1.4s" },
    { left: "26%", top: "34%", size: 4, delay: "2.8s" },
    { left: "74%", top: "30%", size: 3, delay: "0.9s" },
    { left: "84%", top: "62%", size: 2, delay: "2.1s" },
    { left: "92%", top: "26%", size: 4, delay: "3.5s" },
    { left: "48%", top: "14%", size: 2, delay: "4.2s" },
    { left: "61%", top: "72%", size: 3, delay: "5s" },
  ];
  return (
    <div className="absolute inset-0" aria-hidden="true">
      {motes.map((m, i) => (
        <div
          key={i}
          className="animate-bd-dust absolute rounded-full"
          style={{
            left: m.left,
            top: m.top,
            width: m.size,
            height: m.size,
            background: GOLD,
            boxShadow: `0 0 ${m.size * 3}px ${gold(0.9)}`,
            animationDelay: m.delay,
          }}
        />
      ))}
    </div>
  );
}

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

  /* Top 3 featured (active artist first, then most recent), max 10 total. */
  const sortedVaults = [...vaults].sort((a, b) => {
    if (a.id === activeArtist?.id) return -1;
    if (b.id === activeArtist?.id) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const featuredVaults = sortedVaults.slice(0, 3);
  const remainingVaults = sortedVaults.slice(3, 10);
  const hiddenCount = sortedVaults.length - 10;

  const cardDelay = (i: number) => ({ animationDelay: `${0.45 + i * 0.14}s` } as React.CSSProperties);

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden relative">

      {/* ── Grand lobby backdrop ── */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
        {/* Embossed velvet walls */}
        <div className="bd-damask absolute inset-0 opacity-60" />
        {/* Chandelier glow */}
        <div className="animate-bd-curtain absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(201,168,76,0.14)_0%,rgba(201,168,76,0.04)_45%,transparent_70%)] blur-2xl" />
        {/* Twin theater light beams */}
        <div className="animate-bd-spotlight absolute top-0 left-[10%] h-[560px] w-[260px] origin-top -rotate-12 bg-gradient-to-b from-[rgba(201,168,76,0.09)] to-transparent blur-[50px]" />
        <div className="animate-bd-spotlight absolute top-0 right-[10%] h-[560px] w-[260px] origin-top rotate-12 bg-gradient-to-b from-[rgba(201,168,76,0.09)] to-transparent blur-[50px]" />
        {/* Polished floor reflection */}
        <div className="absolute bottom-0 left-0 right-0 h-[220px] bg-gradient-to-t from-[rgba(201,168,76,0.05)] to-transparent" />
        {/* Vignette */}
        <div className="absolute inset-0 shadow-[inset_0_0_220px_rgba(0,0,0,0.9)]" />
        <GoldDust />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-5 md:px-8 pt-14 md:pt-20 pb-20">
        {/* ── The marquee ── */}
        <div className="text-center mb-12 md:mb-16">
          <div className="animate-bd-entrance-fade mb-6 inline-flex items-center gap-2.5 rounded-full border border-[rgba(201,168,76,0.35)] bg-[rgba(201,168,76,0.06)] px-5 py-2 shadow-[0_0_24px_rgba(201,168,76,0.12)] backdrop-blur-sm">
            <Crown className="h-3.5 w-3.5 text-[#C9A84C]" />
            <span className="text-[#C9A84C] text-[10px] md:text-[11px] font-bold uppercase tracking-[0.35em]">
              The Grand Entrance
            </span>
          </div>

          <h1
            className="animate-bd-entrance font-display text-5xl md:text-7xl leading-[1.05] text-white mb-5"
            style={{ animationDelay: "0.15s", textShadow: "0 2px 30px rgba(0,0,0,0.8)" }}
          >
            Who's In Front
            <br />
            of the{" "}
            <span className="italic bg-gradient-to-b from-[#F5DE8E] via-[#C9A84C] to-[#8A6B1F] bg-clip-text text-transparent">
              Camera?
            </span>
          </h1>

          <div className="animate-bd-entrance mb-5" style={{ animationDelay: "0.3s" }}>
            <RopeDivider width="w-32 md:w-44" />
          </div>

          <p
            className="animate-bd-entrance text-white/55 text-base md:text-lg max-w-xl mx-auto leading-relaxed"
            style={{ animationDelay: "0.4s" }}
          >
            Choose your artist — under the lights, their look, sound, and brand
            follow them onto every stage you create.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-[#C9A84C]/60" />
          </div>
        ) : vaults.length === 0 ? (
          <div
            className="animate-bd-entrance mx-auto max-w-xl rounded-3xl border border-[rgba(201,168,76,0.25)] bg-gradient-to-b from-[rgba(201,168,76,0.05)] to-transparent p-10 md:p-14 text-center shadow-[0_0_60px_rgba(201,168,76,0.08)]"
            style={{ animationDelay: "0.5s" }}
          >
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-[rgba(201,168,76,0.25)] to-[rgba(201,168,76,0.05)] border border-[rgba(201,168,76,0.5)] flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(201,168,76,0.3)]">
              <Crown className="h-7 w-7 text-[#C9A84C]" />
            </div>
            <p className="font-display text-2xl md:text-3xl text-white mb-3">No Artists in the Troupe Yet</p>
            <p className="text-sm text-white/45 leading-relaxed mb-8">
              Every legend starts backstage. Set up an artist profile to keep your music and
              visuals unmistakably yours — about two minutes — or slip in quietly and add one later.
            </p>
            <Link href="/artist-vault">
              <Button
                className="h-12 px-8 font-bold gap-2 rounded-xl text-black"
                style={{ background: "linear-gradient(135deg, #E8C96A, #C9A84C 60%, #9B7515)" }}
                data-testid="btn-create-artist"
              >
                <Plus className="h-4 w-4" />
                Create Artist Profile
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {/* ── In the spotlight — featured top 3 ── */}
            <div className="animate-bd-entrance text-center mb-6" style={{ animationDelay: "0.5s" }}>
              <p className="text-[#C9A84C] text-[11px] font-bold uppercase tracking-[0.35em] mb-4">
                In the Spotlight
              </p>
              <RopeDivider width="w-20" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 md:gap-7 mb-14">
              {featuredVaults.map((vault, index) => {
                const isSelected = selectedId === vault.id;
                const initials = vault.artist_name.split(" ").slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join("");
                return (
                  <div key={vault.id} className="animate-bd-entrance relative pt-16" style={cardDelay(index)}>
                    {/* Light cone above the frame */}
                    <SpotlightCone opacity={isSelected ? 1 : 0.55} className="animate-bd-spotlight" />

                    <button
                      type="button"
                      onClick={() => setSelectedId(isSelected ? null : vault.id)}
                      data-testid={`artist-card-${vault.id}`}
                      style={{
                        textAlign: "left",
                        borderRadius: 18,
                        border: isSelected ? "1px solid rgba(201,168,76,0.85)" : "1px solid rgba(201,168,76,0.28)",
                        outline: isSelected ? "1px solid rgba(201,168,76,0.35)" : "none",
                        outlineOffset: 5,
                        boxShadow: isSelected
                          ? "0 0 60px rgba(201,168,76,0.35), 0 20px 50px rgba(0,0,0,0.7)"
                          : "0 0 24px rgba(201,168,76,0.08), 0 12px 36px rgba(0,0,0,0.6)",
                        padding: 0,
                        cursor: "pointer",
                        position: "relative",
                        overflow: "hidden",
                        transition: "all 0.3s cubic-bezier(0.22,1,0.36,1)",
                        display: "block",
                        width: "100%",
                        height: 300,
                        background: vault.reference_image_url
                          ? `url(${vault.reference_image_url}) top center/cover no-repeat`
                          : "linear-gradient(160deg, #161006 0%, #0b0803 55%, #000 100%)",
                      }}
                    >
                      {/* Initials monogram (no photo) */}
                      {!vault.reference_image_url && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <div style={{
                            width: 88, height: 88, borderRadius: "50%",
                            background: "radial-gradient(circle at 35% 30%, rgba(232,201,106,0.28), rgba(201,168,76,0.06))",
                            border: "1px solid rgba(201,168,76,0.55)",
                            boxShadow: "0 0 34px rgba(201,168,76,0.35), inset 0 0 18px rgba(0,0,0,0.6)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            <span className="font-display" style={{ fontSize: 28, fontWeight: 700, color: isSelected ? "#F5DE8E" : "rgba(201,168,76,0.75)" }}>{initials}</span>
                          </div>
                        </div>
                      )}

                      {/* Gilt corner flourishes */}
                      {[
                        { top: 10, left: 10, borderTop: "1.5px solid rgba(201,168,76,0.9)", borderLeft: "1.5px solid rgba(201,168,76,0.9)", borderTopLeftRadius: 4 },
                        { top: 10, right: 10, borderTop: "1.5px solid rgba(201,168,76,0.9)", borderRight: "1.5px solid rgba(201,168,76,0.9)", borderTopRightRadius: 4 },
                        { bottom: 10, left: 10, borderBottom: "1.5px solid rgba(201,168,76,0.9)", borderLeft: "1.5px solid rgba(201,168,76,0.9)", borderBottomLeftRadius: 4 },
                        { bottom: 10, right: 10, borderBottom: "1.5px solid rgba(201,168,76,0.9)", borderRight: "1.5px solid rgba(201,168,76,0.9)", borderBottomRightRadius: 4 },
                      ].map((corner, ci) => (
                        <div key={ci} style={{ position: "absolute", width: 26, height: 26, zIndex: 2, pointerEvents: "none", ...corner }} />
                      ))}

                      {/* Spotlight rank seal */}
                      <div style={{
                        position: "absolute", top: 12, left: 12, zIndex: 3,
                        display: "flex", alignItems: "center", gap: 6,
                        background: "linear-gradient(135deg, rgba(201,168,76,0.3), rgba(201,168,76,0.1))",
                        border: "1px solid rgba(201,168,76,0.65)",
                        borderRadius: 999, padding: "5px 12px",
                        backdropFilter: "blur(8px)",
                        boxShadow: "0 0 16px rgba(201,168,76,0.35)",
                      }}>
                        <Crown className="h-3 w-3" style={{ color: GOLD }} />
                        <span style={{ fontSize: 9, fontWeight: 900, color: GOLD, letterSpacing: "0.14em" }}>
                          #{index + 1} SPOTLIGHT
                        </span>
                      </div>

                      {/* SELECTED wax seal */}
                      {isSelected && (
                        <div style={{
                          position: "absolute", top: 12, right: 12, zIndex: 3,
                          display: "flex", alignItems: "center", gap: 6,
                          background: "linear-gradient(135deg, #E8C96A, #C9A84C 60%, #9B7515)",
                          borderRadius: 999, padding: "5px 12px",
                          boxShadow: "0 0 20px rgba(201,168,76,0.6), inset 0 1px 2px rgba(255,255,255,0.5)",
                        }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#1a1200" }} />
                          <span style={{ fontSize: 9, fontWeight: 900, color: "#1a1200", letterSpacing: "0.14em" }}>SELECTED</span>
                        </div>
                      )}

                      {/* Name plaque — engraved brass plate */}
                      <div style={{
                        position: "absolute", left: 0, right: 0, bottom: 0,
                        background: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.92) 100%)",
                        padding: "44px 16px 14px",
                      }}>
                        <div style={{
                          borderTop: "1px solid rgba(201,168,76,0.35)",
                          paddingTop: 10,
                        }}>
                          <p className="font-display" style={{
                            fontSize: 19, fontWeight: 700, color: "#fff",
                            letterSpacing: "0.02em",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            textShadow: "0 2px 8px rgba(0,0,0,0.9)",
                          }}>{vault.artist_name}</p>
                          {vault.artist_type && (
                            <p style={{ fontSize: 10, color: "rgba(201,168,76,0.85)", marginTop: 2, letterSpacing: "0.18em", textTransform: "uppercase" }}>
                              {vault.artist_type}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* ── The ensemble — remaining artists ── */}
            {remainingVaults.length > 0 && (
              <div className="animate-bd-entrance" style={{ animationDelay: "0.95s" }}>
                <div className="text-center mb-6">
                  <p className="text-[#C9A84C] text-[11px] font-bold uppercase tracking-[0.35em] mb-4">
                    The Ensemble
                  </p>
                  <RopeDivider width="w-20" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
                  {remainingVaults.map((vault) => {
                    const isSelected = selectedId === vault.id;
                    const initials = vault.artist_name.split(" ").slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join("");
                    return (
                      <button
                        key={vault.id}
                        type="button"
                        onClick={() => setSelectedId(isSelected ? null : vault.id)}
                        data-testid={`artist-card-${vault.id}`}
                        className={`rounded-xl border p-3.5 text-left transition-all duration-300 ${
                          isSelected
                            ? "border-[rgba(201,168,76,0.7)] bg-[rgba(201,168,76,0.08)] shadow-[0_0_28px_rgba(201,168,76,0.22)]"
                            : "border-[rgba(201,168,76,0.18)] bg-white/[0.02] hover:border-[rgba(201,168,76,0.45)] hover:bg-[rgba(201,168,76,0.04)]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {vault.reference_image_url ? (
                            <img
                              src={vault.reference_image_url}
                              alt=""
                              className={`h-11 w-11 rounded-full object-cover ${isSelected ? "ring-2 ring-[rgba(201,168,76,0.7)]" : "ring-1 ring-[rgba(201,168,76,0.3)]"}`}
                            />
                          ) : (
                            <div className="font-display flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_30%,rgba(232,201,106,0.25),rgba(201,168,76,0.05))] border border-[rgba(201,168,76,0.45)] text-base font-bold text-[#C9A84C]">
                              {initials}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-display truncate text-[15px] font-bold text-white">{vault.artist_name}</p>
                            {vault.genre && <p className="truncate text-xs text-white/40">{vault.genre}</p>}
                          </div>
                          {isSelected && (
                            <Crown className="h-4 w-4 text-[#C9A84C] ml-auto shrink-0" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {hiddenCount > 0 && (
              <p className="mb-8 text-center text-sm text-white/35">
                +{hiddenCount} more artist{hiddenCount === 1 ? "" : "s"} waiting in the wings — showing your top 10
              </p>
            )}
          </>
        )}

        {/* ── The doors — actions ── */}
        <div className="animate-bd-entrance max-w-xl mx-auto space-y-4 mt-4" style={{ animationDelay: vaults.length > 0 ? "1.1s" : "0.7s" }}>
          <RopeDivider width="w-24" />

          <Button
            onClick={handleUseArtist}
            disabled={!selectedId}
            className="w-full h-15 py-4 text-base font-bold gap-3 rounded-2xl disabled:opacity-40 disabled:saturate-50 border border-[rgba(201,168,76,0.5)]"
            style={selectedId ? {
              background: "linear-gradient(135deg, #F0D27A 0%, #C9A84C 45%, #9B7515 100%)",
              color: "#1a1200",
              boxShadow: "0 0 40px rgba(201,168,76,0.35), inset 0 1px 2px rgba(255,255,255,0.5)",
            } : undefined}
            data-testid="btn-use-artist"
          >
            <Sparkles className="h-5 w-5" />
            {selectedId ? "Take the Stage — Start Creating" : "Choose an Artist to Take the Stage"}
            <ArrowRight className="h-5 w-5 ml-auto" />
          </Button>

          <Link href="/artist-vault">
            <Button
              variant="outline"
              className="w-full h-12 font-bold gap-2 border-[rgba(201,168,76,0.3)] bg-[rgba(201,168,76,0.04)] text-[#E8C96A] hover:bg-[rgba(201,168,76,0.1)] hover:border-[rgba(201,168,76,0.55)] rounded-2xl transition-all"
              data-testid="btn-create-artist"
            >
              <Plus className="h-4 w-4" />
              Create Artist Profile
            </Button>
          </Link>

          <button
            type="button"
            onClick={handleContinueWithout}
            className="w-full py-3 text-sm text-white/35 hover:text-[#E8C96A] transition-colors tracking-wide"
            data-testid="btn-continue-without"
          >
            Enter quietly — I'll choose an artist later
          </button>
        </div>
      </div>
    </div>
  );
}
