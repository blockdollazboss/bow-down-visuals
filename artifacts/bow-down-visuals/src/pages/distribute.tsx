import { useCallback, useEffect, useState } from "react";
import {
  Disc3, Sparkles, Loader2, Plus, Trash2, Rocket, CheckCircle2,
  AlertTriangle, CalendarDays, Music2, Image as ImageIcon, Link2,
  ListMusic, ChevronRight, BadgeCheck, ArrowLeft, ArrowRight,
  Users, Copy, Check, FlaskConical, Clock, Hourglass, X, Tag, Hash,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
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
  type DistributionPlatformKey,
  type DistributionTier,
  type RoyaltySplit,
} from "@/lib/distribution";
import { CheatCodeName } from "@/components/pixel-headline";

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
  label: string | null;
  tracks: ReleaseTrack[];
  audioUrl: string | null;
  artworkUrl: string | null;
  status: "draft" | "packaged";
  aggregator: string | null;
  presaveSlug: string | null;
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
  if (aggregator !== "mock") return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-violet-300">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Sandbox simulation
    </span>
  );
}

function Section({ title, icon, children, action }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
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
  const { pricing, authFetch, onDone, onError, onOutOfCredits, refreshProfile } = props;

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

  const tierPrice = pricing?.tiers.find((t) => t.type === releaseType)?.credits ?? tierCredits(releaseType);

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
    if (!window.confirm(`Generate cover art (${model.credits} credits)?`)) return;
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
          throw new Error(pd.error || "Image generation failed — no credits charged.");
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
    { ok: tracks.length > 0 && tracks.every((t) => t.title.trim().length > 0), label: "Every track has a title" },
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
        tracks: tracks.map((t) => ({ title: t.title.trim(), ...(t.isrc?.trim() ? { isrc: t.isrc.trim() } : {}) })),
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
        <h3 className="mt-4 font-display text-2xl font-black text-emerald-300">Release submitted</h3>
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
            <FlaskConical className="h-4 w-4" /> Sandbox mode — statuses will simulate delivery.
          </p>
        )}
      </div>
    );
  }

  const tierCards = (pricing?.tiers.length ? pricing.tiers : [...DISTRIBUTION_TIERS]).map((t) => ({
    type: t.type,
    credits: t.credits,
    label: t.label,
    blurb: t.blurb,
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
        <Section title="Pick your music" icon={<Music2 className="h-5 w-5 text-primary" />}>
          <p className={labelClass}>From your song library <span className="font-normal normal-case text-white/30">(free — selecting one prefills title + audio)</span></p>
          {songsLoading ? (
            <p className="py-6 text-center text-sm text-white/40"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></p>
          ) : songs.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white/40">
              No songs in your library yet. Generate one on the Make Song page, or use a manual audio URL below.
            </p>
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
            <p className={labelClass}>Or paste a manual audio URL</p>
            <input
              value={audioUrl}
              onChange={(e) => { setAudioUrl(e.target.value); if (e.target.value !== "") setSongId(null); }}
              placeholder="https://…/track.mp3"
              className={inputClass}
            />
          </div>

          <div className="mt-6 flex justify-end">
            <button onClick={() => setStep(1)} className={goldBtn}>
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </Section>
      )}

      {/* ── step 2: metadata ── */}
      {step === 1 && (
        <Section title="Release metadata" icon={<Tag className="h-5 w-5 text-primary" />}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>Release title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Midnight Frequencies" className={inputClass} maxLength={200} />
            </div>
            <div>
              <label className={labelClass}>Artist name *</label>
              <input value={artistName} onChange={(e) => setArtistName(e.target.value)} placeholder="Shark King" className={inputClass} maxLength={120} />
            </div>
          </div>

          <div className="mt-5">
            <label className={labelClass}>Release type *</label>
            <div className="grid gap-2 md:grid-cols-3">
              {tierCards.map((t) => (
                <button
                  key={t.type}
                  onClick={() => setReleaseType(t.type as DistributionTier)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    releaseType === t.type ? "border-primary/60 bg-primary/[0.08]" : "border-white/10 bg-black/40 hover:border-white/25"
                  }`}
                >
                  <p className="flex items-center justify-between text-sm font-black">
                    {t.label}
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">{t.credits} cr</span>
                  </p>
                  <p className="mt-1 text-xs text-white/45">{t.blurb}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>Genre</label>
              <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Hip-Hop / Trap" className={inputClass} maxLength={80} />
            </div>
            <div>
              <label className={labelClass}>Release date *</label>
              <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>ISRC <span className="font-normal normal-case text-white/30">(optional)</span></label>
              <input value={isrc} onChange={(e) => setIsrc(e.target.value)} placeholder="US-XXX-26-00001" className={inputClass} maxLength={20} />
            </div>
            <div>
              <label className={labelClass}>Record label <span className="font-normal normal-case text-white/30">(optional)</span></label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Bow Down Records" className={inputClass} maxLength={120} />
            </div>
          </div>

          {/* explicit declaration — required */}
          <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] p-5">
            <p className={labelClass}>Explicit content — required declaration</p>
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
              />
              I confirm this declaration is accurate for every track on this release.
            </label>
          </div>

          {/* tracks */}
          <div className="mt-5">
            <p className={labelClass}>
              Tracks * <span className="font-normal normal-case text-white/30">
                (EP: 2–5 tracks · Album: 6+ tracks)
              </span>
            </p>
            <div className="space-y-2">
              {tracks.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <span className="flex h-[42px] w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/40 text-xs font-bold text-white/40">
                    {i + 1}
                  </span>
                  <input
                    value={t.title}
                    onChange={(e) => setTracks((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    placeholder={`Track ${i + 1} title`}
                    className={inputClass}
                    maxLength={200}
                  />
                  <input
                    value={t.isrc ?? ""}
                    onChange={(e) => setTracks((prev) => prev.map((x, j) => (j === i ? { ...x, isrc: e.target.value } : x)))}
                    placeholder="ISRC"
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
              <Plus className="h-3.5 w-3.5" /> Add track
            </button>
          </div>

          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(0)} className={ghostBtn}><ArrowLeft className="h-4 w-4" /> Back</button>
            <button onClick={() => setStep(2)} className={goldBtn}>Continue <ArrowRight className="h-4 w-4" /></button>
          </div>
        </Section>
      )}

      {/* ── step 3: cover art ── */}
      {step === 2 && (
        <Section title="Cover art" icon={<ImageIcon className="h-5 w-5 text-primary" />}>
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex h-44 w-44 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              {artworkUrl
                ? <img src={artworkUrl} alt="Cover art preview" className="h-full w-full object-cover" />
                : <ImageIcon className="h-12 w-12 text-white/20" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className={labelClass}>Paste an image URL</p>
              <input value={artworkUrl} onChange={(e) => setArtworkUrl(e.target.value)} placeholder="https://…/cover.jpg" className={inputClass} />
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-primary/25 bg-black/40 p-5">
            <p className={`${labelClass} flex items-center gap-2`}>
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Or generate with AI
            </p>
            <textarea
              value={artPrompt}
              onChange={(e) => setArtPrompt(e.target.value)}
              placeholder="Luxury gold-and-black album cover, shark king silhouette rising from waves, cinematic, dramatic lighting…"
              rows={3}
              className={inputClass}
              maxLength={1000}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="flex gap-2">
                {ART_MODELS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setArtModel(m.value)}
                    title={m.note}
                    className={`rounded-xl border px-4 py-2 text-xs font-bold transition ${
                      artModel === m.value ? "border-primary/60 bg-primary/[0.08] text-primary" : "border-white/15 text-white/50 hover:border-white/40"
                    }`}
                  >
                    {m.label} · {m.credits} cr
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
            <button onClick={() => setStep(1)} className={ghostBtn}><ArrowLeft className="h-4 w-4" /> Back</button>
            <button onClick={() => setStep(3)} className={goldBtn}>Continue <ArrowRight className="h-4 w-4" /></button>
          </div>
        </Section>
      )}

      {/* ── step 4: platforms ── */}
      {step === 3 && (
        <Section title="Platforms" icon={<Rocket className="h-5 w-5 text-primary" />}>
          <p className="mb-4 text-sm text-white/50">Where should this release land? Every platform is included in the tier price.</p>
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
            <button onClick={() => setStep(2)} className={ghostBtn}><ArrowLeft className="h-4 w-4" /> Back</button>
            <button onClick={() => setStep(4)} className={goldBtn}>Review <ArrowRight className="h-4 w-4" /></button>
          </div>
        </Section>
      )}

      {/* ── step 5: review & pay ── */}
      {step === 4 && (
        <Section title="Review & pay" icon={<BadgeCheck className="h-5 w-5 text-primary" />}>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2 text-sm">
              <p><span className="text-white/40">Title:</span> <strong>{title || "—"}</strong></p>
              <p><span className="text-white/40">Artist:</span> <strong>{artistName || "—"}</strong></p>
              <p><span className="text-white/40">Type:</span> <strong>{tierLabel(releaseType)}</strong> · {tracks.length} track{tracks.length === 1 ? "" : "s"}</p>
              <p><span className="text-white/40">Release date:</span> <strong>{releaseDate || "—"}</strong></p>
              <p><span className="text-white/40">Genre:</span> <strong>{genre || "—"}</strong></p>
              <p><span className="text-white/40">Content:</span> <strong>{explicit === null ? "—" : explicit ? "Explicit" : "Clean"}</strong></p>
              <p><span className="text-white/40">ISRC:</span> <strong>{isrc || "—"}</strong></p>
              <p><span className="text-white/40">Label:</span> <strong>{label || "—"}</strong></p>
              <p><span className="text-white/40">Platforms:</span> <strong>{platforms.map(platformLabel).join(", ") || "—"}</strong></p>
            </div>
            <div className="flex items-center gap-4">
              {artworkUrl
                ? <img src={artworkUrl} alt="Cover art" className="h-32 w-32 rounded-2xl border border-white/10 object-cover" />
                : <div className="flex h-32 w-32 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]"><ImageIcon className="h-10 w-10 text-white/20" /></div>}
              <div className="text-sm text-white/50">
                <p className="flex items-center gap-1.5"><Hash className="h-3.5 w-3.5 text-primary/70" /> {tracks.length} track{tracks.length === 1 ? "" : "s"}</p>
                <p className="mt-1 flex items-center gap-1.5"><Music2 className="h-3.5 w-3.5 text-primary/70" /> {audioUrl ? "Audio attached" : "No audio"}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-5">
            <p className={labelClass}>Release checklist</p>
            <ul className="space-y-1.5">
              {validation.map((v) => (
                <li key={v.label} className={`flex items-start gap-2 text-sm ${v.ok ? "text-white/75" : "text-red-300"}`}>
                  {v.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                  {v.label}
                </li>
              ))}
              {warnings.map((w) => (
                <li key={w.label} className="flex items-start gap-2 text-sm text-amber-300/90">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/30 bg-primary/[0.05] p-5">
            <div>
              <p className="text-sm text-white/50">Submission fee · {tierLabel(releaseType)}</p>
              <p className="font-display text-3xl font-black text-primary">{tierPrice} <span className="text-base">credits</span></p>
              {pricing?.aggregator === "mock" && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-violet-300">
                  <FlaskConical className="h-3.5 w-3.5" /> Sandbox mode — statuses will simulate delivery.
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(3)} className={ghostBtn} disabled={creating}><ArrowLeft className="h-4 w-4" /> Back</button>
              <button onClick={createAndSubmit} disabled={creating || !canSubmit} className={goldBtn}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Create & pay {tierPrice} credits
              </button>
            </div>
          </div>
          {!canSubmit && (
            <p className="mt-3 text-xs text-red-300/80">Finish the checklist items above to unlock submission.</p>
          )}
        </Section>
      )}
    </div>
  );
}

/* ── Release detail ──────────────────────────────────────────────────────── */

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
}) {
  const { release, pricing, authFetch, onUpdate, onDelete, onError, onNotice, onOutOfCredits, refreshProfile } = props;

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
        body: JSON.stringify({ splits: splits.map((s) => ({ name: s.name.trim(), role: s.role?.trim() || undefined, share: Number(s.share) })) }),
      });
      const data = (await res.json().catch(() => ({}))) as { splits?: RoyaltySplit[]; error?: string; message?: string };
      if (!res.ok) throw new Error(data.message || data.error || "Couldn't save the splits.");
      onUpdate({ ...release, royaltySplits: data.splits ?? splits });
      onNotice("Royalty splits saved — free.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't save the splits.");
    } finally {
      setSplitsSaving(false);
    }
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
  const submitPrice = pricing?.tiers.find((t) => t.type === release.releaseType)?.credits ?? tierCredits(release.releaseType);

  async function submitRelease() {
    if (submitting || release.status !== "draft") return;
    if (!window.confirm(
      `Submit "${release.title}" for distribution for ${submitPrice} credits?\n\n` +
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
                  {release.status === "packaged" ? <><BadgeCheck className="h-3 w-3" /> Submitted</> : "Draft"}
                </span>
                {release.explicit && (
                  <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 font-bold text-red-300">Explicit</span>
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
          {release.genre && <p><span className="text-white/30">Genre:</span> {release.genre}</p>}
          {release.isrc && <p><span className="text-white/30">ISRC:</span> {release.isrc}</p>}
          {release.label && <p><span className="text-white/30">Label:</span> {release.label}</p>}
          {release.creditsCharged > 0 && <p><span className="text-white/30">Submission fee paid:</span> {release.creditsCharged} credits</p>}
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
                <a href={release.audioUrl} target="_blank" rel="noreferrer" className="truncate text-primary/90 hover:underline">Audio file</a>
              </p>
            )}
            {release.artworkUrl && (
              <p className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-primary/70" />
                <a href={release.artworkUrl} target="_blank" rel="noreferrer" className="truncate text-primary/90 hover:underline">Artwork file</a>
              </p>
            )}
          </div>
        )}

        {release.tracks?.length > 0 && (
          <div className="mt-4">
            <p className={labelClass}>Tracks</p>
            <ol className="space-y-1">
              {release.tracks.map((t, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-white/70">
                  <span className="w-6 text-xs font-bold text-white/30">{i + 1}.</span>
                  <span className="flex-1 truncate">{t.title}</span>
                  {t.isrc && <span className="text-xs text-white/30">{t.isrc}</span>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* ── checklist ── */}
      {release.checklist?.length > 0 && (
        <Section title="Release checklist" icon={<ListMusic className="h-5 w-5 text-primary" />}>
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
        </Section>
      )}

      {/* ── platform tracker ── */}
      <Section
        title="Platform tracker"
        icon={<Rocket className="h-5 w-5 text-primary" />}
        action={<SandboxBadge aggregator={release.aggregator ?? pricing?.aggregator ?? null} />}
      >
        {release.status !== "packaged" ? (
          <p className="text-sm text-white/45">
            Submit this release below and every platform's delivery status will appear here,
            moving queued → pending → delivered → live.
          </p>
        ) : (release.platformStatuses?.length ?? 0) === 0 ? (
          <p className="text-sm text-white/45">Delivery job queued — statuses will appear here as the aggregator picks the release up.</p>
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
        title="Royalty splits"
        icon={<Users className="h-5 w-5 text-primary" />}
        action={<span className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] font-bold text-white/50">Free</span>}
      >
        <p className="mb-4 text-sm text-white/50">
          Add collaborators and their share of royalties. Shares must total exactly 100%.
        </p>
        <div className="space-y-2">
          {splits.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={s.name}
                onChange={(e) => setSplits((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                placeholder="Name"
                className={inputClass}
                maxLength={120}
              />
              <input
                value={s.role ?? ""}
                onChange={(e) => setSplits((prev) => prev.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
                placeholder="Role (producer, feature…)"
                className={`${inputClass} max-w-[170px]`}
                maxLength={80}
              />
              <div className="relative max-w-[110px] shrink-0">
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
          ))}
        </div>
        <button
          onClick={() => setSplits((prev) => [...prev, { name: "", role: "", share: 0 }])}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:brightness-110"
        >
          <Plus className="h-3.5 w-3.5" /> Add collaborator
        </button>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/40 p-4">
          <p className={`text-sm font-bold ${valid ? "text-emerald-300" : "text-amber-300"}`}>
            Total: {Number.isFinite(total) ? total : 0}% {valid ? "— splits are balanced" : "— must equal 100%"}
          </p>
          <button onClick={saveSplits} disabled={splitsSaving || !valid || splits.length === 0} className={goldBtn}>
            {splitsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save splits · free
          </button>
        </div>
      </Section>

      {/* ── pre-save ── */}
      <Section
        title="Pre-save campaign"
        icon={<Link2 className="h-5 w-5 text-primary" />}
        action={<span className="rounded-full bg-white/[0.05] px-3 py-1 text-[11px] font-bold text-white/50">Free</span>}
      >
        {presaveUrl ? (
          <div>
            <p className="text-sm text-white/55">
              Share this link — it goes live for fans on your release date ({release.releaseDate ?? "not set yet"}).
            </p>
            <div className="mt-3 flex gap-2">
              <input value={presaveUrl} readOnly className={`${inputClass} font-mono text-xs`} />
              <button onClick={copyPresave} className={`${ghostBtn} shrink-0`}>
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-white/55">
              Generate a public pre-save page fans can hit before launch day. It goes live for fans on your release date.
            </p>
            <button onClick={generatePresave} disabled={presaveWorking} className={`${goldBtn} mt-4`}>
              {presaveWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Generate pre-save link · free
            </button>
          </div>
        )}
      </Section>

      {release.status === "draft" ? (
        <>
          {/* ── AI metadata ── */}
          <Section
            title="AI Release Metadata"
            icon={<Sparkles className="h-5 w-5 text-primary" />}
            action={<span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">1 credit</span>}
          >
            <p className="mb-4 text-sm text-white/50">
              Describe the song — AI writes streaming-ready title options, a release description, and genre tags.
            </p>
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Song vibe</label>
                <input value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder="Dark luxury trap anthem, heavy 808s, triumphant energy…" className={inputClass} maxLength={500} />
              </div>
              <div>
                <label className={labelClass}>Lyrics <span className="font-normal normal-case text-white/30">(optional — sharpens the titles)</span></label>
                <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Paste a verse or hook…" rows={3} className={inputClass} maxLength={4000} />
              </div>
              <button onClick={generateMetadata} disabled={metaLoading} className={goldBtn}>
                {metaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate metadata · {pricing?.aiMetadataCost ?? AI_CREDIT_COST} credit{(pricing?.aiMetadataCost ?? AI_CREDIT_COST) === 1 ? "" : "s"}
              </button>
            </div>

            {meta?.titleOptions && (
              <div className="mt-6 space-y-4 rounded-2xl border border-primary/25 bg-black/40 p-5">
                <div>
                  <p className={labelClass}>Title options</p>
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
                    <p className={labelClass}>Release description</p>
                    <p className="text-sm leading-relaxed text-white/70">{meta.description}</p>
                  </div>
                )}
                {meta.genreTags && meta.genreTags.length > 0 && (
                  <div>
                    <p className={labelClass}>Genre tags</p>
                    <div className="flex flex-wrap gap-1.5">
                      {meta.genreTags.map((g) => (
                        <span key={g} className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">{g}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(metaResult || strategyResult) && (
                  <button onClick={saveAiToRelease} className={ghostBtn}>Save AI package to release</button>
                )}
              </div>
            )}
          </Section>

          {/* ── AI strategy ── */}
          <Section
            title="AI Pre-Release Strategy"
            icon={<Rocket className="h-5 w-5 text-primary" />}
            action={<span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">1 credit</span>}
          >
            <p className="mb-4 text-sm text-white/50">
              Release timing, a 2-week promo plan, and a must-do checklist — tailored to this release.
            </p>
            <button onClick={generateStrategy} disabled={strategyLoading} className={goldBtn}>
              {strategyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Generate strategy · {pricing?.aiStrategyCost ?? AI_CREDIT_COST} credit{(pricing?.aiStrategyCost ?? AI_CREDIT_COST) === 1 ? "" : "s"}
            </button>

            {strat?.timing && (
              <div className="mt-6 space-y-4 rounded-2xl border border-primary/25 bg-black/40 p-5">
                <div>
                  <p className={labelClass}>Timing</p>
                  <p className="text-sm leading-relaxed text-white/70">{strat.timing}</p>
                </div>
                {strat.promoPlan && strat.promoPlan.length > 0 && (
                  <div>
                    <p className={labelClass}>2-week promo plan</p>
                    <ol className="list-decimal space-y-1.5 pl-5 text-sm text-white/70">
                      {strat.promoPlan.map((s, i) => (<li key={i}>{s}</li>))}
                    </ol>
                  </div>
                )}
                {strat.checklist && strat.checklist.length > 0 && (
                  <div>
                    <p className={labelClass}>Pre-release checklist</p>
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
                  <button onClick={saveAiToRelease} className={ghostBtn}>Save AI package to release</button>
                )}
              </div>
            )}
          </Section>

          {/* ── submit / pay ── */}
          <section className="rounded-3xl border border-primary/30 bg-gradient-to-b from-[#171208] to-black p-6 md:p-8">
            <h3 className="flex items-center gap-2 font-display text-xl font-black">
              <Rocket className="h-5 w-5 text-primary" /> Submit this release
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">
              Pay the <strong className="text-white/85">{tierLabel(release.releaseType)}</strong> submission fee of{" "}
              <strong className="text-primary">{submitPrice} credits</strong> to queue delivery to{" "}
              {release.platforms.map(platformLabel).join(", ") || "your platforms"}.
              {pricing?.aggregator === "mock" && (
                <> The aggregator is currently in <strong className="text-violet-300">sandbox mode</strong> — statuses will simulate delivery.</>
              )}
            </p>
            <button onClick={submitRelease} disabled={submitting} className={`${goldBtn} mt-5`}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Submit · {submitPrice} credits
            </button>
          </section>
        </>
      ) : (
        <section className="rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.05] p-6 md:p-8">
          <h3 className="flex items-center gap-2 font-display text-xl font-black text-emerald-300">
            <BadgeCheck className="h-5 w-5" /> Release submitted
            <span className="ml-2"><SandboxBadge aggregator={release.aggregator ?? pricing?.aggregator ?? null} /></span>
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

/* ── page ────────────────────────────────────────────────────────────────── */

export default function Distribute() {
  const { user, getAccessToken, refreshProfile } = useAuth();

  const [tab, setTab] = useState<"releases" | "new">("releases");
  const [releases, setReleases] = useState<Release[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [pricing, setPricing] = useState<PricingInfo | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

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
      <MarketingNav />

      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-14 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Disc3 className="h-3 w-3" aria-hidden="true" /> <CheatCodeName possessive /> distribution hub
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Music <span className="text-primary">Distribution</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Get your music on Spotify, Apple Music, TikTok, and every major platform.
            AI writes your metadata and your release strategy — you keep the masters.
          </p>
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

        {!user ? (
          <div className="relative mx-auto mt-10 max-w-xl rounded-3xl border border-white/10 bg-white/[0.02] p-10 text-center">
            <p className="text-white/60">Sign in to distribute your music and track every release.</p>
            <a href="/login" className={`${goldBtn} mt-6`}>Sign in</a>
          </div>
        ) : (
          <div className="relative mt-10">
            {/* tabs */}
            <div className="mb-8 flex justify-center">
              <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
                {(["releases", "new"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTab(t); clearBanners(); }}
                    className={`rounded-xl px-6 py-2.5 text-sm font-bold transition ${
                      tab === t ? "bg-primary text-black" : "text-white/55 hover:text-white"
                    }`}
                  >
                    {t === "releases" ? "My Releases" : "New Release"}
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
                        <ListMusic className="h-4 w-4 text-primary" /> Releases
                      </h2>
                      <button onClick={() => { setTab("new"); clearBanners(); }} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black hover:brightness-110">
                        <Plus className="h-3.5 w-3.5" /> New
                      </button>
                    </div>

                    {listLoading ? (
                      <p className="py-6 text-center text-sm text-white/40">Loading releases…</p>
                    ) : releases.length === 0 ? (
                      <p className="py-6 text-center text-sm text-white/40">
                        No releases yet. Hit <strong className="text-white/70">New Release</strong> — setup is free.
                      </p>
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
                                {r.status === "packaged"
                                  ? <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Submitted" />
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
                    <div className="flex h-full min-h-[320px] items-center justify-center rounded-3xl border border-white/10 bg-white/[0.02] p-10 text-center text-sm text-white/40">
                      Pick a release on the left — or create a new one — to build it out.
                    </div>
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
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
