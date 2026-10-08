import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Music2, Clapperboard, Gamepad2, Mic2, Film, Tv, Sparkles, GraduationCap,
  MoreHorizontal, AudioLines, Video, UploadCloud, X, Loader2, Rocket,
  BadgeCheck, Pencil, Trash2, ExternalLink, ImagePlus, Wand2, DollarSign,
  ChevronRight, AlertTriangle, CheckCircle2, User, Share2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  PUBLISH_VERTICALS,
  type PublishVertical,
} from "@/components/publish/PublishToProfileButton";
import { cn } from "@/lib/utils";

/* ─── Vertical config (all nine creator verticals) ───────────────────────── */
const VERTICAL_META: Record<PublishVertical, { label: string; icon: typeof Music2; hint: string }> = {
  music:      { label: "Music",      icon: Music2,        hint: "Tracks, singles, beats" },
  video:      { label: "Video",      icon: Clapperboard,  hint: "Shorts, vlogs, edits" },
  gaming:     { label: "Gaming",     icon: Gamepad2,      hint: "Gameplay, montages" },
  podcast:    { label: "Podcast",    icon: Mic2,          hint: "Episodes & shows" },
  film:       { label: "Film",       icon: Film,          hint: "Short films, features" },
  tv:         { label: "TV",         icon: Tv,            hint: "Series & episodes" },
  influencer: { label: "Influencer", icon: Sparkles,      hint: "Reels, lifestyle, hauls" },
  education:  { label: "Education",  icon: GraduationCap, hint: "Lessons, tutorials" },
  other:      { label: "Other",      icon: MoreHorizontal,hint: "Anything else" },
};

const AUDIO_VERTICALS: PublishVertical[] = ["music", "podcast", "education"];
const VIDEO_VERTICALS: PublishVertical[] = ["video", "gaming", "film", "tv", "influencer"];

const GENRES = ["Hip-Hop", "R&B", "Pop", "Afrobeats", "Trap", "Drill", "EDM", "House",
  "Rock", "Country", "Jazz", "Gospel", "Lo-Fi", "Ambient", "Latin", "K-Pop", "Other"];

const ACCEPT_AUDIO = "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/flac,audio/*";
const ACCEPT_VIDEO = "video/mp4,video/quicktime,video/webm,video/*";
const MAX_MEDIA_BYTES = 80 * 1024 * 1024;
const MAX_ART_BYTES = 10 * 1024 * 1024;

type ContentType = "audio" | "video";

interface ProfileRef { id: string; slug: string; display_name?: string }
interface DraftItem {
  id: string; kind: ContentType; title: string; is_published: boolean;
  media_url: string; artwork_url?: string | null; genre?: string | null;
  description?: string | null; tags?: string[] | null; isrc?: string | null;
  duration_sec?: number | null; download_price_cents?: number | null;
  season?: number | null; episode?: number | null; profile_id: string;
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

export default function Publish() {
  const [, navigate] = useLocation();
  const { getAccessToken, user } = useAuth();
  const { toast } = useToast();

  /* Form state */
  const [vertical, setVertical] = useState<PublishVertical>("music");
  const [contentType, setContentType] = useState<ContentType>("audio");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [genre, setGenre] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [isrc, setIsrc] = useState("");
  const [season, setSeason] = useState("");
  const [episode, setEpisode] = useState("");
  const [priceMode, setPriceMode] = useState<"free" | "paid">("free");
  const [priceDollars, setPriceDollars] = useState("");

  /* Media */
  const [file, setFile] = useState<File | null>(null);
  const [prefillUrl, setPrefillUrl] = useState<string | null>(null);
  const [prefillLabel, setPrefillLabel] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);

  /* Artwork / thumbnail */
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [artUploading, setArtUploading] = useState(false);
  const [artGenerating, setArtGenerating] = useState(false);

