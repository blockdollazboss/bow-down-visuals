import { useCallback, useEffect, useState } from "react";
import { Barcode, Check, Disc3, Link2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  DISTRIBUTION_PLATFORMS,
  SPLIT_ROLES,
  platformLabel,
  platformStatusLabel,
  roleLabel,
  type RoyaltySplit,
} from "@/lib/distribution";
import { parseVaultedCount } from "@/lib/world/business-desks";
import {
  SMARTLINK_LINK_PLATFORMS,
  buildAiSavePayload,
  buildMetadataPayload,
  buildPresaveSettingsPayload,
  buildReleasePayload,
  buildSplitsPayload,
  buildStrategyPayload,
  checklistPasses,
  draftFromRelease,
  emptyReleaseDraft,
  parseBarcodeResult,
  parseMetadataResult,
  parsePlatformStatuses,
  parsePresaveMint,
  parsePresaveStats,
  parseReleaseDetail,
  parseReleaseList,
  parseReleasePricing,
  parseSplitsSave,
  parseStrategyResult,
  parseSubmitChecklist,
  parseSubmitResult,
  smartlinkUrl,
  splitsTotal,
  splitsValid,
  submitPriceFor,
  validateReleaseDraft,
  validateSmartlinkSettings,
  type MetadataResult,
  type PresaveStats,
  type ReleaseDetail,
  type ReleaseDraft,
  type ReleasePrefill,
  type ReleasePricing,
  type SmartlinkSettings,
  type StrategyResult,
} from "@/lib/world/release-desk";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";

/* ─── The in-world Release Desk (Stack-100 #53/#54) ─────────────────
   The Promote Room's folded status-only Release row, finished: the
   full distribution wizard completes HERE on the 2D /distribute
   page's own rails — create/edit a release (metadata, tracks,
   platforms, explicit declaration, territories), royalty splits,
   UPC/barcode, the server checklist, and the paid submit — plus
   the release's smartlink / pre-save surface (mint the link, edit
   its settings + the creator's own retargeting pixels, read its
   view/click analytics). Prices are read live from
   GET /api/distribution/pricing, exactly like the 2D page; the
   paid submit follows the 2D page's own confirmation law (a
   window.confirm naming the live tier price, then the POST).
   Everything else here is free on the rails and is called free. */

function useReleaseAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50";

const chipBtn = (isLight: boolean, active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    active
      ? "border-[#d4af37] bg-[#d4af37] text-black"
      : isLight
        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
        : "border-white/15 text-white/75 hover:text-white"
  }`;

const fieldLabel = (isLight: boolean) =>
  `mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;

function serverMessage(data: unknown, fallback: string): string {
  const d = data as { message?: string; error?: string };
  return d?.message ?? d?.error ?? fallback;
}

/* ─── The wizard form (create + edit share it) ────────────────────── */

