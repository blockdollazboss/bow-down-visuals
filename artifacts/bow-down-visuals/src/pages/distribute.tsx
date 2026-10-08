import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Disc3, Sparkles, Loader2, Plus, Trash2, Rocket, CheckCircle2,
  AlertTriangle, CalendarDays, Music2, Image as ImageIcon, Link2,
  ListMusic, ChevronRight, BadgeCheck, ArrowLeft, ArrowRight,
  Users, Copy, Check, FlaskConical, Clock, Hourglass, X, Tag, Hash, ShieldCheck,
  ExternalLink, Megaphone, Mail, Type, BarChart3, Vault, Share2,
  Circle, Layers, Album, ListChecks,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { ProjectFlowBar } from "@/components/hub/ProjectFlowBar";
import { CatalogVaultPanel } from "@/components/distribute/CatalogVaultPanel";
import { useHubProject } from "@/lib/hub-project";
import {
  DISTRIBUTION_PLATFORMS,
  DISTRIBUTION_AI_CREDIT_COST,
  DISTRIBUTION_PACKAGING_CREDITS,
  DISTRIBUTION_TIERS,
  tierCredits,
  tierLabel,
  platformLabel,
  platformStatusLabel,
  isTerminalPlatformStatus,
  splitsTotal,
  splitsValid,
  roleLabel,
  SPLIT_ROLES,
  type DistributionPlatformKey,
  type DistributionTier,
  type RoyaltySplit,
} from "@/lib/distribution";

/* ─── Thy Cheat Code's Music Distribution hub ───────────────────────────────
   DistroKid-style release dashboard at /distribute.
   - Browsing + release setup + royalty splits + pre-save links: free.
   - AI metadata + AI pre-release strategy: 1 credit each (GPT-6).
   - Cover art via the existing image pipeline: its own model cost
     (Pro 2cr / Sunburst 1cr).
   - Release submission: tier price — Single 10cr / EP 20cr / Album 30cr.
     This pays the aggregator delivery fee and queues the background
     delivery job; per-platform statuses then move
     queued → pending → delivered → live.
   HONESTY CONTRACT (v2): the UI never invents a status. Every platform
   pill renders exactly what GET /api/distribution/releases/:id/platforms
   returned. While the aggregator is in mock mode the hub says so plainly:
   "Sandbox simulation". */

const AI_CREDIT_COST = DISTRIBUTION_AI_CREDIT_COST;
/** Kept for any surface that still references the legacy flat packaging fee. */
const PACKAGING_CREDITS = DISTRIBUTION_PACKAGING_CREDITS;

/* ── API shapes ──────────────────────────────────────────────────────────── */
interface PlatformStatusEntry {
  platform: string;
  status: string;
  detail?: string;
  updatedAt?: string;
}
interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  hint?: string;
}
interface ReleaseTrack {
  title: string;
  isrc?: string;
}

/* ─── Release Metadata Manager (DistroKid parity) ───────────────────────────
   Full metadata form: UPC/EAN (with a "generate barcode" helper that mints a
   valid-format placeholder clearly labeled INTERNAL until a real UPC is
   assigned via a distribution partner), label name/imprint, ℗ and © lines
   (auto-suggested from label + year), primary genre + subgenre, explicit
   flag, original release date + preorder date, territory selection
   (worldwide vs include/exclude), and per-track ISRCs. FREE — metadata entry
   costs no Visual Bucs. Actual UPC registration and store delivery need a
   distribution partnership; custom release dates are honored in our
   presave/scheduler flows. */
interface ReleaseMeta {
  titleOptions?: string[];
  description?: string;
  genreTags?: string[];
}
interface ReleaseStrategy {
  timing?: string;
  promoPlan?: string[];
  checklist?: string[];
}
interface Release {
  id: string;
  title: string;
  artistName: string;
  releaseType: "single" | "ep" | "album";
  releaseDate: string | null;
  platforms: string[];
  platformStatuses: PlatformStatusEntry[];
  genre: string | null;
  explicit: boolean;
  isrc: string | null;
  upc: string | null;
  upcKind: "internal" | "official";
  label: string | null;
  labelImprint: string | null;
  copyrightCLine: string | null;
  copyrightPLine: string | null;
  subgenre: string | null;
  originalReleaseDate: string | null;
  preorderDate: string | null;
  territoriesMode: "worldwide" | "include" | "exclude";
  territories: string[];
  tracks: ReleaseTrack[];
  audioUrl: string | null;
  artworkUrl: string | null;
  status: "draft" | "packaged";
  aggregator: string | null;
  presaveSlug: string | null;
  splitShareSlug: string | null;
  royaltySplits: RoyaltySplit[] | null;
  checklist: ChecklistItem[];
  metadata: ReleaseMeta | null;
  strategy: ReleaseStrategy | null;
  creditsCharged: number;
  createdAt: string;
}
interface SongRow {
  id: string;
  title: string;
  audio_url: string;
  duration_sec?: string | null;
  source?: string | null;
}
interface PricingTier {
  type: string;
  credits: number;
  label: string;
  blurb: string;
}
interface PricingInfo {
  tiers: PricingTier[];
  annualPlan: { label: string; creditsPerYear: number; note: string; comingSoon: boolean } | null;
  aiMetadataCost: number;
  aiStrategyCost: number;
  aggregator: string;
}
interface MetadataResult {
  titleOptions?: string[];
  description?: string;
  genreTags?: string[];
  creditsUsed?: number;
  error?: string;
  message?: string;
}
interface StrategyResult {
  timing?: string;
  promoPlan?: string[];
  checklist?: string[];
  creditsUsed?: number;
  error?: string;
  message?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";
const labelClass = "mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40";
const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-white/80 transition hover:border-primary/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

/* ── small building blocks ─────────────────────────────────────────────── */

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    queued: "border-white/20 bg-white/[0.04] text-white/50",
    pending: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    delivered: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    live: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    failed: "border-red-500/40 bg-red-500/10 text-red-300",
  };
  const Icon =
    status === "live" ? CheckCircle2
    : status === "failed" ? AlertTriangle
    : status === "pending" ? Hourglass
    : status === "delivered" ? BadgeCheck
    : Clock;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${(styles[status] ?? "border-white/20 text-white/50")}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {platformStatusLabel(status)}
    </span>
  );
}

function SandboxBadge({ aggregator }: { aggregator: string | null }) {
  const { t } = useTranslation();
  if (aggregator !== "mock") return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-violet-300">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />{t("distribute.sandbox_simulation")}</span>
  );
}

