import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, Plus, ArrowRight, CheckCircle2, User, Palette, Music2, Sparkles, Crown, Star, Aperture, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { fetchMyProfile } from "@/lib/artist-profiles";
import type { ArtistVault } from "@/components/ArtistVaultSelector";
import { getCharacterTheme, themeAlpha } from "@/lib/character-themes";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";

export default function ChooseArtist() {
  const { t } = useTranslation();
  usePageTitle(t("chooseArtist.pageTitle"), t("chooseArtist.pageDescription"));
  const { getAccessToken } = useAuth();
  const { activeArtist, setActiveArtist } = useActiveArtist();
  const [, setLocation] = useLocation();

  const [vaults, setVaults] = useState<ArtistVault[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(activeArtist?.id ?? null);

  /* ── Drag-and-drop spotlight slots ───────────────────────────────────
     Pointer-based so it works with mouse AND touch. A press becomes a drag
     after moving 10px; otherwise it's a tap (select). Dropping a card on a
     spotlight slot moves it there; the order persists to the account. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const dragRef = useRef<{ id: string; sx: number; sy: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);

  function onCardPointerDown(vaultId: string, e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = { id: vaultId, sx: e.clientX, sy: e.clientY, dragging: false };
  }

  function onCardPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    if (!d.dragging) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 10) return;
      d.dragging = true;
      suppressClick.current = true;
      setDragId(d.id);
    }
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-spot-slot]");
    setDropSlot(el ? Number((el as HTMLElement).dataset.spotSlot) : null);
  }

  function onCardPointerUp(e: React.PointerEvent) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d?.dragging) {
      setDragId(null);
      setDropSlot(null);
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-spot-slot]");
    const target = el ? Number((el as HTMLElement).dataset.spotSlot) : null;
    const draggedId = d.id;
    setDragId(null);
    setDropSlot(null);
    if (target != null && !Number.isNaN(target)) moveToSlot(draggedId, target);
    setTimeout(() => { suppressClick.current = false; }, 50);
  }

  function handleCardClick(vaultId: string) {
    if (suppressClick.current) return;
    setSelectedId((prev) => (prev === vaultId ? null : vaultId));
  }

  async function moveToSlot(draggedId: string, targetSlot: number) {
    const ordered = [...sortedVaults];
    const from = ordered.findIndex((v) => v.id === draggedId);
    if (from === -1 || from === targetSlot) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(Math.min(targetSlot, ordered.length), 0, moved);
    const reordered = ordered.map((v, i) => ({ ...v, spotlight_order: i }));
    const orderMap = new Map(reordered.map((v) => [v.id, v.spotlight_order as number]));
    setVaults((prev) =>
      prev.map((v) => (orderMap.has(v.id) ? { ...v, spotlight_order: orderMap.get(v.id)! } : v)),
    );
    try {
      const token = await getAccessToken();
      await fetch("/api/artist-vaults/spotlight-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ order: reordered.map((v) => v.id) }),
      });
    } catch {
      /* order still applies locally; syncs next load */
    }
  }

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

  async function handleContinueWithout() {
    setActiveArtist(null);
    /* Lightning onboarding: users with no public profile go straight to the
       60-second setup instead of landing on the dashboard with no next step. */
    try {
      const p = await fetchMyProfile();
      setLocation(p ? "/dashboard" : "/artist-setup");
    } catch {
      setLocation("/dashboard");
    }
  }

  /* Spotlight slots: user's drag-and-drop order wins (spotlight_order asc),
     then most recent. Top 3 featured, max 10 total. */
  const sortedVaults = [...vaults].sort((a, b) => {
    const ao = a.spotlight_order ?? 0;
    const bo = b.spotlight_order ?? 0;
    if (ao !== bo) return ao - bo;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const featuredVaults = sortedVaults.slice(0, 3);
  const remainingVaults = sortedVaults.slice(3, 10);
  const hiddenCount = sortedVaults.length - 10;

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">

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
            <span className="text-red-400 text-[11px] font-bold uppercase tracking-[0.25em]">{t("chooseArtist.onSet")}</span>
          </div>
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-[#C9A84C]/20 to-[#C9A84C]/5 border border-[#C9A84C]/40 flex items-center justify-center mx-auto mb-5 shadow-[0_0_30px_rgba(201,168,76,0.25)]">
            <Aperture className="h-7 w-7 text-[#C9A84C]" />
          </div>
          <p className="text-[#C9A84C] text-xs font-bold uppercase tracking-[0.3em] mb-3">
            {t("chooseArtist.eyebrow")}
          </p>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">
            {t("chooseArtist.title")}
          </h1>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            {t("chooseArtist.subtitle")}
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
              <p className="text-white/60 font-semibold mb-1">{t("chooseArtist.emptyTitle")}</p>
              <p className="text-sm text-white/35">{t("chooseArtist.emptyDescription")}</p>
            </div>
            <Link href="/artist-setup">
              <Button
                className="h-12 px-8 font-bold gap-2 rounded-2xl"
                style={{ background: "linear-gradient(135deg, #9B7515, #DAA520)" }}
                data-testid="btn-claim-page"
              >
                <Sparkles className="h-4 w-4" />
                Claim my public page — live in 60 seconds
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {/* Featured top 3 — studio spotlight */}
            <div className="flex items-center justify-center gap-2 mb-2">
              <Camera className="h-4 w-4 text-[#C9A84C]" />
              <p className="text-[#C9A84C] text-[11px] font-bold uppercase tracking-[0.25em]">
                {t("chooseArtist.inSpotlight")}
              </p>
              <Camera className="h-4 w-4 text-[#C9A84C]" />
            </div>
            <p className="text-center text-xs text-white/35 mb-4">
              {t("chooseArtist.dragHint")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {featuredVaults.map((vault, index) => {
              const isSelected = selectedId === vault.id;
              /* Each character shines in their own theme — identity at a glance. */
              const theme = getCharacterTheme(vault.theme_id);
              const T = (o: number) => themeAlpha(theme.primary, o);
              const THEME = theme.primary;
              const initials = vault.artist_name.split(" ").slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join("");
              return (
                <button
                  key={vault.id}
                  type="button"
                  onClick={() => handleCardClick(vault.id)}
                  onPointerDown={(e) => onCardPointerDown(vault.id, e)}
                  onPointerMove={onCardPointerMove}
                  onPointerUp={onCardPointerUp}
                  onPointerCancel={() => { dragRef.current = null; setDragId(null); setDropSlot(null); }}
                  data-testid={`artist-card-${vault.id}`}
                  data-spot-slot={index}
                  style={{
                    textAlign: "left",
                    borderRadius: 20,
                    border: isSelected ? `2px solid ${T(0.6)}` : dropSlot === index ? `2px dashed ${T(0.9)}` : "1px solid rgba(255,255,255,0.07)",
                    boxShadow: isSelected ? `0 0 40px ${T(0.2)}, 0 8px 32px rgba(0,0,0,0.6)` : dropSlot === index ? `0 0 24px ${T(0.35)}` : "none",
                    padding: 0,
                    cursor: dragId ? "grabbing" : "grab",
                    position: "relative",
                    overflow: "hidden",
                    transition: "all 0.2s ease",
                    display: "block",
                    width: "100%",
                    height: 240,
                    opacity: dragId === vault.id ? 0.45 : 1,
                    touchAction: "none",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    background: vault.reference_image_url
                      ? `url(${vault.reference_image_url}) top center/cover no-repeat`
                      : isSelected
                        ? `linear-gradient(135deg, ${T(0.22)} 0%, ${T(0.08)} 60%, #000 100%)`
                        : "linear-gradient(135deg, #111 0%, #0a0a0a 100%)",
                  }}
                >
                  {/* Theme color wash — the character's identity glows through */}
                  <div style={{
                    position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none",
                    background: `linear-gradient(135deg, ${T(0.14)} 0%, transparent 55%)`,
                  }} />
                  {/* Living portrait video — plays over the still photo when available.
                      Native loop + onEnded replay fallback: some mobile browsers
                      silently drop the loop after a few iterations. */}
                  {vault.reference_video_url && (
                    <video
                      src={vault.reference_video_url}
                      poster={vault.reference_image_url ?? undefined}
                      autoPlay
                      muted
                      loop
                      playsInline
                      ref={(v) => { if (v) v.muted = true; }}
                      onEnded={(e) => { const v = e.currentTarget; v.currentTime = 0; v.play().catch(() => {}); }}
                      style={{
                        position: "absolute", inset: 0, zIndex: 1,
                        width: "100%", height: "100%", objectFit: "cover",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  {/* Initials avatar (no photo) */}
                  {!vault.reference_image_url && (
                    <div style={{
                      position: "absolute", inset: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <div style={{
                        width: 72, height: 72, borderRadius: "50%",
                        background: isSelected ? `linear-gradient(135deg, ${T(0.25)}, ${T(0.06)})` : "rgba(255,255,255,0.06)",
                        border: isSelected ? `2px solid ${T(0.5)}` : "1px solid rgba(255,255,255,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: isSelected ? `0 0 28px ${T(0.35)}` : "none",
                      }}>
                        <span style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 900, color: isSelected ? THEME : "rgba(255,255,255,0.35)" }}>{initials}</span>
                      </div>
                    </div>
                  )}

                  {/* VIP rank badge */}
                  <div style={{
                    position: "absolute", top: 10, left: 10, zIndex: 3,
                    display: "flex", alignItems: "center", gap: 5,
                    background: `linear-gradient(135deg, ${T(0.25)}, ${T(0.08)})`,
                    border: `1px solid ${T(0.6)}`,
                    borderRadius: 8, padding: "4px 10px",
                    backdropFilter: "blur(8px)",
                    boxShadow: `0 0 15px ${T(0.3)}`,
                  }}>
                    <Crown className="h-3 w-3" style={{ color: THEME }} />
                    <span style={{ fontSize: 9, fontWeight: 900, color: THEME, letterSpacing: "0.12em" }}>
                      {t("chooseArtist.spotlightBadge", { n: index + 1 })}
                    </span>
                  </div>

                  {/* Viewfinder focus corners */}
                  {[
                    { top: 8, left: 8, borderTop: `2px solid ${T(0.8)}`, borderLeft: `2px solid ${T(0.8)}`, borderTopLeftRadius: 6 },
                    { top: 8, right: 8, borderTop: `2px solid ${T(0.8)}`, borderRight: `2px solid ${T(0.8)}`, borderTopRightRadius: 6 },
                    { bottom: 8, left: 8, borderBottom: `2px solid ${T(0.8)}`, borderLeft: `2px solid ${T(0.8)}`, borderBottomLeftRadius: 6 },
                    { bottom: 8, right: 8, borderBottom: `2px solid ${T(0.8)}`, borderRight: `2px solid ${T(0.8)}`, borderBottomRightRadius: 6 },
                  ].map((corner, ci) => (
                    <div key={ci} style={{ position: "absolute", width: 22, height: 22, zIndex: 2, pointerEvents: "none", ...corner }} />
                  ))}

                  {/* SELECTED badge */}
                  {isSelected && (
                    <div style={{
                      position: "absolute", top: 10, right: 10, zIndex: 3,
                      display: "flex", alignItems: "center", gap: 4,
                      background: "rgba(0,0,0,0.55)", border: `1px solid ${T(0.5)}`,
                      borderRadius: 7, padding: "3px 8px",
                      backdropFilter: "blur(8px)",
                    }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: THEME, boxShadow: `0 0 5px ${THEME}` }} />
                      <span style={{ fontSize: 8.5, fontWeight: 900, color: THEME, letterSpacing: "0.14em" }}>{t("chooseArtist.selected")}</span>
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
                      fontSize: 15, fontWeight: 900, color: THEME,
                      letterSpacing: "0.03em",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      textShadow: "0 1px 6px rgba(0,0,0,0.8)",
                    }}>{vault.artist_name}</p>
                    {vault.artist_type && (
                      <p style={{ fontSize: 9.5, color: isSelected ? T(0.85) : "rgba(255,255,255,0.55)", marginTop: 1, letterSpacing: "0.07em", textTransform: "uppercase" }}>
                        {vault.artist_type}
                      </p>
                    )}
                    {/* Theme name tag — who they are, in their colors */}
                    <p style={{ fontSize: 9, color: T(0.9), marginTop: 3, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700 }}>
                      {theme.name}
                    </p>
                  </div>

                  {/* Theme border glow on selected */}
                  {isSelected && (
                    <div style={{
                      position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                      background: `linear-gradient(to bottom, ${THEME}, ${T(0.3)})`,
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
                  {t("chooseArtist.moreArtists")}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
                  {remainingVaults.map((vault) => {
                    const isSelected = selectedId === vault.id;
                    const rTheme = getCharacterTheme(vault.theme_id);
                    const initials = vault.artist_name.split(" ").slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join("");
                    return (
                      <button
                        key={vault.id}
                        type="button"
                        onClick={() => handleCardClick(vault.id)}
                        onPointerDown={(e) => onCardPointerDown(vault.id, e)}
                        onPointerMove={onCardPointerMove}
                        onPointerUp={onCardPointerUp}
                        onPointerCancel={() => { dragRef.current = null; setDragId(null); setDropSlot(null); }}
                        className="rounded-xl border p-3 text-left transition"
                        style={{
                          ...(isSelected ? {
                            borderColor: themeAlpha(rTheme.primary, 0.6),
                            background: rTheme.cardTint,
                            boxShadow: `0 0 20px ${themeAlpha(rTheme.primary, 0.25)}`,
                          } : undefined),
                          opacity: dragId === vault.id ? 0.45 : 1,
                          cursor: dragId ? "grabbing" : "grab",
                          touchAction: "none",
                          userSelect: "none",
                          WebkitUserSelect: "none",
                        }}
                      >
                        <div className="flex items-center gap-2.5">
                          {vault.reference_video_url ? (
                            <video
                              src={vault.reference_video_url}
                              poster={vault.reference_image_url ?? undefined}
                              autoPlay
                              muted
                              loop
                              playsInline
                              ref={(v) => { if (v) v.muted = true; }}
                              onEnded={(e) => { const v = e.currentTarget; v.currentTime = 0; v.play().catch(() => {}); }}
                              className="h-10 w-10 rounded-full object-cover"
                              style={isSelected ? { border: `2px solid ${themeAlpha(rTheme.primary, 0.6)}` } : undefined}
                            />
                          ) : vault.reference_image_url ? (
                            <img src={vault.reference_image_url} alt="" className="h-10 w-10 rounded-full object-cover" style={isSelected ? { border: `2px solid ${themeAlpha(rTheme.primary, 0.6)}` } : undefined} />
                          ) : (
                            <div
                              className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
                              style={isSelected ? {
                                background: `linear-gradient(135deg, ${themeAlpha(rTheme.primary, 0.3)}, ${themeAlpha(rTheme.primary, 0.08)})`,
                                color: rTheme.primary,
                                border: `1px solid ${themeAlpha(rTheme.primary, 0.5)}`,
                              } : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}
                            >
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
                {t("chooseArtist.hiddenCount", { count: hiddenCount })}
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
            {t("chooseArtist.startCreating")}
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
              {t("chooseArtist.createProfile")}
            </Button>
          </Link>

          {/* Continue Without Artist */}
          <button
            type="button"
            onClick={handleContinueWithout}
            className="w-full py-3 text-sm text-white/35 hover:text-white/60 transition-colors"
            data-testid="btn-continue-without"
          >
            {t("chooseArtist.skipForNow")}
          </button>
        </div>
      </div>
    </div>
  );
}
