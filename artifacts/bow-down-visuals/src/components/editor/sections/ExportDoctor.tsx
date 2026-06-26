import { useState } from "react";
import {
  Stethoscope, Loader2, CheckCircle2, XCircle, Link2, Download, Film, Music2, ExternalLink, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorCard } from "@/components/editor/controls";
import { useAuth } from "@/contexts/AuthContext";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionSettings } from "@/lib/editor-settings";

interface ExportDoctorProps {
  scenes: SceneData[];
  projectId: string;
  /** The exact audio URL the master player is using. */
  masterAudioUrl?: string | null;
  /** The exact caption settings (synced lines + style) the master player is using. */
  captions?: CaptionSettings | null;
}

/** Every candidate URL field the spec asks us to surface for Scene 1. */
const URL_FIELD_KEYS = [
  "clip.url", "clip.video_url", "clip.videoUrl", "clip.output_url", "clip.outputUrl",
  "clip.asset_url", "clip.assetUrl", "clip.runway_url", "clip.runwayUrl",
  "clip.storage_url", "clip.storageUrl",
  "scene.clip_url", "scene.clipUrl", "scene.video_url", "scene.videoUrl",
  "scene.runway_output_url", "scene.runwayOutputUrl",
  "scene.generated_clip_url", "scene.generatedClipUrl",
  "scene.demoClipUrl",
] as const;

type UrlTestResult = {
  urlProvided: boolean;
  startsWithHttp: boolean;
  resolvedUrl?: string;
  status: number;
  contentType: string;
  contentLength: number | null;
  isVideo: boolean;
  isHtml: boolean;
  snippet: string | null;
  message: string;
};

type DownloadResult = {
  doctorId: string;
  localPath: string;
  fileExists: boolean;
  fileSize: number;
  responseStatus: number;
  contentType: string;
  duration?: number;
  codec?: string;
  width?: number;
  height?: number;
  ffprobeValid: boolean;
  error: string | null;
};

type ExportResult = {
  success?: boolean;
  url?: string;
  fileSize?: number;
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  clipCount?: number;
  audioDownloaded?: boolean;
  audioValid?: boolean;
  audioFileSize?: number;
  audioDuration?: number;
  captionsFound?: boolean;
  captionRows?: number;
  captionTimingValid?: boolean;
  captionStyleFound?: boolean;
  captionsBurned?: boolean;
  stylePreset?: string;
  error?: string;
  stderrTail?: string[];
};

type MultiClipRow = {
  sceneNumber: number;
  sceneTitle: string;
  fileExists: boolean;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  codec: string;
  ffprobeValid: boolean;
  responseStatus: number;
  contentType: string;
  error: string | null;
};

type DownloadAllResult = {
  multiId: string;
  total: number;
  downloaded: number;
  valid: number;
  allValid: boolean;
  lastError: string | null;
  clips: MultiClipRow[];
};

async function readJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!ct.toLowerCase().includes("application/json")) {
    throw new Error(`API returned ${ct || "non-JSON"} (HTTP ${res.status}) instead of JSON.`);
  }
  return JSON.parse(text) as T;
}

function fmtBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function ExportDoctor({ scenes, projectId, masterAudioUrl, captions }: ExportDoctorProps) {
  const { getAccessToken } = useAuth();

  // Scene 1 = first scene that has a usable clip URL
  const scene1 = scenes.find((s) => !!s.demoClipUrl?.startsWith("http")) ?? scenes[0] ?? null;
  const scene1Url = scene1?.demoClipUrl ?? "";

  const [busy, setBusy] = useState<
    null | "url" | "download" | "export" | "export-audio" | "download-all" | "export-all" | "export-all-audio" | "export-all-captions"
  >(null);
  const [urlResult, setUrlResult] = useState<UrlTestResult | null>(null);
  const [downloadResult, setDownloadResult] = useState<DownloadResult | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [audioExportResult, setAudioExportResult] = useState<ExportResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // Multi-clip ("All 5 Clips") doctor state
  const [downloadAllResult, setDownloadAllResult] = useState<DownloadAllResult | null>(null);
  const [exportAllResult, setExportAllResult] = useState<ExportResult | null>(null);
  const [exportAllAudioResult, setExportAllAudioResult] = useState<ExportResult | null>(null);
  const [exportAllCaptionsResult, setExportAllCaptionsResult] = useState<ExportResult | null>(null);

  const doctorId = downloadResult?.doctorId ?? null;
  const downloadOk = !!downloadResult?.fileExists && !!downloadResult?.ffprobeValid;

  // Every scene that has a usable clip URL is part of the multi-clip set.
  const multiClips = scenes.map((s, i) => {
    const n = s.sceneNumber ?? i + 1;
    return {
      sceneNumber: n,
      title: s.section ? `Scene ${n} · ${s.section}` : `Scene ${n}`,
      url: s.demoClipUrl ?? null,
    };
  });
  const multiClipsWithUrl = multiClips.filter((c) => !!c.url?.startsWith("http"));
  const multiId = downloadAllResult?.multiId ?? null;
  const allClipsValid = !!downloadAllResult?.allValid && downloadAllResult.total > 0;

  async function authHeaders() {
    const token = await getAccessToken();
    return { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` };
  }

  async function testUrl() {
    setBusy("url"); setLastError(null); setUrlResult(null);
    try {
      const res = await fetch("/api/export-doctor/test-url", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ url: scene1Url }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await readJson<UrlTestResult>(res);
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      setUrlResult(data);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function downloadScene1() {
    setBusy("download"); setLastError(null); setDownloadResult(null);
    setExportResult(null); setAudioExportResult(null);
    try {
      const res = await fetch("/api/export-doctor/download", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ projectId, url: scene1Url }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const data = await readJson<DownloadResult>(res);
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      setDownloadResult(data);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function exportScene1() {
    if (!doctorId) return;
    setBusy("export"); setLastError(null); setExportResult(null);
    try {
      const res = await fetch("/api/export-doctor/export", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ doctorId }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setExportResult(data);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function exportScene1Audio() {
    if (!doctorId) return;
    setBusy("export-audio"); setLastError(null); setAudioExportResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-audio", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ doctorId, audioUrl: masterAudioUrl ?? null }),
        signal: AbortSignal.timeout(3 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAudioExportResult(data);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function downloadAllClips() {
    setBusy("download-all"); setLastError(null);
    setDownloadAllResult(null); setExportAllResult(null); setExportAllAudioResult(null); setExportAllCaptionsResult(null);
    try {
      const res = await fetch("/api/export-doctor/download-all", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ projectId, clips: multiClips }),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      const data = await readJson<DownloadAllResult>(res);
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      setDownloadAllResult(data);
      if (data.lastError) setLastError(data.lastError);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function exportAllClips() {
    if (!multiId) return;
    setBusy("export-all"); setLastError(null); setExportAllResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ multiId }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setExportAllResult(data);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function exportAllClipsAudio() {
    if (!multiId) return;
    setBusy("export-all-audio"); setLastError(null); setExportAllAudioResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all-audio", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ multiId, audioUrl: masterAudioUrl ?? null }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setExportAllAudioResult(data);
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function exportAllClipsCaptions() {
    if (!multiId) return;
    setBusy("export-all-captions"); setLastError(null); setExportAllCaptionsResult(null);
    try {
      const res = await fetch("/api/export-doctor/export-all-captions", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ multiId, audioUrl: masterAudioUrl ?? null, captions: captions ?? null }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const data = await readJson<ExportResult>(res);
      // Persist the body even on non-2xx so the real FFmpeg subtitle error + stderrTail survive.
      setExportAllCaptionsResult(data);
      if (!res.ok) { setLastError(data.error ?? `HTTP ${res.status}`); return; }
      if (data.error) setLastError(data.error);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  if (!scene1) return null;

  // Every candidate URL field for Scene 1 (only demoClipUrl is populated in this data model)
  const fieldValues: Record<string, string> = {};
  for (const k of URL_FIELD_KEYS) fieldValues[k] = "";
  fieldValues["scene.demoClipUrl"] = scene1.demoClipUrl ?? "";

  const isReplitObjStore = /storage\.googleapis\.com\/replit-objstore-/.test(scene1Url);
  const masterSourceAccepted = urlResult
    ? urlResult.status >= 200 && urlResult.status < 400 && !urlResult.isHtml
    : downloadResult
    ? !!downloadResult.fileExists
    : null;

  const statusRows: [string, boolean | null][] = [
    ["Scene 1 URL found", scene1Url.startsWith("http")],
    ["Scene 1 master player source accepted", masterSourceAccepted],
    ["Scene 1 Replit object storage allowed", scene1Url.startsWith("http") ? isReplitObjStore : null],
    ["Scene 1 URL returns video", urlResult ? urlResult.isVideo : null],
    ["Scene 1 downloaded", downloadResult ? !!downloadResult.fileExists : null],
    ["Scene 1 ffprobe valid", downloadResult ? !!downloadResult.ffprobeValid : null],
    ["Scene 1 simple export works", exportResult ? !!exportResult.success : null],
    ["Audio downloaded", audioExportResult ? !!audioExportResult.audioDownloaded : null],
    ["Scene 1 + audio export works", audioExportResult ? !!audioExportResult.success : null],
  ];

  // ── Caption pre-check (frontend, from the master player's caption settings) ──
  const KNOWN_CAPTION_PRESETS = ["clean-white", "gold-hiphop", "karaoke", "boxed", "viral-shorts", "minimal", "drill", "luxury", "rnb", "kids"];
  const captionLines = captions?.lines ?? [];
  const validCaptionLines = captionLines.filter(
    (l) => !!l.text?.trim() && Number.isFinite(l.startSec) && Number.isFinite(l.endSec) && l.endSec > l.startSec && l.startSec >= 0,
  );
  const fcCaptionRows = captionLines.length;
  const fcCaptionTimingValid = fcCaptionRows > 0 && validCaptionLines.length === fcCaptionRows;
  const fcCaptionsFound =
    !!captions && captions.mode !== "none" &&
    (validCaptionLines.length > 0 || captions.showArtistName || captions.showSongTitle);
  const fcCaptionStyleFound = !!captions && KNOWN_CAPTION_PRESETS.includes(captions.stylePreset);
  const r = exportAllCaptionsResult;
  const captionStatusRows: [string, string, boolean | null][] = [
    ["captions found", (r?.captionsFound ?? fcCaptionsFound) ? "yes" : "no", r?.captionsFound ?? fcCaptionsFound],
    ["caption rows", String(r?.captionRows ?? fcCaptionRows), (r?.captionRows ?? fcCaptionRows) > 0],
    ["caption timing valid", (r?.captionTimingValid ?? fcCaptionTimingValid) ? "yes" : "no", r?.captionTimingValid ?? fcCaptionTimingValid],
    ["caption style found", `${(r?.captionStyleFound ?? fcCaptionStyleFound) ? "yes" : "no"}${captions?.stylePreset ? ` · ${r?.stylePreset ?? captions.stylePreset}` : ""}`, r?.captionStyleFound ?? fcCaptionStyleFound],
    ["captions burned into export", r ? (r.captionsBurned ? "yes" : "no") : "—", r ? !!r.captionsBurned : null],
    ["test export created", r ? (r.success ? "yes" : "no") : "—", r ? !!r.success : null],
  ];

  return (
    <EditorCard
      icon={<Stethoscope className="h-4 w-4" />}
      title="Export Doctor"
      subtitle="Prove ONE clip can download and export before running the full video."
    >
      <div className="space-y-4">

        {/* ── Status panel ── */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3 space-y-1.5">
          <p className="text-[10px] font-black text-white/50 uppercase tracking-widest mb-1">Export Doctor Status</p>
          {statusRows.map(([label, val]) => (
            <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-white/40">{label}</span>
              <span className={`font-bold ${val === null ? "text-white/25" : val ? "text-green-400" : "text-red-400"}`}>
                {val === null ? "—" : val ? "yes" : "no"}
              </span>
            </div>
          ))}
          <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
            <span className="text-white/40 shrink-0">Last error</span>
            <span className="text-red-400/80 text-right break-words leading-snug">{lastError ?? "—"}</span>
          </div>
        </div>

        {/* ── Four action buttons ── */}
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={testUrl} disabled={busy !== null || !scene1Url} variant="outline"
            className="gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs"
            data-testid="btn-doctor-test-url">
            {busy === "url" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Test Scene 1 Source URL
          </Button>
          <Button onClick={downloadScene1} disabled={busy !== null || !scene1Url} variant="outline"
            className="gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs"
            data-testid="btn-doctor-download">
            {busy === "download" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download Scene 1 Only
          </Button>
          <Button onClick={exportScene1} disabled={busy !== null || !downloadOk} variant="outline"
            className="gap-2 border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10 text-xs disabled:opacity-40"
            data-testid="btn-doctor-export">
            {busy === "export" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
            Export Scene 1 Only
          </Button>
          <Button onClick={exportScene1Audio} disabled={busy !== null || !downloadOk} variant="outline"
            className="gap-2 border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10 text-xs disabled:opacity-40"
            data-testid="btn-doctor-export-audio">
            {busy === "export-audio" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music2 className="h-3.5 w-3.5" />}
            Export Scene 1 + Audio Only
          </Button>
        </div>
        {!downloadOk && (
          <p className="text-center text-[10px] text-white/25 leading-relaxed -mt-1">
            Export buttons unlock after Scene 1 downloads and passes ffprobe.
          </p>
        )}

        {/* ── TEST 1 result: URL fields ── */}
        <div className="rounded-xl border border-white/[0.08] overflow-hidden">
          <div className="px-3 py-2 bg-white/[0.03] border-b border-white/[0.06]">
            <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Scene 1 URL Fields</p>
          </div>
          <div className="px-3 py-2.5 space-y-1 text-[9px] font-mono">
            {URL_FIELD_KEYS.map((k) => {
              const v = fieldValues[k] ?? "";
              const used = k === "scene.demoClipUrl";
              return (
                <div key={k} className="flex items-start gap-2">
                  <span className={`shrink-0 w-[180px] ${used ? "text-primary/70" : "text-white/30"}`}>
                    {k}{used ? " (master player)" : ""}
                  </span>
                  <span className={`break-all leading-tight ${v ? "text-white/55" : "text-white/20"}`}>
                    {v || "(empty)"}
                  </span>
                </div>
              );
            })}
            <div className="flex items-start gap-2 pt-1.5 mt-1.5 border-t border-white/[0.06]">
              <span className="shrink-0 w-[180px] text-white/40">Final selected URL</span>
              <span className="break-all leading-tight text-white/60">{scene1Url || "(none)"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 w-[180px] text-white/40">Starts with http</span>
              <span className={`font-bold ${scene1Url.startsWith("http") ? "text-green-400" : "text-red-400"}`}>
                {scene1Url.startsWith("http") ? "yes" : "no"}
              </span>
            </div>
            {urlResult && (
              <>
                <div className="flex items-center gap-2"><span className="shrink-0 w-[180px] text-white/40">HTTP status</span><span className="text-white/60">{urlResult.status || "—"}</span></div>
                <div className="flex items-center gap-2"><span className="shrink-0 w-[180px] text-white/40">Content-Type</span><span className="text-white/60">{urlResult.contentType || "—"}</span></div>
                <div className="flex items-center gap-2"><span className="shrink-0 w-[180px] text-white/40">Content-Length</span><span className="text-white/60">{fmtBytes(urlResult.contentLength)}</span></div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 w-[180px] text-white/40">Returns video</span>
                  <span className={`font-bold ${urlResult.isVideo ? "text-green-400" : "text-red-400"}`}>{urlResult.isVideo ? "yes" : "no"}</span>
                </div>
                {urlResult.snippet && (
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 w-[180px] text-white/40">First 100 chars</span>
                    <span className="break-all leading-tight text-amber-400/80">{urlResult.snippet.slice(0, 100)}</span>
                  </div>
                )}
                <div className={`mt-1 pt-1 border-t border-white/[0.06] ${urlResult.isHtml ? "text-red-400" : urlResult.isVideo ? "text-green-400" : "text-amber-400"}`}>
                  {urlResult.message}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── TEST 2 result: download ── */}
        {downloadResult && (
          <div className={`rounded-xl border overflow-hidden ${downloadOk ? "border-green-500/25 bg-green-500/[0.04]" : "border-red-500/25 bg-red-500/[0.04]"}`}>
            <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2">
              {downloadOk ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> : <XCircle className="h-3.5 w-3.5 text-red-400" />}
              <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Scene 1 Download</p>
            </div>
            <div className="px-3 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
              <div className="col-span-2 flex items-start gap-2"><span className="text-white/35 shrink-0 w-[110px]">Local path</span><span className="text-white/55 break-all">{downloadResult.localPath}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/35 w-[110px]">File exists</span><span className={`font-bold ${downloadResult.fileExists ? "text-green-400" : "text-red-400"}`}>{downloadResult.fileExists ? "yes" : "no"}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/35 w-[80px]">File size</span><span className="text-white/55">{fmtBytes(downloadResult.fileSize)}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/35 w-[110px]">Duration</span><span className="text-white/55">{downloadResult.duration ? `${downloadResult.duration.toFixed(2)}s` : "—"}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/35 w-[80px]">Codec</span><span className="text-white/55">{downloadResult.codec || "—"}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/35 w-[110px]">Resolution</span><span className="text-white/55">{downloadResult.width ? `${downloadResult.width}×${downloadResult.height}` : "—"}</span></div>
              <div className="flex items-center gap-2"><span className="text-white/35 w-[80px]">ffprobe</span><span className={`font-bold ${downloadResult.ffprobeValid ? "text-green-400" : "text-red-400"}`}>{downloadResult.ffprobeValid ? "valid" : "invalid"}</span></div>
              {downloadResult.error && <div className="col-span-2 text-red-400/80 break-words pt-1 border-t border-red-500/20">{downloadResult.error}</div>}
            </div>
          </div>
        )}

        {/* ── TEST 3 result: simple export ── */}
        {exportResult?.success && exportResult.url && (
          <div className="rounded-xl border border-green-500/25 bg-green-500/[0.04] px-3 py-3 space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
              <CheckCircle2 className="h-4 w-4" /> Scene 1 test export succeeded · {exportResult.duration?.toFixed(1)}s · {fmtBytes(exportResult.fileSize)}
            </div>
            <video src={exportResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
            <a href={exportResult.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
              <ExternalLink className="h-3 w-3" /> Open / download test video
            </a>
          </div>
        )}

        {/* ── TEST 4 result: scene 1 + audio ── */}
        {audioExportResult?.success && audioExportResult.url && (
          <div className="rounded-xl border border-green-500/25 bg-green-500/[0.04] px-3 py-3 space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
              <CheckCircle2 className="h-4 w-4" /> Scene 1 + audio export succeeded · {audioExportResult.duration?.toFixed(1)}s · audio {audioExportResult.hasAudio ? "✓" : "✗"}
            </div>
            <video src={audioExportResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
            <a href={audioExportResult.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
              <ExternalLink className="h-3 w-3" /> Open / download test video
            </a>
          </div>
        )}

        {/* ════════ ALL CLIPS DOCTOR ════════ */}
        <div className="pt-2 mt-2 border-t border-white/[0.08]">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4 text-primary" />
            <p className="text-[11px] font-black text-white/70 uppercase tracking-widest">All {multiClips.length} Clips Doctor</p>
          </div>

          {/* ── Multi-clip status block ── */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3 space-y-1.5 mb-3">
            {([
              ["clips found", downloadAllResult ? `${multiClipsWithUrl.length}/${multiClips.length}` : `${multiClipsWithUrl.length}/${multiClips.length}`, multiClipsWithUrl.length === multiClips.length && multiClips.length > 0],
              ["clips downloaded", downloadAllResult ? `${downloadAllResult.downloaded}/${downloadAllResult.total}` : "—", downloadAllResult ? downloadAllResult.downloaded === downloadAllResult.total : null],
              ["clips ffprobe valid", downloadAllResult ? `${downloadAllResult.valid}/${downloadAllResult.total}` : "—", downloadAllResult ? downloadAllResult.valid === downloadAllResult.total : null],
              ["all clips export works", exportAllResult ? (exportAllResult.success ? "yes" : "no") : "—", exportAllResult ? !!exportAllResult.success : null],
              ["all clips + audio export works", exportAllAudioResult ? (exportAllAudioResult.success ? "yes" : "no") : "—", exportAllAudioResult ? !!exportAllAudioResult.success : null],
            ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
              <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-white/40">{label}</span>
                <span className={`font-bold ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-red-400"}`}>{val}</span>
              </div>
            ))}
            <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
              <span className="text-white/40 shrink-0">last error</span>
              <span className="text-red-400/80 text-right break-words leading-snug">{lastError ?? "—"}</span>
            </div>
          </div>

          {/* ── Multi-clip action buttons ── */}
          <div className="grid grid-cols-1 gap-2 mb-3">
            <Button onClick={downloadAllClips} disabled={busy !== null || multiClipsWithUrl.length === 0} variant="outline"
              className="gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 text-xs"
              data-testid="btn-doctor-download-all">
              {busy === "download-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download All {multiClips.length} Clips
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={exportAllClips} disabled={busy !== null || !allClipsValid} variant="outline"
                className="gap-2 border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10 text-xs disabled:opacity-40"
                data-testid="btn-doctor-export-all">
                {busy === "export-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
                Export All {multiClips.length} Clips Only
              </Button>
              <Button onClick={exportAllClipsAudio} disabled={busy !== null || !allClipsValid} variant="outline"
                className="gap-2 border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10 text-xs disabled:opacity-40"
                data-testid="btn-doctor-export-all-audio">
                {busy === "export-all-audio" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music2 className="h-3.5 w-3.5" />}
                Export All {multiClips.length} Clips + Audio Only
              </Button>
            </div>
            <Button onClick={exportAllClipsCaptions} disabled={busy !== null || !allClipsValid || !fcCaptionsFound} variant="outline"
              className="gap-2 border-amber-500/30 bg-amber-500/5 text-amber-400 hover:bg-amber-500/10 text-xs disabled:opacity-40"
              data-testid="btn-doctor-export-all-captions">
              {busy === "export-all-captions" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
              Export All {multiClips.length} Clips + Audio + Captions Only
            </Button>
          </div>
          {!allClipsValid && (
            <p className="text-center text-[10px] text-white/25 leading-relaxed -mt-1 mb-3">
              Export buttons unlock after all clips download and pass ffprobe.
            </p>
          )}

          {/* ── Per-scene table ── */}
          {downloadAllResult && (
            <div className="rounded-xl border border-white/[0.08] overflow-hidden mb-3">
              <div className="px-3 py-2 bg-white/[0.03] border-b border-white/[0.06]">
                <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Per-Scene Results</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="text-white/35 border-b border-white/[0.06]">
                      <th className="text-left px-2 py-1.5 font-medium">Scene</th>
                      <th className="text-center px-1 py-1.5 font-medium">File</th>
                      <th className="text-right px-1 py-1.5 font-medium">Size</th>
                      <th className="text-right px-1 py-1.5 font-medium">Dur</th>
                      <th className="text-center px-1 py-1.5 font-medium">Res</th>
                      <th className="text-center px-2 py-1.5 font-medium">ffprobe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {downloadAllResult.clips.map((c) => (
                      <tr key={c.sceneNumber} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-2 py-1.5 text-white/55 whitespace-nowrap">{c.sceneNumber}</td>
                        <td className="text-center px-1 py-1.5">
                          <span className={c.fileExists ? "text-green-400" : "text-red-400"}>{c.fileExists ? "✓" : "✗"}</span>
                        </td>
                        <td className="text-right px-1 py-1.5 text-white/45">{fmtBytes(c.fileSize)}</td>
                        <td className="text-right px-1 py-1.5 text-white/45">{c.duration ? `${c.duration.toFixed(1)}s` : "—"}</td>
                        <td className="text-center px-1 py-1.5 text-white/45">{c.width ? `${c.width}×${c.height}` : "—"}</td>
                        <td className="text-center px-2 py-1.5">
                          <span className={`font-bold ${c.ffprobeValid ? "text-green-400" : "text-red-400"}`}>{c.ffprobeValid ? "valid" : "invalid"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {downloadAllResult.clips.some((c) => c.error) && (
                <div className="px-3 py-2 border-t border-white/[0.06] space-y-1">
                  {downloadAllResult.clips.filter((c) => c.error).map((c) => (
                    <div key={c.sceneNumber} className="text-[10px] font-mono text-red-400/80 break-words">
                      Scene {c.sceneNumber}: {c.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── All clips export result ── */}
          {exportAllResult?.success && exportAllResult.url && (
            <div className="rounded-xl border border-green-500/25 bg-green-500/[0.04] px-3 py-3 space-y-2 mb-3">
              <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
                <CheckCircle2 className="h-4 w-4" /> All clips export succeeded · {exportAllResult.clipCount ?? "?"} clips · {exportAllResult.duration?.toFixed(1)}s · {fmtBytes(exportAllResult.fileSize)}
              </div>
              <video src={exportAllResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
              <a href={exportAllResult.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> Open / download test video
              </a>
            </div>
          )}

          {/* ── All clips + audio export result ── */}
          {exportAllAudioResult?.success && exportAllAudioResult.url && (
            <div className="rounded-xl border border-green-500/25 bg-green-500/[0.04] px-3 py-3 space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-green-400 font-bold">
                <CheckCircle2 className="h-4 w-4" /> All clips + audio export succeeded · {exportAllAudioResult.clipCount ?? "?"} clips · {exportAllAudioResult.duration?.toFixed(1)}s · audio {exportAllAudioResult.hasAudio ? "✓" : "✗"}
              </div>
              <video src={exportAllAudioResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
              <a href={exportAllAudioResult.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> Open / download test video
              </a>
            </div>
          )}

          {/* ── Caption Export Doctor status block ── */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] px-3 py-3 space-y-1.5 mt-3">
            <p className="text-[10px] font-black text-amber-400/70 uppercase tracking-widest mb-1">Caption Export Doctor</p>
            {captionStatusRows.map(([label, val, ok]) => (
              <div key={label} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-white/40">{label}</span>
                <span className={`font-bold ${ok === null ? "text-white/25" : ok ? "text-green-400" : "text-red-400"}`}>{val}</span>
              </div>
            ))}
            <div className="flex items-start justify-between gap-2 text-[11px] font-mono pt-1 mt-1 border-t border-white/[0.06]">
              <span className="text-white/40 shrink-0">last error</span>
              <span className="text-red-400/80 text-right break-words leading-snug">
                {exportAllCaptionsResult?.error ?? (busy !== "export-all-captions" && exportAllCaptionsResult === null ? (lastError ?? "—") : "—")}
              </span>
            </div>
            {/* Real FFmpeg subtitle error tail on failure */}
            {exportAllCaptionsResult?.stderrTail && exportAllCaptionsResult.stderrTail.length > 0 && (
              <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-0.5">
                <span className="text-[10px] font-black text-red-400/60 uppercase tracking-widest">FFmpeg subtitle error</span>
                {exportAllCaptionsResult.stderrTail.map((line, i) => (
                  <div key={i} className="text-[10px] font-mono text-red-400/70 break-words leading-snug">{line}</div>
                ))}
              </div>
            )}
          </div>

          {/* ── Caption test export result ── */}
          {exportAllCaptionsResult?.success && exportAllCaptionsResult.url && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] px-3 py-3 space-y-2 mt-3">
              <div className="flex items-center gap-2 text-[11px] text-amber-300 font-bold">
                <CheckCircle2 className="h-4 w-4" /> Captions burned · {exportAllCaptionsResult.clipCount ?? "?"} clips · {exportAllCaptionsResult.duration?.toFixed(1)}s · {exportAllCaptionsResult.captionRows ?? 0} rows · audio {exportAllCaptionsResult.hasAudio ? "✓" : "✗"}
              </div>
              <video src={exportAllCaptionsResult.url} controls className="w-full max-h-64 rounded-lg bg-black" />
              <a href={exportAllCaptionsResult.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> Open / download captioned test video
              </a>
            </div>
          )}
        </div>

      </div>
    </EditorCard>
  );
}
