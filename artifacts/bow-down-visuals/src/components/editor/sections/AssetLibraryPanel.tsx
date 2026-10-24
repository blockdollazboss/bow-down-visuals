import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle, BadgeCheck, ChevronDown, Download, Film, Image as ImageIcon, Library, Loader2, Music2, Plus, RefreshCw, Save,
} from "lucide-react";
import { Collapsible, Segmented } from "@/components/editor/controls";
import { useToast } from "@/hooks/use-toast";
import { useHubProject } from "@/lib/hub-project";
import {
  downloadLicenceCertificate, fetchAssetLibrary, fetchProvenance, saveAssetLicence,
  type LibraryAsset, type LicenceId, type LicenceOption, type ProvenanceRecord,
} from "@/lib/asset-library";
import {
  isAudioAsset, isTimelineAsset, sceneFromLibraryAsset, stemFromLibraryAsset,
} from "@/lib/editor-library";
import type { EditorSettings } from "@/lib/editor-settings";
import type { SceneData } from "@/lib/scene-parser";

/* ─── My Library in the editor (linkage fix, audit DE-7) ──────────────────
   The creator's OWN library inside the editor's Media + Music rails, on
   the unified /api/asset-library client (until now Thumbnail Studio was
   its only consumer). Videos/images add to the timeline as scenes; audio
   attaches as the project soundtrack stem through the same insert path
   the "Use this sound" handoff uses. Everything here is free — these are
   the creator's own assets, not stock imports. */

interface AssetLibraryPanelProps {
  scenes: SceneData[];
  setScenes: (update: (prev: SceneData[]) => SceneData[]) => void;
  settings: EditorSettings;
  setSettings: (update: (prev: EditorSettings) => EditorSettings) => void;
  getAccessToken: () => Promise<string | null>;
  onGoToTab: (tab: "timeline" | "captions" | "export") => void;
}

type LibraryFilter = "all" | "video" | "image" | "audio";

/* ─── "Made with" provenance card (Stack-100 #3 lane F7) ─────────────────
   Every library asset carries its provenance record: the tool/model that
   made it, its creator, when, a factual history, and the licence its
   creator states for it. The licence picker + certificate download ride
   the /api/provenance doors; the facts render from the library payload
   immediately, the picker options load when the card first opens. */