function ReleaseFormFields({
  isLight,
  draft,
  set,
  locked,
}: {
  isLight: boolean;
  draft: ReleaseDraft;
  set: (patch: Partial<ReleaseDraft>) => void;
  locked: boolean;
}) {
  const togglePlatform = (key: string) =>
    set({
      platforms: draft.platforms.includes(key)
        ? draft.platforms.filter((p) => p !== key)
        : [...draft.platforms, key],
    });
  return (
    <div className="space-y-2" data-testid="world-release-form">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel(isLight)}>Release title</span>
          <input aria-label="Release title" className={inputCls(isLight)} value={draft.title} disabled={locked} onChange={(e) => set({ title: e.target.value })} placeholder="Release title" />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>Artist name</span>
          <input aria-label="Artist name" className={inputCls(isLight)} value={draft.artistName} disabled={locked} onChange={(e) => set({ artistName: e.target.value })} placeholder="Artist name" />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className={fieldLabel(isLight)}>Release type</span>
          <select aria-label="Release type" className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={draft.releaseType} disabled={locked} onChange={(e) => set({ releaseType: e.target.value })}>
            <option value="single">Single — 1 track</option>
            <option value="ep">EP — 2–6 tracks</option>
            <option value="album">Album — 7–30 tracks</option>
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>Release date</span>
          <input aria-label="Release date" type="date" className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={draft.releaseDate} disabled={locked} onChange={(e) => set({ releaseDate: e.target.value })} />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>Genre</span>
          <input aria-label="Genre" className={inputCls(isLight)} value={draft.genre} disabled={locked} onChange={(e) => set({ genre: e.target.value })} placeholder="Primary genre" />
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel(isLight)}>Master audio link</span>
        <input aria-label="Master audio link" className={inputCls(isLight)} value={draft.audioUrl} disabled={locked} onChange={(e) => set({ audioUrl: e.target.value })} placeholder="https://… your final master (WAV/MP3)" />
      </label>
      <label className="block">
        <span className={fieldLabel(isLight)}>Cover art link</span>
        <input aria-label="Cover art link" className={inputCls(isLight)} value={draft.artworkUrl} disabled={locked} onChange={(e) => set({ artworkUrl: e.target.value })} placeholder="https://… 3000×3000 cover art" />
      </label>

      <div>
        <span className={fieldLabel(isLight)}>Platforms</span>
        <div className="flex flex-wrap gap-1.5" data-testid="world-release-platforms">
          {DISTRIBUTION_PLATFORMS.map((p) => (
            <button key={p.key} type="button" disabled={locked} aria-pressed={draft.platforms.includes(p.key)} onClick={() => togglePlatform(p.key)} className={chipBtn(isLight, draft.platforms.includes(p.key))}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className={fieldLabel(isLight)}>Tracks</span>
        <div className="space-y-1.5">
          {draft.tracks.map((t, i) => (
            <div key={i} className="flex gap-2">
              <input aria-label={`Track ${i + 1} title`} className={inputCls(isLight)} value={t.title} disabled={locked} placeholder={`Track ${i + 1} title`} onChange={(e) => set({ tracks: draft.tracks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
              <input aria-label={`Track ${i + 1} ISRC`} className={inputCls(isLight)} style={{ maxWidth: 170 }} value={t.isrc} disabled={locked} placeholder="ISRC (optional)" onChange={(e) => set({ tracks: draft.tracks.map((x, j) => (j === i ? { ...x, isrc: e.target.value } : x)) })} />
              {draft.tracks.length > 1 && !locked ? (
                <button type="button" aria-label={`Remove track ${i + 1}`} onClick={() => set({ tracks: draft.tracks.filter((_, j) => j !== i) })} className={chipBtn(isLight, false)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {!locked ? (
          <button type="button" data-testid="world-release-track-add" onClick={() => set({ tracks: [...draft.tracks, { title: "", isrc: "" }] })} className={`${chipBtn(isLight, false)} mt-1.5`}>
            <Plus className="h-3.5 w-3.5" /> Add a track
          </button>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel(isLight)}>Release ISRC (optional)</span>
          <input aria-label="Release ISRC" className={inputCls(isLight)} value={draft.isrc} disabled={locked} onChange={(e) => set({ isrc: e.target.value })} placeholder="USABC2412345" />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>Subgenre</span>
          <input aria-label="Subgenre" className={inputCls(isLight)} value={draft.subgenre} disabled={locked} onChange={(e) => set({ subgenre: e.target.value })} placeholder="Subgenre" />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>Label</span>
          <input aria-label="Label" className={inputCls(isLight)} value={draft.label} disabled={locked} onChange={(e) => set({ label: e.target.value })} placeholder="Label name" />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>Label imprint</span>
          <input aria-label="Label imprint" className={inputCls(isLight)} value={draft.labelImprint} disabled={locked} onChange={(e) => set({ labelImprint: e.target.value })} placeholder="Imprint (optional)" />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>© line</span>
          <input aria-label="Copyright C line" className={inputCls(isLight)} value={draft.copyrightCLine} disabled={locked} onChange={(e) => set({ copyrightCLine: e.target.value })} placeholder="© 2026 Your label" />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>℗ line</span>
          <input aria-label="Copyright P line" className={inputCls(isLight)} value={draft.copyrightPLine} disabled={locked} onChange={(e) => set({ copyrightPLine: e.target.value })} placeholder="℗ 2026 Your label" />
        </label>
      </div>

      <div>
        <span className={fieldLabel(isLight)}>UPC / barcode</span>
        <div className="flex gap-2">
          <input aria-label="UPC" className={inputCls(isLight)} value={draft.upc} disabled={locked} onChange={(e) => set({ upc: e.target.value })} placeholder="12-digit UPC-A or 13-digit EAN" />
          <select aria-label="UPC kind" className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark", width: "auto" }} value={draft.upcKind} disabled={locked} onChange={(e) => set({ upcKind: e.target.value })}>
            <option value="internal">Internal</option>
            <option value="official">Official (via a partner)</option>
          </select>
        </div>
        <p className={`mt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          An internal barcode is a catalog placeholder, not a store-recognized UPC — your official UPC is assigned when the release is distributed via a partner. Use the barcode button below the form to mint one.
        </p>
      </div>

      <div>
        <span className={fieldLabel(isLight)}>Explicit content — declare it (required)</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" disabled={locked} aria-pressed={draft.explicit === false} onClick={() => set({ explicit: false })} className={chipBtn(isLight, draft.explicit === false)}>Clean</button>
          <button type="button" disabled={locked} aria-pressed={draft.explicit === true} onClick={() => set({ explicit: true })} className={chipBtn(isLight, draft.explicit === true)}>Explicit</button>
          <label className={`ml-2 inline-flex items-center gap-2 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/60"}`}>
            <input type="checkbox" checked={draft.explicitConfirmed} disabled={locked} onChange={(e) => set({ explicitConfirmed: e.target.checked })} />
            I confirm this declaration
          </label>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className={fieldLabel(isLight)}>Territories</span>
          <select aria-label="Territories mode" className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={draft.territoriesMode} disabled={locked} onChange={(e) => set({ territoriesMode: e.target.value })}>
            <option value="worldwide">Worldwide</option>
            <option value="include">Only these</option>
            <option value="exclude">Everywhere except these</option>
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>Territory codes</span>
          <input aria-label="Territory codes" className={inputCls(isLight)} value={draft.territoriesText} disabled={locked || draft.territoriesMode === "worldwide"} onChange={(e) => set({ territoriesText: e.target.value })} placeholder="US, CA, GB…" />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>Preorder date</span>
          <input aria-label="Preorder date" type="date" className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={draft.preorderDate} disabled={locked} onChange={(e) => set({ preorderDate: e.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel(isLight)}>Lyrics (optional)</span>
        <textarea aria-label="Lyrics" className={inputCls(isLight)} rows={3} value={draft.lyrics} disabled={locked} onChange={(e) => set({ lyrics: e.target.value })} placeholder="The song's lyrics — saved with the release" />
      </label>
    </div>
  );
}

/* ─── The desk body (list + wizard + editor + smartlink) ──────────── */

function ReleaseDeskBody({ isLight, prefill, prefillNonce }: { isLight: boolean; prefill?: ReleasePrefill | null; prefillNonce?: number }) {
  const authHeaders = useReleaseAuthHeaders();
  const { refreshProfile } = useAuth();

  const [pricing, setPricing] = useState<ReleasePricing | null>(null);
  const [releases, setReleases] = useState<ReleaseDetail[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [vaulted, setVaulted] = useState(0);
  const [tick, setTick] = useState(0);

  const [selected, setSelected] = useState<ReleaseDetail | null>(null);
  const [draft, setDraft] = useState<ReleaseDraft>(() => emptyReleaseDraft(prefill));
  const [creating, setCreating] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitChecklist, setSubmitChecklist] = useState<ReturnType<typeof parseSubmitChecklist>>([]);

  /* Splits (selected release). */
  const [splits, setSplits] = useState<RoyaltySplit[]>([]);
  const [splitsNote, setSplitsNote] = useState<string | null>(null);

  /* AI benches (selected release). */
  const [vibe, setVibe] = useState("");
  const [metaResult, setMetaResult] = useState<MetadataResult | null>(null);
  const [strategyResult, setStrategyResult] = useState<StrategyResult | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);

  /* Smartlink (selected release). */
  const [stats, setStats] = useState<PresaveStats | null>(null);
  const [slSettings, setSlSettings] = useState<SmartlinkSettings | null>(null);
  const [slNote, setSlNote] = useState<string | null>(null);
  const [mintedUrl, setMintedUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const [rRes, pRes, vRes] = await Promise.all([
        fetch("/api/distribution/releases", { headers }),
        fetch("/api/distribution/pricing", { headers }),
        fetch("/api/catalog-vault/status", { headers }),
      ]);
      if (!rRes.ok) throw new Error("releases");
      setReleases(parseReleaseList(await rRes.json().catch(() => null)));
      setPricing(pRes.ok ? parseReleasePricing(await pRes.json().catch(() => null)) : null);
      setVaulted(vRes.ok ? parseVaultedCount(await vRes.json().catch(() => null)) : 0);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  useEffect(() => {
    void load();
  }, [load]);

  /* A fresh cover prefill (#55) reseeds a NEW release draft. */
  useEffect(() => {
    if (!prefill) return;
    setCreating(true);
    setSelected(null);
    setDraft(emptyReleaseDraft(prefill));
    setNote(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNonce]);

  const set = (patch: Partial<ReleaseDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const adoptRelease = useCallback(async (summary: ReleaseDetail) => {
    setSelected(summary);
    setCreating(false);
    setDraft(draftFromRelease(summary));
    setSplits(summary.royaltySplits);
    setMetaResult(null);
    setStrategyResult(null);
    setStats(null);
    setSlSettings(null);
    setMintedUrl(null);
    setSubmitChecklist([]);
    /* The detail read carries the splits + checklist the list trims. */
    try {
      const res = await fetch(`/api/distribution/releases/${summary.id}`, { headers: await authHeaders() });
      if (res.ok) {
        const detail = parseReleaseDetail(await res.json().catch(() => null));
        if (detail) {
          setSelected(detail);
          setDraft(draftFromRelease(detail));
          setSplits(detail.royaltySplits);
        }
      }
    } catch { /* the summary already seeds the editor honestly */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSmartlink = useCallback(async (release: ReleaseDetail) => {
    if (!release.presaveSlug) return;
    try {
      const res = await fetch(`/api/distribution/releases/${release.id}/presave-stats`, { headers: await authHeaders() });
      if (!res.ok) return;
      const parsed = parsePresaveStats(await res.json().catch(() => null));
      setStats(parsed);
      setSlSettings(parsed.settings);
    } catch { /* analytics is a strip — a miss stays a miss */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selected?.presaveSlug) void loadSmartlink(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.presaveSlug]);

  const jsonHeaders = async () => ({ "Content-Type": "application/json", ...(await authHeaders()) });

  /* Create (free draft) / Save edit (free PATCH). */
  const saveDraft = async () => {
    if (busy) return;
    const problem = validateReleaseDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy("save");
    setError(null);
    setNote(null);
    try {
      const url = creating ? "/api/distribution/releases" : `/api/distribution/releases/${selected!.id}`;
      const res = await fetch(url, {
        method: creating ? "POST" : "PATCH",
        headers: await jsonHeaders(),
        body: JSON.stringify(buildReleasePayload(draft)),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(serverMessage(data, "The release couldn't be saved — try again."));
        return;
      }
      const saved = parseReleaseDetail(data);
      if (!saved) {
        setError("The release desk answered without the release. Try again.");
        return;
      }
      setNote(creating ? "Draft created — free. Finish the checklist, set your splits, then submit when you're ready." : "Saved — your changes are on the release.");
      await adoptRelease(saved);
      setTick((n) => n + 1);
    } catch {
      setError("The release desk didn't answer. Try again.");
    } finally {
      setBusy(null);
    }
  };

  /* Paid submit — the 2D page's confirmation law, verbatim shape. */
  const submitRelease = async () => {
    if (busy || !selected || selected.status !== "draft" || !pricing) return;
    const price = submitPriceFor(pricing, selected.releaseType);
    if (typeof window !== "undefined" && !window.confirm(
      `Submit "${selected.title}" for distribution for ${price} Visual Bucs?\n\n` +
      `This pays the aggregator delivery fee and queues delivery to ${selected.platforms.map(platformLabel).join(", ") || "your platforms"}.`,
    )) return;
    setBusy("submit");
    setError(null);
    setNote(null);
    setSubmitChecklist([]);
    try {
      const res = await fetch(`/api/distribution/releases/${selected.id}/submit`, {
        method: "POST",
        headers: await authHeaders(),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setError("Out of Visual Bucs — top up and the release desk is ready again. Your draft is saved.");
        return;
      }
      if (!res.ok) {
        const checklist = parseSubmitChecklist(data);
        if (checklist.length > 0) setSubmitChecklist(checklist);
        setError(serverMessage(data, "Couldn't submit the release."));
        return;
      }
      const result = parseSubmitResult(data);
      if (result.release) await adoptRelease(result.release);
      setNote(result.notice ?? "Release submitted — delivery queued. Track every platform below.");
      refreshProfile();
      setTick((n) => n + 1);
    } catch {
      setError("The release desk didn't answer. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const deleteDraft = async () => {
    if (busy || !selected || selected.status !== "draft") return;
    if (typeof window !== "undefined" && !window.confirm("Delete this release draft? This can't be undone.")) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/distribution/releases/${selected.id}`, { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) {
        setError("Couldn't delete the release.");
        return;
      }
      setSelected(null);
      setCreating(true);
      setDraft(emptyReleaseDraft());
      setNote("Release draft deleted.");
      setTick((n) => n + 1);
    } catch {
      setError("Couldn't delete the release.");
    } finally {
      setBusy(null);
    }
  };

  const generateBarcode = async () => {
    if (busy || !selected) return;
    setBusy("barcode");
    setError(null);
    try {
      const res = await fetch(`/api/distribution/releases/${selected.id}/generate-barcode`, {
        method: "POST",
        headers: await authHeaders(),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(serverMessage(data, "Couldn't generate the barcode — try again."));
        return;
      }
      const { barcode, notice } = parseBarcodeResult(data);
      const updated = parseReleaseDetail(data);
      if (updated) await adoptRelease(updated);
      if (barcode) set({ upc: barcode, upcKind: "internal" });
      setNote(notice ?? "Internal barcode minted.");
    } catch {
      setError("The barcode desk didn't answer. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const saveSplits = async () => {
    if (busy || !selected || !splitsValid(splits)) return;
    setBusy("splits");
    setSplitsNote(null);
    try {
      const res = await fetch(`/api/distribution/releases/${selected.id}/splits`, {
        method: "PUT",
        headers: await jsonHeaders(),
        body: JSON.stringify(buildSplitsPayload(splits)),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSplitsNote(serverMessage(data, "Couldn't save the splits."));
        return;
      }
      const { splits: saved, agreementVersion } = parseSplitsSave(data);
      if (saved.length > 0) setSplits(saved);
      setSplitsNote(
        agreementVersion && agreementVersion > 1
          ? `Royalty splits saved — agreement v${agreementVersion} applies to future earnings only. Free.`
          : "Royalty splits saved. Free.",
      );
    } catch {
      setSplitsNote("Couldn't save the splits — try again.");
    } finally {
      setBusy(null);
    }
  };

  const generateMetadata = async () => {
    if (busy || !selected) return;
    if (!vibe.trim()) {
      setAiNote("Describe the song's vibe first — that's what the AI writes from.");
      return;
    }
    setBusy("metadata");
    setAiNote(null);
    try {
      const res = await fetch("/api/distribution/metadata", {
        method: "POST",
        headers: await jsonHeaders(),
        body: JSON.stringify(buildMetadataPayload({ vibe, lyrics: draft.lyrics, artistName: selected.artistName, workingTitle: selected.title })),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setAiNote("Out of Visual Bucs — top up and the AI bench is ready again.");
        return;
      }
      const parsed = parseMetadataResult(data);
      if (!res.ok || !parsed) {
        setAiNote(serverMessage(data, "Metadata generation failed — try again."));
        return;
      }
      setMetaResult(parsed);
      refreshProfile();
    } catch {
      setAiNote("Metadata generation failed — try again.");
    } finally {
      setBusy(null);
    }
  };

  const generateStrategy = async () => {
    if (busy || !selected) return;
    setBusy("strategy");
    setAiNote(null);
    try {
      const meta = metaResult
        ? { genreTags: metaResult.genreTags }
        : selected.metadata;
      const res = await fetch("/api/distribution/strategy", {
        method: "POST",
        headers: await jsonHeaders(),
        body: JSON.stringify(buildStrategyPayload(selected, meta)),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setAiNote("Out of Visual Bucs — top up and the AI bench is ready again.");
        return;
      }
      const parsed = parseStrategyResult(data);
      if (!res.ok || !parsed) {
        setAiNote(serverMessage(data, "Strategy generation failed — try again."));
        return;
      }
      setStrategyResult(parsed);
      refreshProfile();
    } catch {
      setAiNote("Strategy generation failed — try again.");
    } finally {
      setBusy(null);
    }
  };

  const saveAiPackage = async () => {
    if (busy || !selected || (!metaResult && !strategyResult)) return;
    setBusy("aisave");
    try {
      const res = await fetch(`/api/distribution/releases/${selected.id}`, {
        method: "PATCH",
        headers: await jsonHeaders(),
        body: JSON.stringify(buildAiSavePayload({ metadata: metaResult, strategy: strategyResult })),
      });
      if (!res.ok) {
        setAiNote("Couldn't save the AI package.");
        return;
      }
      setAiNote("AI package saved to the release.");
    } catch {
      setAiNote("Couldn't save the AI package.");
    } finally {
      setBusy(null);
    }
  };

  const mintSmartlink = async () => {
    if (busy || !selected) return;
    setBusy("mint");
    setSlNote(null);
    try {
      const res = await fetch(`/api/distribution/releases/${selected.id}/presave`, {
        method: "POST",
        headers: await authHeaders(),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSlNote(serverMessage(data, "Couldn't mint the pre-save link — try again."));
        return;
      }
      const { slug, url } = parsePresaveMint(data);
      if (!slug) {
        setSlNote("The link desk answered without a link. Try again.");
        return;
      }
      setMintedUrl(url);
      const updated = { ...selected, presaveSlug: slug };
      setSelected(updated);
      setSlNote("Your smartlink is live — it stays your release link after release day too.");
      void loadSmartlink(updated);
    } catch {
      setSlNote("Couldn't mint the pre-save link — try again.");
    } finally {
      setBusy(null);
    }
  };

  const saveSmartlinkSettings = async () => {
    if (busy || !selected || !slSettings) return;
    const problem = validateSmartlinkSettings(slSettings);
    if (problem) {
      setSlNote(problem);
      return;
    }
    setBusy("slsave");
    setSlNote(null);
    try {
      const res = await fetch(`/api/distribution/releases/${selected.id}/presave-settings`, {
        method: "PATCH",
        headers: await jsonHeaders(),
        body: JSON.stringify(buildPresaveSettingsPayload(slSettings)),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSlNote(serverMessage(data, "Couldn't save pre-save settings — try again."));
        return;
      }
      setSlNote("Smartlink settings saved.");
      void loadSmartlink(selected);
    } catch {
      setSlNote("Couldn't save pre-save settings — try again.");
    } finally {
      setBusy(null);
    }
  };

  const refreshPlatforms = async () => {
    if (busy || !selected) return;
    setBusy("platforms");
    try {
      const res = await fetch(`/api/distribution/releases/${selected.id}/platforms`, { headers: await authHeaders() });
      if (res.ok) {
        const statuses = parsePlatformStatuses(await res.json().catch(() => null));
        setSelected({ ...selected, platformStatuses: statuses });
      }
    } catch { /* the stored statuses stay on the card */ } finally {
      setBusy(null);
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const noteCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;
  const okCls = `text-xs font-semibold ${isLight ? "text-emerald-800" : "text-emerald-300"}`;
  const locked = selected !== null && selected.status !== "draft";
  const effectivePricing = pricing ?? undefined;
  const submitPrice = selected && effectivePricing ? submitPriceFor(effectivePricing, selected.releaseType) : null;
  const smartlinkHref = selected?.presaveSlug
    ? (mintedUrl ?? (typeof window !== "undefined" ? smartlinkUrl(window.location.origin, selected.presaveSlug) : `/presave/${selected.presaveSlug}`))
    : null;
  const checklist = submitChecklist.length > 0 ? submitChecklist : (selected?.checklist ?? []);
  const splitsOk = splitsValid(splits);
  const splitTotal = splitsTotal(splits);

  if (loadFailed) {
    return <NativeErrorState isLight={isLight} message="Your releases wouldn't open — nothing about them changed." onRetry={() => setTick((n) => n + 1)} />;
  }
  if (releases === null) {
    return <NativeLoadingState isLight={isLight} message="Opening the Release Desk…" />;
  }

  return (
    <div className="space-y-3" data-testid="world-release-desk">
      <p className={`text-sm ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
        {releases.length === 0
          ? "No releases yet — start your first one below, right here."
          : `${releases.length} release${releases.length === 1 ? "" : "s"}${vaulted > 0 ? ` · ${vaulted} in the catalog vault` : ""}`}
        {effectivePricing && !effectivePricing.aggregatorLive && effectivePricing.aggregator
          ? " · Delivery runs in sandbox simulation until the distributor is connected — statuses say so."
          : ""}
      </p>

      {releases.length > 0 ? (
        <div className="space-y-1.5" data-testid="world-release-list">
          {releases.map((r) => (
            <button
              key={r.id}
              type="button"
              data-testid="world-release-row"
              aria-pressed={selected?.id === r.id && !creating}
              onClick={() => void adoptRelease(r)}
              className={`flex w-full flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
                selected?.id === r.id && !creating
                  ? "border-[#d4af37] bg-[#d4af37]/10"
                  : isLight ? "border-[#C9A84C]/40 hover:border-[#d4af37]" : "border-white/10 hover:border-[#d4af37]/60"
              }`}
            >
              <Disc3 className="h-4 w-4 shrink-0 text-[#d4af37]" />
              <span className={`min-w-0 flex-1 truncate text-sm font-bold ${strong}`}>{r.title}</span>
              <span className={`text-xs ${muted}`}>{r.releaseType} · {r.status}{r.releaseDate ? ` · ${r.releaseDate}` : ""}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="world-release-new"
          onClick={() => {
            setCreating(true);
            setSelected(null);
            setDraft(emptyReleaseDraft());
            setError(null);
            setNote(null);
          }}
          className={chipBtn(isLight, creating)}
        >
          <Plus className="h-3.5 w-3.5" /> New release
        </button>
        {selected && !creating ? (
          <span className={`text-xs font-bold ${muted}`}>
            <Pencil className="mr-1 inline h-3.5 w-3.5" /> Editing “{selected.title}” — {selected.status}
            {locked ? " · packaged releases are locked; start a new release to change anything" : ""}
          </span>
        ) : null}
      </div>

      <ReleaseFormFields isLight={isLight} draft={draft} set={set} locked={locked} />

      {error ? <p className={noteCls} data-testid="world-release-error">{error}</p> : null}
      {note ? <p className={okCls} data-testid="world-release-note">{note}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {!locked ? (
          <button type="button" data-testid="world-release-save" onClick={() => void saveDraft()} disabled={busy !== null} className={goldBtn}>
            <Check className="h-4 w-4" /> {busy === "save" ? "Saving…" : creating ? "Create the draft — free" : "Save changes — free"}
          </button>
        ) : null}
        {selected && !creating && selected.status === "draft" ? (
          <>
            <button type="button" data-testid="world-release-barcode" onClick={() => void generateBarcode()} disabled={busy !== null} className={chipBtn(isLight, false)}>
              <Barcode className="h-3.5 w-3.5" /> {busy === "barcode" ? "Minting…" : "Generate internal barcode"}
            </button>
            <button type="button" data-testid="world-release-delete" onClick={() => void deleteDraft()} disabled={busy !== null} className={chipBtn(isLight, false)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete draft
            </button>
          </>
        ) : null}
      </div>

      {selected && !creating ? (
        <>
          {/* Checklist + submit */}
          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-release-checklist">
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Release checklist</p>
            <ul className="mt-2 space-y-1">
              {checklist.map((c) => (
                <li key={c.key} className={`flex items-start gap-2 text-xs ${muted}`}>
                  <span className={c.ok ? "text-emerald-500" : "text-amber-400"}>{c.ok ? "✓" : "•"}</span>
                  <span><strong className={strong}>{c.label}</strong>{c.ok ? "" : ` — ${c.hint}`}</span>
                </li>
              ))}
            </ul>
            {selected.status === "draft" ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" data-testid="world-release-submit" onClick={() => void submitRelease()} disabled={busy !== null || !checklistPasses(checklist)} className={goldBtn}>
                  <Disc3 className="h-4 w-4" /> {busy === "submit" ? "Submitting…" : submitPrice !== null ? `Submit for distribution — ${submitPrice.toLocaleString("en-US")} Visual Bucs` : "Submit for distribution"}
                </button>
                <span className={`text-xs ${muted}`}>
                  {checklistPasses(checklist)
                    ? "The price is confirmed before anything charges — the same ask the website makes."
                    : "Finish every checklist line and the submit button lights up."}
                </span>
              </div>
            ) : (
              <p className={`mt-2 text-xs font-semibold ${isLight ? "text-emerald-800" : "text-emerald-300"}`}>
                Submitted{selected.creditsCharged > 0 ? ` — ${selected.creditsCharged.toLocaleString("en-US")} Visual Bucs paid` : ""}. Delivery status is below.
              </p>
            )}
          </div>

          {/* Delivery status */}
          {selected.status !== "draft" || selected.platformStatuses.length > 0 ? (
            <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-release-delivery">
              <div className="flex flex-wrap items-center gap-2">
                <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Delivery</p>
                <button type="button" data-testid="world-release-delivery-refresh" onClick={() => void refreshPlatforms()} disabled={busy !== null} className={`${chipBtn(isLight, false)} ml-auto`}>
                  {busy === "platforms" ? "Checking…" : "Refresh status"}
                </button>
              </div>
              {selected.platformStatuses.length === 0 ? (
                <p className={`mt-2 text-xs ${muted}`}>No per-platform status yet — it lands here as the distributor reports it.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {selected.platformStatuses.map((p) => (
                    <li key={p.platform} className={`flex flex-wrap items-center gap-2 text-xs ${muted}`}>
                      <strong className={strong}>{platformLabel(p.platform)}</strong> · {platformStatusLabel(p.status)}
                      {p.detail ? <span>— {p.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {/* Splits */}
          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-release-splits">
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Royalty splits</p>
            <div className="mt-2 space-y-1.5">
              {splits.map((s, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <input aria-label={`Payee ${i + 1} name`} className={inputCls(isLight)} style={{ flex: "1 1 140px", width: "auto" }} value={s.name} placeholder="Payee name" onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <select aria-label={`Payee ${i + 1} role`} className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark", width: "auto" }} value={s.role ?? ""} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, role: e.target.value || undefined } : x)))}>
                    <option value="">{roleLabel("")}</option>
                    {SPLIT_ROLES.map((r) => (
                      <option key={r} value={r}>{roleLabel(r)}</option>
                    ))}
                  </select>
                  <input aria-label={`Payee ${i + 1} email`} className={inputCls(isLight)} style={{ flex: "1 1 160px", width: "auto" }} value={s.email ?? ""} placeholder="Email (optional)" onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                  <input aria-label={`Payee ${i + 1} share`} type="number" min={0} max={100} className={inputCls(isLight)} style={{ width: 90 }} value={Number.isFinite(s.share) ? s.share : ""} placeholder="%" onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) } : x)))} />
                  <button type="button" aria-label={`Remove payee ${i + 1}`} onClick={() => setSplits(splits.filter((_, j) => j !== i))} className={chipBtn(isLight, false)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" data-testid="world-release-split-add" onClick={() => setSplits([...splits, { name: "", role: "artist", share: 0 }])} className={chipBtn(isLight, false)}>
                <Plus className="h-3.5 w-3.5" /> Add a payee
              </button>
              <span className={`text-xs ${muted}`}>Total: {splitTotal}% — shares must total exactly 100%.</span>
              <button type="button" data-testid="world-release-splits-save" onClick={() => void saveSplits()} disabled={busy !== null || !splitsOk} className={`${goldBtn} ml-auto`}>
                {busy === "splits" ? "Saving…" : "Save splits — free"}
              </button>
            </div>
            <p className={`mt-1 text-[11px] ${muted}`}>Splits are accounting records for future earnings — saving a new version never rewrites past earnings.</p>
            {splitsNote ? <p className={`mt-1 ${noteCls}`}>{splitsNote}</p> : null}
          </div>

          {/* AI benches */}
          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-release-ai">
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Release AI</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input aria-label="The song's vibe" className={inputCls(isLight)} style={{ flex: "1 1 200px", width: "auto" }} value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder="Describe the song's vibe…" />
              <button type="button" data-testid="world-release-ai-metadata" onClick={() => void generateMetadata()} disabled={busy !== null} className={chipBtn(isLight, false)}>
                <Sparkles className="h-3.5 w-3.5" /> {busy === "metadata" ? "Writing…" : `Generate metadata${effectivePricing ? ` · ${effectivePricing.aiMetadataCost.toLocaleString("en-US")} Visual Bucs` : ""}`}
              </button>
              <button type="button" data-testid="world-release-ai-strategy" onClick={() => void generateStrategy()} disabled={busy !== null} className={chipBtn(isLight, false)}>
                <Sparkles className="h-3.5 w-3.5" /> {busy === "strategy" ? "Planning…" : `Generate strategy${effectivePricing ? ` · ${effectivePricing.aiStrategyCost.toLocaleString("en-US")} Visual Bucs` : ""}`}
              </button>
            </div>
            {metaResult ? (
              <div className={`mt-2 text-xs ${muted}`}>
                <p><strong className={strong}>Title ideas:</strong> {metaResult.titleOptions.join(" · ")}</p>
                {metaResult.description ? <p className="mt-1">{metaResult.description}</p> : null}
                {metaResult.genreTags.length > 0 ? <p className="mt-1">Tags: {metaResult.genreTags.join(", ")}</p> : null}
              </div>
            ) : null}
            {strategyResult ? (
              <div className={`mt-2 text-xs ${muted}`}>
                <p><strong className={strong}>Timing:</strong> {strategyResult.timing}</p>
                {strategyResult.promoPlan.length > 0 ? <p className="mt-1">{strategyResult.promoPlan.join(" · ")}</p> : null}
              </div>
            ) : null}
            {metaResult || strategyResult ? (
              <button type="button" data-testid="world-release-ai-save" onClick={() => void saveAiPackage()} disabled={busy !== null} className={`${chipBtn(isLight, false)} mt-2`}>
                {busy === "aisave" ? "Saving…" : "Save the AI package to this release — free"}
              </button>
            ) : null}
            {aiNote ? <p className={`mt-1 ${noteCls}`}>{aiNote}</p> : null}
          </div>

          {/* Smartlink / pre-save (#54) */}
          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-release-smartlink">
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Smartlink / pre-save</p>
            {!smartlinkHref ? (
              <div className="mt-2 space-y-2">
                <p className={`text-xs ${muted}`}>One link for every platform — fans pre-save before release day, and the same page becomes your release smartlink after.</p>
                <button type="button" data-testid="world-release-smartlink-mint" onClick={() => void mintSmartlink()} disabled={busy !== null} className={goldBtn}>
                  <Link2 className="h-4 w-4" /> {busy === "mint" ? "Minting…" : "Create my smartlink — free"}
                </button>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input aria-label="Smartlink URL" readOnly className={inputCls(isLight)} style={{ flex: "1 1 240px", width: "auto" }} value={smartlinkHref} />
                  <button
                    type="button"
                    data-testid="world-release-smartlink-copy"
                    onClick={() => {
                      void navigator.clipboard?.writeText(smartlinkHref).then(() => setSlNote("Smartlink copied.")).catch(() => setSlNote("Couldn't copy — select the link manually."));
                    }}
                    className={chipBtn(isLight, false)}
                  >
                    Copy link
                  </button>
                </div>
                {stats ? (
                  <div className="flex flex-wrap gap-2" data-testid="world-release-smartlink-analytics">
                    {stats.linkAnalytics ? (
                      <>
                        {[
                          `${stats.linkAnalytics.views.toLocaleString("en-US")} views`,
                          `${stats.linkAnalytics.clicks.toLocaleString("en-US")} clicks`,
                          `${stats.linkAnalytics.clicksLast7d.toLocaleString("en-US")} clicks in 7 days`,
                          `${stats.followers.toLocaleString("en-US")} pre-saves`,
                          `${stats.shares.toLocaleString("en-US")} shares`,
                        ].map((s) => (
                          <span key={s} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/10 text-white/60"}`}>{s}</span>
                        ))}
                      </>
                    ) : (
                      <span className={`text-xs ${muted}`}>View/click counting isn't collecting on this install yet — pre-saves: {stats.followers.toLocaleString("en-US")} · shares: {stats.shares.toLocaleString("en-US")}.</span>
                    )}
                  </div>
                ) : null}
                {stats?.linkAnalytics && stats.linkAnalytics.perLink.length > 0 ? (
                  <ul className="space-y-0.5">
                    {stats.linkAnalytics.perLink.map((l) => (
                      <li key={l.linkKey} className={`text-xs ${muted}`}>{l.linkTitle} — {l.clicks.toLocaleString("en-US")} clicks</li>
                    ))}
                  </ul>
                ) : null}
                {slSettings ? (
                  <div className="space-y-2" data-testid="world-release-smartlink-settings">
                    <label className="block">
                      <span className={fieldLabel(isLight)}>Page headline</span>
                      <input aria-label="Smartlink headline" className={inputCls(isLight)} value={slSettings.headline} onChange={(e) => setSlSettings({ ...slSettings, headline: e.target.value })} placeholder="e.g. The new single — out Friday" />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {SMARTLINK_LINK_PLATFORMS.map((p) => (
                        <label key={p.key} className="block">
                          <span className={fieldLabel(isLight)}>{p.label} link</span>
                          <input aria-label={`${p.label} smartlink`} className={inputCls(isLight)} value={slSettings.platformLinks[p.key] ?? ""} onChange={(e) => setSlSettings({ ...slSettings, platformLinks: { ...slSettings.platformLinks, [p.key]: e.target.value } })} placeholder={`https://… ${p.label}`} />
                        </label>
                      ))}
                    </div>
                    <label className="block">
                      <span className={fieldLabel(isLight)}>Bonus link (share to unlock)</span>
                      <input aria-label="Smartlink bonus link" className={inputCls(isLight)} value={slSettings.bonusUrl} onChange={(e) => setSlSettings({ ...slSettings, bonusUrl: e.target.value })} placeholder="https://…" />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="block">
                        <span className={fieldLabel(isLight)}>Meta Pixel ID</span>
                        <input aria-label="Meta Pixel ID" className={inputCls(isLight)} value={slSettings.pixels.metaPixelId ?? ""} onChange={(e) => setSlSettings({ ...slSettings, pixels: { ...slSettings.pixels, metaPixelId: e.target.value } })} placeholder="Digits only" />
                      </label>
                      <label className="block">
                        <span className={fieldLabel(isLight)}>TikTok Pixel ID</span>
                        <input aria-label="TikTok Pixel ID" className={inputCls(isLight)} value={slSettings.pixels.tiktokPixelId ?? ""} onChange={(e) => setSlSettings({ ...slSettings, pixels: { ...slSettings.pixels, tiktokPixelId: e.target.value } })} placeholder="Your TikTok pixel" />
                      </label>
                      <label className="block">
                        <span className={fieldLabel(isLight)}>Google tag ID</span>
                        <input aria-label="Google tag ID" className={inputCls(isLight)} value={slSettings.pixels.googleTagId ?? ""} onChange={(e) => setSlSettings({ ...slSettings, pixels: { ...slSettings.pixels, googleTagId: e.target.value } })} placeholder="G-…" />
                      </label>
                    </div>
                    <p className={`text-[11px] ${muted}`}>Pixels are YOUR ad accounts' IDs — the smartlink page fires only the ones you set, so fan visits build your retargeting audience. Blank clears one.</p>
                    <button type="button" data-testid="world-release-smartlink-save" onClick={() => void saveSmartlinkSettings()} disabled={busy !== null} className={goldBtn}>
                      {busy === "slsave" ? "Saving…" : "Save smartlink settings — free"}
                    </button>
                  </div>
                ) : (
                  <p className={`text-xs ${muted}`}>Loading your smartlink settings…</p>
                )}
              </div>
            )}
            {slNote ? <p className={`mt-1 ${noteCls}`}>{slNote}</p> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ─── The Promote Room section ────────────────────────────────────── */

export function ReleaseDeskSection({
  isLight,
  prefill,
  prefillNonce,
}: {
  isLight: boolean;
  prefill?: ReleasePrefill | null;
  prefillNonce?: number;
}) {
  return (
    <NativeCard isLight={isLight} title="Release Desk — distribution & smartlinks">
      <ReleaseDeskBody isLight={isLight} prefill={prefill} prefillNonce={prefillNonce} />
    </NativeCard>
  );
}

/* ─── The Cover Desk chip's standalone desk (Stack-100 #55) ─────────
   A finished cover's "Release it" chip opens THIS — the same release
   desk, prefilled with the cover as the release's artwork — right
   where the member stands. The release completes in-world; there
   is no /distribute tab-out anymore. */

export function ReleaseDeskStandalone({
  isLight,
  prefill,
}: {
  isLight: boolean;
  prefill: ReleasePrefill;
}) {
  return (
    <div
      className={`mt-3 rounded-2xl border p-3 ${isLight ? "border-[#C9A84C]/50 bg-white/40" : "border-[#d4af37]/30 bg-white/5"}`}
      data-testid="world-release-chip-desk"
    >
      <p className={`mb-2 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        Release this cover
      </p>
      <ReleaseDeskBody isLight={isLight} prefill={prefill} prefillNonce={1} />
    </div>
  );
}
