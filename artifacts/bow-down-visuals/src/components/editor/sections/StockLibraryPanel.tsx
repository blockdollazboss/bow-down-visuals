import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Search, Image as ImageIcon, Film, Loader2, AlertTriangle,
  Plus, Download, ChevronLeft, ChevronRight, Clock3, Camera,
} from "lucide-react";
import { Collapsible, Segmented } from "@/components/editor/controls";
import { useToast } from "@/hooks/use-toast";
import { useHubProject } from "@/lib/hub-project";
import type { FetchImpl } from "@/hooks/use-confirmed-api";
import type { SceneData } from "@/lib/scene-parser";

/* ─── Stock Media Library (CapCut parity) ────────────────────────────────
   Searchable stock video + photos inside the editor's Media rail.
   Provider: Pexels (server proxies with PEXELS_API_KEY). Browsing/search is
   free; importing a file into the project costs 50 Visual Bucs (confirmed
   via confirmedFetch + the credit-costs registry, 402 pre-check server-side).
   Imported stock writes to hub project assets so captions/templates/export
   treat it like any other clip. Photographer credit is shown per item. */

interface StockItem {
  id: string;
  type: "video" | "photo";
  title: string;
  previewUrl: string;
  fileUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  durationSec?: number | null;
  photographer: string;
  photographerUrl: string;
  sourceUrl: string;
}

interface StockLibraryPanelProps {
  scenes: SceneData[];
  setScenes: (update: (prev: SceneData[]) => SceneData[]) => void;
  projectId?: string | null;
  getAccessToken: () => Promise<string | null>;
  confirmedFetch: FetchImpl;
  onGoToTab: (tab: "timeline" | "captions" | "export") => void;
}

type StockType = "video" | "photo";

const PER_PAGE = 12;

