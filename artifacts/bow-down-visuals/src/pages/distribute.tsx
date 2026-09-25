import { useCallback, useEffect, useState } from "react";
import {
  Disc3, Sparkles, Loader2, Plus, Trash2, Rocket, CheckCircle2,
  AlertTriangle, CalendarDays, Music2, Image as ImageIcon, Link2,
  ListMusic, ChevronRight, BadgeCheck,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  DISTRIBUTION_PLATFORMS,
  DISTRIBUTION_AI_CREDIT_COST,
  DISTRIBUTION_PACKAGING_CREDITS,
  platformLabel,
  type DistributionPlatformKey,
} from "@/lib/distribution";

/* ─── Thy Cheat Code's Music Distribution hub ───────────────────────────────
   DistroKid-style release dashboard at /distribute.
   - Browsing + release setup: free (pure UI/DB).
   - AI metadata + AI pre-release strategy: 1 credit each (GPT-6).
   - Release packaging: DISTRIBUTION_RELEASE_CREDITS (10) — a service fee
     for preparing the release package.
   HONESTY CONTRACT (v1): the hub prepares + tracks releases. It does NOT
   submit to Spotify/Apple APIs, and the UI says so plainly. There is no
   fake "delivered to Spotify" state anywhere on this page. */

const AI_CREDIT_COST = DISTRIBUTION_AI_CREDIT_COST;
const PACKAGING_CREDITS = DISTRIBUTION_PACKAGING_CREDITS;

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
  releaseDate: string | null;
  platforms: string[];
  audioUrl: string | null;
  artworkUrl: string | null;
  metadata: ReleaseMeta | null;
  strategy: ReleaseStrategy | null;
  status: "draft" | "packaged";
  creditsCharged: number;
  createdAt: string;
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

