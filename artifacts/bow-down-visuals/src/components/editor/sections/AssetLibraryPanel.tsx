import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle, Film, Image as ImageIcon, Library, Loader2, Music2, Plus, RefreshCw,
} from "lucide-react";
import { Collapsible, Segmented } from "@/components/editor/controls";
import { useToast } from "@/hooks/use-toast";
import { useHubProject } from "@/lib/hub-project";
import { fetchAssetLibrary, type LibraryAsset } from "@/lib/asset-library";
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