function StockCard({
  item,
  importing,
  onImport,
  tr,
}: {
  item: StockItem;
  importing: boolean;
  onImport: (item: StockItem) => void;
  tr: (key: string, opts?: Record<string, string | number>) => string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const startHoverPreview = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.src) v.src = item.fileUrl;
    void v.play().catch(() => { /* hover preview is best-effort */ });
  }, [item.fileUrl]);

  const stopHoverPreview = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try { v.currentTime = 0; } catch { /* ignore */ }
  }, []);

  return (
    <div className="group rounded-xl overflow-hidden border border-white/[0.07] bg-white/[0.02] hover:border-primary/30 transition-colors">
      <div
        className="relative aspect-video bg-black/60 overflow-hidden"
        onMouseEnter={item.type === "video" ? startHoverPreview : undefined}
        onMouseLeave={item.type === "video" ? stopHoverPreview : undefined}
      >
        {item.type === "video" ? (
          <video
            ref={videoRef}
            muted
            loop
            playsInline
            preload="none"
            poster={item.previewUrl}
            className="h-full w-full object-cover"
          />
        ) : (
          <img
            src={item.previewUrl}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
        {item.type === "video" && item.durationSec != null && (
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white/90">
            <Clock3 className="h-3 w-3" />
            {Math.round(item.durationSec)}s
          </span>
        )}
        <span className="absolute top-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-primary">
          {item.type === "video" ? tr("badgeVideo") : tr("badgePhoto")}
        </span>
      </div>
      <div className="p-2.5 space-y-2">
        <p className="flex items-center gap-1 min-w-0 text-[10px] text-white/40 truncate">
          <Camera className="h-3 w-3 shrink-0 text-white/30" />
          <span className="truncate">
            {tr(item.type === "video" ? "videoBy" : "photoBy", { name: item.photographer })}
          </span>
          <a
            href={item.photographerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 text-primary/80 hover:text-primary underline underline-offset-2"
          >
            Pexels
          </a>
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onImport(item)}
            disabled={importing}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-1.5 text-[11px] font-black text-black hover:bg-primary/90 transition-colors disabled:opacity-50"
            data-testid={`stock-import-${item.id}`}
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {tr("addToTimeline")}
          </button>
          <a
            href={item.downloadUrl}
            download
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-white/60 hover:text-white hover:border-white/25 transition-colors"
            title={tr("download")}
            data-testid={`stock-download-${item.id}`}
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

export function StockLibraryPanel({
  scenes, setScenes, projectId, getAccessToken, confirmedFetch, onGoToTab,
}: StockLibraryPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { addAsset } = useHubProject();
  const tr = (key: string, opts?: Record<string, string | number>) =>
    t(`videoEditor.stockLibrary.${key}`, opts);

  const [query, setQuery] = useState("");
  const [type, setType] = useState<StockType>("video");
  const [items, setItems] = useState<StockItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [page, setPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [importingId, setImportingId] = useState<string | null>(null);

  const runSearch = useCallback(async (nextPage: number) => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setNotConfigured(false);
    try {
      const token = await getAccessToken().catch(() => null);
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(
        `/api/stock/search?q=${encodeURIComponent(q)}&type=${type}&page=${nextPage}&per_page=${PER_PAGE}`,
        { headers },
      );
      const data = (await res.json().catch(() => ({}))) as {
        items?: StockItem[];
        totalResults?: number;
        error?: string;
        message?: string;
      };
      if (res.status === 503 || data.error === "stock_not_configured") {
        setNotConfigured(true);
        setItems([]);
        return;
      }
      if (!res.ok) throw new Error(data.message ?? data.error ?? tr("errorGeneric", { status: res.status }));
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotalResults(data.totalResults ?? 0);
      setPage(nextPage);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("errorGenericFallback"));
      setItems([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, type, getAccessToken]);

  const handleImport = useCallback(async (item: StockItem) => {
    setImportingId(item.id);
    try {
      /* 50 Visual Bucs — the confirm popup + 402 pre-check both gate this. */
      const res = await confirmedFetch("/api/stock/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          type: item.type,
          title: item.title,
          previewUrl: item.previewUrl,
          fileUrl: item.fileUrl,
          photographer: item.photographer,
          photographerUrl: item.photographerUrl,
          width: item.width,
          height: item.height,
          durationSec: item.durationSec ?? undefined,
          projectId: projectId ?? undefined,
        }),
      });
      if (res === null) return; // user cancelled the spend confirmation
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        item?: StockItem;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.success || !data.item) {
        throw new Error(data.message ?? data.error ?? tr("importFailedDesc"));
      }
      const imported = data.item;
      const nowIso = new Date().toISOString();
      const newScene: SceneData = {
        id: `stock-${Date.now().toString(36)}`,
        sceneNumber: scenes.length + 1,
        timestamp: "",
        section: tr("sceneSection"),
        lyricLine: "",
        location: "",
        action: imported.title,
        cameraMovement: "",
        lighting: "",
        mood: "",
        aiVideoPrompt: "",
        negativePrompt: "",
        approved: true,
        demoClipUrl: imported.fileUrl,
        thumbnailUrl: imported.previewUrl,
        clipId: null,
        runwayJobId: null,
        provider: "stock-pexels",
        generationStatus: "completed",
        promptUsed: null,
        generatedAt: nowIso,
        clipReusedIntentionally: true,
      };
      setScenes((prev) => [...prev, newScene]);
      /* Coherence: the import lands in hub project assets so captions,
         templates and export treat it like any other clip. */
      addAsset({
        kind: imported.type === "video" ? "clip" : "image",
        url: imported.fileUrl,
        label: imported.title,
        detail: tr("hubAssetDetail", { name: imported.photographer }),
      });
      toast({ title: tr("addedTitle"), description: imported.title });
      onGoToTab("timeline");
    } catch (err) {
      toast({
        title: tr("importFailedTitle"),
        description: err instanceof Error ? err.message : tr("importFailedDesc"),
      });
    } finally {
      setImportingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedFetch, scenes.length, setScenes, projectId, addAsset, toast, onGoToTab]);

  const totalPages = Math.max(1, Math.ceil(totalResults / PER_PAGE));

  return (
    <Collapsible title={tr("title")} defaultOpen={false}>
      <div className="space-y-4">
        {/* header row: price badge */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-white/40 leading-relaxed">{tr("subtitle")}</p>
          <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-primary bg-primary/10 border border-primary/25 rounded-full px-2.5 py-1">
            {tr("priceBadge")}
          </span>
        </div>

        {/* search controls */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void runSearch(1); }}
              placeholder={tr("searchPlaceholder")}
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-primary/50 transition-colors"
              data-testid="stock-search-input"
            />
          </div>
          <button
            type="button"
            onClick={() => void runSearch(1)}
            disabled={loading || !query.trim()}
            className="shrink-0 flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-black hover:bg-primary/90 transition-colors disabled:opacity-50"
            data-testid="stock-search-button"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {tr("searchButton")}
          </button>
        </div>
        <Segmented<StockType>
          value={type}
          onChange={(v) => { setType(v); setSearched(false); setItems([]); }}
          options={[
            { value: "video", label: tr("typeVideo") },
            { value: "photo", label: tr("typePhoto") },
          ]}
        />

        {/* dormant: provider key not configured */}
        {notConfigured && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/[0.07] border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] font-bold text-amber-200">{tr("notConfiguredTitle")}</p>
              <p className="text-[11px] text-amber-200/70 leading-relaxed mt-0.5">{tr("notConfiguredDesc")}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/[0.07] border border-red-500/20">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-200/80 leading-relaxed">{error}</p>
          </div>
        )}

        {/* idle hint */}
        {!searched && !loading && !notConfigured && !error && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            {type === "video"
              ? <Film className="h-8 w-8 text-white/15" />
              : <ImageIcon className="h-8 w-8 text-white/15" />}
            <p className="text-[11px] text-white/35 max-w-[260px] leading-relaxed">{tr("idleHint")}</p>
          </div>
        )}

        {/* loading */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-white/50">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm font-bold">{tr("searching")}</p>
          </div>
        )}

        {/* empty */}
        {searched && !loading && !error && !notConfigured && items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Search className="h-8 w-8 text-white/15" />
            <p className="text-xs font-bold text-white/50">{tr("emptyTitle")}</p>
            <p className="text-[11px] text-white/35 max-w-[260px] leading-relaxed">{tr("emptyDesc")}</p>
          </div>
        )}

        {/* results */}
        {items.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {items.map((item) => (
                <StockCard
                  key={item.id}
                  item={item}
                  importing={importingId === item.id}
                  onImport={handleImport}
                  tr={tr}
                />
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void runSearch(page - 1)}
                disabled={loading || page <= 1}
                className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-bold text-white/60 hover:text-white disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> {tr("prevPage")}
              </button>
              <p className="text-[11px] text-white/35 font-bold">
                {tr("pageOf", { page, total: totalPages })}
              </p>
              <button
                type="button"
                onClick={() => void runSearch(page + 1)}
                disabled={loading || page >= totalPages}
                className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-bold text-white/60 hover:text-white disabled:opacity-40 transition-colors"
              >
                {tr("nextPage")} <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    </Collapsible>
  );
}
