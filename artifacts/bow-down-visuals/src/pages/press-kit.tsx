import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Newspaper, Loader2, Sparkles, Plus, Trash2, Copy, Check, Download,
  RefreshCw, Globe, Mail, ExternalLink, ArrowLeft, Eye, EyeOff, Pencil, Send,
  Fingerprint, ArrowUp, ArrowDown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  slugifyHandle,
  defaultPressKitLayout,
  resolvePressKitLayout,
  movePressKitLayoutEntry,
  setPressKitSectionVisible,
  type PressKitLayoutEntry,
  type PressKitSectionKey,
  PRESS_KIT_GENERATE_COST_VISUAL_BUCS,
  PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS,
} from "@/lib/press-kit";
import { fetchBrandKit, pressKitFieldsFromBrandKit } from "@/lib/brand-kit";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";
import { useHubProject } from "@/lib/hub-project";
import PressReleasePanel, { type PressReleaseKit } from "@/components/PressReleasePanel";
import MediaKitBuilder from "@/components/wave8/MediaKitBuilder";

/* ─── Press Kit Builder ───────────────────────────────────────────────────
   Electronic press kits (EPKs): artists generate an AI-written bio and
   publish a shareable page at /press/:handle — bio, photos, top tracks,
   achievements, press quotes, booking contact.

   Pricing: 300 Visual Bucs for AI bio + kit generation, 100 for a
   bio refresh — the PRESS_KIT_*_COST_VISUAL_BUCS constants in
   lib/press-kit.ts, read from the credit registry; the server
   charges exactly those. All editing, viewing, sharing, and PDF
   download are free. */

interface Vault {
  id: string;
  artist_name: string;
  reference_image_url?: string | null;
  genre?: string | null;
}