function ProvenanceCard({
  asset,
  getAccessToken,
}: {
  asset: LibraryAsset;
  getAccessToken: () => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const tr = (key: string, opts?: Record<string, string | number>) =>
    t(`videoEditor.myLibrary.${key}`, opts);
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<ProvenanceRecord | null>(asset.provenance ?? null);
  const [options, setOptions] = useState<LicenceOption[] | null>(null);
  const [licence, setLicence] = useState<LicenceId>(asset.provenance?.licence ?? "all-rights-reserved");
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [certBusy, setCertBusy] = useState(false);
  const [certFailed, setCertFailed] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    void (async () => {
      const fresh = await fetchProvenance(getAccessToken, asset.id);
      if (fresh) {
        setRecord(fresh.record);
        setOptions(fresh.licenceOptions);
        setLicence(fresh.record.licence);
      }
    })();
  }, [open, asset.id, getAccessToken]);

  if (!record) return null;

  async function onSaveLicence() {
    setSaving(true);
    setSaveFailed(false);
    const updated = await saveAssetLicence(getAccessToken, asset.id, licence);
    setSaving(false);
    if (updated) {
      setRecord(updated);
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 2500);
    } else {
      setSaveFailed(true);
    }
  }

  async function onCertificate() {
    setCertBusy(true);
    setCertFailed(false);
    const ok = await downloadLicenceCertificate(
      getAccessToken,
      asset.id,
      `${asset.label || "asset"}-licence-certificate.pdf`,
    );
    setCertBusy(false);
    if (!ok) setCertFailed(true);
  }

  const createdDay = new Date(record.createdAt).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

  return (
    <div className="border-t border-white/[0.06] pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] font-bold text-white/70 transition hover:border-primary/40 hover:text-white"
        data-testid={`my-library-prov-${asset.id}`}
        aria-expanded={open}
      >
        <BadgeCheck className="h-3.5 w-3.5 text-primary" />
        {tr("madeWith", { defaultValue: "Made with" })}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 pt-2 text-left">
          <p className="text-[11px] leading-relaxed text-white/75">
            {record.createdWith.tool}
            {record.createdWith.model ? <span className="text-white/45"> · {record.createdWith.model}</span> : null}
          </p>
          <p className="text-[10px] text-white/40">
            {record.creator.name
              ? tr("madeBy", { defaultValue: "by {{name}}", name: record.creator.name })
              : record.createdWith.platform}
            {" · "}
            {createdDay}
          </p>
          {record.aiGenerated && (
            <span className="inline-flex rounded-md bg-primary/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-primary">
              {tr("aiBadge", { defaultValue: "AI-generated" })}
            </span>
          )}
          {record.editHistory.length > 0 && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-white/35">
                {tr("history", { defaultValue: "History" })}
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {record.editHistory.map((line, i) => (
                  <li key={i} className="text-[10px] leading-snug text-white/45">{line}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-white/35" htmlFor={`licence-${asset.id}`}>
              {tr("licence", { defaultValue: "Licence" })}
            </label>
            <div className="mt-1 flex gap-1.5">
              <select
                id={`licence-${asset.id}`}
                value={licence}
                onChange={(e) => setLicence(e.target.value as LicenceId)}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-1.5 py-1.5 text-[11px] text-white/80"
                data-testid={`my-library-licence-${asset.id}`}
              >
                {(options ?? [{ id: record.licence, name: record.licence, summary: "", url: null }]).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void onSaveLicence()}
                disabled={saving || licence === record.licence}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-bold text-white/85 transition hover:bg-white/20 disabled:opacity-40"
                data-testid={`my-library-licence-save-${asset.id}`}
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {savedTick
                  ? tr("licenceSaved", { defaultValue: "Saved" })
                  : tr("saveLicence", { defaultValue: "Save" })}
              </button>
            </div>
            {saveFailed && (
              <p className="mt-1 text-[10px] text-red-300">
                {tr("licenceSaveFailed", { defaultValue: "Couldn't save the licence — try again." })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void onCertificate()}
            disabled={certBusy}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/30 px-2 py-1.5 text-[11px] font-bold text-primary transition hover:bg-primary/10 disabled:opacity-50"
            data-testid={`my-library-cert-${asset.id}`}
          >
            {certBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {tr("certificate", { defaultValue: "Licence certificate" })}
          </button>
          {certFailed && (
            <p className="text-[10px] text-red-300">
              {tr("certificateFailed", { defaultValue: "Couldn't build the certificate — try again." })}
            </p>
          )}
          <p className="text-[9px] leading-snug text-white/30">
            {tr("disclosureNote", { defaultValue: "Exports carry an AI disclosure in their file details by default — you can turn it off per export." })}
          </p>
        </div>
      )}
    </div>
  );
}

function matchesFilter(asset: LibraryAsset, filter: LibraryFilter): boolean {
  if (filter === "all") return isTimelineAsset(asset) || isAudioAsset(asset);
  if (filter === "audio") return isAudioAsset(asset);
  return asset.mediaKind === filter;
}

export function AssetLibraryPanel({
  scenes, setScenes, settings, setSettings, getAccessToken, onGoToTab,
}: AssetLibraryPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { addAsset } = useHubProject();
  const tr = (key: string, opts?: Record<string, string | number>) =>
    t(`videoEditor.myLibrary.${key}`, opts);

  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAssets(await fetchAssetLibrary(getAccessToken));
      loadedRef.current = true;
    } catch {
      setError(tr("loadFailed", { defaultValue: "Couldn't load your library — try again." }));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAccessToken]);

  useEffect(() => {
    if (!loadedRef.current) void load();
  }, [load]);

  const visible = (assets ?? []).filter((a) => matchesFilter(a, filter));

  function addToTimeline(asset: LibraryAsset) {
    const scene = sceneFromLibraryAsset(asset, scenes.length + 1);
    setScenes((prev) => [...prev, scene]);
    /* Coherence: the clip joins the hub tray so captions, templates and
       export treat it like any other project clip. */
    addAsset({
      kind: asset.mediaKind === "video" ? "clip" : "image",
      url: asset.url,
      label: asset.label,
      detail: tr("hubDetail", { defaultValue: "From my library" }),
    });
    toast({ title: tr("addedTitle", { defaultValue: "Added to your timeline" }), description: asset.label });
    onGoToTab("timeline");
  }

  function useAsSoundtrack(asset: LibraryAsset) {
    if (settings.musicStudio.stems.some((s) => s.url === asset.url)) {
      toast({
        title: tr("alreadySoundtrackTitle", { defaultValue: "Already your soundtrack" }),
        description: tr("alreadySoundtrackDesc", { defaultValue: "\"{{title}}\" is already attached — find it in the Music tab.", title: asset.label }),
      });
      return;
    }
    const stem = stemFromLibraryAsset(asset);
    setSettings((prev) => ({
      ...prev,
      musicStudio: { ...prev.musicStudio, stems: [...prev.musicStudio.stems, stem] },
    }));
    addAsset({ kind: "song", url: asset.url, label: asset.label, detail: tr("hubDetail", { defaultValue: "From my library" }) });
    toast({
      title: tr("soundtrackTitle", { defaultValue: "Soundtrack attached" }),
      description: tr("soundtrackDesc", { defaultValue: "\"{{title}}\" is now your soundtrack stem — it mixes into preview and export.", title: asset.label }),
    });
  }

  return (
    <Collapsible title={tr("title", { defaultValue: "My Library" })} defaultOpen={false}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] leading-relaxed text-white/40">
            {tr("subtitle", { defaultValue: "Your own songs, clips and covers — add them without re-uploading. Free: they're already yours." })}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 rounded-lg border border-white/10 p-1.5 text-white/50 transition hover:border-white/25 hover:text-white disabled:opacity-50"
            title={tr("refresh", { defaultValue: "Refresh" })}
            data-testid="my-library-refresh"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>

        <Segmented<LibraryFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: tr("filterAll", { defaultValue: "All" }) },
            { value: "video", label: tr("filterVideo", { defaultValue: "Video" }) },
            { value: "image", label: tr("filterImage", { defaultValue: "Images" }) },
            { value: "audio", label: tr("filterAudio", { defaultValue: "Audio" }) },
          ]}
        />

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-400/25 bg-red-500/5 px-3 py-2.5 text-xs text-red-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        )}
        {!error && assets === null && (
          <p className="flex items-center gap-2 py-2 text-xs text-white/40">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {tr("loading", { defaultValue: "Loading your library…" })}
          </p>
        )}
        {assets !== null && visible.length === 0 && (
          <p className="py-2 text-xs text-white/40">
            {assets.length === 0
              ? tr("empty", { defaultValue: "Nothing here yet — your generated songs, clips and covers land in your library automatically." })
              : tr("emptyFilter", { defaultValue: "Nothing of this kind in your library yet." })}
          </p>
        )}

        <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto pr-0.5">
          {visible.map((asset) => {
            const audio = isAudioAsset(asset);
            return (
              <div
                key={asset.id}
                className="group overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02] transition-colors hover:border-primary/30"
              >
                <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-black/60">
                  {asset.mediaKind === "image" ? (
                    <img src={asset.url} alt={asset.label} loading="lazy" className="h-full w-full object-cover" />
                  ) : asset.mediaKind === "video" ? (
                    <video src={asset.url} muted loop playsInline preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    <Music2 className="h-8 w-8 text-primary/60" />
                  )}
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-primary">
                    {asset.mediaKind === "video" ? <Film className="h-3 w-3" /> : asset.mediaKind === "image" ? <ImageIcon className="h-3 w-3" /> : <Music2 className="h-3 w-3" />}
                    {asset.mediaKind}
                  </span>
                </div>
                <div className="space-y-2 p-2.5">
                  <p className="truncate text-[11px] font-semibold text-white/80" title={asset.label}>{asset.label}</p>
                  <button
                    type="button"
                    onClick={() => (audio ? useAsSoundtrack(asset) : addToTimeline(asset))}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-1.5 text-[11px] font-black text-black transition-colors hover:bg-primary/90"
                    data-testid={`my-library-add-${asset.id}`}
                  >
                    {audio ? <Music2 className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    {audio
                      ? tr("useAsSoundtrack", { defaultValue: "Use as soundtrack" })
                      : tr("addToTimeline", { defaultValue: "Add to timeline" })}
                  </button>
                  {asset.provenance && (
                    <ProvenanceCard asset={asset} getAccessToken={getAccessToken} />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="flex items-center gap-1.5 text-[10px] text-white/30">
          <Library className="h-3 w-3" />
          {tr("foot", { defaultValue: "The same library your other desks read — one library, everywhere." })}
        </p>
      </div>
    </Collapsible>
  );
}
