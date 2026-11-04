import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Barcode, Check, Disc3, Link2, Mail, Pencil, Plus, Share2, Sparkles, Trash2, X } from "lucide-react";
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
import { apiErrorMessage } from "@/lib/api-error";
import {
  SMARTLINK_LINK_PLATFORMS,
  buildAiSavePayload,
  buildMetadataPayload,
  buildPresaveSettingsPayload,
  buildReleasePayload,
  SPLIT_INVITE_PATH,
  SPLIT_SHARE_LINK_PATH,
  buildSplitInviteBody,
  buildSplitsPayload,
  buildStrategyPayload,
  checklistPasses,
  draftFromRelease,
  draftWithSong,
  emptyReleaseDraft,
  parseBarcodeResult,
  parseMetadataResult,
  parsePlatformStatuses,
  parsePresaveMint,
  parsePresaveStats,
  parseReleaseDetail,
  parseReleaseList,
  parseReleasePricing,
  parseReleaseSongs,
  parseSplitInviteResult,
  parseSplitShareLink,
  parseSplitsSave,
  parseStrategyResult,
  parseSubmitChecklist,
  parseSubmitResult,
  smartlinkUrl,
  splitInviteReady,
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
  type ReleaseSong,
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
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";

const chipBtn = (isLight: boolean, active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    active
      ? "border-[#d4af37] bg-[#d4af37] text-black"
      : isLight
        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
        : "border-white/15 text-white/75 hover:text-white"
  }`;

const fieldLabel = (isLight: boolean) =>
  `mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;

function serverMessage(data: unknown, fallback: string): string {
  return apiErrorMessage(data, fallback);
}

/* ─── The wizard form (create + edit share it) ────────────────────── */

function ReleaseFormFields({
  isLight,
  draft,
  set,
  setDraft,
  locked,
  songs,
}: {
  isLight: boolean;
  draft: ReleaseDraft;
  set: (patch: Partial<ReleaseDraft>) => void;
  setDraft: (d: ReleaseDraft) => void;
  locked: boolean;
  /** The member's song library (create mode) — picking one is the
   *  wizard's music step: it links the song and prefills from it. */
  songs?: ReleaseSong[];
}) {
  const { t } = useTranslation();
  const togglePlatform = (key: string) =>
    set({
      platforms: draft.platforms.includes(key)
        ? draft.platforms.filter((p) => p !== key)
        : [...draft.platforms, key],
    });
  return (
    <div className="space-y-2" data-testid="world-release-form">
      {songs ? (
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relSongPickerLabel")}</span>
          <select
            aria-label={t("worldScheduleRelease.relSongPickerAria")}
            data-testid="world-release-song-picker"
            className={inputCls(isLight)}
            style={{ colorScheme: isLight ? "light" : "dark" }}
            value={draft.songId ?? ""}
            disabled={locked}
            onChange={(e) => {
              const song = songs.find((s) => s.id === e.target.value) ?? null;
              setDraft(draftWithSong(draft, song));
            }}
          >
            <option value="">{t("worldScheduleRelease.relNoSongOption")}</option>
            {songs.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relTitleLabel")}</span>
          <input aria-label={t("worldScheduleRelease.relTitleLabel")} className={inputCls(isLight)} value={draft.title} disabled={locked} onChange={(e) => set({ title: e.target.value })} placeholder={t("worldScheduleRelease.relTitleLabel")} />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relArtistLabel")}</span>
          <input aria-label={t("worldScheduleRelease.relArtistLabel")} className={inputCls(isLight)} value={draft.artistName} disabled={locked} onChange={(e) => set({ artistName: e.target.value })} placeholder={t("worldScheduleRelease.relArtistLabel")} />
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relTypeLabel")}</span>
          <select aria-label={t("worldScheduleRelease.relTypeLabel")} className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={draft.releaseType} disabled={locked} onChange={(e) => set({ releaseType: e.target.value })}>
            <option value="single">{t("worldScheduleRelease.relTypeSingle")}</option>
            <option value="ep">{t("worldScheduleRelease.relTypeEp")}</option>
            <option value="album">{t("worldScheduleRelease.relTypeAlbum")}</option>
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relDateLabel")}</span>
          <input aria-label={t("worldScheduleRelease.relDateLabel")} type="date" className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={draft.releaseDate} disabled={locked} onChange={(e) => set({ releaseDate: e.target.value })} />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("distribute.genre")}</span>
          <input aria-label={t("distribute.genre")} className={inputCls(isLight)} value={draft.genre} disabled={locked} onChange={(e) => set({ genre: e.target.value })} placeholder={t("worldScheduleRelease.relGenrePlaceholder")} />
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relAudioLabel")}</span>
        <input aria-label={t("worldScheduleRelease.relAudioLabel")} className={inputCls(isLight)} value={draft.audioUrl} disabled={locked} onChange={(e) => set({ audioUrl: e.target.value })} placeholder={t("worldScheduleRelease.relAudioPlaceholder")} />
      </label>
      <label className="block">
        <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relArtworkLabel")}</span>
        <input aria-label={t("worldScheduleRelease.relArtworkLabel")} className={inputCls(isLight)} value={draft.artworkUrl} disabled={locked} onChange={(e) => set({ artworkUrl: e.target.value })} placeholder={t("worldScheduleRelease.relArtworkPlaceholder")} />
      </label>

      <div>
        <span className={fieldLabel(isLight)}>{t("distribute.platforms")}</span>
        <div className="flex flex-wrap gap-1.5" data-testid="world-release-platforms">
          {DISTRIBUTION_PLATFORMS.map((p) => (
            <button key={p.key} type="button" disabled={locked} aria-pressed={draft.platforms.includes(p.key)} onClick={() => togglePlatform(p.key)} className={chipBtn(isLight, draft.platforms.includes(p.key))}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className={fieldLabel(isLight)}>{t("distribute.tracks_2")}</span>
        <div className="space-y-1.5">
          {draft.tracks.map((track, i) => (
            <div key={i} className="flex gap-2">
              <input aria-label={t("distribute.trackTitle", { n: i + 1 })} className={inputCls(isLight)} value={track.title} disabled={locked} placeholder={t("distribute.trackTitle", { n: i + 1 })} onChange={(e) => set({ tracks: draft.tracks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
              <input aria-label={t("worldScheduleRelease.relTrackIsrcAria", { n: i + 1 })} className={inputCls(isLight)} style={{ maxWidth: 170 }} value={track.isrc} disabled={locked} placeholder={t("worldScheduleRelease.relTrackIsrcPlaceholder")} onChange={(e) => set({ tracks: draft.tracks.map((x, j) => (j === i ? { ...x, isrc: e.target.value } : x)) })} />
              {draft.tracks.length > 1 && !locked ? (
                <button type="button" aria-label={t("worldScheduleRelease.relRemoveTrackAria", { n: i + 1 })} onClick={() => set({ tracks: draft.tracks.filter((_, j) => j !== i) })} className={chipBtn(isLight, false)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {!locked ? (
          <button type="button" data-testid="world-release-track-add" onClick={() => set({ tracks: [...draft.tracks, { title: "", isrc: "" }] })} className={`${chipBtn(isLight, false)} mt-1.5`}>
            <Plus className="h-3.5 w-3.5" /> {t("worldScheduleRelease.relAddTrack")}
          </button>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relIsrcLabel")}</span>
          <input aria-label={t("worldScheduleRelease.relIsrcAria")} className={inputCls(isLight)} value={draft.isrc} disabled={locked} onChange={(e) => set({ isrc: e.target.value })} placeholder="USABC2412345" />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relSubgenreLabel")}</span>
          <input aria-label={t("worldScheduleRelease.relSubgenreLabel")} className={inputCls(isLight)} value={draft.subgenre} disabled={locked} onChange={(e) => set({ subgenre: e.target.value })} placeholder={t("worldScheduleRelease.relSubgenrePlaceholder")} />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relLabelLabel")}</span>
          <input aria-label={t("worldScheduleRelease.relLabelLabel")} className={inputCls(isLight)} value={draft.label} disabled={locked} onChange={(e) => set({ label: e.target.value })} placeholder={t("worldScheduleRelease.relLabelPlaceholder")} />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relImprintLabel")}</span>
          <input aria-label={t("worldScheduleRelease.relImprintLabel")} className={inputCls(isLight)} value={draft.labelImprint} disabled={locked} onChange={(e) => set({ labelImprint: e.target.value })} placeholder={t("worldScheduleRelease.relImprintPlaceholder")} />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relCLineLabel")}</span>
          <input aria-label={t("worldScheduleRelease.relCLineAria")} className={inputCls(isLight)} value={draft.copyrightCLine} disabled={locked} onChange={(e) => set({ copyrightCLine: e.target.value })} placeholder={t("worldScheduleRelease.relCLinePlaceholder")} />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relPLineLabel")}</span>
          <input aria-label={t("worldScheduleRelease.relPLineAria")} className={inputCls(isLight)} value={draft.copyrightPLine} disabled={locked} onChange={(e) => set({ copyrightPLine: e.target.value })} placeholder={t("worldScheduleRelease.relPLinePlaceholder")} />
        </label>
      </div>

      <div>
        <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relUpcLabel")}</span>
        <div className="flex gap-2">
          <input aria-label={t("worldScheduleRelease.relUpcAria")} className={inputCls(isLight)} value={draft.upc} disabled={locked} onChange={(e) => set({ upc: e.target.value })} placeholder={t("worldScheduleRelease.relUpcPlaceholder")} />
          <select aria-label={t("worldScheduleRelease.relUpcKindAria")} className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark", width: "auto" }} value={draft.upcKind} disabled={locked} onChange={(e) => set({ upcKind: e.target.value })}>
            <option value="internal">{t("worldScheduleRelease.relUpcInternal")}</option>
            <option value="official">{t("worldScheduleRelease.relUpcOfficial")}</option>
          </select>
        </div>
        <p className={`mt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          {t("worldScheduleRelease.relUpcNote")}
        </p>
      </div>

      <div>
        <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relExplicitLabel")}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" disabled={locked} aria-pressed={draft.explicit === false} onClick={() => set({ explicit: false })} className={chipBtn(isLight, draft.explicit === false)}>{t("worldScheduleRelease.relClean")}</button>
          <button type="button" disabled={locked} aria-pressed={draft.explicit === true} onClick={() => set({ explicit: true })} className={chipBtn(isLight, draft.explicit === true)}>{t("distribute.explicit")}</button>
          <label className={`ml-2 inline-flex items-center gap-2 text-xs font-semibold bdv-touch-target ${isLight ? "text-[#6B5B36]" : "text-white/60"}`}>
            <input type="checkbox" checked={draft.explicitConfirmed} disabled={locked} onChange={(e) => set({ explicitConfirmed: e.target.checked })} />
            {t("worldScheduleRelease.relConfirmDeclaration")}
          </label>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relTerritoriesLabel")}</span>
          <select aria-label={t("worldScheduleRelease.relTerritoriesAria")} className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={draft.territoriesMode} disabled={locked} onChange={(e) => set({ territoriesMode: e.target.value })}>
            <option value="worldwide">{t("worldScheduleRelease.relTerrWorldwide")}</option>
            <option value="include">{t("worldScheduleRelease.relTerrInclude")}</option>
            <option value="exclude">{t("worldScheduleRelease.relTerrExclude")}</option>
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relTerrCodesLabel")}</span>
          <input aria-label={t("worldScheduleRelease.relTerrCodesLabel")} className={inputCls(isLight)} value={draft.territoriesText} disabled={locked || draft.territoriesMode === "worldwide"} onChange={(e) => set({ territoriesText: e.target.value })} placeholder={t("worldScheduleRelease.relTerrCodesPlaceholder")} />
        </label>
        <label className="block">
          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relPreorderLabel")}</span>
          <input aria-label={t("worldScheduleRelease.relPreorderLabel")} type="date" className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={draft.preorderDate} disabled={locked} onChange={(e) => set({ preorderDate: e.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relLyricsLabel")}</span>
        <textarea aria-label={t("worldScheduleRelease.relLyricsAria")} className={inputCls(isLight)} rows={3} value={draft.lyrics} disabled={locked} onChange={(e) => set({ lyrics: e.target.value })} placeholder={t("worldScheduleRelease.relLyricsPlaceholder")} />
      </label>
    </div>
  );
}

/* ─── The desk body (list + wizard + editor + smartlink) ──────────── */

function ReleaseDeskBody({ isLight, prefill, prefillNonce }: { isLight: boolean; prefill?: ReleasePrefill | null; prefillNonce?: number }) {
  const { t, i18n } = useTranslation();
  const authHeaders = useReleaseAuthHeaders();
  const { refreshProfile } = useAuth();

  const [pricing, setPricing] = useState<ReleasePricing | null>(null);
  const [releases, setReleases] = useState<ReleaseDetail[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [vaulted, setVaulted] = useState(0);
  const [tick, setTick] = useState(0);

  const [selected, setSelected] = useState<ReleaseDetail | null>(null);
  const [songs, setSongs] = useState<ReleaseSong[]>([]);
  const [draft, setDraft] = useState<ReleaseDraft>(() => emptyReleaseDraft(prefill));
  const [creating, setCreating] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitChecklist, setSubmitChecklist] = useState<ReturnType<typeof parseSubmitChecklist>>([]);

  /* Splits (selected release). */
  const [splits, setSplits] = useState<RoyaltySplit[]>([]);
  const [splitsNote, setSplitsNote] = useState<string | null>(null);
  /* Item 99: the minted agreement share link (the invite fallback
     when no email provider is configured, and the shareable door). */
  const [splitLink, setSplitLink] = useState<string | null>(null);

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

  /* The wizard's music step: the member's song library (best-effort —
   *  an empty library still leaves the audio-link field working). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/songs", { headers: await authHeaders() });
        if (!cancelled && res.ok) setSongs(parseReleaseSongs(await res.json().catch(() => null)));
      } catch { /* the link field is the fallback, never a dead end */ }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const problem = validateReleaseDraft(draft, {
      titleArtist: t("worldScheduleRelease.relValTitleArtist"),
      explicit: t("worldScheduleRelease.relValExplicit"),
      platforms: t("worldScheduleRelease.relValPlatforms"),
      audio: t("worldScheduleRelease.relValAudio"),
      tracks: t("worldScheduleRelease.relValTracks"),
      releaseDate: t("worldScheduleRelease.relValDate"),
    });
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
        body: JSON.stringify(buildReleasePayload(draft, { forCreate: creating })),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(serverMessage(data, t("worldScheduleRelease.relSaveFailedFallback")));
        return;
      }
      const saved = parseReleaseDetail(data);
      if (!saved) {
        setError(t("worldScheduleRelease.relSaveNoRelease"));
        return;
      }
      setNote(creating ? t("worldScheduleRelease.relCreatedNote") : t("worldScheduleRelease.relSavedNote"));
      await adoptRelease(saved);
      setTick((n) => n + 1);
    } catch {
      setError(t("worldScheduleRelease.relNoAnswer"));
    } finally {
      setBusy(null);
    }
  };

  /* Paid submit — the 2D page's confirmation law, verbatim shape. */
  const submitRelease = async () => {
    if (busy || !selected || selected.status !== "draft" || !pricing) return;
    const price = submitPriceFor(pricing, selected.releaseType);
    if (typeof window !== "undefined" && !window.confirm(
      t("worldScheduleRelease.relSubmitConfirm", {
        title: selected.title,
        price,
        platforms: selected.platforms.map(platformLabel).join(", ") || t("worldScheduleRelease.relYourPlatforms"),
      }),
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
        setError(t("worldScheduleRelease.relSubmitOutOfBucs"));
        return;
      }
      if (!res.ok) {
        const checklist = parseSubmitChecklist(data);
        if (checklist.length > 0) setSubmitChecklist(checklist);
        setError(serverMessage(data, t("worldScheduleRelease.relSubmitFailedFallback")));
        return;
      }
      const result = parseSubmitResult(data);
      if (result.release) await adoptRelease(result.release);
      setNote(result.notice ?? t("worldScheduleRelease.relSubmittedFallback"));
      refreshProfile();
      setTick((n) => n + 1);
    } catch {
      setError(t("worldScheduleRelease.relNoAnswer"));
    } finally {
      setBusy(null);
    }
  };

  const deleteDraft = async () => {
    if (busy || !selected || selected.status !== "draft") return;
    if (typeof window !== "undefined" && !window.confirm(t("worldScheduleRelease.relDeleteConfirm"))) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/distribution/releases/${selected.id}`, { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) {
        setError(t("worldScheduleRelease.relDeleteFailed"));
        return;
      }
      setSelected(null);
      setCreating(true);
      setDraft(emptyReleaseDraft());
      setNote(t("worldScheduleRelease.relDeletedNote"));
      setTick((n) => n + 1);
    } catch {
      setError(t("worldScheduleRelease.relDeleteFailed"));
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
        setError(serverMessage(data, t("worldScheduleRelease.relBarcodeFailedFallback")));
        return;
      }
      const { barcode, notice } = parseBarcodeResult(data);
      const updated = parseReleaseDetail(data);
      if (updated) await adoptRelease(updated);
      if (barcode) set({ upc: barcode, upcKind: "internal" });
      setNote(notice ?? t("worldScheduleRelease.relBarcodeMintedFallback"));
    } catch {
      setError(t("worldScheduleRelease.relBarcodeNoAnswer"));
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
        setSplitsNote(serverMessage(data, t("worldScheduleRelease.relSplitsSaveFailedFallback")));
        return;
      }
      const { splits: saved, agreementVersion } = parseSplitsSave(data);
      if (saved.length > 0) setSplits(saved);
      setSplitsNote(
        agreementVersion && agreementVersion > 1
          ? t("worldScheduleRelease.relSplitsSavedVersioned", { version: agreementVersion })
          : t("worldScheduleRelease.relSplitsSaved"),
      );
    } catch {
      setSplitsNote(t("worldScheduleRelease.relSplitsSaveFailed"));
    } finally {
      setBusy(null);
    }
  };

  /* Item 99: invite a saved payee by the email on their split row —
     the REAL rail (POST .../splits/invite), the same one the 2D
     /distribute page uses. The payee is marked "invited" only from
     the server's recorded answer, never from the click. Free:
     splits are percentages of your own release. */
  const invitePayee = async (split: RoyaltySplit) => {
    if (busy || !selected || !splitInviteReady(split)) return;
    const body = buildSplitInviteBody(split);
    if (!body) return;
    setBusy("split-invite");
    setSplitsNote(null);
    try {
      const res = await fetch(SPLIT_INVITE_PATH(selected.id), {
        method: "POST",
        headers: await jsonHeaders(),
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSplitsNote(serverMessage(data, t("worldScheduleRelease.relInviteFailedFallback")));
        return;
      }
      const result = parseSplitInviteResult(data);
      if (result.recorded) {
        setSplits((prev) => prev.map((x) => (x.id === split.id ? { ...x, inviteStatus: "invited" } : x)));
        setSplitsNote(
          result.emailSent
            ? t("worldScheduleRelease.relInviteSent", { email: split.email })
            : result.note ?? t("worldScheduleRelease.relInviteRecordedFallback"),
        );
      } else {
        setSplitsNote(t("worldScheduleRelease.relInviteNotRecorded"));
      }
    } catch {
      setSplitsNote(t("worldScheduleRelease.relInviteFailed"));
    } finally {
      setBusy(null);
    }
  };

  /* Item 99: mint (idempotently) the public agreement share link —
     the share-by-link door beside the email invite. */
  const shareSplitLink = async () => {
    if (busy || !selected) return;
    setBusy("split-share");
    setSplitsNote(null);
    try {
      const res = await fetch(SPLIT_SHARE_LINK_PATH(selected.id), {
        method: "POST",
        headers: await jsonHeaders(),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSplitsNote(serverMessage(data, t("worldScheduleRelease.relShareFailedFallback")));
        return;
      }
      const link = parseSplitShareLink(data);
      if (link) {
        setSplitLink(link.url);
        setSplitsNote(t("worldScheduleRelease.relShareReady"));
      } else {
        setSplitsNote(t("worldScheduleRelease.relShareNoLink"));
      }
    } catch {
      setSplitsNote(t("worldScheduleRelease.relShareFailed"));
    } finally {
      setBusy(null);
    }
  };

  const generateMetadata = async () => {
    if (busy || !selected) return;
    if (!vibe.trim()) {
      setAiNote(t("worldScheduleRelease.relAiNeedVibe"));
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
        setAiNote(t("worldScheduleRelease.relAiOutOfBucs"));
        return;
      }
      const parsed = parseMetadataResult(data);
      if (!res.ok || !parsed) {
        setAiNote(serverMessage(data, t("worldScheduleRelease.relAiMetaFailed")));
        return;
      }
      setMetaResult(parsed);
      refreshProfile();
    } catch {
      setAiNote(t("worldScheduleRelease.relAiMetaFailed"));
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
        setAiNote(t("worldScheduleRelease.relAiOutOfBucs"));
        return;
      }
      const parsed = parseStrategyResult(data);
      if (!res.ok || !parsed) {
        setAiNote(serverMessage(data, t("worldScheduleRelease.relAiStrategyFailed")));
        return;
      }
      setStrategyResult(parsed);
      refreshProfile();
    } catch {
      setAiNote(t("worldScheduleRelease.relAiStrategyFailed"));
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
        setAiNote(t("worldScheduleRelease.relAiSaveFailed"));
        return;
      }
      setAiNote(t("worldScheduleRelease.relAiSaved"));
    } catch {
      setAiNote(t("worldScheduleRelease.relAiSaveFailed"));
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
        setSlNote(serverMessage(data, t("worldScheduleRelease.relMintFailed")));
        return;
      }
      const { slug, url } = parsePresaveMint(data);
      if (!slug) {
        setSlNote(t("worldScheduleRelease.relMintNoLink"));
        return;
      }
      setMintedUrl(url);
      const updated = { ...selected, presaveSlug: slug };
      setSelected(updated);
      setSlNote(t("worldScheduleRelease.relMintedNote"));
      void loadSmartlink(updated);
    } catch {
      setSlNote(t("worldScheduleRelease.relMintFailed"));
    } finally {
      setBusy(null);
    }
  };

  const saveSmartlinkSettings = async () => {
    if (busy || !selected || !slSettings) return;
    const problem = validateSmartlinkSettings(slSettings, {
      metaPixel: t("worldScheduleRelease.relValMetaPixel"),
      tiktokPixel: t("worldScheduleRelease.relValTiktokPixel"),
      googleTag: t("worldScheduleRelease.relValGoogleTag"),
    });
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
        setSlNote(serverMessage(data, t("worldScheduleRelease.relSlSaveFailed")));
        return;
      }
      setSlNote(t("worldScheduleRelease.relSlSaved"));
      void loadSmartlink(selected);
    } catch {
      setSlNote(t("worldScheduleRelease.relSlSaveFailed"));
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
    return <NativeErrorState isLight={isLight} message={t("worldScheduleRelease.relLoadFailed")} onRetry={() => setTick((n) => n + 1)} />;
  }
  if (releases === null) {
    return <NativeLoadingState isLight={isLight} message={t("worldScheduleRelease.relLoading")} />;
  }

  return (
    <div className="space-y-3" data-testid="world-release-desk">
      <p className={`text-sm ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
        {releases.length === 0
          ? t("worldScheduleRelease.relNoneYet")
          : t(releases.length === 1 ? "worldScheduleRelease.relCountOne" : "worldScheduleRelease.relCountMany", { count: releases.length })}
        {releases.length > 0 && vaulted > 0
          ? t("worldScheduleRelease.relVaultSuffix", { count: vaulted })
          : ""}
        {effectivePricing && !effectivePricing.aggregatorLive && effectivePricing.aggregator
          ? t("worldScheduleRelease.relSandboxNote")
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
          <Plus className="h-3.5 w-3.5" /> {t("worldScheduleRelease.relNewRelease")}
        </button>
        {selected && !creating ? (
          <span className={`text-xs font-bold ${muted}`}>
            <Pencil className="mr-1 inline h-3.5 w-3.5" /> {t("worldScheduleRelease.relEditingLine", { title: selected.title, status: selected.status })}
            {locked ? t("worldScheduleRelease.relLockedSuffix") : ""}
          </span>
        ) : null}
      </div>

      <ReleaseFormFields isLight={isLight} draft={draft} set={set} setDraft={setDraft} locked={locked} songs={creating ? songs : undefined} />

      {error ? <p className={noteCls} data-testid="world-release-error">{error}</p> : null}
      {note ? <p className={okCls} data-testid="world-release-note">{note}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {!locked ? (
          <button type="button" data-testid="world-release-save" onClick={() => void saveDraft()} disabled={busy !== null} className={goldBtn}>
            <Check className="h-4 w-4" /> {busy === "save" ? t("worldScheduleRelease.relSaving") : creating ? t("worldScheduleRelease.relCreateDraft") : t("worldScheduleRelease.relSaveChangesFree")}
          </button>
        ) : null}
        {selected && !creating && selected.status === "draft" ? (
          <>
            <button type="button" data-testid="world-release-barcode" onClick={() => void generateBarcode()} disabled={busy !== null} className={chipBtn(isLight, false)}>
              <Barcode className="h-3.5 w-3.5" /> {busy === "barcode" ? t("worldScheduleRelease.relBusyMinting") : t("worldScheduleRelease.relGenerateBarcode")}
            </button>
            <button type="button" data-testid="world-release-delete" onClick={() => void deleteDraft()} disabled={busy !== null} className={chipBtn(isLight, false)}>
              <Trash2 className="h-3.5 w-3.5" /> {t("worldScheduleRelease.relDeleteDraft")}
            </button>
          </>
        ) : null}
      </div>

      {selected && !creating ? (
        <>
          {/* Checklist + submit */}
          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-release-checklist">
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("distribute.release_checklist")}</p>
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
                  <Disc3 className="h-4 w-4" /> {busy === "submit" ? t("worldScheduleRelease.relSubmitBusy") : submitPrice !== null ? t("worldScheduleRelease.relSubmitButton", { price: submitPrice.toLocaleString(i18n.language) }) : t("worldScheduleRelease.relSubmitPlain")}
                </button>
                <span className={`text-xs ${muted}`}>
                  {checklistPasses(checklist)
                    ? t("worldScheduleRelease.relSubmitReadyNote")
                    : t("worldScheduleRelease.relSubmitBlockedNote")}
                </span>
              </div>
            ) : (
              <p className={`mt-2 text-xs font-semibold ${isLight ? "text-emerald-800" : "text-emerald-300"}`}>
                {selected.creditsCharged > 0
                  ? t("worldScheduleRelease.relSubmittedPaid", { amount: selected.creditsCharged.toLocaleString(i18n.language) })
                  : t("worldScheduleRelease.relSubmittedPlain")}
              </p>
            )}
          </div>

          {/* Delivery status */}
          {selected.status !== "draft" || selected.platformStatuses.length > 0 ? (
            <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-release-delivery">
              <div className="flex flex-wrap items-center gap-2">
                <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldScheduleRelease.relDeliveryTitle")}</p>
                <button type="button" data-testid="world-release-delivery-refresh" onClick={() => void refreshPlatforms()} disabled={busy !== null} className={`${chipBtn(isLight, false)} ml-auto`}>
                  {busy === "platforms" ? t("worldScheduleRelease.relDeliveryRefreshBusy") : t("worldScheduleRelease.relDeliveryRefresh")}
                </button>
              </div>
              {selected.platformStatuses.length === 0 ? (
                <p className={`mt-2 text-xs ${muted}`}>{t("worldScheduleRelease.relDeliveryEmpty")}</p>
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
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("distribute.royalty_splits")}</p>
            <div className="mt-2 space-y-1.5">
              {splits.map((s, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <input aria-label={t("worldScheduleRelease.relPayeeNameAria", { n: i + 1 })} className={inputCls(isLight)} style={{ flex: "1 1 140px", width: "auto" }} value={s.name} placeholder={t("worldScheduleRelease.relPayeeNamePlaceholder")} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <select aria-label={t("worldScheduleRelease.relPayeeRoleAria", { n: i + 1 })} className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark", width: "auto" }} value={s.role ?? ""} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, role: e.target.value || undefined } : x)))}>
                    <option value="">{roleLabel("")}</option>
                    {SPLIT_ROLES.map((r) => (
                      <option key={r} value={r}>{roleLabel(r)}</option>
                    ))}
                  </select>
                  <input aria-label={t("worldScheduleRelease.relPayeeEmailAria", { n: i + 1 })} className={inputCls(isLight)} style={{ flex: "1 1 160px", width: "auto" }} value={s.email ?? ""} placeholder={t("worldScheduleRelease.relPayeeEmailPlaceholder")} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                  <input aria-label={t("worldScheduleRelease.relPayeeShareAria", { n: i + 1 })} type="number" min={0} max={100} className={inputCls(isLight)} style={{ width: 90 }} value={Number.isFinite(s.share) ? s.share : ""} placeholder="%" onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) } : x)))} />
                  <button type="button" aria-label={t("worldScheduleRelease.relRemovePayeeAria", { n: i + 1 })} onClick={() => setSplits(splits.filter((_, j) => j !== i))} className={chipBtn(isLight, false)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {s.id ? (
                    <button
                      type="button"
                      data-testid={`world-release-split-invite-${i}`}
                      onClick={() => void invitePayee(s)}
                      disabled={busy !== null || !splitInviteReady(s)}
                      title={splitInviteReady(s) ? t("worldScheduleRelease.relInviteTitleReady") : t("worldScheduleRelease.relInviteTitleNoEmail")}
                      className={chipBtn(isLight, false)}
                    >
                      <Mail className="h-3.5 w-3.5" /> {s.inviteStatus === "invited" ? t("worldScheduleRelease.relInviteAgain") : t("worldScheduleRelease.relInviteByEmail")}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" data-testid="world-release-split-add" onClick={() => setSplits([...splits, { name: "", role: "artist", share: 0 }])} className={chipBtn(isLight, false)}>
                <Plus className="h-3.5 w-3.5" /> {t("worldScheduleRelease.relAddPayee")}
              </button>
              <span className={`text-xs ${muted}`}>{t("worldScheduleRelease.relSplitTotal", { total: splitTotal })}</span>
              <button type="button" data-testid="world-release-splits-save" onClick={() => void saveSplits()} disabled={busy !== null || !splitsOk} className={`${goldBtn} ml-auto`}>
                {busy === "splits" ? t("worldScheduleRelease.relSaving") : t("worldScheduleRelease.relSaveSplits")}
              </button>
              <button type="button" data-testid="world-release-split-share" onClick={() => void shareSplitLink()} disabled={busy !== null} className={chipBtn(isLight, false)}>
                <Share2 className="h-3.5 w-3.5" /> {busy === "split-share" ? t("worldScheduleRelease.relBusyMinting") : t("worldScheduleRelease.relShareLink")}
              </button>
            </div>
            {splitLink ? (
              <p className={`mt-1 text-[11px] ${muted}`} data-testid="world-release-split-link">
                {t("worldScheduleRelease.relSplitLinkPrefix")} <span className={strong}>{splitLink}</span>{t("worldScheduleRelease.relSplitLinkSuffix")}
              </p>
            ) : null}
            <p className={`mt-1 text-[11px] ${muted}`}>{t("worldScheduleRelease.relInviteHint")}</p>
            <p className={`mt-1 text-[11px] ${muted}`}>{t("worldScheduleRelease.relSplitsAccountingNote")}</p>
            {splitsNote ? <p className={`mt-1 ${noteCls}`}>{splitsNote}</p> : null}
          </div>

          {/* AI benches */}
          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-release-ai">
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldScheduleRelease.relAiTitle")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input aria-label={t("worldScheduleRelease.relVibeAria")} className={inputCls(isLight)} style={{ flex: "1 1 200px", width: "auto" }} value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder={t("worldScheduleRelease.relVibePlaceholder")} />
              <button type="button" data-testid="world-release-ai-metadata" onClick={() => void generateMetadata()} disabled={busy !== null} className={chipBtn(isLight, false)}>
                <Sparkles className="h-3.5 w-3.5" /> {busy === "metadata" ? t("worldScheduleRelease.relAiBusyMeta") : `${t("worldScheduleRelease.relAiMetaButton")}${effectivePricing ? t("worldScheduleRelease.relAiCostSuffix", { cost: effectivePricing.aiMetadataCost.toLocaleString(i18n.language) }) : ""}`}
              </button>
              <button type="button" data-testid="world-release-ai-strategy" onClick={() => void generateStrategy()} disabled={busy !== null} className={chipBtn(isLight, false)}>
                <Sparkles className="h-3.5 w-3.5" /> {busy === "strategy" ? t("worldScheduleRelease.relAiBusyStrategy") : `${t("worldScheduleRelease.relAiStrategyButton")}${effectivePricing ? t("worldScheduleRelease.relAiCostSuffix", { cost: effectivePricing.aiStrategyCost.toLocaleString(i18n.language) }) : ""}`}
              </button>
            </div>
            {metaResult ? (
              <div className={`mt-2 text-xs ${muted}`}>
                <p><strong className={strong}>{t("worldScheduleRelease.relAiTitleIdeas")}</strong> {metaResult.titleOptions.join(" · ")}</p>
                {metaResult.description ? <p className="mt-1">{metaResult.description}</p> : null}
                {metaResult.genreTags.length > 0 ? <p className="mt-1">{t("worldScheduleRelease.relAiTagsLine", { tags: metaResult.genreTags.join(", ") })}</p> : null}
              </div>
            ) : null}
            {strategyResult ? (
              <div className={`mt-2 text-xs ${muted}`}>
                <p><strong className={strong}>{t("distribute.timing")}:</strong> {strategyResult.timing}</p>
                {strategyResult.promoPlan.length > 0 ? <p className="mt-1">{strategyResult.promoPlan.join(" · ")}</p> : null}
              </div>
            ) : null}
            {metaResult || strategyResult ? (
              <button type="button" data-testid="world-release-ai-save" onClick={() => void saveAiPackage()} disabled={busy !== null} className={`${chipBtn(isLight, false)} mt-2`}>
                {busy === "aisave" ? t("worldScheduleRelease.relSaving") : t("worldScheduleRelease.relAiSaveButton")}
              </button>
            ) : null}
            {aiNote ? <p className={`mt-1 ${noteCls}`}>{aiNote}</p> : null}
          </div>

          {/* Smartlink / pre-save (#54) */}
          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-release-smartlink">
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldScheduleRelease.relSmartlinkTitle")}</p>
            {!smartlinkHref ? (
              <div className="mt-2 space-y-2">
                <p className={`text-xs ${muted}`}>{t("worldScheduleRelease.relSmartlinkIntro")}</p>
                <button type="button" data-testid="world-release-smartlink-mint" onClick={() => void mintSmartlink()} disabled={busy !== null} className={goldBtn}>
                  <Link2 className="h-4 w-4" /> {busy === "mint" ? t("worldScheduleRelease.relBusyMinting") : t("worldScheduleRelease.relSmartlinkMint")}
                </button>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input aria-label={t("worldScheduleRelease.relSmartlinkUrlAria")} readOnly className={inputCls(isLight)} style={{ flex: "1 1 240px", width: "auto" }} value={smartlinkHref} />
                  <button
                    type="button"
                    data-testid="world-release-smartlink-copy"
                    onClick={() => {
                      void navigator.clipboard?.writeText(smartlinkHref).then(() => setSlNote(t("worldScheduleRelease.relSmartlinkCopied"))).catch(() => setSlNote(t("worldScheduleRelease.relCopyFailed")));
                    }}
                    className={chipBtn(isLight, false)}
                  >
                    {t("worldScheduleRelease.relCopyLink")}
                  </button>
                </div>
                {stats ? (
                  <div className="flex flex-wrap gap-2" data-testid="world-release-smartlink-analytics">
                    {stats.linkAnalytics ? (
                      <>
                        {[
                          t("worldScheduleRelease.relStatViews", { count: stats.linkAnalytics.views.toLocaleString(i18n.language) }),
                          t("worldScheduleRelease.relStatClicks", { count: stats.linkAnalytics.clicks.toLocaleString(i18n.language) }),
                          t("worldScheduleRelease.relStatClicks7d", { count: stats.linkAnalytics.clicksLast7d.toLocaleString(i18n.language) }),
                          t("worldScheduleRelease.relStatPresaves", { count: stats.followers.toLocaleString(i18n.language) }),
                          t("worldScheduleRelease.relStatShares", { count: stats.shares.toLocaleString(i18n.language) }),
                        ].map((s) => (
                          <span key={s} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/10 text-white/60"}`}>{s}</span>
                        ))}
                      </>
                    ) : (
                      <span className={`text-xs ${muted}`}>{t("worldScheduleRelease.relAnalyticsNotCollecting", { followers: stats.followers.toLocaleString(i18n.language), shares: stats.shares.toLocaleString(i18n.language) })}</span>
                    )}
                  </div>
                ) : null}
                {stats?.linkAnalytics && stats.linkAnalytics.perLink.length > 0 ? (
                  <ul className="space-y-0.5">
                    {stats.linkAnalytics.perLink.map((l) => (
                      <li key={l.linkKey} className={`text-xs ${muted}`}>{t("worldScheduleRelease.relPerLinkClicks", { title: l.linkTitle, count: l.clicks.toLocaleString(i18n.language) })}</li>
                    ))}
                  </ul>
                ) : null}
                {slSettings ? (
                  <div className="space-y-2" data-testid="world-release-smartlink-settings">
                    <label className="block">
                      <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relHeadlineLabel")}</span>
                      <input aria-label={t("worldScheduleRelease.relHeadlineAria")} className={inputCls(isLight)} value={slSettings.headline} onChange={(e) => setSlSettings({ ...slSettings, headline: e.target.value })} placeholder={t("worldScheduleRelease.relHeadlinePlaceholder")} />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {SMARTLINK_LINK_PLATFORMS.map((p) => (
                        <label key={p.key} className="block">
                          <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relPlatformLinkLabel", { label: p.label })}</span>
                          <input aria-label={t("worldScheduleRelease.relPlatformLinkAria", { label: p.label })} className={inputCls(isLight)} value={slSettings.platformLinks[p.key] ?? ""} onChange={(e) => setSlSettings({ ...slSettings, platformLinks: { ...slSettings.platformLinks, [p.key]: e.target.value } })} placeholder={t("worldScheduleRelease.relPlatformLinkPlaceholder", { label: p.label })} />
                        </label>
                      ))}
                    </div>
                    <label className="block">
                      <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relBonusLabel")}</span>
                      <input aria-label={t("worldScheduleRelease.relBonusAria")} className={inputCls(isLight)} value={slSettings.bonusUrl} onChange={(e) => setSlSettings({ ...slSettings, bonusUrl: e.target.value })} placeholder="https://…" />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="block">
                        <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relMetaPixelLabel")}</span>
                        <input aria-label={t("worldScheduleRelease.relMetaPixelLabel")} className={inputCls(isLight)} value={slSettings.pixels.metaPixelId ?? ""} onChange={(e) => setSlSettings({ ...slSettings, pixels: { ...slSettings.pixels, metaPixelId: e.target.value } })} placeholder={t("worldScheduleRelease.relMetaPixelPlaceholder")} />
                      </label>
                      <label className="block">
                        <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relTiktokPixelLabel")}</span>
                        <input aria-label={t("worldScheduleRelease.relTiktokPixelLabel")} className={inputCls(isLight)} value={slSettings.pixels.tiktokPixelId ?? ""} onChange={(e) => setSlSettings({ ...slSettings, pixels: { ...slSettings.pixels, tiktokPixelId: e.target.value } })} placeholder={t("worldScheduleRelease.relTiktokPixelPlaceholder")} />
                      </label>
                      <label className="block">
                        <span className={fieldLabel(isLight)}>{t("worldScheduleRelease.relGoogleTagLabel")}</span>
                        <input aria-label={t("worldScheduleRelease.relGoogleTagLabel")} className={inputCls(isLight)} value={slSettings.pixels.googleTagId ?? ""} onChange={(e) => setSlSettings({ ...slSettings, pixels: { ...slSettings.pixels, googleTagId: e.target.value } })} placeholder="G-…" />
                      </label>
                    </div>
                    <p className={`text-[11px] ${muted}`}>{t("worldScheduleRelease.relPixelsNote")}</p>
                    <button type="button" data-testid="world-release-smartlink-save" onClick={() => void saveSmartlinkSettings()} disabled={busy !== null} className={goldBtn}>
                      {busy === "slsave" ? t("worldScheduleRelease.relSaving") : t("worldScheduleRelease.relSmartlinkSave")}
                    </button>
                  </div>
                ) : (
                  <p className={`text-xs ${muted}`}>{t("worldScheduleRelease.relSmartlinkLoading")}</p>
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
  const { t } = useTranslation();
  return (
    <NativeCard isLight={isLight} title={t("worldScheduleRelease.relCardTitle")}>
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
  const { t } = useTranslation();
  return (
    <div
      className={`mt-3 rounded-2xl border p-3 ${isLight ? "border-[#C9A84C]/50 bg-white/40" : "border-[#d4af37]/30 bg-white/5"}`}
      data-testid="world-release-chip-desk"
    >
      <p className={`mb-2 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {t("worldScheduleRelease.relStandaloneTitle")}
      </p>
      <ReleaseDeskBody isLight={isLight} prefill={prefill} prefillNonce={1} />
    </div>
  );
}