export default function Distribute() {
  const { user, getAccessToken, refreshProfile } = useAuth();

  const [releases, setReleases] = useState<Release[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  /* create form */
  const [showCreate, setShowCreate] = useState(false);
  const [fTitle, setFTitle] = useState("");
  const [fArtist, setFArtist] = useState("");
  const [fDate, setFDate] = useState("");
  const [fPlatforms, setFPlatforms] = useState<DistributionPlatformKey[]>(["spotify", "apple_music"]);
  const [fAudio, setFAudio] = useState("");
  const [fArtwork, setFArtwork] = useState("");
  const [saving, setSaving] = useState(false);

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
      /* non-fatal — dashboard still renders the create form */
    } finally {
      setListLoading(false);
    }
  }, [user, authFetch, selectedId]);

  useEffect(() => { void loadReleases(); }, [loadReleases]);

  function handle402(data: { error?: string }) {
    if (data.error === "out_of_credits") {
      setOutOfCredits(true);
      refreshProfile();
      return true;
    }
    return false;
  }

  async function createRelease() {
    if (saving || !user) return;
    if (!fTitle.trim() || !fArtist.trim()) {
      setError("Give the release a title and an artist name first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch("/api/distribution/releases", {
        method: "POST",
        body: JSON.stringify({
          title: fTitle.trim(),
          artistName: fArtist.trim(),
          releaseDate: fDate.trim(),
          platforms: fPlatforms,
          audioUrl: fAudio.trim(),
          artworkUrl: fArtwork.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { release?: Release; error?: string; message?: string };
      if (handle402(data)) return;
      if (!res.ok || !data.release) throw new Error(data.message || data.error || "Couldn't create the release.");
      setReleases((prev) => [data.release!, ...prev]);
      setSelectedId(data.release.id);
      setShowCreate(false);
      setFTitle(""); setFArtist(""); setFDate(""); setFAudio(""); setFArtwork("");
      setNotice("Release draft created — free. Build it out below, then package it when it's ready.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the release.");
    } finally {
      setSaving(false);
    }
  }

  async function generateMetadata() {
    if (metaLoading || !user || !selected) return;
    if (!vibe.trim()) {
      setError("Describe the song's vibe first — that's what the AI writes from.");
      return;
    }
    setMetaLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authFetch("/api/distribution/metadata", {
        method: "POST",
        body: JSON.stringify({
          vibe: vibe.trim(),
          lyrics: lyrics.trim(),
          artistName: selected.artistName,
          workingTitle: selected.title,
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
      setError(err instanceof Error ? err.message : "Metadata generation failed.");
    } finally {
      setMetaLoading(false);
    }
  }

  async function generateStrategy() {
    if (strategyLoading || !user || !selected) return;
    setStrategyLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const meta = (selected.metadata ?? metaResult ?? {}) as ReleaseMeta;
      const res = await authFetch("/api/distribution/strategy", {
        method: "POST",
        body: JSON.stringify({
          title: selected.title,
          artistName: selected.artistName,
          genreTags: meta.genreTags ?? [],
          releaseDate: selected.releaseDate ?? "",
          platforms: selected.platforms.length ? selected.platforms : ["spotify"],
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
      setError(err instanceof Error ? err.message : "Strategy generation failed.");
    } finally {
      setStrategyLoading(false);
    }
  }

  async function saveAiToRelease() {
    if (!selected) return;
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
      const res = await authFetch(`/api/distribution/releases/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { release?: Release; error?: string };
      if (res.ok && data.release) {
        setReleases((prev) => prev.map((r) => (r.id === data.release!.id ? data.release! : r)));
        setNotice("AI package saved to the release.");
      }
    } catch {
      /* non-fatal */
    }
  }

  async function deleteRelease(id: string) {
    if (!window.confirm("Delete this release draft? This can't be undone.")) return;
    try {
      const res = await authFetch(`/api/distribution/releases/${id}`, { method: "DELETE" });
      if (res.ok) {
        setReleases((prev) => prev.filter((r) => r.id !== id));
        if (selectedId === id) setSelectedId(null);
      }
    } catch {
      setError("Couldn't delete the release.");
    }
  }

  async function submitRelease() {
    if (submitting || !user || !selected || selected.status !== "draft") return;
    if (!window.confirm(
      `Package "${selected.title}" for distribution for ${PACKAGING_CREDITS} credits?\n\n` +
      `This prepares your release package (metadata, artwork, audio, platform checklist). ` +
      `Direct delivery to streaming platforms is coming soon — v1 does not submit to Spotify/Apple APIs.`,
    )) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/distribution/releases/${selected.id}/submit`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        release?: Release; notice?: string; error?: string; message?: string;
      };
      if (handle402(data)) return;
      if (!res.ok || !data.release) {
        throw new Error(data.message || data.error || "Couldn't package the release.");
      }
      setReleases((prev) => prev.map((r) => (r.id === data.release!.id ? data.release! : r)));
      setNotice(data.notice ?? "Release packaged.");
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't package the release.");
    } finally {
      setSubmitting(false);
    }
  }

  function togglePlatform(key: DistributionPlatformKey) {
    setFPlatforms((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
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
            <Disc3 className="h-3 w-3" aria-hidden="true" /> Thy Cheat Code's distribution hub
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Music <span className="text-primary">Distribution</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Package your music for every streaming platform. AI writes your
            metadata and your release strategy — you keep the masters, we
            handle the paperwork.
          </p>
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
            <p className="text-white/60">Sign in to package and track your releases.</p>
            <a href="/login" className={`${goldBtn} mt-6`}>Sign in</a>
          </div>
        ) : (
          <div className="relative mt-10 grid gap-6 lg:grid-cols-[320px_1fr]">
            {/* ── release list ── */}
            <div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/60">
                    <ListMusic className="h-4 w-4 text-primary" /> Releases
                  </h2>
                  <button onClick={() => setShowCreate((s) => !s)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black hover:brightness-110">
                    <Plus className="h-3.5 w-3.5" /> New
                  </button>
                </div>

                {showCreate && (
                  <div className="mb-4 space-y-3 rounded-2xl border border-primary/25 bg-black/40 p-4">
                    <div>
                      <label className={labelClass}>Release title</label>
                      <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="Midnight Frequencies" className={inputClass} maxLength={200} />
                    </div>
                    <div>
                      <label className={labelClass}>Artist name</label>
                      <input value={fArtist} onChange={(e) => setFArtist(e.target.value)} placeholder="Shark King" className={inputClass} maxLength={120} />
                    </div>
                    <div>
                      <label className={labelClass}>Release date</label>
                      <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Platforms</label>
                      <div className="flex flex-wrap gap-1.5">
                        {DISTRIBUTION_PLATFORMS.map((p) => {
                          const on = fPlatforms.includes(p.key);
                          return (
                            <button
                              key={p.key}
                              onClick={() => togglePlatform(p.key)}
                              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${on ? "bg-primary text-black" : "border border-white/15 text-white/50 hover:border-primary/50 hover:text-white"}`}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Audio URL <span className="font-normal normal-case text-white/30">(optional)</span></label>
                      <input value={fAudio} onChange={(e) => setFAudio(e.target.value)} placeholder="https://…/track.mp3" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Artwork URL <span className="font-normal normal-case text-white/30">(optional)</span></label>
                      <input value={fArtwork} onChange={(e) => setFArtwork(e.target.value)} placeholder="https://…/cover.jpg" className={inputClass} />
                    </div>
                    <button onClick={createRelease} disabled={saving} className={`${goldBtn} w-full`}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Create release · free
                    </button>
                  </div>
                )}

                {listLoading ? (
                  <p className="py-6 text-center text-sm text-white/40">Loading releases…</p>
                ) : releases.length === 0 ? (
                  <p className="py-6 text-center text-sm text-white/40">
                    No releases yet. Create your first one — setup is free.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {releases.map((r) => (
                      <li key={r.id}>
                        <button
                          onClick={() => { setSelectedId(r.id); setMetaResult(null); setStrategyResult(null); setNotice(null); setError(null); }}
                          className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${selectedId === r.id ? "border-primary/50 bg-primary/[0.07]" : "border-white/10 bg-black/40 hover:border-white/25"}`}
                        >
                          <Disc3 className={`h-8 w-8 shrink-0 ${selectedId === r.id ? "text-primary" : "text-white/30"}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold">{r.title}</span>
                            <span className="block truncate text-xs text-white/40">{r.artistName}</span>
                          </span>
                          {r.status === "packaged"
                            ? <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Packaged" />
                            : <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* ── release detail ── */}
            <div>
              {!selected ? (
                <div className="flex h-full min-h-[320px] items-center justify-center rounded-3xl border border-white/10 bg-white/[0.02] p-10 text-center text-sm text-white/40">
                  Pick a release on the left — or create a new one — to build its package.
                </div>
              ) : (
                <div className="space-y-6">
                  {/* header card */}
                  <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-center gap-4">
                        {selected.artworkUrl ? (
                          <img src={selected.artworkUrl} alt={`${selected.title} artwork`} className="h-20 w-20 rounded-2xl border border-white/10 object-cover" />
                        ) : (
                          <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
                            <ImageIcon className="h-8 w-8 text-white/25" />
                          </div>
                        )}
                        <div>
                          <h2 className="font-display text-2xl font-black">{selected.title}</h2>
                          <p className="text-sm text-white/50">{selected.artistName}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold ${selected.status === "packaged" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/15 bg-white/[0.04] text-white/50"}`}>
                              {selected.status === "packaged" ? <><BadgeCheck className="h-3 w-3" /> Packaged</> : "Draft"}
                            </span>
                            {selected.releaseDate && (
                              <span className="inline-flex items-center gap-1 text-white/40">
                                <CalendarDays className="h-3 w-3" /> {selected.releaseDate}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {selected.status === "draft" && (
                        <button onClick={() => deleteRelease(selected.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-300/80 hover:bg-red-500/10">
                          <Trash2 className="h-3.5 w-3.5" /> Delete draft
                        </button>
                      )}
                    </div>

                    <div className="mt-5 flex flex-wrap gap-1.5">
                      {selected.platforms.length === 0 && (
                        <span className="text-xs text-white/35">No platforms picked yet — edit via a new draft.</span>
                      )}
                      {selected.platforms.map((p) => (
                        <span key={p} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60">
                          {platformLabel(p)}
                        </span>
                      ))}
                    </div>

                    {(selected.audioUrl || selected.artworkUrl) && (
                      <div className="mt-4 space-y-1.5 text-xs text-white/45">
                        {selected.audioUrl && (
                          <p className="flex items-center gap-1.5"><Music2 className="h-3.5 w-3.5 text-primary/70" />
                            <a href={selected.audioUrl} target="_blank" rel="noreferrer" className="truncate text-primary/90 hover:underline">Audio file</a>
                          </p>
                        )}
                        {selected.artworkUrl && (
                          <p className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-primary/70" />
                            <a href={selected.artworkUrl} target="_blank" rel="noreferrer" className="truncate text-primary/90 hover:underline">Artwork file</a>
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {selected.status === "draft" ? (
                    <>
                      {/* ── AI metadata ── */}
                      <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
                        <h3 className="flex items-center gap-2 font-display text-xl font-black">
                          <Sparkles className="h-5 w-5 text-primary" /> AI Release Metadata
                          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">1 credit</span>
                        </h3>
                        <p className="mt-2 text-sm text-white/50">
                          Describe the song — AI writes streaming-ready title options, a release description, and genre tags.
                        </p>
                        <div className="mt-4 space-y-3">
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
                            Generate metadata · 1 credit
                          </button>
                        </div>

                        {(metaResult?.titleOptions ?? selected.metadata?.titleOptions) && (
                          <div className="mt-6 space-y-4 rounded-2xl border border-primary/25 bg-black/40 p-5">
                            <div>
                              <p className={labelClass}>Title options</p>
                              <ul className="space-y-1.5">
                                {(metaResult?.titleOptions ?? selected.metadata?.titleOptions ?? []).map((t) => (
                                  <li key={t} className="flex items-center gap-2 text-sm text-white/85">
                                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> {t}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <p className={labelClass}>Release description</p>
                              <p className="text-sm leading-relaxed text-white/70">{metaResult?.description ?? selected.metadata?.description}</p>
                            </div>
                            <div>
                              <p className={labelClass}>Genre tags</p>
                              <div className="flex flex-wrap gap-1.5">
                                {(metaResult?.genreTags ?? selected.metadata?.genreTags ?? []).map((g) => (
                                  <span key={g} className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">{g}</span>
                                ))}
                              </div>
                            </div>
                            <button onClick={saveAiToRelease} className={ghostBtn}>
                              Save AI package to release
                            </button>
                          </div>
                        )}
                      </section>

                      {/* ── AI strategy ── */}
                      <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
                        <h3 className="flex items-center gap-2 font-display text-xl font-black">
                          <Rocket className="h-5 w-5 text-primary" /> AI Pre-Release Strategy
                          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">1 credit</span>
                        </h3>
                        <p className="mt-2 text-sm text-white/50">
                          Release timing, a 2-week promo plan, and a must-do checklist — tailored to this release.
                        </p>
                        <button onClick={generateStrategy} disabled={strategyLoading} className={`${goldBtn} mt-4`}>
                          {strategyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                          Generate strategy · 1 credit
                        </button>

                        {(strategyResult?.timing ?? selected.strategy?.timing) && (
                          <div className="mt-6 space-y-4 rounded-2xl border border-primary/25 bg-black/40 p-5">
                            <div>
                              <p className={labelClass}>Timing</p>
                              <p className="text-sm leading-relaxed text-white/70">{strategyResult?.timing ?? selected.strategy?.timing}</p>
                            </div>
                            <div>
                              <p className={labelClass}>2-week promo plan</p>
                              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-white/70">
                                {(strategyResult?.promoPlan ?? selected.strategy?.promoPlan ?? []).map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ol>
                            </div>
                            <div>
                              <p className={labelClass}>Pre-release checklist</p>
                              <ul className="space-y-1.5">
                                {(strategyResult?.checklist ?? selected.strategy?.checklist ?? []).map((c, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {c}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <button onClick={saveAiToRelease} className={ghostBtn}>
                              Save AI package to release
                            </button>
                          </div>
                        )}
                      </section>

                      {/* ── package / submit ── */}
                      <section className="rounded-3xl border border-primary/30 bg-gradient-to-b from-[#171208] to-black p-6 md:p-8">
                        <h3 className="flex items-center gap-2 font-display text-xl font-black">
                          <Rocket className="h-5 w-5 text-primary" /> Package this release
                        </h3>
                        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">
                          Packaging prepares your full release package — validated metadata, artwork,
                          audio, and a per-platform checklist — for a{" "}
                          <strong className="text-white/85">{PACKAGING_CREDITS}-credit service fee</strong>.
                          Be aware: v1 prepares and tracks your release.{" "}
                          <strong className="text-white/85">Direct delivery to Spotify, Apple Music and the
                          other platforms is coming soon</strong> — this does not submit to their APIs yet,
                          and we'll notify you the moment your release ships.
                        </p>
                        <button onClick={submitRelease} disabled={submitting} className={`${goldBtn} mt-5`}>
                          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                          Package release · {PACKAGING_CREDITS} credits
                        </button>
                      </section>
                    </>
                  ) : (
                    /* ── packaged state ── */
                    <section className="rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.05] p-6 md:p-8">
                      <h3 className="flex items-center gap-2 font-display text-xl font-black text-emerald-300">
                        <BadgeCheck className="h-5 w-5" /> Release packaged
                      </h3>
                      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">
                        Your release package is prepared — metadata, artwork, audio, and platform
                        checklist are ready for {selected.platforms.map(platformLabel).join(", ") || "your platforms"}.
                        Direct delivery to streaming platforms is coming soon; we'll notify you when
                        "{selected.title}" ships. Packaged releases are locked — create a new release
                        for any changes.
                      </p>
                      {selected.strategy?.checklist && selected.strategy.checklist.length > 0 && (
                        <div className="mt-5">
                          <p className={labelClass}>Platform readiness checklist</p>
                          <ul className="space-y-1.5">
                            {selected.strategy.checklist.map((c, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> {c}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