  /* Profile */
  const [profile, setProfile] = useState<ProfileRef | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profilesUnavailable, setProfilesUnavailable] = useState(false);
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [creatingProfile, setCreatingProfile] = useState(false);

  /* Drafts + editing */
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fromTool, setFromTool] = useState<{ path: string; label: string } | null>(null);
  const [publishedItem, setPublishedItem] = useState<{ slug: string; itemId: string; kind: ContentType; title: string } | null>(null);
  const [shareState, setShareState] = useState<"idle" | "shared" | "copied">("idle");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const artInputRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const meta = VERTICAL_META[vertical];
  const isFilmTv = contentType === "video" && (vertical === "film" || vertical === "tv");
  const showGenre = contentType === "audio";
  const showIsrc = contentType === "audio" && vertical === "music";
  const showPricing = contentType === "audio";

  /* ── Deep-link prefill: ?type=&category=&audioUrl=/videoUrl=&title=&…
     (mirrors the ?template=slug protocol). Consumed once, then cleared. ── */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("type");
      const cat = params.get("category") as PublishVertical | null;
      if (cat && (PUBLISH_VERTICALS as readonly string[]).includes(cat)) {
        setVertical(cat);
        setContentType(t === "video" ? "video" : AUDIO_VERTICALS.includes(cat) ? "audio" : VIDEO_VERTICALS.includes(cat) ? "video" : "audio");
      } else if (t === "video" || t === "audio") {
        setContentType(t);
      }
      const aUrl = params.get("audioUrl");
      const vUrl = params.get("videoUrl");
      if (aUrl || vUrl) {
        setPrefillUrl(aUrl ?? vUrl);
        setContentType(vUrl ? "video" : "audio");
        setPrefillLabel("Linked from your creation — ready to publish");
      }
      const pTitle = params.get("title");
      if (pTitle) setTitle(pTitle);
      const pArt = params.get("artwork") ?? params.get("thumbnail");
      if (pArt) setArtworkUrl(pArt);
      const pGenre = params.get("genre");
      if (pGenre) setGenre(pGenre);
      const pDesc = params.get("description");
      if (pDesc) setDescription(pDesc);
      const pIsrc = params.get("isrc");
      if (pIsrc) setIsrc(pIsrc);
      const pDur = params.get("durationSec");
      if (pDur && Number(pDur) > 0) setDurationSec(Math.round(Number(pDur)));
      const pSeason = params.get("season");
      if (pSeason) setSeason(pSeason);
      const pEpisode = params.get("episode");
      if (pEpisode) setEpisode(pEpisode);
      const pFrom = params.get("from");
      if (pFrom && pFrom.startsWith("/") && !pFrom.startsWith("//")) {
        setFromTool({ path: pFrom, label: params.get("fromLabel") || "creation tool" });
      }
      if ([...params.keys()].length) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch {
      /* malformed query — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Profile + drafts ── */
  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    return { Authorization: `Bearer ${token ?? ""}` };
  }

  async function loadProfile() {
    setProfileLoading(true);
    setProfilesUnavailable(false);
    try {
      const res = await fetch("/api/creator-profiles", { headers: await authHeaders() });
      if (!res.ok) throw new Error(`profiles ${res.status}`);
      const json = await res.json() as unknown;
      const list = Array.isArray(json) ? json
        : Array.isArray((json as { profiles?: unknown }).profiles) ? (json as { profiles: ProfileRef[] }).profiles
        : (json as ProfileRef)?.id ? [json as ProfileRef] : [];
      setProfile(list[0] ?? null);
      if (!list.length) {
        // Suggest a slug from the vault artist name — one-click, no dead ends.
        try {
          const vr = await fetch("/api/artist-vaults", { headers: await authHeaders() });
          if (vr.ok) {
            const vj = await vr.json() as { vaults?: { artist_name?: string }[] } | { artist_name?: string }[];
            const arr = Array.isArray(vj) ? vj : vj.vaults ?? [];
            const name = arr[0]?.artist_name;
            if (name) setNewSlug(slugify(name));
          }
        } catch { /* optional */ }
        if (!newSlug) setNewSlug(slugify(user?.email?.split("@")[0] ?? "creator"));
      }
    } catch {
      setProfilesUnavailable(true);
    } finally {
      setProfileLoading(false);
    }
  }

  async function loadDrafts() {
    setDraftsLoading(true);
    try {
      const headers = await authHeaders();
      const [tr, vr] = await Promise.all([
        fetch("/api/publish/tracks", { headers }),
        fetch("/api/publish/videos", { headers }),
      ]);
      const items: DraftItem[] = [];
      if (tr.ok) {
        const j = await tr.json() as { tracks?: Record<string, unknown>[] };
        for (const t of j.tracks ?? []) {
          items.push({
            id: String(t.id), kind: "audio", title: String(t.title ?? "Untitled"),
            is_published: t.is_published === true, media_url: String(t.audio_url ?? ""),
            artwork_url: (t.artwork_url as string) ?? null, genre: (t.genre as string) ?? null,
            tags: (t.tags as string[]) ?? null, isrc: (t.isrc as string) ?? null,
            duration_sec: (t.duration_sec as number) ?? null,
            download_price_cents: (t.download_price_cents as number) ?? null,
            profile_id: String(t.profile_id ?? ""),
          });
        }
      }
      if (vr.ok) {
        const j = await vr.json() as { videos?: Record<string, unknown>[] };
        for (const v of j.videos ?? []) {
          items.push({
            id: String(v.id), kind: "video", title: String(v.title ?? "Untitled"),
            is_published: v.is_published === true, media_url: String(v.video_url ?? ""),
            artwork_url: (v.thumbnail_url as string) ?? null,
            description: (v.description as string) ?? null,
            duration_sec: (v.duration_sec as number) ?? null,
            season: (v.season as number) ?? null, episode: (v.episode as number) ?? null,
            profile_id: String(v.profile_id ?? ""),
          });
        }
      }
      setDrafts(items);
    } catch {
      /* drafts are a bonus — form still works */
    } finally {
      setDraftsLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
    loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Media selection + validation ── */
  function validateMedia(f: File): string | null {
    const isAudio = f.type.startsWith("audio/");
    const isVideo = f.type.startsWith("video/");
    if (contentType === "audio" && !isAudio) return "Drop an audio file (MP3, WAV, M4A…) for audio content.";
    if (contentType === "video" && !isVideo) return "Drop a video file (MP4, MOV, WebM) for video content.";
    if (!isAudio && !isVideo) return "That file type isn't supported — use audio or video.";
    if (f.size > MAX_MEDIA_BYTES) return "That file is over the 80 MB upload limit.";
    return null;
  }

  function probeDuration(f: File) {
    try {
      const url = URL.createObjectURL(f);
      const el = document.createElement(contentType === "audio" ? "audio" : "video");
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        if (Number.isFinite(el.duration)) setDurationSec(Math.round(el.duration));
        URL.revokeObjectURL(url);
      };
      el.onerror = () => URL.revokeObjectURL(url);
      el.src = url;
    } catch { /* optional */ }
  }

  function handleFile(f: File | undefined | null) {
    if (!f) return;
    const err = validateMedia(f);
    if (err) {
      setUploadError(err);
      return;
    }
    setUploadError(null);
    setFile(f);
    setPrefillUrl(null);
    setPrefillLabel(null);
    probeDuration(f);
  }

  /* ── XHR upload with progress bar ── */
  function uploadWithProgress(f: File): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append("file", f);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        setUploadPct(null);
        try {
          const j = JSON.parse(xhr.responseText) as { url?: string; error?: string; message?: string };
          if (xhr.status >= 200 && xhr.status < 300 && j.url) resolve(j.url);
          else reject(new Error(j.message ?? j.error ?? `Upload failed (${xhr.status})`));
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => { setUploadPct(null); reject(new Error("Upload failed — check your connection.")); };
      const token = await getAccessToken();
      xhr.open("POST", "/api/publish/upload");
      xhr.setRequestHeader("Authorization", `Bearer ${token ?? ""}`);
      xhr.send(fd);
    });
  }

  async function uploadArtwork(f: File): Promise<void> {
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      toast({ title: "Artwork must be JPG, PNG, or WebP", variant: "destructive" });
      return;
    }
    if (f.size > MAX_ART_BYTES) {
      toast({ title: "Artwork must be 10 MB or smaller", variant: "destructive" });
      return;
    }
    setArtUploading(true);
    try {
      const url = await uploadWithProgress(f);
      setArtworkUrl(url);
    } catch (e) {
      toast({ title: "Artwork upload failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setArtUploading(false);
    }
  }

  /* ── AI artwork (paid per credit registry — publishing itself is free) ── */
  async function generateArtwork() {
    if (!title.trim()) {
      toast({ title: "Add a title first", description: "The AI needs a title to design around.", variant: "destructive" });
      return;
    }
    setArtGenerating(true);
    try {
      const res = await fetch("/api/cover-art", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({
          songTitle: title.trim(),
          artistName: profile?.display_name ?? user?.email?.split("@")[0] ?? "Creator",
          mood: `${vertical} ${contentType}`,
          style: "luxury-gold",
          aspectRatio: "1:1",
        }),
      });
      const j = await res.json() as { url?: string; error?: string; message?: string };
      if (!res.ok || !j.url) throw new Error(j.message ?? j.error ?? `Generation failed (${res.status})`);
      setArtworkUrl(j.url);
      toast({ title: "Artwork generated", description: "200 Visual Bucs — looking sharp." });
    } catch (e) {
      toast({ title: "Artwork generation failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setArtGenerating(false);
    }
  }

  /* ── Profile creation (one-click, no dead ends) ── */
  async function createProfile() {
    const slug = slugify(newSlug);
    if (!slug) {
      toast({ title: "Pick a profile URL", description: "e.g. my-stage-name", variant: "destructive" });
      return;
    }
    setCreatingProfile(true);
    try {
      const res = await fetch("/api/creator-profiles", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ slug, display_name: newSlug.replace(/-/g, " ") }),
      });
      const j = await res.json() as { id?: string; slug?: string; display_name?: string; error?: string; message?: string };
      if (!res.ok || !j.id) throw new Error(j.message ?? j.error ?? `Couldn't create profile (${res.status})`);
      setProfile({ id: j.id, slug: j.slug ?? slug, display_name: j.display_name });
      setShowCreateProfile(false);
      toast({ title: "Profile created", description: `You're live at /artist/${j.slug ?? slug}` });
    } catch (e) {
      toast({ title: "Couldn't create profile", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setCreatingProfile(false);
    }
  }

  /* ── Save draft / publish ── */
  async function handleSave(publish: boolean) {
    setFormError(null);
    if (profilesUnavailable) {
      setFormError("Creator profiles are still being set up — try again in a moment.");
      return;
    }
    if (!profile) {
      setShowCreateProfile(true);
      setFormError("Create your profile first — one click, then you're publishing.");
      topRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (!title.trim()) { setFormError("Give your content a title."); return; }
    const mediaUrl = prefillUrl;
    if (!mediaUrl && !file && !editingId) { setFormError("Drop your file first — or link one from any creation tool."); return; }

    setSaving(true);
    try {
      const headers = await authHeaders();
      let finalMediaUrl = mediaUrl ?? null;
      if (file && !editingId) {
        setUploadPct(0);
        finalMediaUrl = await uploadWithProgress(file);
      }
      // Editing a draft keeps its existing media unless a new file was dropped.
      const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
      const priceCents = priceMode === "paid" ? Math.round(Math.max(0, Number(priceDollars) || 0) * 100) : 0;

      const body: Record<string, unknown> =
        contentType === "audio"
          ? {
              profile_id: profile.id, title: title.trim(), audio_url: finalMediaUrl,
              artwork_url: artworkUrl, genre: genre || undefined, category: vertical,
              tags, isrc: isrc || undefined, duration_sec: durationSec,
              download_price_cents: priceCents, is_published: publish,
            }
          : {
              profile_id: profile.id, title: title.trim(), video_url: finalMediaUrl,
              thumbnail_url: artworkUrl, category: vertical, duration_sec: durationSec,
              description: description || undefined, is_published: publish,
              season: season ? Number(season) : undefined,
              episode: episode ? Number(episode) : undefined,
            };

      const isEdit = editingId !== null;
      const existing = isEdit ? drafts.find((d) => d.id === editingId) : undefined;
      const endpoint = contentType === "audio" ? "track" : "video";
      const url = isEdit ? `/api/publish/${endpoint}/${editingId}` : `/api/publish/${endpoint}`;
      if (isEdit && !finalMediaUrl && existing) {
        body[contentType === "audio" ? "audio_url" : "video_url"] = existing.media_url;
      }
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json() as {
        error?: string; message?: string;
        track?: { id?: string | number }; video?: { id?: string | number };
      };
      if (!res.ok) throw new Error(j.message ?? j.error ?? `Save failed (${res.status})`);

      if (publish) {
        const itemId = String(j.track?.id ?? j.video?.id ?? "");
        setPublishedItem({ slug: profile.slug, itemId, kind: contentType, title: title.trim() });
        setShareState("idle");
        toast({
          title: "You're live! 🚀",
          description: (
            <span>
              Your {contentType === "audio" ? "audio" : "video"} is on your profile and ready to sell.{" "}
              <button
                className="underline font-bold text-amber-300"
                onClick={() => navigate(`/artist/${profile.slug}`)}
              >
                View it now →
              </button>
            </span>
          ),
        });
      } else {
        toast({ title: "Draft saved", description: "Pick it up anytime from your list below." });
      }
      resetForm();
      loadDrafts();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
      setUploadPct(null);
    }
  }

  function resetForm() {
    setPublishedItem(null); setShareState("idle");
    setTitle(""); setDescription(""); setGenre(""); setTagsInput(""); setIsrc("");
    setSeason(""); setEpisode(""); setPriceMode("free"); setPriceDollars("");
    setFile(null); setPrefillUrl(null); setPrefillLabel(null);
    setArtworkUrl(null); setDurationSec(null); setEditingId(null); setUploadError(null);
  }

  function startEdit(d: DraftItem) {
    setEditingId(d.id);
    setContentType(d.kind);
    setTitle(d.title);
    setDescription(d.description ?? "");
    setGenre(d.genre ?? "");
    setTagsInput((d.tags ?? []).join(", "));
    setIsrc(d.isrc ?? "");
    setSeason(d.season ? String(d.season) : "");
    setEpisode(d.episode ? String(d.episode) : "");
    setPriceMode((d.download_price_cents ?? 0) > 0 ? "paid" : "free");
    setPriceDollars((d.download_price_cents ?? 0) > 0 ? String((d.download_price_cents ?? 0) / 100) : "");
    setArtworkUrl(d.artwork_url ?? null);
    setDurationSec(d.duration_sec ?? null);
    setFile(null);
    setPrefillUrl(d.media_url);
    setPrefillLabel(d.is_published ? "Currently live — editing keeps it live until you save" : "Draft — saved, not live yet");
    const tag0 = (d.tags ?? [])[0];
    if (tag0 && (PUBLISH_VERTICALS as readonly string[]).includes(tag0)) setVertical(tag0 as PublishVertical);
    setFormError(null);
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  async function handleDelete(d: DraftItem) {
    if (!window.confirm(`Delete "${d.title}"${d.is_published ? " — it's live on your profile" : ""}? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/publish/${d.kind === "audio" ? "track" : "video"}/${d.id}`, {
        method: "DELETE", headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      toast({ title: "Deleted" });
      loadDrafts();
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }

  const canSave = useMemo(
    () => title.trim().length > 0 && (file !== null || prefillUrl !== null || editingId !== null),
    [title, file, prefillUrl, editingId],
  );

  const mediaPreviewUrl = file ? undefined : prefillUrl ?? undefined;

  /* ── Share sheet: native share, clipboard fallback — never a dead "done" ── */
  async function sharePublished() {
    if (!publishedItem) return;
    const anchor = `#${publishedItem.kind === "audio" ? "track" : "video"}-${publishedItem.itemId}`;
    const url = `${window.location.origin}/artist/${publishedItem.slug}${anchor}`;
    const shareData = {
      title: `${publishedItem.title} — Bow Down Visuals`,
      text: `Check out "${publishedItem.title}" on my Bow Down Visuals profile`,
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setShareState("shared");
      } else {
        await navigator.clipboard.writeText(url);
        setShareState("copied");
        toast({ title: "Link copied", description: "Share it anywhere." });
      }
    } catch {
      /* user dismissed the share sheet — fine */
    }
  }

  function liveItemUrl(): string | null {
    if (!publishedItem || !publishedItem.itemId) return null;
    const anchor = `#${publishedItem.kind === "audio" ? "track" : "video"}-${publishedItem.itemId}`;
    return `/artist/${publishedItem.slug}${anchor}`;
  }

  /* ─── Render ─── */
  return (
    <div ref={topRef} className="min-h-screen bg-[#0a0a0c] text-white">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        {/* Header + the cheat-code chain */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/[0.07] px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-amber-300">
            <Rocket className="h-3.5 w-3.5" /> The unfair advantage
          </div>
          <h1 className="mt-4 text-3xl sm:text-4xl font-black bg-gradient-to-b from-amber-100 via-amber-300 to-amber-600 bg-clip-text text-transparent">
            Publish to Your Profile
          </h1>
          <p className="mt-2 text-sm text-white/55 max-w-md mx-auto">
            One click from creation → live on your profile → selling. It should feel illegal.
          </p>
          <div className="mt-5 flex items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-[11px] font-bold">
            {["Create", "Publish", "Live", "Selling"].map((s, i) => (
              <span key={s} className="flex items-center gap-1 sm:gap-2">
                <span className={cn(
                  "rounded-lg border px-2.5 py-1.5",
                  i < 2 ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-white/10 bg-white/[0.03] text-white/40",
                )}>{s}</span>
                {i < 3 && <ChevronRight className="h-3 w-3 text-amber-400/60" />}
              </span>
            ))}
          </div>
        </div>

        {/* Deep-link back to the creation tool we came from */}
        {fromTool && (
          <div className="mt-4 text-center">
            <button
              onClick={() => navigate(fromTool.path)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-white/45 hover:text-amber-300"
            >
              ← Back to {fromTool.label}
            </button>
          </div>
        )}

        {/* Profile status — one-click creation, no dead ends */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          {profileLoading ? (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your creator profile…
            </div>
          ) : profilesUnavailable ? (
            <div className="flex items-start gap-2 text-sm text-amber-200/80">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              Creator profiles are still being set up — your content will publish the moment they're ready.
            </div>
          ) : profile ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-600 text-black">
                  <User className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-bold truncate">
                    {profile.display_name ?? profile.slug}
                    <BadgeCheck className="h-4 w-4 text-amber-400 shrink-0" />
                  </div>
                  <div className="text-xs text-white/40 truncate">bowdownvisuals.com/artist/{profile.slug}</div>
                </div>
              </div>
              <button
                onClick={() => navigate(`/artist/${profile.slug}`)}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/70 hover:text-white hover:border-amber-400/40"
              >
                <ExternalLink className="h-3.5 w-3.5" /> View
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm font-bold">You don't have a creator profile yet.</p>
              <p className="mt-1 text-xs text-white/50">Create it now — 10 seconds, then everything you publish goes live on it.</p>
              {showCreateProfile || true ? (
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <div className="flex flex-1 items-center rounded-xl border border-white/10 bg-black/40 px-3">
                    <span className="text-xs text-white/35">bowdownvisuals.com/artist/</span>
                    <input
                      value={newSlug}
                      onChange={(e) => setNewSlug(slugify(e.target.value))}
                      placeholder="your-name"
                      className="w-full bg-transparent px-1 py-2.5 text-sm font-bold text-amber-200 outline-none placeholder:text-white/25"
                    />
                  </div>
                  <button
                    onClick={createProfile}
                    disabled={creatingProfile}
                    className="rounded-xl bg-gradient-to-b from-amber-300 to-amber-600 px-5 py-2.5 text-sm font-black text-black hover:brightness-110 disabled:opacity-50"
                  >
                    {creatingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create my profile"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Vertical picker — all nine */}
        <div className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-white/40">What kind of creator are you?</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {PUBLISH_VERTICALS.map((v) => {
              const m = VERTICAL_META[v];
              const active = vertical === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVertical(v)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 transition-all",
                    active
                      ? "border-amber-400/60 bg-amber-400/[0.1] text-amber-200 shadow-[0_0_24px_rgba(251,191,36,0.15)]"
                      : "border-white/10 bg-white/[0.02] text-white/55 hover:border-white/25 hover:text-white",
                  )}
                >
                  <m.icon className="h-5 w-5" />
                  <span className="text-xs font-bold">{m.label}</span>
                  <span className="hidden sm:block text-[10px] opacity-60">{m.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Audio / video toggle */}
        <div className="mt-6 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-1.5">
          {([
            { v: "audio" as ContentType, label: "Audio content", icon: AudioLines, hint: "Episodes, tracks, lessons" },
            { v: "video" as ContentType, label: "Video content", icon: Video, hint: "Films, clips, series" },
          ]).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => { setContentType(o.v); setFile(null); setPrefillUrl(null); setUploadError(null); }}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all",
                contentType === o.v
                  ? "bg-gradient-to-b from-amber-300 to-amber-500 text-black"
                  : "text-white/55 hover:text-white",
              )}
            >
              <o.icon className="h-4 w-4" />
              <span>{o.label}</span>
              <span className={cn("hidden sm:inline text-[10px] font-medium", contentType === o.v ? "text-black/60" : "text-white/35")}>{o.hint}</span>
            </button>
          ))}
        </div>

        {/* Drop zone / prefill */}
        <div className="mt-6">
          {prefillUrl ? (
            <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.05] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-emerald-200">{prefillLabel ?? "Content linked"}</p>
                    <p className="mt-0.5 truncate text-xs text-white/40">{prefillUrl}</p>
                    {durationSec ? <p className="mt-1 text-xs text-white/50">{Math.floor(durationSec / 60)}:{String(durationSec % 60).padStart(2, "0")} long</p> : null}
                  </div>
                </div>
                {!editingId && (
                  <button
                    onClick={() => { setPrefillUrl(null); setPrefillLabel(null); }}
                    className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:text-white"
                    title="Use a different file"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {contentType === "audio"
                ? <audio controls src={mediaPreviewUrl} className="mt-3 w-full" />
                : <video controls src={mediaPreviewUrl} className="mt-3 max-h-64 w-full rounded-xl bg-black" />}
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
              className={cn(
                "cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all",
                uploadError ? "border-red-500/50 bg-red-500/[0.03]" : "border-white/15 bg-white/[0.02] hover:border-amber-400/50 hover:bg-amber-400/[0.03]",
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={contentType === "audio" ? ACCEPT_AUDIO : ACCEPT_VIDEO}
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {uploadPct !== null ? (
                <div className="mx-auto max-w-xs">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-amber-400" />
                  <p className="mt-3 text-sm font-bold text-amber-200">Uploading… {uploadPct}%</p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-600 transition-all" style={{ width: `${uploadPct}%` }} />
                  </div>
                </div>
              ) : file ? (
                <div>
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
                  <p className="mt-3 text-sm font-bold truncate">{file.name}</p>
                  <p className="mt-1 text-xs text-white/40">
                    {(file.size / 1024 / 1024).toFixed(1)} MB{durationSec ? ` · ${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, "0")}` : ""}
                    {" "}— tap to replace
                  </p>
                </div>
              ) : (
                <div>
                  <UploadCloud className="mx-auto h-10 w-10 text-amber-400/70" />
                  <p className="mt-3 text-base font-black">
                    Drop your latest {contentType === "audio" ? "audio" : "video"}
                  </p>
                  <p className="mt-1 text-xs text-white/45">
                    {contentType === "audio" ? "MP3, WAV, M4A, OGG, FLAC" : "MP4, MOV, WebM"} · up to 80 MB · or tap to browse
                  </p>
                </div>
              )}
              {uploadError && (
                <p className="mt-3 flex items-center justify-center gap-1.5 text-xs font-bold text-red-300">
                  <AlertTriangle className="h-3.5 w-3.5" /> {uploadError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="mt-6 space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-white/40">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={vertical === "podcast" ? "Episode 12: …" : vertical === "film" ? "My short film" : "Untitled"}
              maxLength={160}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm font-bold outline-none placeholder:text-white/25 focus:border-amber-400/60"
            />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-white/40">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this about? Sell it."
              rows={3}
              maxLength={2000}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-amber-400/60"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {showGenre && (
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-white/40">Genre</label>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm font-bold outline-none focus:border-amber-400/60 [&>option]:bg-black"
                >
                  <option value="">Pick a genre…</option>
                  {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            )}
            <div className={showGenre ? "" : "sm:col-span-2"}>
              <label className="text-xs font-bold uppercase tracking-widest text-white/40">Tags <span className="text-white/25 normal-case">(comma separated)</span></label>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="viral, behind-the-scenes, 2026"
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-amber-400/60"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {showIsrc && (
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-white/40">ISRC <span className="text-white/25 normal-case">(optional)</span></label>
                <input
                  value={isrc}
                  onChange={(e) => setIsrc(e.target.value)}
                  placeholder="US-XXX-26-00001"
                  maxLength={32}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-amber-400/60"
                />
              </div>
            )}
            {isFilmTv && (
              <>
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-white/40">Season <span className="text-white/25 normal-case">(optional)</span></label>
                  <input
                    value={season}
                    onChange={(e) => setSeason(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="1" inputMode="numeric" maxLength={4}
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-amber-400/60"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-white/40">Episode <span className="text-white/25 normal-case">(optional)</span></label>
                  <input
                    value={episode}
                    onChange={(e) => setEpisode(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="3" inputMode="numeric" maxLength={4}
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none placeholder:text-white/25 focus:border-amber-400/60"
                  />
                </div>
              </>
            )}
          </div>

          {/* Artwork / thumbnail */}
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-white/40">
              {contentType === "audio" ? "Cover art" : "Thumbnail"}
            </label>
            <div className="mt-1.5 flex items-start gap-3">
              {artworkUrl ? (
                <div className="relative shrink-0">
                  <img src={artworkUrl} alt="artwork" className="h-24 w-24 rounded-xl object-cover border border-white/10" />
                  <button
                    onClick={() => setArtworkUrl(null)}
                    className="absolute -top-2 -right-2 rounded-full bg-black/80 border border-white/15 p-1 text-white/60 hover:text-white"
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => artInputRef.current?.click()}
                  className="flex h-24 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/15 text-white/40 hover:border-amber-400/50 hover:text-amber-300"
                >
                  {artUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                  <span className="text-[10px] font-bold">Upload</span>
                </button>
              )}
              <input
                ref={artInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadArtwork(f); e.target.value = ""; }}
              />
              <div className="flex-1">
                <button
                  onClick={generateArtwork}
                  disabled={artGenerating || artUploading}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-3.5 py-2.5 text-xs font-bold text-amber-300 hover:bg-amber-400/[0.14] disabled:opacity-50"
                >
                  {artGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  {artGenerating ? "Designing…" : "Generate AI artwork"}
                </button>
                <p className="mt-1.5 text-[11px] text-white/40">200 Visual Bucs · luxury gold style · uploading is free</p>
              </div>
            </div>
          </div>

          {/* Pricing — streams are always free; downloads can sell */}
          {showPricing && (
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-white/40">Downloads</label>
              <p className="mt-1 text-[11px] text-white/40">Streaming on your profile is always free. Charge for the download, or give it away.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {([
                  { v: "free" as const, label: "Free download" },
                  { v: "paid" as const, label: "Paid download" },
                ]).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setPriceMode(o.v)}
                    className={cn(
                      "rounded-xl border px-4 py-2.5 text-sm font-bold",
                      priceMode === o.v
                        ? "border-amber-400/60 bg-amber-400/10 text-amber-200"
                        : "border-white/10 text-white/50 hover:text-white",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {priceMode === "paid" && (
                <div className="mt-2 flex items-center rounded-xl border border-white/10 bg-black/40 px-3 focus-within:border-amber-400/60">
                  <DollarSign className="h-4 w-4 text-white/35" />
                  <input
                    value={priceDollars}
                    onChange={(e) => setPriceDollars(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="1.99" inputMode="decimal"
                    className="w-full bg-transparent px-1 py-3 text-sm font-bold outline-none placeholder:text-white/25"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Errors */}
        {formError && (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {formError}
          </div>
        )}

        {/* Save / publish */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            onClick={() => handleSave(false)}
            disabled={saving || !canSave}
            className="rounded-2xl border border-white/15 bg-white/[0.03] px-4 py-4 text-sm font-black hover:border-white/30 disabled:opacity-40"
          >
            {saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : editingId ? "Save changes" : "Save draft"}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving || !canSave}
            className="rounded-2xl bg-gradient-to-b from-amber-300 to-amber-600 px-4 py-4 text-sm font-black text-black hover:brightness-110 disabled:opacity-40 shadow-[0_0_32px_rgba(251,191,36,0.25)]"
          >
            {saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (
              <span className="inline-flex items-center gap-1.5"><Rocket className="h-4 w-4" /> {editingId ? "Publish now" : "Publish — go live"}</span>
            )}
          </button>
        </div>
        {editingId && (
          <button onClick={resetForm} className="mt-2 w-full text-xs font-bold text-white/40 hover:text-white">
            Cancel editing — start fresh
          </button>
        )}
        {/* Success state: profile + live item + share — never a dead "done" */}
        {publishedItem && (
          <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              <p className="text-sm font-black text-emerald-200">
                "{publishedItem.title}" is live — the chain is complete.
              </p>
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              {liveItemUrl() && (
                <button
                  onClick={() => navigate(liveItemUrl()!)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-amber-300 to-amber-600 px-3 py-2.5 text-xs font-black text-black hover:brightness-110"
                >
                  {publishedItem.kind === "audio" ? <AudioLines className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}
                  {publishedItem.kind === "audio" ? "Hear it live" : "Watch it live"}
                </button>
              )}
              <button
                onClick={() => navigate(`/artist/${publishedItem.slug}`)}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 px-3 py-2.5 text-xs font-bold text-white/80 hover:border-amber-400/50 hover:text-white"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Full profile
              </button>
              <button
                onClick={sharePublished}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 px-3 py-2.5 text-xs font-bold text-white/80 hover:border-amber-400/50 hover:text-white"
              >
                <Share2 className="h-3.5 w-3.5" />
                {shareState === "copied" ? "Link copied!" : shareState === "shared" ? "Shared!" : "Share it"}
              </button>
            </div>
          </div>
        )}

        {/* My content — drafts + published */}
        <div className="mt-10">
          <h2 className="text-xs font-bold uppercase tracking-widest text-white/40">My content</h2>
          {draftsLoading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : drafts.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-center text-sm text-white/40">
              Nothing here yet — drop your first file above and go live.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {drafts.map((d) => (
                <div key={`${d.kind}-${d.id}`} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  {d.artwork_url
                    ? <img src={d.artwork_url} alt="" className="h-12 w-12 rounded-xl object-cover border border-white/10 shrink-0" />
                    : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-white/30">
                        {d.kind === "audio" ? <AudioLines className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                      </div>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{d.title}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/40">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 font-bold",
                        d.is_published ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-white/50",
                      )}>
                        {d.is_published ? "Live" : "Draft"}
                      </span>
                      {d.kind === "audio" ? "Audio" : "Video"}
                      {(d.season || d.episode) ? ` · S${d.season ?? "?"} E${d.episode ?? "?"}` : ""}
                      {(d.download_price_cents ?? 0) > 0 ? ` · $${((d.download_price_cents ?? 0) / 100).toFixed(2)} download` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => startEdit(d)}
                    className="rounded-xl border border-white/10 p-2 text-white/50 hover:text-white hover:border-amber-400/40"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(d)}
                    className="rounded-xl border border-white/10 p-2 text-white/50 hover:text-red-400 hover:border-red-500/30"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="mt-8 text-center text-[11px] text-white/30">
          Uploading and publishing are free — it's your content. Only AI extras like generated artwork cost Visual Bucs.
        </p>
      </div>
    </div>
  );
}
