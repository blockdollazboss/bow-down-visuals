import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Newspaper, Loader2, Sparkles, Plus, Trash2, Copy, Check, Download,
  RefreshCw, Globe, Mail, ExternalLink, ArrowLeft, Eye, EyeOff, Pencil,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { slugifyHandle } from "@/lib/press-kit";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Press Kit Builder ───────────────────────────────────────────────────
   Electronic press kits (EPKs): artists generate an AI-written bio and
   publish a shareable page at /press/:handle — bio, photos, top tracks,
   achievements, press quotes, booking contact.

   Pricing: 3 credits for AI bio + kit generation. Bio refresh 1 credit.
   All editing, viewing, sharing, and PDF download are free. */

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
  is_public: boolean;
}

const FALLBACK_GENERATE_COST = 3;
const FALLBACK_REFRESH_COST = 1;

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-[#d4af37]/60 focus:outline-none";

export default function PressKitBuilder() {
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
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

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshingBio, setRefreshingBio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tone, setTone] = useState("professional");

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
    setAchievements([""]); setQuotes([]); setTracks([]); setPhotoUrls([]);
    setError(null);
  }

  const cleanList = (l: string[]) => l.map((s) => s.trim()).filter(Boolean);

  async function handleGenerate() {
    setError(null);
    setOutOfCredits(false);
    if (!handle.trim() || !artistName.trim()) {
      setError("Give your press kit a URL handle and an artist name.");
      return;
    }
    setGenerating(true);
    try {
      const res = await confirmedFetch("/api/press-kit/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        overrideCost: FALLBACK_GENERATE_COST, // registry is stale at 1; backend + UI agree on 3
        overrideFeature: "Press Kit Generator",
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
      if (!res.ok) { setError(data.message || data.error || "Generation failed."); return; }
      const kit = data.kit as PressKit;
      setKits((k) => [kit, ...k]);
      loadKit(kit);
    } catch {
      setError("Network error — please try again.");
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
          achievements: cleanList(achievements),
          press_quotes: quotes.filter((q) => q.quote.trim() && q.source.trim()),
          photo_urls: cleanList(photoUrls),
          top_tracks: tracks.filter((t) => t.title.trim() && t.url.trim()),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || data.error || "Save failed."); return; }
      const kit = data.kit as PressKit;
      setKits((ks) => ks.map((k) => (k.id === kit.id ? kit : k)));
      setSelectedKit(kit);
      setEditing(false);
    } catch {
      setError("Network error — please try again.");
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
        overrideCost: FALLBACK_REFRESH_COST, // not in the credit registry; backend charges 1
        overrideFeature: "Press Kit Bio Refresh",
        body: JSON.stringify({ achievements: cleanList(achievements), tone }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = await res.json();
      if (res.status === 402) { setOutOfCredits(true); return; }
      if (!res.ok) { setError(data.message || data.error || "Bio refresh failed."); return; }
      const kit = data.kit as PressKit;
      setKits((ks) => ks.map((k) => (k.id === kit.id ? kit : k)));
      setSelectedKit(kit);
      setBio(kit.bio ?? "");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setRefreshingBio(false);
    }
  }

  async function handleDelete() {
    if (!selectedKit || !window.confirm("Delete this press kit? This can't be undone.")) return;
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

  const publicUrl = selectedKit ? `/press/${selectedKit.handle}` : null;
  const showForm = !selectedKit || editing;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="max-w-6xl mx-auto px-5 md:px-8 py-10">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <Newspaper className="h-8 w-8 text-[#d4af37]" />
          <h1 className="text-3xl md:text-4xl font-bold">Press Kit Builder</h1>
        </div>
        <p className="text-white/50 mb-8 max-w-2xl">
          Generate a professional electronic press kit — AI-written bio, photos, top tracks,
          achievements, press quotes, and booking contact — published at your own shareable URL.
        </p>

        {outOfCredits && <OutOfCredits />}
        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        )}

        <div className="grid lg:grid-cols-[280px_1fr] gap-8">
          {/* kit list */}
          <aside>
            <Button onClick={resetForm} variant="outline" className="w-full mb-4 border-[#d4af37]/40 text-[#d4af37] hover:bg-[#d4af37]/10">
              <Plus className="h-4 w-4 mr-2" /> New press kit
            </Button>
            <div className="space-y-2">
              {kits.map((k) => (
                <button
                  key={k.id}
                  onClick={() => loadKit(k)}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                    selectedKit?.id === k.id
                      ? "border-[#d4af37]/60 bg-[#d4af37]/10"
                      : "border-white/10 bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <div className="font-medium text-sm truncate">{k.artist_name}</div>
                  <div className="text-xs text-white/40 truncate">/press/{k.handle}</div>
                </button>
              ))}
              {kits.length === 0 && (
                <p className="text-sm text-white/30">No press kits yet — create your first.</p>
              )}
            </div>
          </aside>

          {/* main panel */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
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
                    <Button size="sm" variant="outline" onClick={copyLink} className="border-white/15">
                      {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={downloadPdf} className="border-white/15">
                      <Download className="h-4 w-4 mr-1" /> PDF
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="border-white/15">
                      <Pencil className="h-4 w-4 mr-1" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleDelete}
                            className="border-red-500/30 text-red-300 hover:bg-red-500/10">
                      <Trash2 className="h-4 w-4 mr-1" /> Delete
                    </Button>
                  </div>
                </div>

                {selectedKit.photo_urls[0] && (
                  <img src={selectedKit.photo_urls[0]} alt={selectedKit.artist_name}
                       className="w-full max-h-80 object-cover rounded-xl mb-6 border border-white/10" />
                )}

                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37]">Bio</h3>
                    <div className="flex items-center gap-2">
                      <select value={tone} onChange={(e) => setTone(e.target.value)}
                              className="rounded-lg border border-white/10 bg-black px-2 py-1 text-xs text-white/70">
                        <option value="professional">Professional</option>
                        <option value="bold">Bold</option>
                        <option value="playful">Playful</option>
                        <option value="luxury">Luxury</option>
                      </select>
                      <Button size="sm" variant="outline" onClick={handleRefreshBio} disabled={refreshingBio}
                              className="border-white/15 text-xs">
                        {refreshingBio ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                        Refresh bio · {FALLBACK_REFRESH_COST} credit
                      </Button>
                    </div>
                  </div>
                  <p className="text-white/80 text-sm leading-relaxed whitespace-pre-line">{selectedKit.bio}</p>
                </div>

                {selectedKit.achievements.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-2">Achievements</h3>
                    <ul className="list-disc list-inside text-sm text-white/70 space-y-1">
                      {selectedKit.achievements.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}

                {selectedKit.press_quotes.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-2">Press</h3>
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
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-2">Top tracks</h3>
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
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-2">Photos</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {selectedKit.photo_urls.slice(1).map((u, i) => (
                        <img key={i} src={u} alt="" className="aspect-square object-cover rounded-lg border border-white/10" />
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-sm text-white/50">
                  {selectedKit.is_public ? <Eye className="h-4 w-4 text-green-400" /> : <EyeOff className="h-4 w-4 text-white/30" />}
                  {selectedKit.is_public ? "Public — anyone with the link can view" : "Private — only you can view"}
                </div>
              </div>
            ) : (
              /* ── create / edit form ── */
              <div className="space-y-6">
                <h2 className="text-xl font-bold">{selectedKit ? "Edit press kit" : "Create your press kit"}</h2>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">Artist vault (bio source + photo)</label>
                    <select value={vaultId} onChange={(e) => setVaultId(e.target.value)} className={`${inputCls} bg-black`}>
                      <option value="">None — enter manually</option>
                      {vaults.map((v) => <option key={v.id} value={v.id}>{v.artist_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">URL handle *</label>
                    <div className="flex items-center gap-1">
                      <span className="text-white/30 text-sm">/press/</span>
                      <Input value={handle} onChange={(e) => setHandle(slugifyHandle(e.target.value))}
                             placeholder="shark-king" className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">Artist name *</label>
                    <Input value={artistName} onChange={(e) => setArtistName(e.target.value)}
                           placeholder="Thy Cheat Code" className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">Tagline</label>
                    <Input value={tagline} onChange={(e) => setTagline(e.target.value)}
                           placeholder="The King Shark of content" className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">Genre</label>
                    <Input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Hip-hop" className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">Location</label>
                    <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Atlanta, GA" className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">Booking email</label>
                    <Input value={bookingEmail} onChange={(e) => setBookingEmail(e.target.value)}
                           placeholder="book@example.com" className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">Website</label>
                    <Input value={website} onChange={(e) => setWebsite(e.target.value)}
                           placeholder="https://…" className={inputCls} />
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
                      <label className="text-xs font-medium text-white/60 mb-1 block">{label as string} URL</label>
                      <Input value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)}
                             placeholder="https://…" className={inputCls} />
                    </div>
                  ))}
                </div>

                <div>
                  <label className="text-xs font-medium text-white/60 mb-2 block">Achievements (one per line)</label>
                  {achievements.map((a, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <Input value={a} onChange={(e) => setAchievements((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                             placeholder="Headlined…" className={inputCls} />
                      <Button size="sm" variant="ghost" onClick={() => setAchievements((l) => l.filter((_, j) => j !== i))}
                              className="text-white/40 hover:text-red-300 shrink-0"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setAchievements((l) => [...l, ""])}
                          className="border-white/15 text-xs"><Plus className="h-3 w-3 mr-1" /> Add achievement</Button>
                </div>

                <div>
                  <label className="text-xs font-medium text-white/60 mb-2 block">Press quotes</label>
                  {quotes.map((q, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <Input value={q.quote} placeholder="Quote…"
                             onChange={(e) => setQuotes((l) => l.map((x, j) => (j === i ? { ...x, quote: e.target.value } : x)))}
                             className={inputCls} />
                      <Input value={q.source} placeholder="Source…"
                             onChange={(e) => setQuotes((l) => l.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)))}
                             className={`${inputCls} max-w-[160px]`} />
                      <Button size="sm" variant="ghost" onClick={() => setQuotes((l) => l.filter((_, j) => j !== i))}
                              className="text-white/40 hover:text-red-300 shrink-0"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setQuotes((l) => [...l, { quote: "", source: "" }])}
                          className="border-white/15 text-xs"><Plus className="h-3 w-3 mr-1" /> Add quote</Button>
                </div>

                <div>
                  <label className="text-xs font-medium text-white/60 mb-2 block">Top tracks (title + link)</label>
                  {tracks.map((t, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <Input value={t.title} placeholder="Track title…"
                             onChange={(e) => setTracks((l) => l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                             className={inputCls} />
                      <Input value={t.url} placeholder="https://…"
                             onChange={(e) => setTracks((l) => l.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                             className={inputCls} />
                      <Button size="sm" variant="ghost" onClick={() => setTracks((l) => l.filter((_, j) => j !== i))}
                              className="text-white/40 hover:text-red-300 shrink-0"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setTracks((l) => [...l, { title: "", url: "" }])}
                          className="border-white/15 text-xs"><Plus className="h-3 w-3 mr-1" /> Add track</Button>
                </div>

                <div>
                  <label className="text-xs font-medium text-white/60 mb-2 block">Photo URLs (one per line)</label>
                  <Textarea value={photoUrls.join("\n")} onChange={(e) => setPhotoUrls(e.target.value.split("\n"))}
                            placeholder="https://… (paste image URLs, or pick a vault above)" rows={3} className={inputCls} />
                  <p className="text-xs text-white/30 mt-1">Tip: pick an artist vault above to auto-fill its reference photo.</p>
                </div>

                {selectedKit && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-white/60 mb-1 block">Bio (free to edit)</label>
                      <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={6} className={inputCls} />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                      <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)}
                             className="accent-[#d4af37] h-4 w-4" />
                      Public — anyone with the link can view this press kit
                    </label>
                  </>
                )}

                <div className="flex flex-wrap gap-3 pt-2">
                  {selectedKit ? (
                    <>
                      <Button onClick={handleSave} disabled={saving}
                              className="bg-[#d4af37] text-black hover:bg-[#e5c158] font-semibold">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Save changes (free)
                      </Button>
                      <Button variant="outline" onClick={() => setEditing(false)} className="border-white/15">Cancel</Button>
                    </>
                  ) : (
                    <Button onClick={handleGenerate} disabled={generating}
                            className="bg-[#d4af37] text-black hover:bg-[#e5c158] font-semibold">
                      {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                      Generate press kit · {FALLBACK_GENERATE_COST} credits
                    </Button>
                  )}
                </div>
                {!selectedKit && (
                  <p className="text-xs text-white/30">
                    The 3 credits cover the AI-written bio. Everything else — editing, sharing, PDF download — is free.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
