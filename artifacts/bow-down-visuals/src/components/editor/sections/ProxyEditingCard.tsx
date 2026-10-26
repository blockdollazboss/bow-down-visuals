import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Loader2, Film, Zap } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import { EditorCard, Chip } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  EXPORT_HONESTY_LINE,
  previewUrlFor,
  proxyStatusLabel,
  type ProxyRowLike,
} from "@/lib/proxy-editing";

/* ── Proxy Editing (board 184) ────────────────────────────────────────
 * Docked inside the Video Editor's Export tab — never a standalone
 * page. Heavy originals can get a low-res proxy so preview / scrubbing
 * stays smooth. Honesty rules, in the UI itself:
 *  - Every clip row says whether you are Viewing: Proxy or Original.
 *  - The export line is printed on the card: export ALWAYS renders
 *    from the full-res originals, never from a proxy.
 *  - Proxies are made ON DEMAND only (per-clip button), and only for
 *    clips the server judges heavy — light clips get a plain refusal
 *    message and keep editing from the original.
 * No price: proxy editing is free editor tooling. */

interface ProxyApiRow extends ProxyRowLike {
  id: string;
  heavy_reasons: string[];
}

export function ProxyEditingCard({ scenes, projectId }: { scenes: SceneData[]; projectId: string }) {
  const { confirmedFetch } = useConfirmedApi();
  const isLight = useIsLightTheme();
  const [enabled, setEnabled] = useState(true);
  const [rows, setRows] = useState<ProxyApiRow[]>([]);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await confirmedFetch(`/api/proxy-editing?project_id=${encodeURIComponent(projectId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { enabled: boolean; proxies: ProxyApiRow[] };
      setEnabled(data.enabled);
      setRows(data.proxies ?? []);
    } catch { /* panel stays on originals — the safe default */ }
  }, [confirmedFetch, projectId]);

  useEffect(() => { void load(); }, [load]);

  // Poll while any proxy is being made so the badge flips honestly.
  useEffect(() => {
    if (!rows.some((r) => r.status === "pending" || r.status === "generating")) return;
    const id = window.setInterval(() => { void load(); }, 3000);
    return () => window.clearInterval(id);
  }, [rows, load]);

  const rowFor = (url: string) => rows.find((r) => r.original_url === url) ?? null;

  const requestProxy = async (url: string) => {
    setBusyUrl(url);
    setNote(null);
    try {
      const video = document.createElement("video");
      const meta = await new Promise<{ width: number; height: number; durationSec: number }>((resolve) => {
        video.preload = "metadata";
        video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight, durationSec: video.duration || 0 });
        video.onerror = () => resolve({ width: 0, height: 0, durationSec: 0 });
        video.src = url;
      });
      const res = await confirmedFetch("/api/proxy-editing/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original_url: url, project_id: projectId,
          width: meta.width || null, height: meta.height || null,
          duration_sec: meta.durationSec || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { outcome?: string; message?: string; error?: string };
      if (data.outcome === "not_heavy") setNote(data.message ?? "This clip is light enough to edit from the original — no proxy needed.");
      else if (!res.ok) setNote(data.message ?? "Proxy editing is off for this account.");
      await load();
    } catch {
      setNote("Could not request a proxy. You are still editing from the original.");
    } finally {
      setBusyUrl(null);
    }
  };

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      await confirmedFetch("/api/proxy-editing/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
    } catch { /* load() on next poll restores the server truth */ }
    void load();
  };

  const clipUrls = [...new Set(scenes.map((s) => s.demoClipUrl).filter((u): u is string => !!u))];

  return (
    <EditorCard
      title="Proxy Editing — smooth preview for heavy clips"
      subtitle="Low-res copies for editing only. Make a proxy per clip, only when a clip is heavy."
      icon={<Clapperboard className="h-4 w-4" />}
      right={
        <Chip active={enabled} onClick={() => void toggle()} title="Turn proxy editing on or off for your account">
          {enabled ? "Proxies: On" : "Proxies: Off"}
        </Chip>
      }
    >
      <p className={`text-xs ${isLight ? "text-amber-900" : "text-amber-200"}`}>{EXPORT_HONESTY_LINE}</p>
      {note && <p className="mt-2 text-xs opacity-80">{note}</p>}
      {!enabled && (
        <p className="mt-2 text-xs opacity-80">Proxy editing is off — every clip below is the original, full-res.</p>
      )}
      <div className="mt-3 space-y-2">
        {clipUrls.length === 0 && <p className="text-xs opacity-70">Add a clip to the timeline and it will show up here.</p>}
        {clipUrls.map((url, i) => {
          const row = rowFor(url);
          const preview = previewUrlFor(url, row, enabled);
          return (
            <div key={url} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${isLight ? "border-amber-900/20 bg-white/60" : "border-white/10 bg-black/30"}`}>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  {preview.isProxy ? <Zap className="h-3.5 w-3.5" /> : <Film className="h-3.5 w-3.5" />}
                  Clip {i + 1} — {preview.badge}
                </p>
                <p className="truncate text-[11px] opacity-70">{proxyStatusLabel(row)}</p>
              </div>
              {enabled && row?.status !== "ready" && (
                <button
                  type="button"
                  disabled={busyUrl === url || row?.status === "generating" || row?.status === "pending"}
                  onClick={() => void requestProxy(url)}
                  className="shrink-0 rounded-md border px-2 py-1 text-[11px] disabled:opacity-50"
                >
                  {busyUrl === url ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : row?.status === "failed" ? "Try again" : "Make proxy"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </EditorCard>
  );
}