interface PressKit {
  id: string;
  handle: string;
  artist_name: string;
  tagline?: string | null;
  bio?: string | null;
  genre?: string | null;
  location?: string | null;
  booking_email?: string | null;
  website?: string | null;
  instagram_url?: string | null;
  tiktok_url?: string | null;
  youtube_url?: string | null;
  spotify_url?: string | null;
  achievements: string[];
  press_quotes: Array<{ quote: string; source: string }>;
  photo_urls: string[];
  top_tracks: Array<{ title: string; url: string }>;
  artist_vault_id?: string | null;
  layout?: PressKitLayoutEntry[] | null;
  is_public: boolean;
  press_releases?: Array<{ id: string; headline: string; body: string; announcementType: string; social: string; createdAt: string }>;
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-[#d4af37]/60 focus:outline-none";

export default function PressKitBuilder() {
  usePageTitle("Press Kit", "Build an electronic press kit with an AI-written bio, photos, top tracks, and booking contact — published as a shareable page.");
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { t } = useTranslation();
  const { addAsset } = useHubProject();
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [kits, setKits] = useState<PressKit[]>([]);
  const [selectedKit, setSelectedKit] = useState<PressKit | null>(null);
  const [editing, setEditing] = useState(false);

  /* form state */
  const [vaultId, setVaultId] = useState("");
  const [handle, setHandle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [tagline, setTagline] = useState("");
  const [genre, setGenre] = useState("");
  const [location, setLocation] = useState("");
  const [bookingEmail, setBookingEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [youtube, setYoutube] = useState("");
  const [spotify, setSpotify] = useState("");
  const [achievements, setAchievements] = useState<string[]>([""]);
  const [quotes, setQuotes] = useState<Array<{ quote: string; source: string }>>([]);
  const [tracks, setTracks] = useState<Array<{ title: string; url: string }>>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [bio, setBio] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [layout, setLayout] = useState<PressKitLayoutEntry[]>(() => defaultPressKitLayout());

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshingBio, setRefreshingBio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tone, setTone] = useState("professional");
  const [activeTab, setActiveTab] = useState<"kit" | "release">("kit");

  function handleReleaseKitUpdated(updated: PressReleaseKit) {
    setKits((ks) => ks.map((k) => (k.id === updated.id ? { ...k, press_releases: updated.press_releases } : k)));
    if (selectedKit?.id === updated.id) {
      setSelectedKit({ ...selectedKit, press_releases: updated.press_releases });
    }
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [vRes, kRes] = await Promise.all([
          fetch("/api/artist-vaults", { credentials: "include" }),
          fetch("/api/press-kit/mine", { credentials: "include" }),
        ]);
        if (vRes.ok) {
          const v = await vRes.json();
          setVaults(v.vaults ?? v ?? []);
        }
        if (kRes.ok) {
          const k = await kRes.json();
          setKits(k.kits ?? []);
        }
      } catch { /* non-fatal */ }
    })();
  }, [user]);

  useEffect(() => {
    if (vaultId && !artistName) {
      const v = vaults.find((x) => x.id === vaultId);
      if (v) {
        setArtistName(v.artist_name);
        if (v.genre) setGenre(v.genre);
        if (v.reference_image_url) setPhotoUrls([v.reference_image_url]);
        if (!handle) setHandle(slugifyHandle(v.artist_name));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultId]);

  function loadKit(k: PressKit) {
    setSelectedKit(k);
    setEditing(false);
    setVaultId(k.artist_vault_id ?? "");
    setHandle(k.handle);
    setArtistName(k.artist_name);
    setTagline(k.tagline ?? "");
    setGenre(k.genre ?? "");
    setLocation(k.location ?? "");
    setBookingEmail(k.booking_email ?? "");
    setWebsite(k.website ?? "");
    setInstagram(k.instagram_url ?? "");
    setTiktok(k.tiktok_url ?? "");
    setYoutube(k.youtube_url ?? "");
    setSpotify(k.spotify_url ?? "");
    setBio(k.bio ?? "");
    setIsPublic(k.is_public);
    setLayout(resolvePressKitLayout(k.layout));
    setAchievements(k.achievements.length ? k.achievements : [""]);
    setQuotes(k.press_quotes);
    setTracks(k.top_tracks);
    setPhotoUrls(k.photo_urls);
    setError(null);
  }

  function resetForm() {
    setSelectedKit(null);
    setEditing(false);
    setVaultId(""); setHandle(""); setArtistName(""); setTagline("");
    setGenre(""); setLocation(""); setBookingEmail(""); setWebsite("");
    setInstagram(""); setTiktok(""); setYoutube(""); setSpotify("");
    setBio(""); setIsPublic(true);
    setLayout(defaultPressKitLayout());
    setAchievements([""]); setQuotes([]); setTracks([]); setPhotoUrls([]);
    setError(null);
  }

  const cleanList = (l: string[]) => l.map((s) => s.trim()).filter(Boolean);

  /* Linkage (DE-5): fill the form's empty fields from the creator's
     brand kit — name, tagline, bio lines and press facts — instead of
     re-typing what the brand already knows. The kit's logo is NOT
     imported as a press photo: a logo is not a photo. */
  const [importingBrand, setImportingBrand] = useState(false);
  const [brandImportNote, setBrandImportNote] = useState<string | null>(null);
  async function importFromBrandKit() {
    setImportingBrand(true);
    setBrandImportNote(null);
    try {
      const kit = await fetchBrandKit(getAccessToken);
      if (!kit) {
        setBrandImportNote(t("press-kit.brandKit.none", { defaultValue: "No brand kit yet — generate one in Branding and it can fill this in for you." }));
        return;
      }
      const f = pressKitFieldsFromBrandKit(kit);
      let filled = 0;
      if (f.artistName && !artistName.trim()) { setArtistName(f.artistName); filled++; }
      if (f.tagline && !tagline.trim()) { setTagline(f.tagline); filled++; }
      if (f.bio && !bio.trim()) { setBio(f.bio); filled++; }
      if (f.achievements && achievements.every((a) => !a.trim())) { setAchievements(f.achievements); filled++; }
      setBrandImportNote(
        filled
          ? t("press-kit.brandKit.filled", { defaultValue: "Filled from your brand kit — only the empty fields; your words were left alone." })
          : t("press-kit.brandKit.nothingNew", { defaultValue: "Your brand kit is saved — everything it holds is already in this form." }),
      );
    } catch {
      setBrandImportNote(t("press-kit.brandKit.failed", { defaultValue: "Couldn't load your brand kit — try again." }));
    } finally {
      setImportingBrand(false);
    }
  }

  async function handleGenerate() {
    setError(null);
    setOutOfCredits(false);
    if (!handle.trim() || !artistName.trim()) {
      setError(t("press-kit.errors.missingHandleAndName"));
      return;
    }
    setGenerating(true);
    try {
      const res = await confirmedFetch("/api/press-kit/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        overrideCost: PRESS_KIT_GENERATE_COST_VISUAL_BUCS, // the registry price — the server charges exactly this
        overrideFeature: t("press-kit.confirmFeatureGenerate"),
        body: JSON.stringify({
          handle: slugifyHandle(handle),
          artist_name: artistName.trim(),
          tagline: tagline.trim(),
          genre: genre.trim(),
          location: location.trim(),
          booking_email: bookingEmail.trim(),
          website: website.trim(),
          instagram_url: instagram.trim(),
          tiktok_url: tiktok.trim(),
          youtube_url: youtube.trim(),
          spotify_url: spotify.trim(),
          achievements: cleanList(achievements),
          press_quotes: quotes.filter((q) => q.quote.trim() && q.source.trim()),
          photo_urls: cleanList(photoUrls),
          top_tracks: tracks.filter((t) => t.title.trim() && t.url.trim()),
          artist_vault_id: vaultId || undefined,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = await res.json();
      if (res.status === 402) { setOutOfCredits(true); return; }
      if (!res.ok) { setError(data.message || data.error || t("press-kit.errors.generationFailed")); return; }
      const kit = data.kit as PressKit;
      setKits((k) => [kit, ...k]);
      loadKit(kit);
    } catch {
      setError(t("press-kit.errors.network"));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!selectedKit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/press-kit/${selectedKit.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          handle: slugifyHandle(handle),
          artist_name: artistName.trim(),
          tagline: tagline.trim(),
          genre: genre.trim(),
          location: location.trim(),
          booking_email: bookingEmail.trim(),
          website: website.trim(),
          instagram_url: instagram.trim(),
          tiktok_url: tiktok.trim(),
          youtube_url: youtube.trim(),
          spotify_url: spotify.trim(),
          bio: bio.trim(),
          is_public: isPublic,
          layout,
          achievements: cleanList(achievements),
          press_quotes: quotes.filter((q) => q.quote.trim() && q.source.trim()),
          photo_urls: cleanList(photoUrls),
          top_tracks: tracks.filter((t) => t.title.trim() && t.url.trim()),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || data.error || t("press-kit.errors.saveFailed")); return; }
      const kit = data.kit as PressKit;
      setKits((ks) => ks.map((k) => (k.id === kit.id ? kit : k)));
      setSelectedKit(kit);
      setEditing(false);
    } catch {
      setError(t("press-kit.errors.network"));
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshBio() {
    if (!selectedKit) return;
    setRefreshingBio(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(`/api/press-kit/${selectedKit.id}/regenerate-bio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        overrideCost: PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS, // the registry price for the :id route — the server charges exactly this
        overrideFeature: t("press-kit.confirmFeatureRefresh"),
        body: JSON.stringify({ achievements: cleanList(achievements), tone }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = await res.json();
      if (res.status === 402) { setOutOfCredits(true); return; }
      if (!res.ok) { setError(data.message || data.error || t("press-kit.errors.bioRefreshFailed")); return; }
      const kit = data.kit as PressKit;
      setKits((ks) => ks.map((k) => (k.id === kit.id ? kit : k)));
      setSelectedKit(kit);
      setBio(kit.bio ?? "");
      /* The bio flows into the hub project — outreach and NFC cards pick it up. */
      if (kit.bio) {
        try { addAsset({ kind: "script", url: `data:text/plain;charset=utf-8,${encodeURIComponent(kit.bio)}`, label: `Bio — ${kit.artist_name || "press kit"}`, detail: "Press kit bio", meta: { text: kit.bio } }); } catch { /* non-fatal */ }
      }
    } catch {
      setError(t("press-kit.errors.network"));
    } finally {
      setRefreshingBio(false);
    }
  }

  async function handleDelete() {
    if (!selectedKit || !window.confirm(t("press-kit.confirmDelete"))) return;
    try {
      const res = await fetch(`/api/press-kit/${selectedKit.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) return;
      setKits((ks) => ks.filter((k) => k.id !== selectedKit.id));
      resetForm();
    } catch { /* non-fatal */ }
  }

  function copyLink() {
    if (!selectedKit) return;
    navigator.clipboard.writeText(`${window.location.origin}/press/${selectedKit.handle}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadPdf() {
    window.print();
  }

  const layoutSectionLabel: Record<PressKitSectionKey, string> = {
    bio: t("press-kit.sections.bio"),
    achievements: t("press-kit.sections.achievements"),
    press_quotes: t("press-kit.sections.press"),
    top_tracks: t("press-kit.sections.topTracks"),
    photos: t("press-kit.sections.photos"),
    contact: t("press-kit.sections.contact"),
  };

  const publicUrl = selectedKit ? `/press/${selectedKit.handle}` : null;
  const showForm = !selectedKit || editing;

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-6xl mx-auto px-5 md:px-8 py-10">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white mb-6">
          <ArrowLeft className="h-4 w-4" /> {t("press-kit.backToDashboard")}
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <Newspaper className="h-8 w-8 text-[#d4af37]" />
          <h1 className="text-3xl md:text-4xl font-bold">{t("press-kit.title")}</h1>
        </div>
        <p className="text-white/50 mb-6 max-w-2xl">
          {t("press-kit.description")}
        </p>

        {/* tabs */}
        <div className="flex gap-2 mb-8">
          {(["kit", "release"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-[#d4af37] text-black"
                  : isLight ? "border border-[#C9A84C]/40 text-[#6B5B36] hover:text-[#2A1E07] hover:border-[#C9A84C]/70" : "border border-white/15 text-white/60 hover:text-white hover:border-white/30"
              }`}
            >
              {t(`press-kit.tabs.${tab}`)}
            </button>
          ))}
        </div>

        {/* ── Wave 8: AI Media Kit Builder ── */}
        <section className="mb-8">
          <MediaKitBuilder />
        </section>

        {activeTab === "release" ? (
          <section className={`rounded-2xl border p-6 md:p-8 ${isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/60" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <PressReleasePanel kit={selectedKit} onKitUpdated={handleReleaseKitUpdated} />
          </section>
        ) : (
        <>
        {outOfCredits && <OutOfCredits />}
        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        )}

        <div className="grid lg:grid-cols-[280px_1fr] gap-8">
          {/* kit list */}
          <aside>
            <Button onClick={resetForm} variant="outline" className={`w-full mb-4 ${isLight ? "border-[#C9A84C]/70 text-[#7A5A12] hover:bg-[#C9A84C]/10" : "border-[#d4af37]/40 text-[#d4af37] hover:bg-[#d4af37]/10"}`}>
              <Plus className="h-4 w-4 mr-2" /> {t("press-kit.newPressKit")}
            </Button>
            <div className="space-y-2">
              {kits.map((k) => (
                <button
                  key={k.id}
                  onClick={() => loadKit(k)}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                    selectedKit?.id === k.id
                      ? "border-[#d4af37]/60 bg-[#d4af37]/10"
                      : isLight ? "border-[#C9A84C]/25 bg-white/50 hover:border-[#C9A84C]/50" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] hover:border-primary/40"
                  }`}
                >
                  <div className="font-medium text-sm truncate">{k.artist_name}</div>
                  <div className={`text-xs truncate ${isLight ? "text-[#8A7A56]" : "text-white/40"}`}>/press/{k.handle}</div>
                </button>
              ))}
              {kits.length === 0 && (
                <p className={`text-sm ${isLight ? "text-[#8A7A56]" : "text-white/30"}`}>{t("press-kit.emptyKits")}</p>
              )}
            </div>
          </aside>

          {/* main panel */}
          <section className={`rounded-2xl border p-6 md:p-8 ${isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/60" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            {selectedKit && !editing ? (
              /* ── preview / manage ── */
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                  <div>
                    <h2 className="text-2xl font-bold">{selectedKit.artist_name}</h2>
                    <a href={publicUrl!} target="_blank" rel="noreferrer"
                       className="text-sm text-[#d4af37] hover:underline inline-flex items-center gap-1">
                      {window.location.origin}/press/{selectedKit.handle} <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={copyLink} className={isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/15"}>
                      {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                      {copied ? t("press-kit.copied") : t("press-kit.copyLink")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={downloadPdf} className={isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/15"}>
                      <Download className="h-4 w-4 mr-1" /> {t("press-kit.pdf")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)} className={isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/15"}>
                      <Pencil className="h-4 w-4 mr-1" /> {t("press-kit.edit")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleDelete}
                            className="border-red-500/30 text-red-300 hover:bg-red-500/10">
                      <Trash2 className="h-4 w-4 mr-1" /> {t("press-kit.delete")}
                    </Button>
                  </div>
                </div>

                {selectedKit.photo_urls[0] && (
                  <img src={selectedKit.photo_urls[0]} onError={(e) => { e.currentTarget.style.display = "none"; }} alt={selectedKit.artist_name}
                       className="w-full max-h-80 object-cover rounded-xl mb-6 border border-white/10" />
                )}

                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37]">{t("press-kit.sections.bio")}</h3>
                    <div className="flex items-center gap-2">
                      <select value={tone} onChange={(e) => setTone(e.target.value)}
                              className="rounded-lg border border-white/10 bg-black px-2 py-1 text-xs text-white/70">
                        <option value="professional">{t("press-kit.tone.professional")}</option>
                        <option value="bold">{t("press-kit.tone.bold")}</option>
                        <option value="playful">{t("press-kit.tone.playful")}</option>
                        <option value="luxury">{t("press-kit.tone.luxury")}</option>
                      </select>
                      <Button size="sm" variant="outline" onClick={handleRefreshBio} disabled={refreshingBio}
                              className="border-white/15 text-xs">
                        {refreshingBio ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                        {t("press-kit.refreshBio", { count: PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS })}
                      </Button>
                    </div>
                  </div>
                  <p className="text-white/80 text-sm leading-relaxed whitespace-pre-line">{selectedKit.bio}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={`/brand-deals?tab=pitch&bio=${encodeURIComponent(selectedKit.bio || "")}`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary/20"
                    >
                      <Send className="h-4 w-4" />{t("press-kit.sendToOutreach", { defaultValue: "Use in outreach" })}
                    </Link>
                  </div>
                </div>

                {selectedKit.achievements.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-2">{t("press-kit.sections.achievements")}</h3>
                    <ul className="list-disc list-inside text-sm text-white/70 space-y-1">
                      {selectedKit.achievements.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}

                {selectedKit.press_quotes.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-2">{t("press-kit.sections.press")}</h3>
                    <div className="space-y-3">
                      {selectedKit.press_quotes.map((q, i) => (
                        <blockquote key={i} className="border-l-2 border-[#d4af37]/50 pl-4 text-sm">
                          <p className="text-white/80 italic">“{q.quote}”</p>
                          <cite className="text-white/40 not-italic">— {q.source}</cite>
                        </blockquote>
                      ))}
                    </div>
                  </div>
                )}

                {selectedKit.top_tracks.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-2">{t("press-kit.sections.topTracks")}</h3>
                    <div className="space-y-1">
                      {selectedKit.top_tracks.map((t, i) => (
                        <a key={i} href={t.url} target="_blank" rel="noreferrer"
                           className="flex items-center gap-2 text-sm text-white/70 hover:text-[#d4af37]">
                          <span className="text-white/30">{i + 1}.</span> {t.title}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {selectedKit.photo_urls.length > 1 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-2">{t("press-kit.sections.photos")}</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {selectedKit.photo_urls.slice(1).map((u, i) => (
                        <img key={i} src={u} onError={(e) => { e.currentTarget.style.display = "none"; }} alt="" className="aspect-square object-cover rounded-lg border border-white/10" />
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-sm text-white/50">
                  {selectedKit.is_public ? <Eye className="h-4 w-4 text-green-400" /> : <EyeOff className="h-4 w-4 text-white/30" />}
                  {selectedKit.is_public ? t("press-kit.publicNote") : t("press-kit.privateNote")}
                </div>
              </div>
            ) : (
              /* ── create / edit form ── */
              <div className="space-y-6">
                <h2 className="text-xl font-bold">{selectedKit ? t("press-kit.editTitle") : t("press-kit.createTitle")}</h2>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void importFromBrandKit()}
                    disabled={importingBrand}
                    className={isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 text-[#d4af37] hover:bg-[#d4af37]/10"}
                  >
                    {importingBrand ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Fingerprint className="h-4 w-4 mr-2" />}
                    {t("press-kit.brandKit.import", { defaultValue: "Import from my brand kit" })}
                  </Button>
                  {brandImportNote && <span className={`text-xs ${isLight ? "text-[#8A7A56]" : "text-white/40"}`}>{brandImportNote}</span>}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">{t("press-kit.form.vaultLabel")}</label>
                    <select value={vaultId} onChange={(e) => setVaultId(e.target.value)} className={`${inputCls} bg-black`}>
                      <option value="">{t("press-kit.form.noneOption")}</option>
                      {vaults.map((v) => <option key={v.id} value={v.id}>{v.artist_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">{t("press-kit.form.urlHandle")}</label>
                    <div className="flex items-center gap-1">
                      <span className="text-white/30 text-sm">/press/</span>
                      <Input value={handle} onChange={(e) => setHandle(slugifyHandle(e.target.value))}
                             placeholder={t("press-kit.placeholders.handle")} className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">{t("press-kit.form.artistName")}</label>
                    <Input value={artistName} onChange={(e) => setArtistName(e.target.value)}
                           placeholder={t("press-kit.placeholders.artistName")} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">{t("press-kit.form.tagline")}</label>
                    <Input value={tagline} onChange={(e) => setTagline(e.target.value)}
                           placeholder={t("press-kit.placeholders.tagline")} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">{t("press-kit.form.genre")}</label>
                    <Input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder={t("press-kit.placeholders.genre")} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">{t("press-kit.form.location")}</label>
                    <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("press-kit.placeholders.location")} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">{t("press-kit.form.bookingEmail")}</label>
                    <Input value={bookingEmail} onChange={(e) => setBookingEmail(e.target.value)}
                           placeholder={t("press-kit.placeholders.bookingEmail")} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">{t("press-kit.form.website")}</label>
                    <Input value={website} onChange={(e) => setWebsite(e.target.value)}
                           placeholder={t("press-kit.placeholders.url")} className={inputCls} />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  {[
                    ["Instagram", instagram, setInstagram],
                    ["TikTok", tiktok, setTiktok],
                    ["YouTube", youtube, setYoutube],
                    ["Spotify", spotify, setSpotify],
                  ].map(([label, val, set]) => (
                    <div key={label as string}>
                      <label className="text-xs font-medium text-white/60 mb-1 block">{t("press-kit.form.socialUrl", { platform: label as string })}</label>
                      <Input value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)}
                             placeholder={t("press-kit.placeholders.url")} className={inputCls} />
                    </div>
                  ))}
                </div>

                <div>
                  <label className="text-xs font-medium text-white/60 mb-2 block">{t("press-kit.form.achievementsLabel")}</label>
                  {achievements.map((a, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <Input value={a} onChange={(e) => setAchievements((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                             placeholder={t("press-kit.placeholders.achievement")} className={inputCls} />
                      <Button size="sm" variant="ghost" onClick={() => setAchievements((l) => l.filter((_, j) => j !== i))}
                              className="text-white/40 hover:text-red-300 shrink-0"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setAchievements((l) => [...l, ""])}
                          className="border-white/15 text-xs"><Plus className="h-3 w-3 mr-1" /> {t("press-kit.form.addAchievement")}</Button>
                </div>

                <div>
                  <label className="text-xs font-medium text-white/60 mb-2 block">{t("press-kit.form.quotesLabel")}</label>
                  {quotes.map((q, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <Input value={q.quote} placeholder={t("press-kit.placeholders.quote")}
                             onChange={(e) => setQuotes((l) => l.map((x, j) => (j === i ? { ...x, quote: e.target.value } : x)))}
                             className={inputCls} />
                      <Input value={q.source} placeholder={t("press-kit.placeholders.source")}
                             onChange={(e) => setQuotes((l) => l.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)))}
                             className={`${inputCls} max-w-[160px]`} />
                      <Button size="sm" variant="ghost" onClick={() => setQuotes((l) => l.filter((_, j) => j !== i))}
                              className="text-white/40 hover:text-red-300 shrink-0"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setQuotes((l) => [...l, { quote: "", source: "" }])}
                          className="border-white/15 text-xs"><Plus className="h-3 w-3 mr-1" /> {t("press-kit.form.addQuote")}</Button>
                </div>

                <div>
                  <label className="text-xs font-medium text-white/60 mb-2 block">{t("press-kit.form.tracksLabel")}</label>
                  {tracks.map((track, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <Input value={track.title} placeholder={t("press-kit.placeholders.trackTitle")}
                             onChange={(e) => setTracks((l) => l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                             className={inputCls} />
                      <Input value={track.url} placeholder={t("press-kit.placeholders.url")}
                             onChange={(e) => setTracks((l) => l.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                             className={inputCls} />
                      <Button size="sm" variant="ghost" onClick={() => setTracks((l) => l.filter((_, j) => j !== i))}
                              className="text-white/40 hover:text-red-300 shrink-0"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setTracks((l) => [...l, { title: "", url: "" }])}
                          className="border-white/15 text-xs"><Plus className="h-3 w-3 mr-1" /> {t("press-kit.form.addTrack")}</Button>
                </div>

                <div>
                  <label className="text-xs font-medium text-white/60 mb-2 block">{t("press-kit.form.photoUrlsLabel")}</label>
                  <Textarea value={photoUrls.join("\n")} onChange={(e) => setPhotoUrls(e.target.value.split("\n"))}
                            placeholder={t("press-kit.placeholders.photoUrls")} rows={3} className={inputCls} />
                  <p className="text-xs text-white/30 mt-1">{t("press-kit.form.photoTip")}</p>
                </div>

                {selectedKit && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-white/60 mb-1 block">{t("press-kit.form.bioLabel")}</label>
                      <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={6} className={inputCls} />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                      <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)}
                             className="accent-[#d4af37] h-4 w-4" />
                      {t("press-kit.form.publicCheckbox")}
                    </label>

                    {/* Page layout — section order + visibility on the
                        public page. The hero header (name, photo,
                        tagline) is not a section and always stays. */}
                    <div>
                      <label className="text-xs font-medium text-white/60 mb-1 block">{t("press-kit.layout.title")}</label>
                      <p className="text-xs text-white/30 mb-2">{t("press-kit.layout.hint")}</p>
                      <div className="space-y-2">
                        {layout.map((entry, i) => (
                          <div key={entry.key}
                               className={`flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 ${entry.visible ? "" : "opacity-60"}`}>
                            <span className="flex-1 text-sm">{layoutSectionLabel[entry.key]}</span>
                            {!entry.visible && (
                              <span className="text-[11px] uppercase tracking-wider text-white/30">{t("press-kit.layout.hiddenBadge")}</span>
                            )}
                            <Button size="sm" variant="ghost" disabled={i === 0}
                                    onClick={() => setLayout((l) => movePressKitLayoutEntry(l, entry.key, -1))}
                                    className="text-white/50 hover:text-white shrink-0 px-2"
                                    aria-label={t("press-kit.layout.moveUp")} title={t("press-kit.layout.moveUp")}>
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" disabled={i === layout.length - 1}
                                    onClick={() => setLayout((l) => movePressKitLayoutEntry(l, entry.key, 1))}
                                    className="text-white/50 hover:text-white shrink-0 px-2"
                                    aria-label={t("press-kit.layout.moveDown")} title={t("press-kit.layout.moveDown")}>
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost"
                                    onClick={() => setLayout((l) => setPressKitSectionVisible(l, entry.key, !entry.visible))}
                                    className="text-white/50 hover:text-white shrink-0 px-2"
                                    aria-label={entry.visible ? t("press-kit.layout.hide") : t("press-kit.layout.show")}
                                    title={entry.visible ? t("press-kit.layout.hide") : t("press-kit.layout.show")}>
                              {entry.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div className="flex flex-wrap gap-3 pt-2">
                  {selectedKit ? (
                    <>
                      <Button onClick={handleSave} disabled={saving}
                              className="bg-[#d4af37] text-black hover:bg-[#e5c158] font-semibold">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        {t("press-kit.form.saveChanges")}
                      </Button>
                      <Button variant="outline" onClick={() => setEditing(false)} className={isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/15"}>{t("press-kit.form.cancel")}</Button>
                    </>
                  ) : (
                    <Button onClick={handleGenerate} disabled={generating}
                            className="bg-[#d4af37] text-black hover:bg-[#e5c158] font-semibold">
                      {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                      {t("press-kit.generateKit", { count: PRESS_KIT_GENERATE_COST_VISUAL_BUCS })}
                    </Button>
                  )}
                </div>
                {!selectedKit && (
                  <p className="text-xs text-white/30">
                    {t("press-kit.costNote")}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
        </>
        )}
      </main>

    </div>
  );
}