function Section({ title, icon, children, action, minStars }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode; minStars?: number;
}) {
  return (
    <section data-min-stars={minStars} className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-xl font-black">{icon}{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ── New release wizard ────────────────────────────────────────────────────
   5 steps: Music → Metadata → Cover art → Platforms → Review & pay.
   Creates the (free) draft, then immediately submits it (tier-priced). */

const WIZARD_STEPS = ["Music", "Metadata", "Cover art", "Platforms", "Review & pay"] as const;

/* DistroKid-style primary genres for the Release Metadata Manager. */
const PRIMARY_GENRES = [
  "Hip-Hop/Rap", "Trap", "Drill", "R&B/Soul", "Pop", "Afrobeats", "Amapiano",
  "Dancehall/Reggae", "Latin", "K-Pop", "Rock", "Alternative", "Indie",
  "Electronic/Dance", "House", "Techno", "Drum & Bass", "Phonk", "Jersey Club",
  "Hyperpop", "Lo-Fi", "Ambient", "Country", "Folk/Acoustic", "Jazz", "Blues",
  "Classical", "Gospel/Christian", "Metal", "Punk",
];

/* Curated territory list (ISO 3166-1 alpha-2) for include/exclude selection. */
const TERRITORIES: { code: string; name: string }[] = [
  { code: "US", name: "United States" }, { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" }, { code: "IE", name: "Ireland" },
  { code: "AU", name: "Australia" }, { code: "NZ", name: "New Zealand" },
  { code: "DE", name: "Germany" }, { code: "FR", name: "France" },
  { code: "ES", name: "Spain" }, { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" }, { code: "BE", name: "Belgium" },
  { code: "CH", name: "Switzerland" }, { code: "AT", name: "Austria" },
  { code: "SE", name: "Sweden" }, { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" }, { code: "FI", name: "Finland" },
  { code: "PT", name: "Portugal" }, { code: "GR", name: "Greece" },
  { code: "PL", name: "Poland" }, { code: "CZ", name: "Czechia" },
  { code: "HU", name: "Hungary" }, { code: "RO", name: "Romania" },
  { code: "UA", name: "Ukraine" }, { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" }, { code: "AR", name: "Argentina" },
  { code: "CO", name: "Colombia" }, { code: "CL", name: "Chile" },
  { code: "PE", name: "Peru" }, { code: "NG", name: "Nigeria" },
  { code: "ZA", name: "South Africa" }, { code: "GH", name: "Ghana" },
  { code: "KE", name: "Kenya" }, { code: "EG", name: "Egypt" },
  { code: "AE", name: "United Arab Emirates" }, { code: "SA", name: "Saudi Arabia" },
  { code: "TR", name: "Türkiye" }, { code: "IL", name: "Israel" },
  { code: "IN", name: "India" }, { code: "PK", name: "Pakistan" },
  { code: "BD", name: "Bangladesh" }, { code: "ID", name: "Indonesia" },
  { code: "MY", name: "Malaysia" }, { code: "SG", name: "Singapore" },
  { code: "PH", name: "Philippines" }, { code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" }, { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" }, { code: "CN", name: "China" },
  { code: "TW", name: "Taiwan" }, { code: "HK", name: "Hong Kong" },
];

const ART_MODELS = [
  { value: "gen4_image", label: "Pro", credits: 2, note: "Best detail for covers" },
  { value: "gpt-image-2.5-sunburst", label: "Sunburst", credits: 1, note: "Sharp + cheap" },
];

function NewReleaseWizard(props: {
  pricing: PricingInfo | null;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onDone: (release: Release, notice: string | null, paid: boolean) => void;
  onError: (msg: string) => void;
  onOutOfCredits: () => void;
  refreshProfile: () => void;
}) {
  const { t } = useTranslation();
  const { pricing, authFetch, onDone, onError, onOutOfCredits, refreshProfile } = props;
  const { project } = useHubProject();

  const [step, setStep] = useState(0);

  /* step 1: music */
  const [songs, setSongs] = useState<SongRow[]>([]);
  const [songsLoading, setSongsLoading] = useState(true);
  const [songId, setSongId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState("");

  /* step 2: metadata */
  const [title, setTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [releaseType, setReleaseType] = useState<DistributionTier>("single");
  const [genre, setGenre] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [explicit, setExplicit] = useState<boolean | null>(null);
  const [explicitConfirmed, setExplicitConfirmed] = useState(false);
  const [isrc, setIsrc] = useState("");
  const [label, setLabel] = useState("");
  const [tracks, setTracks] = useState<ReleaseTrack[]>([{ title: "" }]);

  /* step 3: cover art */
  const [artworkUrl, setArtworkUrl] = useState("");
  const [artPrompt, setArtPrompt] = useState("");
  const [artModel, setArtModel] = useState("gen4_image");
  const [artWorking, setArtWorking] = useState(false);
  const [artStatus, setArtStatus] = useState<string | null>(null);

  /* step 4: platforms */
  const [platforms, setPlatforms] = useState<string[]>(["spotify", "apple_music"]);

  /* step 5: submit */
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState<{ release: Release; notice: string | null } | null>(null);

  /* Deep-link + hub prefill: /distribute?title=…&cover=<url> (from release plans
     and the cover-art studio) so nothing is retyped or re-uploaded. */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const titleParam = params.get("title")?.trim().slice(0, 200);
      const coverParam = params.get("cover")?.trim();
      if (titleParam && !title) setTitle(titleParam);
      if (coverParam && !artworkUrl) setArtworkUrl(coverParam);
      if (!title && project.name && project.name !== "Untitled Project") setTitle(project.name);
      if (titleParam || coverParam) window.history.replaceState(null, "", window.location.pathname);
    } catch { /* non-browser — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Hub prefill: artist name from the artist vault, cover art from the hub
     project's latest image asset (title already prefills from project name). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!artworkUrl) {
          const img = [...project.assets].reverse().find((a) => a.kind === "image" && !a.url.startsWith("blob:"));
          if (!cancelled && img?.url) setArtworkUrl(img.url);
        }
        if (!artistName) {
          const res = await authFetch("/api/artist-vaults");
          const data = (await res.json().catch(() => ({}))) as {
            vaults?: { artist_name?: string }[];
          };
          const first = Array.isArray(data.vaults) ? data.vaults[0] : undefined;
          if (!cancelled && res.ok && first?.artist_name) setArtistName(first.artist_name);
        }
      } catch {
        /* prefill is best-effort — the fields stay editable */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/songs");
        const data = (await res.json().catch(() => ({}))) as { songs?: SongRow[] };
        if (!cancelled && res.ok && Array.isArray(data.songs)) setSongs(data.songs);
      } catch {
        /* empty library still renders */
      } finally {
        if (!cancelled) setSongsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authFetch]);

  const tierPrice = pricing?.tiers.find((tr) => tr.type === releaseType)?.credits ?? tierCredits(releaseType);

  function selectSong(s: SongRow | null) {
    setSongId(s?.id ?? null);
    setAudioUrl(s?.audio_url ?? "");
    if (s && !title.trim()) setTitle(s.title);
    if (s && tracks.length === 1 && !tracks[0]!.title.trim()) setTracks([{ title: s.title }]);
  }

  function togglePlatform(key: string) {
    setPlatforms((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
  }

  /* AI cover art via the existing image pipeline */
  async function generateArtwork() {
    if (artWorking || !artPrompt.trim()) return;
    const model = ART_MODELS.find((m) => m.value === artModel)!;
    if (!window.confirm(`Generate cover art (${model.credits} Visual Bucs)?`)) return;
    setArtWorking(true);
    setArtStatus("Submitting image job…");
    onError("");
    try {
      const res = await authFetch("/generate-artist-image", {
        method: "POST",
        body: JSON.stringify({ promptText: artPrompt.trim(), model: artModel, ratio: "1080:1080" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        taskId?: string; error?: string; message?: string;
      };
      if (res.status === 402) { onOutOfCredits(); return; }
      if (!res.ok || !data.taskId) throw new Error(data.message || data.error || "Couldn't start image generation.");
      /* poll until it lands */
      let attempts = 0;
      for (;;) {
        attempts += 1;
        await new Promise((r) => setTimeout(r, 3000));
        const poll = await authFetch(`/generate-artist-image/${data.taskId}`);
        const pd = (await poll.json().catch(() => ({}))) as {
          status?: string; url?: string | null; error?: string; progress?: number | null;
        };
        if (pd.status === "succeeded" && pd.url) {
          setArtworkUrl(pd.url);
          setArtStatus(null);
          refreshProfile();
          break;
        }
        if (pd.status === "failed" || pd.status === "cancelled") {
          throw new Error(pd.error || "Image generation failed — no Visual Bucs charged.");
        }
        setArtStatus(pd.progress != null ? `Rendering… ${Math.round(pd.progress)}%` : `Rendering… (${attempts * 3}s)`);
        if (attempts >= 60) throw new Error("Image job is taking too long — check back; it may still finish.");
      }
    } catch (err) {
      setArtStatus(null);
      onError(err instanceof Error ? err.message : "Cover art generation failed.");
    } finally {
      setArtWorking(false);
    }
  }

  /* review-step validation */
  const validation = [
    { ok: title.trim().length > 0 && artistName.trim().length > 0, label: "Title and artist name set" },
    { ok: explicit !== null && explicitConfirmed, label: "Explicit-content declaration confirmed (required)" },
    { ok: platforms.length > 0, label: "At least one platform selected" },
    { ok: audioUrl.trim().length > 0, label: "Audio source set (song library or manual URL)" },
    { ok: tracks.length > 0 && tracks.every((tr) => tr.title.trim().length > 0), label: "Every track has a title" },
    { ok: releaseDate.trim().length > 0, label: "Release date set" },
  ];
  const warnings = [
    { show: !artworkUrl.trim(), label: "No cover art yet — add one for a complete package" },
  ].filter((w) => w.show);
  const canSubmit = validation.every((v) => v.ok);

  async function createAndSubmit() {
    if (creating || !canSubmit) return;
    setCreating(true);
    onError("");
    try {
      /* 1 — free draft */
      const body: Record<string, unknown> = {
        title: title.trim(),
        artistName: artistName.trim(),
        releaseType,
        tracks: tracks.map((tr) => ({ title: tr.title.trim(), ...(tr.isrc?.trim() ? { isrc: tr.isrc.trim() } : {}) })),
        explicit: explicit === true,
        releaseDate: releaseDate.trim(),
        platforms,
      };
      if (songId) body.songId = songId;
      if (audioUrl.trim()) body.audioUrl = audioUrl.trim();
      if (artworkUrl.trim()) body.artworkUrl = artworkUrl.trim();
      if (isrc.trim()) body.isrc = isrc.trim();
      if (genre.trim()) body.genre = genre.trim();
      if (label.trim()) body.label = label.trim();

      const draftRes = await authFetch("/api/distribution/releases", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const draftData = (await draftRes.json().catch(() => ({}))) as {
        release?: Release; error?: string; message?: string;
      };
      if (!draftRes.ok || !draftData.release) {
        throw new Error(draftData.message || draftData.error || "Couldn't create the release draft.");
      }
      const release = draftData.release;

      /* 2 — paid submit */
      const subRes = await authFetch(`/api/distribution/releases/${release.id}/submit`, { method: "POST" });
      const subData = (await subRes.json().catch(() => ({}))) as {
        release?: Release; notice?: string; error?: string; message?: string; creditsRemaining?: number;
      };
      if (subRes.status === 402) {
        /* draft still exists — the user can pay from the Releases tab later */
        onDone(release, null, false);
        onOutOfCredits();
        refreshProfile();
        return;
      }
      if (!subRes.ok || !subData.release) {
        throw new Error(subData.message || subData.error || "Couldn't submit the release.");
      }
      refreshProfile();
      setDone({ release: subData.release, notice: subData.notice ?? null });
      onDone(subData.release, subData.notice ?? null, true);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't create the release.");
    } finally {
      setCreating(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-2xl rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.05] p-10 text-center">
        <BadgeCheck className="mx-auto h-12 w-12 text-emerald-400" />
        <h3 className="mt-4 font-display text-2xl font-black text-emerald-300">{t("distribute.release_submitted")}</h3>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/60">
          "{done.release.title}" is queued for delivery. Track every platform below.
        </p>
        {done.notice && (
          <p className="mx-auto mt-4 max-w-md rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/70">
            {done.notice}
          </p>
        )}
        {pricing?.aggregator === "mock" && (
          <p className="mx-auto mt-3 inline-flex items-center gap-2 text-xs text-violet-300">
            <FlaskConical className="h-4 w-4" />{t("distribute.sandbox_mode_statuses_will_simul")}</p>
        )}
      </div>
    );
  }

  const tierCards = (pricing?.tiers.length ? pricing.tiers : [...DISTRIBUTION_TIERS]).map((tr) => ({
    type: tr.type,
    credits: tr.credits,
    label: tr.label,
    blurb: tr.blurb,
  }));

  return (
    <div className="mx-auto max-w-4xl">
      {/* stepper */}
      <ol className="mb-8 flex items-center justify-between gap-1">
        {WIZARD_STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-1 last:flex-none">
            <button
              onClick={() => i < step && setStep(i)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                i === step ? "border-primary/60 bg-primary/10 text-primary"
                : i < step ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 text-white/35"
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[10px]">
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{s}</span>
            </button>
            {i < WIZARD_STEPS.length - 1 && <span className="mx-1 hidden h-px flex-1 bg-white/10 md:block" />}
          </li>
        ))}
      </ol>

      {/* ── step 1: music ── */}
      {step === 0 && (
        <Section title={t("distribute.pick_your_music")} icon={<Music2 className="h-5 w-5 text-primary" />}>
          <ProjectFlowBar
            kinds={["song"]}
            actionLabel="Distribute it"
            onPick={(asset) => {
              setSongId(null);
              setAudioUrl(asset.url);
              if (!title.trim()) setTitle(asset.label);
              if (tracks.length === 1 && !tracks[0]!.title.trim()) setTracks([{ title: asset.label }]);
            }}
          />
          <p className={labelClass}>{t("distribute.from_your_song_library")}<span className="font-normal normal-case text-white/30">{t("distribute.free_selecting_one_prefills_titl")}</span></p>
          {songsLoading ? (
            <p className="py-6 text-center text-sm text-white/40"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></p>
          ) : songs.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/40">{t("distribute.no_songs_in_your_library_yet_gen")}</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {songs.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => selectSong(songId === s.id ? null : s)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                      songId === s.id ? "border-primary/60 bg-primary/[0.08]" : "border-white/10 bg-black/40 hover:border-white/25"
                    }`}
                  >
                    <Disc3 className={`h-7 w-7 shrink-0 ${songId === s.id ? "text-primary" : "text-white/30"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{s.title}</span>
                      <span className="block text-xs text-white/35">
                        {s.source ?? "upload"}{s.duration_sec ? ` · ${s.duration_sec}` : ""}
                      </span>
                    </span>
                    {songId === s.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5">
            <p className={labelClass}>{t("distribute.or_paste_a_manual_audio_url")}</p>
            <input
              value={audioUrl}
              onChange={(e) => { setAudioUrl(e.target.value); if (e.target.value !== "") setSongId(null); }}
              placeholder="https://…/track.mp3"
              className={inputClass}
            />
          </div>

          <div className="mt-6 flex justify-end">
            <button onClick={() => setStep(1)} className={goldBtn}>{t("distribute.continue")}<ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </Section>
      )}

      {/* ── step 2: metadata ── */}
      {step === 1 && (
        <Section title={t("distribute.release_metadata")} icon={<Tag className="h-5 w-5 text-primary" />}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>{t("distribute.release_title")}</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("distribute.midnight_frequencies")} className={inputClass} maxLength={200} />
            </div>
            <div>
              <label className={labelClass}>{t("distribute.artist_name")}</label>
              <input value={artistName} onChange={(e) => setArtistName(e.target.value)} placeholder={t("distribute.shark_king")} className={inputClass} maxLength={120} />
            </div>
          </div>

          <div className="mt-5">
            <label data-min-stars="2" className={labelClass}>{t("distribute.release_type")}</label>
            <div data-min-stars="2" className="grid gap-2 md:grid-cols-3">
              {tierCards.map((tc) => (
                <button
                  key={tc.type}
                  onClick={() => setReleaseType(tc.type as DistributionTier)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    releaseType === tc.type ? "border-primary/60 bg-primary/[0.08]" : "border-white/10 bg-black/40 hover:border-white/25"
                  }`}
                >
                  <p className="flex items-center justify-between text-sm font-black">
                    {t(`distribute.tier.${tc.type}.label`, { defaultValue: tc.label })}
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">{tc.credits} VB</span>
                  </p>
                  <p className="mt-1 text-xs text-white/45">{t(`distribute.tier.${tc.type}.blurb`, { defaultValue: tc.blurb })}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div data-min-stars="3">
              <label className={labelClass}>{t("distribute.genre")}</label>
              <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder={t("distribute.hip_hop_trap")} className={inputClass} maxLength={80} />
            </div>
            <div>
              <label className={labelClass}>{t("distribute.release_date")}</label>
              <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} className={inputClass} />
            </div>
            <div data-min-stars="3">
              <label className={labelClass}>{t("distribute.isrc")}<span className="font-normal normal-case text-white/30">{t("distribute.optional")}</span></label>
              <input value={isrc} onChange={(e) => setIsrc(e.target.value)} placeholder={t("distribute.us_xxx_26_00001")} className={inputClass} maxLength={20} />
            </div>
            <div data-min-stars="3">
              <label className={labelClass}>{t("distribute.record_label")}<span className="font-normal normal-case text-white/30">{t("distribute.optional")}</span></label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("distribute.bow_down_records")} className={inputClass} maxLength={120} />
            </div>
          </div>

          {/* explicit declaration — required */}
          <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] p-5">
            <p className={labelClass}>{t("distribute.explicit_content_required_declar")}</p>
            <div className="flex gap-2">
              {[{ v: false, label: "Clean" }, { v: true, label: "Explicit" }].map((o) => (
                <button
                  key={o.label}
                  onClick={() => setExplicit(o.v)}
                  className={`rounded-xl border px-5 py-2.5 text-sm font-bold transition ${
                    explicit === o.v
                      ? o.v ? "border-red-500/60 bg-red-500/15 text-red-300" : "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                      : "border-white/15 text-white/50 hover:border-white/40"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-white/55">
              <input
                type="checkbox"
                checked={explicitConfirmed}
                onChange={(e) => setExplicitConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-yellow-500"
              />{t("distribute.i_confirm_this_declaration_is_ac")}</label>
          </div>

          {/* tracks */}
          <div className="mt-5">
            <p className={labelClass}>{t("distribute.tracks")}<span className="font-normal normal-case text-white/30">{t("distribute.ep_2_5_tracks_album_6_tracks")}</span>
            </p>
            <div className="space-y-2">
              {tracks.map((tr, i) => (
                <div key={i} className="flex gap-2">
                  <span className="flex h-[42px] w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/40 text-xs font-bold text-white/40">
                    {i + 1}
                  </span>
                  <input
                    value={tr.title}
                    onChange={(e) => setTracks((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    placeholder={t("distribute.trackTitle", { n: i + 1 })}
                    className={inputClass}
                    maxLength={200}
                  />
                  <input
                    value={tr.isrc ?? ""}
                    onChange={(e) => setTracks((prev) => prev.map((x, j) => (j === i ? { ...x, isrc: e.target.value } : x)))}
                    placeholder={t("distribute.isrc")}
                    data-min-stars="4"
                    className={`${inputClass} max-w-[140px]`}
                    maxLength={20}
                  />
                  {tracks.length > 1 && (
                    <button
                      onClick={() => setTracks((prev) => prev.filter((_, j) => j !== i))}
                      className="flex h-[42px] w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/30 text-red-300/80 hover:bg-red-500/10"
                      aria-label={`Remove track ${i + 1}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => setTracks((prev) => [...prev, { title: "" }])}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:brightness-110"
            >
              <Plus className="h-3.5 w-3.5" />{t("distribute.add_track")}</button>
          </div>

          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(0)} className={ghostBtn}><ArrowLeft className="h-4 w-4" />{t("distribute.back")}</button>
            <button onClick={() => setStep(2)} className={goldBtn}>{t("distribute.continue")}<ArrowRight className="h-4 w-4" /></button>
          </div>
        </Section>
      )}

      {/* ── step 3: cover art ── */}
      {step === 2 && (
        <Section title={t("distribute.cover_art")} icon={<ImageIcon className="h-5 w-5 text-primary" />}>
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex h-44 w-44 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              {artworkUrl
                ? <img src={artworkUrl} alt={t("distribute.cover_art_preview")} className="h-full w-full object-cover" />
                : <ImageIcon className="h-12 w-12 text-white/20" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className={labelClass}>{t("distribute.paste_an_image_url")}</p>
              <input value={artworkUrl} onChange={(e) => setArtworkUrl(e.target.value)} placeholder="https://…/cover.jpg" className={inputClass} />
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-primary/25 bg-black/40 p-5">
            <p className={`${labelClass} flex items-center gap-2`}>
              <Sparkles className="h-3.5 w-3.5 text-primary" />{t("distribute.or_generate_with_ai")}</p>
            <textarea
              value={artPrompt}
              onChange={(e) => setArtPrompt(e.target.value)}
              placeholder={t("distribute.luxury_gold_and_black_album_cove")}
              rows={3}
              className={inputClass}
              maxLength={1000}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div data-min-stars="5" className="flex gap-2">
                {ART_MODELS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setArtModel(m.value)}
                    title={m.note}
                    className={`rounded-xl border px-4 py-2 text-xs font-bold transition ${
                      artModel === m.value ? "border-primary/60 bg-primary/[0.08] text-primary" : "border-white/15 text-white/50 hover:border-white/40"
                    }`}
                  >
                    {m.label} · {m.credits} VB
                  </button>
                ))}
              </div>
              <button onClick={generateArtwork} disabled={artWorking || !artPrompt.trim()} className={goldBtn}>
                {artWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate art
              </button>
              {artStatus && <p className="text-xs text-white/50">{artStatus}</p>}
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(1)} className={ghostBtn}><ArrowLeft className="h-4 w-4" />{t("distribute.back")}</button>
            <button onClick={() => setStep(3)} className={goldBtn}>{t("distribute.continue")}<ArrowRight className="h-4 w-4" /></button>
          </div>
        </Section>
      )}

      {/* ── step 4: platforms ── */}
      {step === 3 && (
        <Section title={t("distribute.platforms")} icon={<Rocket className="h-5 w-5 text-primary" />}>
          <p className="mb-4 text-sm text-white/50">{t("distribute.where_should_this_release_land_e")}</p>
          <div className="flex flex-wrap gap-2">
            {DISTRIBUTION_PLATFORMS.map((p: { key: string; label: string }) => {
              const on = platforms.includes(p.key);
              return (
                <button
                  key={p.key}
                  onClick={() => togglePlatform(p.key)}
                  className={`rounded-full border px-5 py-2.5 text-sm font-bold transition ${
                    on ? "border-primary/60 bg-primary/15 text-primary" : "border-white/15 text-white/50 hover:border-primary/50 hover:text-white"
                  }`}
                >
                  {on && <Check className="mr-1.5 inline h-3.5 w-3.5" />}
                  {p.label}
                </button>
              );
            })}
          </div>
          {platforms.includes("correctional") && (
            <p className="mt-3 text-xs text-white/40">
              Jails &amp; Prisons delivers to correctional tablet networks (JPay, GTL, Securus/ViaPath).
              These networks are curated and do not accept explicit content — clean versions only.
            </p>
          )}
          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(2)} className={ghostBtn}><ArrowLeft className="h-4 w-4" />{t("distribute.back")}</button>
            <button onClick={() => setStep(4)} className={goldBtn}>{t("distribute.review")}<ArrowRight className="h-4 w-4" /></button>
          </div>
        </Section>
      )}

      {/* ── step 5: review & pay ── */}
      {step === 4 && (
        <Section title={t("distribute.review_pay")} icon={<BadgeCheck className="h-5 w-5 text-primary" />}>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2 text-sm">
              <p><span className="text-white/40">{t("distribute.title")}</span> <strong>{title || "—"}</strong></p>
              <p><span className="text-white/40">{t("distribute.artist")}</span> <strong>{artistName || "—"}</strong></p>
              <p><span className="text-white/40">{t("distribute.type")}</span> <strong>{tierLabel(releaseType)}</strong> · {tracks.length} track{tracks.length === 1 ? "" : "s"}</p>
              <p><span className="text-white/40">{t("distribute.release_date_2")}</span> <strong>{releaseDate || "—"}</strong></p>
              <p><span className="text-white/40">{t("distribute.genre_2")}</span> <strong>{genre || "—"}</strong></p>
              <p><span className="text-white/40">{t("distribute.content")}</span> <strong>{explicit === null ? "—" : explicit ? "Explicit" : "Clean"}</strong></p>
              <p><span className="text-white/40">{t("distribute.isrc_2")}</span> <strong>{isrc || "—"}</strong></p>
              <p><span className="text-white/40">{t("distribute.label")}</span> <strong>{label || "—"}</strong></p>
              <p><span className="text-white/40">{t("distribute.platforms_2")}</span> <strong>{platforms.map(platformLabel).join(", ") || "—"}</strong></p>
            </div>
            <div className="flex items-center gap-4">
              {artworkUrl
                ? <img src={artworkUrl} alt={t("distribute.cover_art")} className="h-32 w-32 rounded-2xl border border-white/10 object-cover" />
                : <div className="flex h-32 w-32 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]"><ImageIcon className="h-10 w-10 text-white/20" /></div>}
              <div className="text-sm text-white/50">
                <p className="flex items-center gap-1.5"><Hash className="h-3.5 w-3.5 text-primary/70" /> {tracks.length} track{tracks.length === 1 ? "" : "s"}</p>
                <p className="mt-1 flex items-center gap-1.5"><Music2 className="h-3.5 w-3.5 text-primary/70" /> {audioUrl ? "Audio attached" : "No audio"}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-5">
            <p className={labelClass}>{t("distribute.release_checklist")}</p>
            <ul className="space-y-1.5">
              {validation.map((v, vi) => (
                <li key={v.label} className={`flex items-start gap-2 text-sm ${v.ok ? "text-white/75" : "text-red-300"}`}>
                  {v.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                  {t(`distribute.validation.${vi}`, { defaultValue: v.label })}
                </li>
              ))}
              {warnings.map((w, wi) => (
                <li key={w.label} className="flex items-start gap-2 text-sm text-amber-300/90">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {t(`distribute.warning.${wi}`, { defaultValue: w.label })}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/30 bg-primary/[0.05] p-5">
            <div>
              <p className="text-sm text-white/50">Submission fee · {tierLabel(releaseType)}</p>
              <p className="font-display text-3xl font-black text-primary">{tierPrice} <span className="text-base">{t("distribute.visual_bucs")}</span></p>
              {pricing?.aggregator === "mock" && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-violet-300">
                  <FlaskConical className="h-3.5 w-3.5" />{t("distribute.sandbox_mode_statuses_will_simul")}</p>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(3)} className={ghostBtn} disabled={creating}><ArrowLeft className="h-4 w-4" />{t("distribute.back")}</button>
              <button onClick={createAndSubmit} disabled={creating || !canSubmit} className={goldBtn}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Create & pay {tierPrice} Visual Bucs
              </button>
            </div>
          </div>
          {!canSubmit && (
            <p className="mt-3 text-xs text-red-300/80">{t("distribute.finish_the_checklist_items_above")}</p>
          )}
        </Section>
      )}
    </div>
  );
}

/* ── Release Metadata Manager ──────────────────────────────────────────────
   Drafts: full editable form (free — no credit charge on save).
   Packaged: read-only summary (submitted releases are locked). */

function ReleaseMetadataManager(props: {
  release: Release;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onUpdate: (release: Release) => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  onSendToPresave: () => Promise<void>;
}) {
  const { release, authFetch, onUpdate, onError, onNotice, onSendToPresave } = props;
  const isDraft = release.status === "draft";

  const [upc, setUpc] = useState(release.upc ?? "");
  const [upcKind, setUpcKind] = useState<"internal" | "official">(release.upcKind ?? "internal");
  const [officialConfirm, setOfficialConfirm] = useState(false);
  const [labelImprint, setLabelImprint] = useState(release.labelImprint ?? "");
  const [cLine, setCLine] = useState(release.copyrightCLine ?? "");
  const [pLine, setPLine] = useState(release.copyrightPLine ?? "");
  const [genre, setGenre] = useState(release.genre ?? "");
  const [subgenre, setSubgenre] = useState(release.subgenre ?? "");
  const [explicit, setExplicit] = useState<boolean | null>(
    release.explicit ? true : null,
  );
  const [origDate, setOrigDate] = useState(release.originalReleaseDate ?? "");
  const [preorderDate, setPreorderDate] = useState(release.preorderDate ?? "");
  const [releaseDate, setReleaseDate] = useState(release.releaseDate ?? "");
  const [terrMode, setTerrMode] = useState<"worldwide" | "include" | "exclude">(release.territoriesMode ?? "worldwide");
  const [terrSelected, setTerrSelected] = useState<string[]>(release.territories ?? []);
  const [terrSearch, setTerrSearch] = useState("");
  const [tracks, setTracks] = useState<ReleaseTrack[]>(release.tracks ?? []);
  const [saving, setSaving] = useState(false);
  const [barcodeWorking, setBarcodeWorking] = useState(false);
  const [presaveWorking, setPresaveWorking] = useState(false);
  const [copied, setCopied] = useState(false);

  const filteredTerritories = TERRITORIES.filter((c) =>
    c.name.toLowerCase().includes(terrSearch.trim().toLowerCase()) ||
    c.code.toLowerCase().includes(terrSearch.trim().toLowerCase()),
  );

  function toggleTerritory(code: string) {
    setTerrSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  /* © and ℗ auto-suggest from label/imprint + release year. */
  function autoSuggestCopyright() {
    const imprint = labelImprint.trim() || release.label?.trim() || release.artistName;
    const yearSrc = origDate.trim() || releaseDate.trim() || release.releaseDate || "";
    const year = /^\d{4}/.test(yearSrc) ? yearSrc.slice(0, 4) : String(new Date().getFullYear());
    setCLine(`© ${year} ${imprint}`);
    setPLine(`℗ ${year} ${imprint}`);
    onNotice("Copyright lines auto-suggested from your label + year — review and edit freely, then save.");
  }

  async function generateBarcode() {
    if (barcodeWorking) return;
    if (!window.confirm(
      "Mint a valid-format UPC-A placeholder for this release's internal catalog?\n\n" +
      "It is labeled INTERNAL — not a store-recognized UPC. Your official UPC is assigned when the release is distributed via a partner.",
    )) return;
    setBarcodeWorking(true);
    onError("");
    try {
      const res = await authFetch(`/api/distribution/releases/${release.id}/generate-barcode`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        release?: Release; barcode?: string; notice?: string; error?: string; message?: string;
      };
      if (!res.ok || !data.release) {
        throw new Error(data.message || data.error || "Couldn't generate the barcode.");
      }
      setUpc(data.barcode ?? "");
      setUpcKind("internal");
      onUpdate(data.release);
      onNotice(data.notice ?? "Internal catalog ID minted — not a store-recognized UPC.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't generate the barcode.");
    } finally {
      setBarcodeWorking(false);
    }
  }

  async function saveMetadata() {
    if (saving) return false;
    setSaving(true);
    onError("");
    try {
      if ((terrMode === "include" || terrMode === "exclude") && terrSelected.length === 0) {
        throw new Error(`Pick at least one territory for "${terrMode}" mode — or switch back to Worldwide.`);
      }
      if (preorderDate && releaseDate && preorderDate > releaseDate) {
        throw new Error("The preorder date can't be after the release date.");
      }
      const payload: Record<string, unknown> = {
        upc: upc.trim(),
        upcKind,
        labelImprint: labelImprint.trim(),
        copyrightCLine: cLine.trim(),
        copyrightPLine: pLine.trim(),
        genre: genre.trim(),
        subgenre: subgenre.trim(),
        originalReleaseDate: origDate.trim(),
        preorderDate: preorderDate.trim(),
        releaseDate: releaseDate.trim(),
        territoriesMode: terrMode,
        territories: terrSelected,
        /* Track rows with no title are wizard placeholder rows — drop them so
           server-side title validation stays clean. */
        tracks: tracks
          .filter((t) => t.title.trim().length > 0)
          .map((t) => ({ title: t.title.trim(), ...(t.isrc?.trim() ? { isrc: t.isrc.trim() } : {}) })),
      };
      if (explicit !== null) {
        payload.explicit = explicit;
        payload.explicitDeclared = true;
      }
      const res = await authFetch(`/api/distribution/releases/${release.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        release?: Release; error?: string; message?: string;
      };
      if (!res.ok || !data.release) {
        throw new Error(data.message || data.error || "Couldn't save the metadata.");
      }
      setTracks(data.release.tracks ?? []);
      onUpdate(data.release);
      onNotice("Release metadata saved — free.");
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't save the metadata.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /* "Send to Presave": save metadata first, then mint/refresh the presave
     page — the public presave page shows a live countdown to the release
     date. Custom release dates are honored in our presave/scheduler flows. */
  async function sendToPresave() {
    if (presaveWorking) return;
    setPresaveWorking(true);
    try {
      const saved = await saveMetadata();
      if (!saved) return;
      await onSendToPresave();
    } finally {
      setPresaveWorking(false);
    }
  }

  async function copyChecklistLink() {
    const url = `${window.location.origin}/distribute?release=${release.id}#release-checklist`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onNotice("Checklist deep-link copied — it opens this release scrolled to its release checklist.");
    } catch {
      onError("Couldn't copy — the link is in the address bar format /distribute?release=" + release.id);
    }
  }

  /* ── packaged: read-only summary ── */
  if (!isDraft) {
    const terrLabel =
      release.territoriesMode === "worldwide"
        ? "Worldwide"
        : `${release.territoriesMode === "include" ? "Include" : "Exclude"}: ${(release.territories ?? []).join(", ") || "—"}`;
    return (
      <Section title="Release metadata" icon={<Tag className="h-5 w-5 text-primary" />}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3"><dt className="text-white/40">UPC/EAN</dt>
            <dd className="font-semibold">{release.upc ?? "—"}
              {release.upc && (
                <span className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                  release.upcKind === "official"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                }`}>{release.upcKind === "official" ? "Official" : "Internal catalog ID"}</span>
              )}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-white/40">Label imprint</dt><dd className="font-semibold">{release.labelImprint ?? release.label ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-white/40">© line</dt><dd className="font-semibold">{release.copyrightCLine ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-white/40">℗ line</dt><dd className="font-semibold">{release.copyrightPLine ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-white/40">Genre</dt><dd className="font-semibold">{[release.genre, release.subgenre].filter(Boolean).join(" / ") || "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-white/40">Content</dt><dd className="font-semibold">{release.explicit ? "Explicit" : "Clean"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-white/40">Original release</dt><dd className="font-semibold">{release.originalReleaseDate ?? release.releaseDate ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-white/40">Preorder date</dt><dd className="font-semibold">{release.preorderDate ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-white/40">Territories</dt><dd className="font-semibold">{terrLabel}</dd></div>
        </dl>
        {(release.tracks ?? []).length > 0 && (
          <ol className="mt-4 space-y-1">
            {(release.tracks ?? []).map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-white/70">
                <span className="w-6 text-xs font-bold text-white/30">{i + 1}.</span>
                <span className="flex-1 truncate">{t.title}</span>
                {t.isrc && <span className="text-xs text-white/30">{t.isrc}</span>}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-xs text-white/35">Submitted releases are locked — create a new release for any changes.</p>
      </Section>
    );
  }

  /* ── draft: full editable form ── */
  return (
    <Section
      title="Release metadata manager"
      icon={<Tag className="h-5 w-5 text-primary" />}
      action={<span className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] font-bold text-white/50">Free</span>}
    >
      {/* UPC / EAN */}
      <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
        <label className={labelClass}>UPC / EAN</label>
        <div className="flex flex-wrap gap-2">
          <input
            value={upc}
            onChange={(e) => { setUpc(e.target.value); if (upcKind === "official" && !officialConfirm) setOfficialConfirm(true); }}
            placeholder="12-digit UPC-A or 13-digit EAN"
            className={`${inputClass} flex-1 min-w-[200px] font-mono`}
            maxLength={20}
            inputMode="numeric"
          />
          <button onClick={generateBarcode} disabled={barcodeWorking} className={ghostBtn}>
            {barcodeWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hash className="h-4 w-4" />}
            Generate barcode · free
          </button>
        </div>
        {upc && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${
              upcKind === "official"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-300"
            }`}>
              {upcKind === "official" ? <BadgeCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {upcKind === "official" ? "Official UPC" : "Internal catalog ID"}
            </span>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-white/55">
              <input
                type="checkbox"
                checked={upcKind === "official"}
                onChange={(e) => { setUpcKind(e.target.checked ? "official" : "internal"); setOfficialConfirm(e.target.checked); }}
                className="h-4 w-4 accent-yellow-500"
              />
              This is an official UPC assigned by a distribution partner
            </label>
          </div>
        )}
        <p className="mt-2 text-xs text-white/40">
          Generated barcodes are valid-format placeholders, clearly labeled internal — actual UPC registration
          and store delivery need a distribution partnership.
        </p>
      </div>

      {/* Label imprint + copyright lines */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label className={labelClass}>Label name / imprint</label>
          <input
            value={labelImprint}
            onChange={(e) => setLabelImprint(e.target.value)}
            placeholder={release.label || "e.g. Bow Down Records"}
            className={inputClass}
            maxLength={120}
          />
        </div>
        <div className="flex items-end">
          <button onClick={autoSuggestCopyright} className={ghostBtn}>
            <Sparkles className="h-4 w-4" /> Auto-suggest © &amp; ℗ lines
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label className={labelClass}>© copyright line</label>
          <input value={cLine} onChange={(e) => setCLine(e.target.value)} placeholder="© 2026 Bow Down Records" className={inputClass} maxLength={200} />
        </div>
        <div>
          <label className={labelClass}>℗ phonographic line</label>
          <input value={pLine} onChange={(e) => setPLine(e.target.value)} placeholder="℗ 2026 Bow Down Records" className={inputClass} maxLength={200} />
        </div>
      </div>

      {/* Genre / subgenre / explicit */}
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <label className={labelClass}>Primary genre</label>
          <select value={genre} onChange={(e) => setGenre(e.target.value)} className={`${inputClass} appearance-none`}>
            <option value="">Select genre…</option>
            {PRIMARY_GENRES.map((g) => (<option key={g} value={g}>{g}</option>))}
            {!PRIMARY_GENRES.includes(genre) && genre && <option value={genre}>{genre}</option>}
          </select>
        </div>
        <div>
          <label className={labelClass}>Subgenre</label>
          <input value={subgenre} onChange={(e) => setSubgenre(e.target.value)} placeholder="e.g. Dark Trap" className={inputClass} maxLength={80} />
        </div>
        <div>
          <label className={labelClass}>Explicit lyrics</label>
          <div className="flex gap-2">
            {[{ v: false, label: "Clean" }, { v: true, label: "Explicit" }].map((o) => (
              <button
                key={o.label}
                onClick={() => setExplicit(o.v)}
                className={`flex-1 rounded-xl border px-4 py-3 text-sm font-bold transition ${
                  explicit === o.v
                    ? o.v ? "border-red-500/60 bg-red-500/15 text-red-300" : "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                    : "border-white/15 text-white/50 hover:border-white/40"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Dates */}
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <label className={labelClass}>Release date</label>
          <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} className={inputClass} />
          <p className="mt-1 text-[11px] text-white/35">Custom release dates are honored in our presave + scheduler flows.</p>
        </div>
        <div>
          <label className={labelClass}>Original release date <span className="font-normal normal-case text-white/30">(first release, if reissue)</span></label>
          <input type="date" value={origDate} onChange={(e) => setOrigDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Preorder date <span className="font-normal normal-case text-white/30">(on-sale)</span></label>
          <input type="date" value={preorderDate} onChange={(e) => setPreorderDate(e.target.value)} className={inputClass} />
        </div>
      </div>

      {/* Territories */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-5">
        <label className={labelClass}>Territories</label>
        <div className="flex flex-wrap gap-2">
          {([["worldwide", "Worldwide"], ["include", "Include list"], ["exclude", "Exclude list"]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTerrMode(v)}
              className={`rounded-xl border px-4 py-2 text-xs font-bold transition ${
                terrMode === v ? "border-primary/60 bg-primary/15 text-primary" : "border-white/15 text-white/50 hover:border-white/40"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {terrMode !== "worldwide" && (
          <div className="mt-4">
            <input
              value={terrSearch}
              onChange={(e) => setTerrSearch(e.target.value)}
              placeholder="Search territories…"
              className={`${inputClass} mb-3`}
              maxLength={60}
            />
            <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
              {filteredTerritories.map((c) => {
                const on = terrSelected.includes(c.code);
                return (
                  <button
                    key={c.code}
                    onClick={() => toggleTerritory(c.code)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${
                      on ? "border-primary/60 bg-primary/10 text-primary" : "border-white/10 text-white/55 hover:border-white/30"
                    }`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? "border-primary bg-primary text-black" : "border-white/25"
                    }`}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{c.name}</span>
                    <span className="ml-auto shrink-0 text-white/25">{c.code}</span>
                  </button>
                );
              })}
              {filteredTerritories.length === 0 && (
                <p className="col-span-full py-4 text-center text-xs text-white/40">No territories match “{terrSearch}”.</p>
              )}
            </div>
            <p className="mt-2 text-xs text-white/40">
              {terrSelected.length} selected{terrMode === "include" ? " — the release is available ONLY in these territories" : " — the release is available everywhere EXCEPT these"}
            </p>
          </div>
        )}
      </div>

      {/* Per-track ISRCs */}
      <div className="mt-4">
        <p className={labelClass}>Per-track ISRCs</p>
        <div className="space-y-2">
          {tracks.map((tr, i) => (
            <div key={i} className="flex gap-2">
              <span className="flex h-[42px] w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/40 text-xs font-bold text-white/40">
                {i + 1}
              </span>
              <input
                value={tr.title}
                onChange={(e) => setTracks((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                placeholder={`Track ${i + 1} title`}
                className={inputClass}
                maxLength={200}
              />
              <input
                value={tr.isrc ?? ""}
                onChange={(e) => setTracks((prev) => prev.map((x, j) => (j === i ? { ...x, isrc: e.target.value.toUpperCase() } : x)))}
                placeholder="ISRC"
                className={`${inputClass} max-w-[160px] font-mono`}
                maxLength={20}
              />
              {tracks.length > 1 && (
                <button
                  onClick={() => setTracks((prev) => prev.filter((_, j) => j !== i))}
                  className="flex h-[42px] w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/30 text-red-300/80 hover:bg-red-500/10"
                  aria-label={`Remove track ${i + 1}`}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() => setTracks((prev) => [...prev, { title: "" }])}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:brightness-110"
        >
          <Plus className="h-3.5 w-3.5" /> Add track
        </button>
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button onClick={() => void saveMetadata()} disabled={saving} className={goldBtn}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save metadata · free
        </button>
        <button onClick={() => void sendToPresave()} disabled={presaveWorking || saving} className={ghostBtn}>
          {presaveWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          Send to Presave
        </button>
        <button onClick={() => void copyChecklistLink()} className={ghostBtn}>
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          {copied ? "Link copied" : "Add to Release Checklist"}
        </button>
      </div>
      <p className="mt-3 text-xs text-white/35">
        “Send to Presave” saves your metadata first, then creates or refreshes the public presave page —
        it shows fans a live countdown to your release date.
      </p>
    </Section>
  );
}

/* ── Release detail ──────────────────────────────────────────────────────── */

/* ─── Pre-save campaign manager (HyperFollow parity) ────────────────────────
   Artist-facing controls for the public /presave/:slug page:
   - live follower / share stats + recent fan signups
   - customize headline, per-platform URLs, share-to-unlock bonus URL (free)
   - handoff: "Announce on release day" → the scheduler (prefilled);
     "Fan email list" → the email-list dashboard (signups land there). */

const PRESAVE_PLATFORM_KEYS = [
  "spotify", "apple_music", "youtube_music", "tiktok",
  "amazon_music", "deezer", "tidal",
];

interface PresaveStats {
  followers: number;
  shares: number;
  settings: { headline: string | null; platformLinks: Record<string, string>; bonusUrl: string | null };
  recentFollows: Array<{ email: string; name: string | null; platform: string | null; created_at: string }>;
}

function PresaveManager(props: {
  release: Release;
  presaveUrl: string;
  copied: boolean;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  copyPresave: () => void;
}) {
  const { release, presaveUrl, copied, authFetch, onError, onNotice, copyPresave } = props;

  const [stats, setStats] = useState<PresaveStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [headline, setHeadline] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [bonusUrl, setBonusUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const loadStats = useCallback(async () => {
    if (!presaveUrl) return;
    setStatsLoading(true);
    try {
      const res = await authFetch(`/api/distribution/releases/${release.id}/presave-stats`);
      const data = (await res.json().catch(() => ({}))) as Partial<PresaveStats> & { error?: string; message?: string };
      if (!res.ok) throw new Error(data.message || data.error || "Couldn't load pre-save stats.");
      setStats(data as PresaveStats);
      setHeadline(data.settings?.headline ?? "");
      setLinks(data.settings?.platformLinks ?? {});
      setBonusUrl(data.settings?.bonusUrl ?? "");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't load pre-save stats.");
    } finally {
      setStatsLoading(false);
    }
  }, [release.id, presaveUrl, authFetch, onError]);

  useEffect(() => { void loadStats(); }, [loadStats]);

  async function saveSettings() {
    if (saving) return;
    setSaving(true);
    onError("");
    try {
      const res = await authFetch(`/api/distribution/releases/${release.id}/presave-settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ headline, platformLinks: links, bonusUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as PresaveStats & { error?: string; message?: string };
      if (!res.ok) throw new Error((data as { message?: string; error?: string }).message || (data as { error?: string }).error || "Couldn't save pre-save settings.");
      setStats((prev) => (prev ? { ...prev, settings: data.settings } : prev));
      setEditing(false);
      onNotice("Pre-save page updated — free.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't save pre-save settings.");
    } finally {
      setSaving(false);
    }
  }

  const announceCaption =
    `🎵 ${release.title} by ${release.artistName} ` +
    (release.releaseDate ? `drops ${release.releaseDate}` : "is dropping soon") +
    ` — pre-save it now: ${presaveUrl ?? ""} Made with Bow Down Visuals`;
  const schedulerHref = `/scheduler?schedule=1&caption=${encodeURIComponent(announceCaption)}`;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-white/55">
          Share this link — fans get a countdown, email pre-save, and share-to-unlock bonus. On release day it flips to “stream now” automatically.
        </p>
            <div className="mt-3 flex gap-2">
              <input value={presaveUrl} readOnly className={`${inputClass} font-mono text-xs`} />
              <button onClick={copyPresave} className={`${ghostBtn} shrink-0`}>
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <a href={presaveUrl} target="_blank" rel="noreferrer" className={`${ghostBtn} shrink-0`}>
                <ExternalLink className="h-4 w-4" /> Preview
              </a>
            </div>
          </div>

          {/* stats */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-bold text-primary">
              <BarChart3 className="h-4 w-4" />
              {statsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (stats?.followers ?? 0).toLocaleString()} fans pre-saved
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-1.5 text-sm font-bold text-white/70">
              <Share2 className="h-4 w-4" /> {statsLoading ? "…" : (stats?.shares ?? 0).toLocaleString()} shares
            </span>
            <button onClick={() => void loadStats()} className="text-xs font-bold text-white/40 underline-offset-2 hover:text-primary hover:underline">
              Refresh
            </button>
          </div>

          {/* recent fans */}
          {stats && stats.recentFollows.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">Latest fans</p>
              <ul className="space-y-1.5">
                {stats.recentFollows.slice(0, 5).map((f) => (
                  <li key={f.email} className="flex items-center justify-between gap-2 text-xs text-white/60">
                    <span className="truncate">{f.name ? `${f.name} <${f.email}>` : f.email}</span>
                    <span className="shrink-0 text-white/30">
                      {new Date(f.created_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* handoffs */}
          <div className="flex flex-wrap gap-2">
            <a href={schedulerHref} className={goldBtn}>
              <Megaphone className="h-4 w-4" /> Announce on release day · scheduler
            </a>
            <a href="/email-list" className={ghostBtn}>
              <Mail className="h-4 w-4" /> Fan email list
            </a>
          </div>

          {/* settings editor */}
          {!editing ? (
            <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:brightness-110">
              <Type className="h-3.5 w-3.5" /> Customize the pre-save page — headline, platform links, bonus content
            </button>
          ) : (
            <div className="space-y-4 rounded-2xl border border-primary/25 bg-black/40 p-5">
              <div>
                <label className={labelClass}>Headline</label>
                <input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="e.g. My hardest single yet — be the first to hear it"
                  maxLength={140}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Platform links (paste your pre-save / follow URLs)</label>
                <div className="space-y-2">
                  {PRESAVE_PLATFORM_KEYS.map((key) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="w-32 shrink-0 text-xs font-bold text-white/60">{platformLabel(key)}</span>
                      <input
                        value={links[key] ?? ""}
                        onChange={(e) => setLinks((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder="https://…"
                        inputMode="url"
                        className={`${inputClass} py-2 text-xs`}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelClass}>Bonus content URL <span className="font-normal normal-case text-white/30">(unlocked when a fan shares)</span></label>
                <input
                  value={bonusUrl}
                  onChange={(e) => setBonusUrl(e.target.value)}
                  placeholder="https://… (exclusive snippet, BTS video, download)"
                  inputMode="url"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={saveSettings} disabled={saving} className={goldBtn}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save page · free
                </button>
                <button onClick={() => setEditing(false)} className={ghostBtn}>Cancel</button>
              </div>
            </div>
          )}
        </div>
  );
}

function ReleaseDetail(props: {
  release: Release;
  pricing: PricingInfo | null;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onUpdate: (release: Release) => void;
  onDelete: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  onOutOfCredits: () => void;
  refreshProfile: () => void;
  vaulted: boolean;
  onVaulted: (releaseId: string) => void;
}) {
  const { t } = useTranslation();
  const { release, pricing, authFetch, onUpdate, onDelete, onError, onNotice, onOutOfCredits, refreshProfile, vaulted, onVaulted } = props;
  const { addAsset } = useHubProject();

  /* AI metadata */
  const [vibe, setVibe] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaResult, setMetaResult] = useState<MetadataResult | null>(null);

  /* AI strategy */
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [strategyResult, setStrategyResult] = useState<StrategyResult | null>(null);

  /* submit */
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* royalty splits */
  const [splits, setSplits] = useState<RoyaltySplit[]>(release.royaltySplits ?? []);
  const [splitsSaving, setSplitsSaving] = useState(false);
  useEffect(() => { setSplits(release.royaltySplits ?? []); }, [release.id, release.royaltySplits]);
  /* split invites + share link */
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [shareSlug, setShareSlug] = useState<string | null>(release.splitShareSlug ?? null);
  const [shareWorking, setShareWorking] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);
  useEffect(() => { setShareSlug(release.splitShareSlug ?? null); }, [release.id, release.splitShareSlug]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/referrals/me");
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as { code?: string };
        if (!cancelled && data.code) setRefCode(data.code);
      } catch { /* share links just won't carry ?ref */ }
    })();
    return () => { cancelled = true; };
  }, [authFetch]);
  const shareUrl = shareSlug
    ? `${window.location.origin}/splits/${shareSlug}${refCode ? `?ref=${encodeURIComponent(refCode)}` : ""}`
    : null;

  /* pre-save */
  const [presaveUrl, setPresaveUrl] = useState<string | null>(
    release.presaveSlug ? `${window.location.origin}/presave/${release.presaveSlug}` : null,
  );
  const [presaveWorking, setPresaveWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setPresaveUrl(release.presaveSlug ? `${window.location.origin}/presave/${release.presaveSlug}` : null);
  }, [release.id, release.presaveSlug]);

  const total = splitsTotal(splits);
  const valid = splitsValid(splits);

  function handle402(data: { error?: string }) {
    if (data.error === "out_of_credits") {
      onOutOfCredits();
      refreshProfile();
      return true;
    }
    return false;
  }

  /* ── platform tracker auto-poll (every ~10s while non-terminal) ── */
  useEffect(() => {
    if (release.status !== "packaged") return;
    const statuses = release.platformStatuses ?? [];
    if (statuses.length === 0) return;
    if (statuses.every((s) => isTerminalPlatformStatus(s.status))) return;
    const timer = setInterval(async () => {
      try {
        const res = await authFetch(`/api/distribution/releases/${release.id}/platforms`);
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as {
          platformStatuses?: PlatformStatusEntry[]; aggregator?: string;
        };
        if (Array.isArray(data.platformStatuses)) {
          onUpdate({ ...release, platformStatuses: data.platformStatuses, aggregator: data.aggregator ?? release.aggregator });
        }
      } catch {
        /* keep the last-known statuses on poll failure */
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [release.id, release.status, release.platformStatuses, release.aggregator, authFetch, onUpdate]);

  /* ── AI metadata ── */
  async function generateMetadata() {
    if (metaLoading || !vibe.trim()) { if (!vibe.trim()) onError("Describe the song's vibe first — that's what the AI writes from."); return; }
    setMetaLoading(true);
    onError("");
    try {
      const res = await authFetch("/api/distribution/metadata", {
        method: "POST",
        body: JSON.stringify({
          vibe: vibe.trim(),
          lyrics: lyrics.trim(),
          artistName: release.artistName,
          workingTitle: release.title,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as MetadataResult;
      if (handle402(data)) return;
      if (!res.ok || !data.titleOptions?.length) {
        throw new Error(data.message || data.error || "Metadata generation failed — try again.");
      }
      setMetaResult(data);
      refreshProfile();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Metadata generation failed.");
    } finally {
      setMetaLoading(false);
    }
  }

  /* ── AI strategy ── */
  async function generateStrategy() {
    if (strategyLoading) return;
    setStrategyLoading(true);
    onError("");
    try {
      const meta = (release.metadata ?? metaResult ?? {}) as ReleaseMeta;
      const res = await authFetch("/api/distribution/strategy", {
        method: "POST",
        body: JSON.stringify({
          title: release.title,
          artistName: release.artistName,
          genreTags: meta.genreTags ?? [],
          releaseDate: release.releaseDate ?? "",
          platforms: release.platforms.length ? release.platforms : ["spotify"],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as StrategyResult;
      if (handle402(data)) return;
      if (!res.ok || !data.timing) {
        throw new Error(data.message || data.error || "Strategy generation failed — try again.");
      }
      setStrategyResult(data);
      refreshProfile();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Strategy generation failed.");
    } finally {
      setStrategyLoading(false);
    }
  }

  async function saveAiToRelease() {
    const payload: { metadata?: ReleaseMeta; strategy?: ReleaseStrategy } = {};
    if (metaResult?.titleOptions) {
      payload.metadata = {
        titleOptions: metaResult.titleOptions,
        description: metaResult.description,
        genreTags: metaResult.genreTags,
      };
    }
    if (strategyResult?.timing) {
      payload.strategy = {
        timing: strategyResult.timing,
        promoPlan: strategyResult.promoPlan,
        checklist: strategyResult.checklist,
      };
    }
    if (!payload.metadata && !payload.strategy) return;
    try {
      const res = await authFetch(`/api/distribution/releases/${release.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { release?: Release };
      if (res.ok && data.release) {
        onUpdate(data.release);
        onNotice("AI package saved to the release.");
      }
    } catch {
      onError("Couldn't save the AI package.");
    }
  }

  /* ── royalty splits ── */
  async function saveSplits() {
    if (splitsSaving || !valid) return;
    setSplitsSaving(true);
    onError("");
    try {
      const res = await authFetch(`/api/distribution/releases/${release.id}/splits`, {
        method: "PUT",
        body: JSON.stringify({
          splits: splits.map((s) => ({
            name: s.name.trim(),
            role: (s.role ?? "").trim() || undefined,
            email: (s.email ?? "").trim() || undefined,
            share: Number(s.share),
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        splits?: RoyaltySplit[]; agreementVersion?: number; error?: string; message?: string;
      };
      if (!res.ok) throw new Error(data.message || data.error || "Couldn't save the splits.");
      onUpdate({ ...release, royaltySplits: data.splits ?? splits });
      onNotice(
        data.agreementVersion && data.agreementVersion > 1
          ? `Royalty splits saved — agreement v${data.agreementVersion} applies to future earnings only. Free.`
          : "Royalty splits saved — free.",
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't save the splits.");
    } finally {
      setSplitsSaving(false);
    }
  }

  /* ── split invite (stub until an email provider is configured) ── */
  async function inviteCollaborator(split: RoyaltySplit) {
    if (!split.id || invitingId) return;
    setInvitingId(split.id);
    onError("");
    try {
      const res = await authFetch(`/api/distribution/releases/${release.id}/splits/invite`, {
        method: "POST",
        body: JSON.stringify({ splitId: split.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; recorded?: boolean };
      if (res.status === 501) {
        /* Expected until an email provider is configured: invite recorded. */
        setSplits((prev) => prev.map((x) => (x.id === split.id ? { ...x, inviteStatus: "invited" } : x)));
        onNotice(data.error ?? "Invite recorded — share the agreement link with them instead.");
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || "Couldn't record the invite.");
      setSplits((prev) => prev.map((x) => (x.id === split.id ? { ...x, inviteStatus: "invited" } : x)));
      onNotice("Invite sent to the collaborator.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't record the invite.");
    } finally {
      setInvitingId(null);
    }
  }

  /* ── split agreement share link ── */
  async function generateShareLink() {
    if (shareWorking) return;
    setShareWorking(true);
    onError("");
    try {
      const res = await authFetch(`/api/distribution/releases/${release.id}/splits/share-link`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { slug?: string; error?: string; message?: string };
      if (!res.ok || !data.slug) throw new Error(data.message || data.error || "Couldn't create the share link.");
      setShareSlug(data.slug);
      onUpdate({ ...release, splitShareSlug: data.slug });
      onNotice("Split agreement link created — free.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't create the share link.");
    } finally {
      setShareWorking(false);
    }
  }

  function copyShareLink() {
    if (!shareUrl) return;
    void navigator.clipboard?.writeText(shareUrl).then(
      () => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); },
      () => onError("Couldn't copy — long-press the link to copy it manually."),
    );
  }

  /* ── pre-save link ── */
  async function generatePresave() {
    if (presaveWorking) return;
    setPresaveWorking(true);
    onError("");
    try {
      const res = await authFetch(`/api/distribution/releases/${release.id}/presave`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { slug?: string; url?: string; error?: string; message?: string };
      if (!res.ok || !data.url) throw new Error(data.message || data.error || "Couldn't create the pre-save link.");
      setPresaveUrl(data.url);
      onUpdate({ ...release, presaveSlug: data.slug ?? release.presaveSlug });
      onNotice("Pre-save link created — free.");
      /* The pre-save page flows into the hub project — announce it from the scheduler. */
      try { addAsset({ kind: "other", url: data.url, label: `Pre-save — ${release.title || "release"}`, detail: "Distribution" }); } catch { /* non-fatal */ }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't create the pre-save link.");
    } finally {
      setPresaveWorking(false);
    }
  }

  async function copyPresave() {
    if (!presaveUrl) return;
    try {
      await navigator.clipboard.writeText(presaveUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError("Couldn't copy — select the link manually.");
    }
  }

  /* ── submit / pay ── */
  const submitPrice = pricing?.tiers.find((tr) => tr.type === release.releaseType)?.credits ?? tierCredits(release.releaseType);

  async function submitRelease() {
    if (submitting || release.status !== "draft") return;
    if (!window.confirm(
      `Submit "${release.title}" for distribution for ${submitPrice} Visual Bucs?\n\n` +
      `This pays the aggregator delivery fee and queues delivery to ${release.platforms.map(platformLabel).join(", ") || "your platforms"}.`,
    )) return;
    setSubmitting(true);
    onError("");
    try {
      const res = await authFetch(`/api/distribution/releases/${release.id}/submit`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        release?: Release; notice?: string; error?: string; message?: string;
      };
      if (handle402(data)) return;
      if (!res.ok || !data.release) {
        throw new Error(data.message || data.error || "Couldn't submit the release.");
      }
      onUpdate(data.release);
      onNotice(data.notice ?? "Release submitted — delivery queued.");
      refreshProfile();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't submit the release.");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteDraft() {
    if (deleting || release.status !== "draft") return;
    if (!window.confirm("Delete this release draft? This can't be undone.")) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/api/distribution/releases/${release.id}`, { method: "DELETE" });
      if (res.ok) {
        onNotice("Release draft deleted.");
        onDelete();
      } else {
        throw new Error("Couldn't delete the release.");
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't delete the release.");
    } finally {
      setDeleting(false);
    }
  }

  const meta = metaResult?.titleOptions ? metaResult : release.metadata;
  const strat = strategyResult?.timing ? strategyResult : release.strategy;

  return (
    <div className="space-y-6">
      {/* ── header card ── */}
      <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            {release.artworkUrl ? (
              <img src={release.artworkUrl} alt={`${release.title} artwork`} className="h-20 w-20 rounded-2xl border border-white/10 object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
                <ImageIcon className="h-8 w-8 text-white/25" />
              </div>
            )}
            <div>
              <h2 className="font-display text-2xl font-black">{release.title}</h2>
              <p className="text-sm text-white/50">{release.artistName}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 font-semibold text-white/60">
                  {tierLabel(release.releaseType)}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold ${
                  release.status === "packaged"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-white/15 bg-white/[0.04] text-white/50"
                }`}>
                  {release.status === "packaged" ? <><BadgeCheck className="h-3 w-3" />{t("distribute.submitted")}</> : "Draft"}
                </span>
                {release.explicit && (
                  <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 font-bold text-red-300">{t("distribute.explicit")}</span>
                )}
                {release.releaseDate && (
                  <span className="inline-flex items-center gap-1 text-white/40">
                    <CalendarDays className="h-3 w-3" /> {release.releaseDate}
                  </span>
                )}
              </div>
            </div>
          </div>
          {release.status === "draft" && (
            <button onClick={deleteDraft} disabled={deleting} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-300/80 hover:bg-red-500/10 disabled:opacity-50">
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete draft
            </button>
          )}
        </div>

        <div className="mt-4 grid gap-1.5 text-xs text-white/45 sm:grid-cols-2">
          {release.genre && <p><span className="text-white/30">{t("distribute.genre_2")}</span> {release.genre}{release.subgenre ? ` / ${release.subgenre}` : ""}</p>}
          {release.isrc && <p><span className="text-white/30">{t("distribute.isrc_2")}</span> {release.isrc}</p>}
          {release.upc && (
            <p><span className="text-white/30">UPC</span> {release.upc}{" "}
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                release.upcKind === "official"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-300"
              }`}>{release.upcKind === "official" ? "Official" : "Internal"}</span>
            </p>
          )}
          {release.label && <p><span className="text-white/30">{t("distribute.label")}</span> {release.labelImprint ?? release.label}</p>}
          {release.creditsCharged > 0 && <p><span className="text-white/30">{t("distribute.submission_fee_paid")}</span> {release.creditsCharged} Visual Bucs</p>}
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {release.platforms.map((p) => (
            <span key={p} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60">
              {platformLabel(p)}
            </span>
          ))}
        </div>

        {(release.audioUrl || release.artworkUrl) && (
          <div className="mt-4 space-y-1.5 text-xs text-white/45">
            {release.audioUrl && (
              <p className="flex items-center gap-1.5"><Music2 className="h-3.5 w-3.5 text-primary/70" />
                <a href={release.audioUrl} target="_blank" rel="noreferrer" className="truncate text-primary/90 hover:underline">{t("distribute.audio_file")}</a>
              </p>
            )}
            {release.artworkUrl && (
              <p className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-primary/70" />
                <a href={release.artworkUrl} target="_blank" rel="noreferrer" className="truncate text-primary/90 hover:underline">{t("distribute.artwork_file")}</a>
              </p>
            )}
          </div>
        )}

        {release.tracks?.length > 0 && (
          <div className="mt-4">
            <p className={labelClass}>{t("distribute.tracks_2")}</p>
            <ol className="space-y-1">
              {release.tracks.map((tr, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-white/70">
                  <span className="w-6 text-xs font-bold text-white/30">{i + 1}.</span>
                  <span className="flex-1 truncate">{tr.title}</span>
                  {tr.isrc && <span className="text-xs text-white/30">{tr.isrc}</span>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* ── release metadata manager (DistroKid parity) ── */}
      <ReleaseMetadataManager
        release={release}
        authFetch={authFetch}
        onUpdate={onUpdate}
        onError={onError}
        onNotice={onNotice}
        onSendToPresave={generatePresave}
      />

      {/* ── checklist ── */}
      {release.checklist?.length > 0 && (
        <Section title={t("distribute.release_checklist")} icon={<ListMusic className="h-5 w-5 text-primary" />}>
          <div id="release-checklist" className="scroll-mt-24">
          <ul className="space-y-2">
            {release.checklist.map((c) => (
              <li key={c.key} className="flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-black/40 p-3.5">
                {c.ok
                  ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                  : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />}
                <div>
                  <p className="text-sm font-semibold text-white/85">{c.label}</p>
                  {c.hint && <p className="mt-0.5 text-xs text-white/45">{c.hint}</p>}
                </div>
              </li>
            ))}
          </ul>
          </div>
        </Section>
      )}

      {/* ── platform tracker ── */}
      <Section
        title={t("distribute.platform_tracker")}
        icon={<Rocket className="h-5 w-5 text-primary" />}
        action={<SandboxBadge aggregator={release.aggregator ?? pricing?.aggregator ?? null} />}
      >
        {release.status !== "packaged" ? (
          <p className="text-sm text-white/45">{t("distribute.submit_this_release_below_and_ev")}</p>
        ) : (release.platformStatuses?.length ?? 0) === 0 ? (
          <p className="text-sm text-white/45">{t("distribute.delivery_job_queued_statuses_wil")}</p>
        ) : (
          <>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {release.platformStatuses.map((ps) => (
                <div key={ps.platform} className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-black/40 p-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{platformLabel(ps.platform)}</p>
                    {ps.detail && <p className="mt-0.5 truncate text-xs text-white/40">{ps.detail}</p>}
                    {ps.updatedAt && <p className="mt-0.5 text-[11px] text-white/25">{ps.updatedAt}</p>}
                  </div>
                  <StatusPill status={ps.status} />
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-white/35">
              Statuses refresh automatically while delivery is in progress.
              {release.aggregator === "mock" && " Sandbox mode — these statuses simulate delivery, not real platform APIs."}
            </p>
          </>
        )}
      </Section>

      {/* ── royalty splits ── */}
      <Section
        title={t("distribute.royalty_splits")}
        icon={<Users className="h-5 w-5 text-primary" />}
        action={<span className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] font-bold text-white/50">{t("distribute.free")}</span>}
        minStars={5}
      >
        <p className="mb-4 text-sm text-white/50">{t("distribute.add_collaborators_and_their_shar")}</p>
        <div className="space-y-3">
          {splits.map((s, i) => (
            <div key={s.id ?? `new-${i}`} className="rounded-2xl border border-white/10 bg-black/30 p-3">
              <div className="flex flex-wrap gap-2">
                <input
                  value={s.name}
                  onChange={(e) => setSplits((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder={t("distribute.name")}
                  className={`${inputClass} min-w-[140px] flex-1`}
                  maxLength={120}
                />
                <input
                  value={s.email ?? ""}
                  onChange={(e) => setSplits((prev) => prev.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))}
                  placeholder="Email (for invites)"
                  type="email"
                  className={`${inputClass} min-w-[160px] flex-1`}
                  maxLength={254}
                />
                <select
                  value={(s.role ?? "artist").toLowerCase()}
                  onChange={(e) => setSplits((prev) => prev.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
                  className={`${inputClass} max-w-[150px] bg-black`}
                  aria-label={`Role for collaborator ${i + 1}`}
                >
                  {SPLIT_ROLES.map((r) => (
                    <option key={r} value={r}>{roleLabel(r)}</option>
                  ))}
                </select>
                <div className="relative w-[110px] shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    value={s.share}
                    onChange={(e) => setSplits((prev) => prev.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) } : x)))}
                    placeholder="%"
                    className={`${inputClass} pr-8`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/35">%</span>
                </div>
                <button
                  onClick={() => setSplits((prev) => prev.filter((_, j) => j !== i))}
                  className="flex h-[42px] w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/30 text-red-300/80 hover:bg-red-500/10"
                  aria-label={`Remove collaborator ${i + 1}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {s.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {s.inviteStatus === "accepted" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-300">
                      <Check className="h-3 w-3" />Invite accepted
                    </span>
                  ) : s.inviteStatus === "invited" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-bold text-amber-300">
                      <Mail className="h-3 w-3" />Invite recorded
                    </span>
                  ) : (
                    <button
                      onClick={() => inviteCollaborator(s)}
                      disabled={invitingId === s.id || !(s.email ?? "").trim()}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                      title={!(s.email ?? "").trim() ? "Add an email first" : "Record an invite for this collaborator"}
                    >
                      {invitingId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                      Invite
                    </button>
                  )}
                  <span className="text-[11px] text-white/35">
                    {s.agreementVersion ? `Agreement v${s.agreementVersion}` : ""}
                    {s.effectiveFrom ? ` · effective ${s.effectiveFrom.slice(0, 10)}` : ""}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() => setSplits((prev) => [...prev, { name: "", role: "artist", email: "", share: 0 }])}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:brightness-110"
        >
          <Plus className="h-3.5 w-3.5" />{t("distribute.add_collaborator")}</button>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/40 p-4">
          <div>
            <p className={`text-sm font-bold ${valid ? "text-emerald-300" : "text-amber-300"}`}>
              Total: {Number.isFinite(total) ? total : 0}% {valid ? "— splits are balanced" : "— must equal 100%"}
            </p>
            <p className="mt-1 text-xs text-white/40">
              Editing splits creates a new agreement version — changes apply to future earnings only.
            </p>
          </div>
          <button onClick={saveSplits} disabled={splitsSaving || !valid || splits.length === 0} className={goldBtn}>
            {splitsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save splits · free
          </button>
        </div>
        <p className="mt-3 text-xs text-white/40">
          Split accounting for your logged income — automatic store payouts need a distribution partner.
        </p>

        {/* ── shareable split agreement ── */}
        <div className="mt-4 rounded-2xl border border-primary/25 bg-primary/[0.05] p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <Share2 className="h-4 w-4 text-primary" /> Split agreement link
          </p>
          {shareUrl ? (
            <div>
              <p className="mt-1 text-xs text-white/50">
                Share this with your collaborators{refCode ? " — it carries your referral link" : ""}. They see the agreed shares, nothing else.
              </p>
              <div className="mt-3 flex gap-2">
                <input value={shareUrl} readOnly className={`${inputClass} font-mono text-xs`} />
                <button onClick={copyShareLink} className={`${ghostBtn} shrink-0`}>
                  {shareCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  {shareCopied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="mt-1 text-xs text-white/50">
                Generate a public summary of this release's split agreement to share with collaborators.
              </p>
              <button onClick={generateShareLink} disabled={shareWorking || !splits.some((s) => s.id)} className={`${goldBtn} mt-3`}
                title={splits.some((s) => s.id) ? undefined : "Save your splits first"}
              >
                {shareWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                Generate agreement link · free
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* ── pre-save ── */}
      <Section
        title={t("distribute.pre_save_campaign")}
        icon={<Link2 className="h-5 w-5 text-primary" />}
        action={<span className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] font-bold text-white/50">{t("distribute.free")}</span>}
      >
        {presaveUrl ? (
          <PresaveManager
            release={release}
            presaveUrl={presaveUrl}
            copied={copied}
            authFetch={authFetch}
            onError={onError}
            onNotice={onNotice}
            copyPresave={copyPresave}
          />
        ) : (
          <div>
            <p className="text-sm text-white/55">{t("distribute.generate_a_public_pre_save_page")}</p>
            <button onClick={generatePresave} disabled={presaveWorking} className={`${goldBtn} mt-4`}>
              {presaveWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Generate pre-save link · free
            </button>
          </div>
        )}

        {/* ── promo cards handoff (Worker 7) ── */}
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] px-4 py-3">
          <p className="text-sm text-white/60">
            Turn this release into release-day social cards — announcement, out now, pre-save &amp; milestone styles.
          </p>
          <a
            href={`/promote?promoTitle=${encodeURIComponent(release.title)}&promoArtist=${encodeURIComponent(release.artistName)}${release.artworkUrl ? `&promoArt=${encodeURIComponent(release.artworkUrl)}` : ""}#promo-cards`}
            className="inline-flex items-center gap-2 rounded-xl border border-primary/50 px-4 py-2 text-sm font-black text-primary transition hover:bg-primary/10"
          >
            <Megaphone className="h-4 w-4" />
            Make promo cards · 100 Visual Bucs
          </a>
        </div>
      </Section>

      {/* ── content id protection ── */}
      <Section
        title="Content ID protection"
        icon={<ShieldCheck className="h-5 w-5 text-primary" />}
        action={<span className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] font-bold text-white/50">{t("distribute.free")}</span>}
      >
        <p className="text-sm text-white/55">
          Opt this release into YouTube Content ID monitoring — track who's using your music across YouTube.
          Setup is free; actual claims activate when our distribution partner integration goes live.
        </p>
        <a
          href={`/analytics-hub?tab=content-id&releaseId=${release.id}&title=${encodeURIComponent(release.title)}&artist=${encodeURIComponent(release.artistName ?? "")}`}
          className={`${goldBtn} mt-4`}
        >
          <ShieldCheck className="h-4 w-4" />
          Protect with Content ID · free
        </a>
      </Section>

      {/* ── Catalog Vault: permanent hosting (Leave a Legacy parity) ── */}
      <CatalogVaultPanel
        releaseId={release.id}
        releaseTitle={release.title}
        vaulted={vaulted}
        onVaulted={onVaulted}
        onOutOfCredits={onOutOfCredits}
        onError={onError}
        refreshProfile={refreshProfile}
      />

      {release.status === "draft" ? (
        <>
          {/* ── AI metadata ── */}
          <Section
            title={t("distribute.ai_release_metadata")}
            icon={<Sparkles className="h-5 w-5 text-primary" />}
            action={<span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">{t("distribute.100_visual_bucs")}</span>}
          >
            <p className="mb-4 text-sm text-white/50">{t("distribute.describe_the_song_ai_writes_stre")}</p>
            <div className="space-y-3">
              <div>
                <label className={labelClass}>{t("distribute.song_vibe")}</label>
                <input value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder={t("distribute.dark_luxury_trap_anthem_heavy_80")} className={inputClass} maxLength={500} />
              </div>
              <div>
                <label className={labelClass}>{t("distribute.lyrics")}<span className="font-normal normal-case text-white/30">{t("distribute.optional_sharpens_the_titles")}</span></label>
                <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder={t("distribute.paste_a_verse_or_hook")} rows={3} className={inputClass} maxLength={4000} />
              </div>
              <button onClick={generateMetadata} disabled={metaLoading} className={goldBtn}>
                {metaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate metadata · {pricing?.aiMetadataCost ?? AI_CREDIT_COST} Visual Buc{(pricing?.aiMetadataCost ?? AI_CREDIT_COST) === 1 ? "" : "s"}
              </button>
            </div>

            {meta?.titleOptions && (
              <div className="mt-6 space-y-4 rounded-2xl border border-primary/25 bg-black/40 p-5">
                <div>
                  <p className={labelClass}>{t("distribute.title_options")}</p>
                  <ul className="space-y-1.5">
                    {meta.titleOptions.map((t) => (
                      <li key={t} className="flex items-center gap-2 text-sm text-white/85">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> {t}
                      </li>
                    ))}
                  </ul>
                </div>
                {meta.description && (
                  <div>
                    <p className={labelClass}>{t("distribute.release_description")}</p>
                    <p className="text-sm leading-relaxed text-white/70">{meta.description}</p>
                  </div>
                )}
                {meta.genreTags && meta.genreTags.length > 0 && (
                  <div>
                    <p className={labelClass}>{t("distribute.genre_tags")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {meta.genreTags.map((g) => (
                        <span key={g} className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">{g}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(metaResult || strategyResult) && (
                  <button onClick={saveAiToRelease} className={ghostBtn}>{t("distribute.save_ai_package_to_release")}</button>
                )}
              </div>
            )}
          </Section>

          {/* ── AI strategy ── */}
          <Section
            title={t("distribute.ai_pre_release_strategy")}
            icon={<Rocket className="h-5 w-5 text-primary" />}
            action={<span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">{t("distribute.100_visual_bucs")}</span>}
          >
            <p className="mb-4 text-sm text-white/50">{t("distribute.release_timing_a_2_week_promo_pl")}</p>
            <button onClick={generateStrategy} disabled={strategyLoading} className={goldBtn}>
              {strategyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Generate strategy · {pricing?.aiStrategyCost ?? AI_CREDIT_COST} Visual Buc{(pricing?.aiStrategyCost ?? AI_CREDIT_COST) === 1 ? "" : "s"}
            </button>

            {strat?.timing && (
              <div className="mt-6 space-y-4 rounded-2xl border border-primary/25 bg-black/40 p-5">
                <div>
                  <p className={labelClass}>{t("distribute.timing")}</p>
                  <p className="text-sm leading-relaxed text-white/70">{strat.timing}</p>
                </div>
                {strat.promoPlan && strat.promoPlan.length > 0 && (
                  <div>
                    <p className={labelClass}>{t("distribute.2_week_promo_plan")}</p>
                    <ol className="list-decimal space-y-1.5 pl-5 text-sm text-white/70">
                      {strat.promoPlan.map((s, i) => (<li key={i}>{s}</li>))}
                    </ol>
                  </div>
                )}
                {strat.checklist && strat.checklist.length > 0 && (
                  <div>
                    <p className={labelClass}>{t("distribute.pre_release_checklist")}</p>
                    <ul className="space-y-1.5">
                      {strat.checklist.map((c, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(metaResult || strategyResult) && (
                  <button onClick={saveAiToRelease} className={ghostBtn}>{t("distribute.save_ai_package_to_release")}</button>
                )}
              </div>
            )}
          </Section>

          {/* ── submit / pay ── */}
          <section className="rounded-3xl border border-primary/30 bg-gradient-to-b from-[#171208] to-black p-6 md:p-8">
            <h3 className="flex items-center gap-2 font-display text-xl font-black">
              <Rocket className="h-5 w-5 text-primary" />{t("distribute.submit_this_release")}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">{t("distribute.pay_the")}<strong className="text-white/85">{tierLabel(release.releaseType)}</strong> submission fee of{" "}
              <strong className="text-primary">{submitPrice} Visual Bucs</strong> to queue delivery to{" "}
              {release.platforms.map(platformLabel).join(", ") || "your platforms"}.
              {pricing?.aggregator === "mock" && (
                <>{t("distribute.the_aggregator_is_currently_in")}<strong className="text-violet-300">{t("distribute.sandbox_mode")}</strong>{t("distribute.statuses_will_simulate_delivery")}</>
              )}
            </p>
            <button onClick={submitRelease} disabled={submitting} className={`${goldBtn} mt-5`}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Submit · {submitPrice} Visual Bucs
            </button>
          </section>
        </>
      ) : (
        <section className="rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.05] p-6 md:p-8">
          <h3 className="flex items-center gap-2 font-display text-xl font-black text-emerald-300">
            <BadgeCheck className="h-5 w-5" />{t("distribute.release_submitted")}<span className="ml-2"><SandboxBadge aggregator={release.aggregator ?? pricing?.aggregator ?? null} /></span>
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">
            "{release.title}" is with the aggregator. Watch the platform tracker above — each
            platform moves queued → pending → delivered → live. Submitted releases are locked;
            create a new release for any changes.
          </p>
        </section>
      )}
    </div>
  );
}

/* ── Plan tab (merged from the Release Checklist page) ─────────────────
   AI-powered song/album release planner. POSTs to /api/release-checklist
   at 2 credits per plan on GPT-6 Sol (registry key "/api/release-checklist";
   overrideCost used because the registry is stale at 1 — backend + UI
   agree on 2). The returned week-by-week task list is stored in
   localStorage so the artist can check items off over the coming weeks —
   task tracking itself is pure UI, so it's free. Tool hints from the
   model link out to real on-site tools; keeps its → /playlist-pitch,
   → /scheduler and → /distribute handoffs. */

type ReleasePlanType = "single" | "ep" | "album";

interface ReleasePlanTypeOpt {
  key: ReleasePlanType;
  icon: LucideIcon;
}

const RELEASE_PLAN_TYPE_OPTS: ReleasePlanTypeOpt[] = [
  { key: "single", icon: Disc3 },
  { key: "ep", icon: Layers },
  { key: "album", icon: Album },
];

const RELEASE_PLAN_CREDIT_COST = 2;

interface PlanTask {
  title: string;
  detail: string;
  category: string;
  tool: string | null;
}

interface PlanWeek {
  label: string;
  tasks: PlanTask[];
}

interface ReleasePlan {
  weeks: PlanWeek[];
  summary: string;
  preSaveTip: string;
}

interface ReleasePlanResponse {
  plan?: ReleasePlan;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

/* Tool hint → on-site destination. Only known tools get links; anything
   else renders as plain text so a model hallucination never 404s. */
const PLAN_TOOL_LINKS: Record<string, string> = {
  "playlist-pitcher": "/playlist-pitch",
  "content-scheduler": "/scheduler",
  "press-kit": "/press-kit",
  "cover-art": "/cover-art",
  "email-list": "/email-list",
};

const PLAN_CATEGORY_STYLES: Record<string, string> = {
  distribution: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  playlist: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  social: "border-pink-500/40 bg-pink-500/10 text-pink-300",
  press: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  "pre-save": "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  email: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  creative: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  "release-day": "border-primary/50 bg-primary/15 text-primary",
  "follow-up": "border-teal-500/40 bg-teal-500/10 text-teal-300",
};

function planCategoryBadge(category: string): string {
  return PLAN_CATEGORY_STYLES[category] ?? "border-white/15 bg-white/[0.05] text-white/60";
}

/* localStorage: plans persist per release so check-offs survive reloads.
   Keyed by release type + title + date so different releases don't collide. */
function planStorageKey(releaseType: string, title: string, date: string): string {
  return `release-checklist:${releaseType}:${title.trim().toLowerCase().slice(0, 40)}:${date}`;
}

function planDefaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 28);
  return d.toISOString().slice(0, 10);
}

function ReleasePlanTab() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [releaseType, setReleaseType] = useState<ReleasePlanType>("single");
  const [title, setTitle] = useState("");
  const { project } = useHubProject();
  useEffect(() => {
    if (!title && project.name) setTitle(project.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.name]);
  const [genre, setGenre] = useState("");
  const [releaseDate, setReleaseDate] = useState(planDefaultDate);

  const [plan, setPlan] = useState<ReleasePlan | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const planKey = useMemo(
    () => (plan ? planStorageKey(releaseType, title, releaseDate) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan]
  );

  /* Restore a previously generated plan + check-offs on mount (same inputs). */
  useEffect(() => {
    if (!plan) return;
    try {
      const saved = localStorage.getItem(`${planKey}:plan`);
      if (saved) setPlan(JSON.parse(saved) as ReleasePlan);
      const done = localStorage.getItem(`${planKey}:done`);
      if (done) setChecked(JSON.parse(done) as Record<string, boolean>);
    } catch {
      /* corrupted storage — start fresh */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistPlan(nextPlan: ReleasePlan) {
    const key = planStorageKey(releaseType, title, releaseDate);
    try {
      localStorage.setItem(`${key}:plan`, JSON.stringify(nextPlan));
      localStorage.setItem(`${key}:done`, JSON.stringify({}));
    } catch {
      /* storage full/blocked — plan still works for this session */
    }
  }

  function toggleTask(weekIdx: number, taskIdx: number) {
    const id = `${weekIdx}:${taskIdx}`;
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (planKey) {
        try {
          localStorage.setItem(`${planKey}:done`, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }

  const totalTasks = plan?.weeks.reduce((n, w) => n + w.tasks.length, 0) ?? 0;
  const doneCount = Object.values(checked).filter(Boolean).length;
  const progress = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  async function buildPlan() {
    if (loading || !user) return;
    const finalTitle = title.trim().slice(0, 200);
    if (!finalTitle) {
      setError(t("release.error.noTitle"));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
      setError(t("release.error.noDate"));
      return;
    }
    const ts = new Date(`${releaseDate}T00:00:00Z`).getTime();
    if (!Number.isFinite(ts) || ts <= Date.now()) {
      setError(t("release.error.pastDate"));
      return;
    }

    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/release-checklist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: RELEASE_PLAN_CREDIT_COST, // registry is stale at 1; backend + UI agree on 2
        overrideFeature: "Release Checklist AI",
        body: JSON.stringify({
          releaseType,
          title: finalTitle,
          genre: genre.trim().slice(0, 120),
          releaseDate,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as ReleasePlanResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.plan || !Array.isArray(data.plan.weeks) || data.plan.weeks.length === 0) {
        throw new Error(data.message || data.error || t("release.error.planFailed"));
      }
      setPlan(data.plan);
      setChecked({});
      persistPlan(data.plan);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("release-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("release.error.planFailed"));
    } finally {
      setLoading(false);
    }
  }

  function toolLink(tool: string | null): { path: string; label: string } | null {
    if (!tool) return null;
    const key = tool.trim().toLowerCase().replace(/^\/+/, "");
    const path = PLAN_TOOL_LINKS[key];
    if (!path) return null;
    return { path, label: t(`release.tools.${key}`) };
  }

  return (
    <div className="relative mx-auto max-w-4xl">
      {/* ── INPUTS ─────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
        {/* release type */}
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
          {t("release.whatDropping")}
        </p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {RELEASE_PLAN_TYPE_OPTS.map((opt) => {
            const Icon = opt.icon;
            const selected = releaseType === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setReleaseType(opt.key)}
                className={`rounded-2xl border p-4 text-left transition ${
                  selected
                    ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                    : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                }`}
              >
                <Icon className={`h-6 w-6 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
                <span className={`mt-2 block text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>
                  {t(`release.types.${opt.key}.label`)}
                </span>
                <span className="block text-[11px] text-white/35">{t(`release.types.${opt.key}.blurb`)}</span>
              </button>
            );
          })}
        </div>

        {/* title + genre + date */}
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("release.releaseTitle")}
            </p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={t("release.titlePlaceholder")}
              className={inputClass}
            />
          </div>
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("release.genreVibe")} <span className="font-normal normal-case text-white/30">{t("release.optional")}</span>
            </p>
            <input
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              maxLength={120}
              placeholder={t("release.genrePlaceholder")}
              className={inputClass}
            />
          </div>
        </div>
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("release.releaseDate")}
          </p>
          <input
            type="date"
            value={releaseDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setReleaseDate(e.target.value)}
            className={`${inputClass} max-w-[220px] [color-scheme:dark]`}
          />
        </div>

        {/* CTA */}
        <div className="mt-8 text-center">
          {user ? (
            <button
              onClick={buildPlan}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              ) : (
                <ListChecks className="h-6 w-6" aria-hidden="true" />
              )}
              {loading ? t("release.building") : t("release.buildPlan")}
            </button>
          ) : (
            <a
              href="/login"
              className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
            >
              <ListChecks className="h-6 w-6" aria-hidden="true" />
              {t("release.signInToBuild")}
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
          <p className="mt-2.5 text-xs text-white/35">
            {t("release.costNote", { cost: RELEASE_PLAN_CREDIT_COST })}
          </p>
          {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
          {error && !outOfCredits && (
            <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* ── RESULTS ────────────────────────────────────────────────── */}
      {plan && plan.weeks.length > 0 && (
        <div id="release-results" className="relative mt-8">
          {plan.summary && (
            <p className="mx-auto max-w-2xl text-center text-[15px] leading-relaxed text-white/70">
              {plan.summary}
            </p>
          )}

          {/* progress */}
          <div className="mt-6 rounded-2xl border border-primary/25 bg-primary/[0.06] p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-white">
                {t("release.tasksDone", { done: doneCount, total: totalTasks })}
              </p>
              <p className="font-display text-2xl font-black text-primary">{progress}%</p>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#8a6d1f] via-primary to-[#f5d67b] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* weeks */}
          {plan.weeks.map((week, wi) => {
            const weekDone = week.tasks.filter((_, ti) => checked[`${wi}:${ti}`]).length;
            return (
              <div key={`week-${wi}`} className="mt-8">
                <p className="mb-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-widest text-primary/80">
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    {week.label}
                  </span>
                  <span className="text-white/35">
                    {weekDone}/{week.tasks.length}
                  </span>
                </p>
                <div className="grid gap-2.5">
                  {week.tasks.map((task, ti) => {
                    const id = `${wi}:${ti}`;
                    const done = !!checked[id];
                    const link = toolLink(task.tool);
                    return (
                      <div
                        key={id}
                        className={`rounded-2xl border p-4 transition ${
                          done
                            ? "border-emerald-500/25 bg-emerald-500/[0.05]"
                            : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <button
                          onClick={() => toggleTask(wi, ti)}
                          className="flex w-full items-start gap-3 text-left"
                        >
                          {done ? (
                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
                          ) : (
                            <Circle className="mt-0.5 h-5 w-5 shrink-0 text-white/25" aria-hidden="true" />
                          )}
                          <span className="flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className={`text-[15px] font-bold ${done ? "text-white/45 line-through" : "text-white"}`}>
                                {task.title}
                              </span>
                              <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${planCategoryBadge(task.category)}`}>
                                {task.category}
                              </span>
                            </span>
                            <span className={`mt-1 block text-sm leading-relaxed ${done ? "text-white/30" : "text-white/60"}`}>
                              {task.detail}
                            </span>
                          </span>
                        </button>
                        {link && !done && (
                          <a
                            href={link.path}
                            className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-xs font-bold text-primary transition hover:bg-primary hover:text-black"
                          >
                            {link.label}
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* pre-save tip */}
          {plan.preSaveTip && (
            <div className="mt-8 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-300">
                {t("release.preSaveTitle")}
              </p>
              <p className="mt-1.5 text-[15px] leading-relaxed text-white/85">{plan.preSaveTip}</p>
            </div>
          )}

          {user && (
            <div className="mt-6 text-center">
              <button
                onClick={buildPlan}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                )}
                {t("release.rebuild", { cost: RELEASE_PLAN_CREDIT_COST })}
              </button>
            </div>
          )}
        </div>
      )}

      {/* cross-links — keeps the playlist-pitch / scheduler / distribute handoffs */}
      <p className="relative mt-8 text-center text-sm text-white/40">
        {t("release.crossLinks.p1")}{" "}
        <a href={`/playlist-pitch?song=${encodeURIComponent(title.trim())}`} className="font-semibold text-primary hover:underline">
          {t("release.crossLinks.playlistPitcher")}
        </a>
        {" "}{t("release.crossLinks.p2")}{" "}
        <a href="/scheduler" className="font-semibold text-primary hover:underline">
          {t("release.crossLinks.scheduler")}
        </a>
        {t("release.crossLinks.p3")}{" "}
        <a href={`/distribute?title=${encodeURIComponent(title.trim())}`} className="font-semibold text-primary hover:underline">
          {t("release.crossLinks.distribute", { defaultValue: "distribute it" })}
        </a>
      </p>
    </div>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */

export default function Distribute() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();

  const [tab, setTab] = useState<"releases" | "new" | "plan">(() => {
    try { return new URLSearchParams(window.location.search).get("tab") === "plan" ? "plan" : "releases"; } catch { return "releases"; }
  });
  const [releases, setReleases] = useState<Release[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [pricing, setPricing] = useState<PricingInfo | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  /* Catalog Vault: release ids with the permanent-hosting purchase (gold badge). */
  const [vaultedIds, setVaultedIds] = useState<Set<string>>(new Set());

  const selected = releases.find((r) => r.id === selectedId) ?? null;

  const authFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken();
      return fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
    },
    [getAccessToken],
  );

  const loadReleases = useCallback(async () => {
    if (!user) { setListLoading(false); return; }
    setListLoading(true);
    try {
      const res = await authFetch("/api/distribution/releases");
      const data = (await res.json().catch(() => ({}))) as { releases?: Release[] };
      if (res.ok && Array.isArray(data.releases)) {
        setReleases(data.releases);
        if (!selectedId && data.releases.length > 0) setSelectedId(data.releases[0]!.id);
      }
    } catch {
      /* non-fatal — the page still renders the wizard */
    } finally {
      setListLoading(false);
    }
  }, [user, authFetch, selectedId]);

  useEffect(() => { void loadReleases(); }, [loadReleases]);

  /* Deep-link: /distribute?release=<id>#release-checklist (from the Release
     Metadata Manager's "Add to Release Checklist") selects the release and
     scrolls to its checklist. */
  const [deepReleaseId] = useState<string | null>(() => {
    try { return new URLSearchParams(window.location.search).get("release"); } catch { return null; }
  });
  const [deepScrolled, setDeepScrolled] = useState(false);
  useEffect(() => {
    if (!deepReleaseId || deepScrolled || releases.length === 0) return;
    if (releases.some((r) => r.id === deepReleaseId)) {
      setSelectedId(deepReleaseId);
      setTab("releases");
      const hash = window.location.hash;
      try { window.history.replaceState(null, "", window.location.pathname + hash); } catch { /* ignore */ }
      if (hash === "#release-checklist") {
        setTimeout(() => {
          document.getElementById("release-checklist")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 400);
      }
      setDeepScrolled(true);
    }
  }, [deepReleaseId, deepScrolled, releases]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/distribution/pricing");
        const data = (await res.json().catch(() => ({}))) as Partial<PricingInfo>;
        if (!cancelled && res.ok && Array.isArray(data.tiers)) {
          setPricing({
            tiers: data.tiers,
            annualPlan: data.annualPlan ?? null,
            aiMetadataCost: data.aiMetadataCost ?? 1,
            aiStrategyCost: data.aiStrategyCost ?? 1,
            aggregator: data.aggregator ?? "mock",
          });
        }
      } catch {
        /* pricing falls back to the lib constants */
      }
    })();
    return () => { cancelled = true; };
  }, [authFetch]);

  /* Catalog Vault status: which of this user's releases are vaulted. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) return;
      try {
        const res = await authFetch("/api/catalog-vault/status");
        const data = (await res.json().catch(() => ({}))) as { vaults?: { releaseId: string }[] };
        if (!cancelled && res.ok && Array.isArray(data.vaults)) {
          setVaultedIds(new Set(data.vaults.map((v) => v.releaseId)));
        }
      } catch {
        /* non-fatal — the vault panel still renders per-release */
      }
    })();
    return () => { cancelled = true; };
  }, [user, authFetch]);

  const clearBanners = () => { setError(null); setNotice(null); setOutOfCredits(false); };

  function handleWizardDone(release: Release, wizardNotice: string | null, paid: boolean) {
    setReleases((prev) => {
      const exists = prev.some((r) => r.id === release.id);
      return exists ? prev.map((r) => (r.id === release.id ? release : r)) : [release, ...prev];
    });
    setSelectedId(release.id);
    if (wizardNotice) setNotice(wizardNotice);
    else if (paid) setNotice("Release submitted — delivery queued. Track every platform above.");
    else setNotice("Release draft created — free. It still needs submission before it delivers.");
    setTab("releases");
  }

  return (
    <div className="min-h-screen bg-black text-white">

      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-14 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Disc3 className="h-3 w-3" aria-hidden="true" />{t("distribute.thy_cheat_code_s_distribution_hu")}</p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">{t("distribute.music")}<span className="text-primary">{t("distribute.distribution")}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">{t("distribute.get_your_music_on_spotify_apple")}</p>
          {pricing?.annualPlan?.comingSoon && (
            <p className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold text-white/45">
              <Clock className="h-3 w-3" /> {pricing.annualPlan.label} — coming soon
            </p>
          )}
        </div>

        {error && (
          <div className="relative mx-auto mt-6 flex max-w-4xl items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}
        {notice && (
          <div className="relative mx-auto mt-6 flex max-w-4xl items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{notice}</p>
          </div>
        )}
        {outOfCredits && (
          <div className="relative mx-auto mt-6 max-w-4xl">
            <OutOfCredits />
          </div>
        )}

        {/* The Plan tab (merged Release Checklist) renders for signed-out
            visitors too — it has its own sign-in CTA like the old page did. */}
        {tab === "plan" ? (
          <div className="relative mt-10">
            {/* tabs */}
            <div className="mb-8 flex justify-center">
              <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
                {(["releases", "new", "plan"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTab(t); clearBanners(); }}
                    className={`rounded-xl px-6 py-2.5 text-sm font-bold transition ${
                      tab === t ? "bg-primary text-black" : "text-white/55 hover:text-white"
                    }`}
                  >
                    {t === "releases" ? "My Releases" : t === "new" ? "New Release" : "Plan"}
                  </button>
                ))}
              </div>
            </div>
            <ReleasePlanTab />
          </div>
        ) : !user ? (
          <div className="relative mx-auto mt-10 max-w-xl rounded-3xl border border-white/10 bg-white/[0.02] p-10 text-center">
            <p className="text-white/60">{t("distribute.sign_in_to_distribute_your_music")}</p>
            <a href="/login" className={`${goldBtn} mt-6`}>{t("distribute.sign_in")}</a>
          </div>
        ) : (
          <div className="relative mt-10">
            {/* tabs — the Plan tab lives in the outer branch (signed-out friendly) */}
            <div className="mb-8 flex justify-center">
              <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
                {(["releases", "new", "plan"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTab(t); clearBanners(); }}
                    className={`rounded-xl px-6 py-2.5 text-sm font-bold transition ${
                      tab === t ? "bg-primary text-black" : "text-white/55 hover:text-white"
                    }`}
                  >
                    {t === "releases" ? "My Releases" : t === "new" ? "New Release" : "Plan"}
                  </button>
                ))}
              </div>
            </div>

            {tab === "new" ? (
              <NewReleaseWizard
                pricing={pricing}
                authFetch={authFetch}
                onDone={handleWizardDone}
                onError={(m) => { setError(m || null); if (m) setNotice(null); }}
                onOutOfCredits={() => { setOutOfCredits(true); }}
                refreshProfile={refreshProfile}
              />
            ) : (
              <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
                {/* ── release list ── */}
                <div>
                  <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/60">
                        <ListMusic className="h-4 w-4 text-primary" />{t("distribute.releases")}</h2>
                      <button onClick={() => { setTab("new"); clearBanners(); }} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black hover:brightness-110">
                        <Plus className="h-3.5 w-3.5" />{t("distribute.new")}</button>
                    </div>

                    {listLoading ? (
                      <p className="py-6 text-center text-sm text-white/40">{t("distribute.loading_releases")}</p>
                    ) : releases.length === 0 ? (
                      <p className="py-6 text-center text-sm text-white/40">{t("distribute.no_releases_yet_hit")}<strong className="text-white/70">{t("distribute.new_release")}</strong>{t("distribute.setup_is_free")}</p>
                    ) : (
                      <ul className="space-y-2">
                        {releases.map((r) => {
                          const liveCount = (r.platformStatuses ?? []).filter((s) => s.status === "live").length;
                          return (
                            <li key={r.id}>
                              <button
                                onClick={() => { setSelectedId(r.id); clearBanners(); }}
                                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                                  selectedId === r.id ? "border-primary/50 bg-primary/[0.07]" : "border-white/10 bg-black/40 hover:border-white/25"
                                }`}
                              >
                                <Disc3 className={`h-8 w-8 shrink-0 ${selectedId === r.id ? "text-primary" : "text-white/30"}`} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-bold">{r.title}</span>
                                  <span className="block truncate text-xs text-white/40">
                                    {r.artistName} · {tierLabel(r.releaseType)}
                                    {r.status === "packaged" && liveCount > 0 ? ` · ${liveCount} live` : ""}
                                  </span>
                                </span>
                                {vaultedIds.has(r.id) && (
                                  <Vault className="h-4 w-4 shrink-0 text-primary" aria-label={t("catalogVault.vaulted")} />
                                )}
                                {r.status === "packaged"
                                  ? <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-label={t("distribute.submitted")} />
                                  : <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                {/* ── release detail ── */}
                <div>
                  {!selected ? (
                    <div className="flex h-full min-h-[320px] items-center justify-center rounded-3xl border border-white/10 bg-white/[0.02] p-10 text-center text-sm text-white/40">{t("distribute.pick_a_release_on_the_left_or_cr")}</div>
                  ) : (
                    <ReleaseDetail
                      key={selected.id}
                      release={selected}
                      pricing={pricing}
                      authFetch={authFetch}
                      onUpdate={(r) => setReleases((prev) => prev.map((x) => (x.id === r.id ? r : x)))}
                      onDelete={() => { setReleases((prev) => prev.filter((x) => x.id !== selected.id)); setSelectedId(null); }}
                      onError={(m) => { setError(m || null); if (m) setNotice(null); }}
                      onNotice={(m) => { setNotice(m); setError(null); }}
                      onOutOfCredits={() => setOutOfCredits(true)}
                      refreshProfile={refreshProfile}
                      vaulted={vaultedIds.has(selected.id)}
                      onVaulted={(id) => setVaultedIds((prev) => new Set(prev).add(id))}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>


    </div>
  );
}
