import { useCallback, useRef, useState } from "react";
import {
  ScanSearch, Loader2, UploadCloud, Link2, X, Plus,
  Bot, UserCheck, HelpCircle, ChevronRight, ShieldAlert,
  Image as ImageIcon, Film, Music4, FileWarning,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── AI Media Detector ──────────────────────────────────────────────────
   Upload an image, video, or audio file (or paste a URL) → GPT-6 Sol
   forensically analyzes it for AI-generation tells and returns a verdict
   (Likely AI / Likely Human / Uncertain) with confidence + signal breakdown.
   POST /api/detect/media at 2 credits, charge-before-analyze with
   auto-refund on failure. Video frames are extracted client-side (canvas);
   audio is assessed from technical metadata. Framed honestly: AI-assisted
   assessment, not a definitive forensic verdict. */

const CREDIT_COST = 2;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const FRAME_COUNT = 3;

type Verdict = "likely_ai" | "likely_human" | "uncertain";
type MediaKind = "image" | "video" | "audio";

interface Signal {
  name: string;
  description: string;
  severity: "low" | "medium" | "high";
  supportsAi: boolean;
}
interface Detection {
  verdict: Verdict;
  confidence: number;
  summary: string;
  signals: Signal[];
  frameNotes?: string[];
}
interface QueueItem {
  id: string;
  file?: File;
  mediaUrl?: string;
  kind: MediaKind;
  previewUrl?: string;
  status: "queued" | "analyzing" | "done" | "error";
  detection?: Detection;
  error?: string;
  disclaimer?: string;
}

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}
function kindOfUrl(url: string): MediaKind | null {
  if (/\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i.test(url)) return "image";
  return null;
}

/** Extract N evenly-spaced frames from a video file as JPEG data URLs. */
function extractVideoFrames(file: File, count = FRAME_COUNT): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    const frames: string[] = [];
    const canvas = document.createElement("canvas");
    const cleanup = () => URL.revokeObjectURL(url);

    video.onloadedmetadata = async () => {
      const duration = video.duration || 1;
      canvas.width = 640;
      canvas.height = Math.round(640 * (video.videoHeight / Math.max(video.videoWidth, 1))) || 360;
      const ctx = canvas.getContext("2d");
      if (!ctx) { cleanup(); reject(new Error("Canvas unavailable")); return; }
      try {
        for (let i = 0; i < count; i++) {
          const t = duration * ((i + 1) / (count + 1));
          await new Promise<void>((res, rej) => {
            const onSeek = () => { video.removeEventListener("seeked", onSeek); res(); };
            const onErr = () => { video.removeEventListener("error", onErr); rej(new Error("Frame seek failed")); };
            video.addEventListener("seeked", onSeek);
            video.addEventListener("error", onErr);
            video.currentTime = Math.min(t, Math.max(duration - 0.1, 0));
          });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push(canvas.toDataURL("image/jpeg", 0.8));
        }
        cleanup();
        resolve(frames);
      } catch (e) {
        cleanup();
        reject(e);
      }
    };
    video.onerror = () => { cleanup(); reject(new Error("Could not read video file")); };
    setTimeout(() => { cleanup(); reject(new Error("Video load timed out")); }, 30000);
  });
}

/** Read basic audio metadata client-side. */
function readAudioMetadata(file: File): Promise<{ durationSec?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ durationSec: Number.isFinite(audio.duration) ? Math.round(audio.duration * 10) / 10 : undefined });
    };
    audio.onerror = () => { URL.revokeObjectURL(url); resolve({}); };
    setTimeout(() => { URL.revokeObjectURL(url); resolve({}); }, 15000);
  });
}

function verdictMeta(v: Verdict) {
  if (v === "likely_ai")
    return { label: "Likely AI-Generated", icon: Bot, ring: "border-fuchsia-400/50 bg-fuchsia-400/10", text: "text-fuchsia-300", bar: "bg-fuchsia-400" };
  if (v === "likely_human")
    return { label: "Likely Human-Created", icon: UserCheck, ring: "border-emerald-400/50 bg-emerald-400/10", text: "text-emerald-300", bar: "bg-emerald-400" };
  return { label: "Uncertain", icon: HelpCircle, ring: "border-amber-400/50 bg-amber-400/10", text: "text-amber-300", bar: "bg-amber-400" };
}
function severityBadge(s: string) {
  if (s === "high") return "bg-red-500/20 text-red-300 border-red-500/40";
  if (s === "medium") return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  return "bg-white/10 text-white/60 border-white/20";
}
function kindIcon(k: MediaKind) {
  if (k === "image") return ImageIcon;
  if (k === "video") return Film;
  return Music4;
}

let idCounter = 0;
const nextId = () => `q${Date.now()}_${idCounter++}`;

export default function MediaDetector() {
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const items: QueueItem[] = [];
    for (const file of Array.from(files)) {
      const kind = kindOf(file);
      if (!kind) continue;
      if (file.size > MAX_FILE_BYTES) continue;
      items.push({
        id: nextId(),
        file,
        kind,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
        status: "queued",
      });
    }
    if (items.length) setQueue((q) => [...q, ...items]);
  }, []);

  const addUrl = useCallback(() => {
    const url = urlInput.trim();
    if (!url) return;
    let parsed: URL;
    try { parsed = new URL(url); } catch { return; }
    if (!/^https?:$/.test(parsed.protocol)) return;
    const kind = kindOfUrl(url);
    if (!kind) return;
    setQueue((q) => [...q, { id: nextId(), mediaUrl: url, kind, previewUrl: url, status: "queued" }]);
    setUrlInput("");
  }, [urlInput]);

  const removeItem = useCallback((id: string) => {
    setQueue((q) => {
      const item = q.find((i) => i.id === id);
      if (item?.previewUrl && item.file) URL.revokeObjectURL(item.previewUrl);
      return q.filter((i) => i.id !== id);
    });
  }, []);

  async function analyzeOne(item: QueueItem): Promise<QueueItem> {
    setQueue((q) => q.map((i) => (i.id === item.id ? { ...i, status: "analyzing", error: undefined } : i)));
    try {
      let res: Response | null;
      if (item.file && item.kind === "video") {
        // Extract frames client-side, send as JSON
        const frames = await extractVideoFrames(item.file);
        res = await confirmedFetch("/api/detect/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          overrideCost: CREDIT_COST,
          overrideFeature: "AI Media Detection",
          body: JSON.stringify({ frames, fileName: item.file.name }),
        });
      } else if (item.file && item.kind === "audio") {
        const meta = await readAudioMetadata(item.file);
        const form = new FormData();
        form.append("file", item.file);
        form.append("audioMetadata", JSON.stringify({ durationSec: meta.durationSec }));
        res = await confirmedFetch("/api/detect/media", {
          method: "POST",
          overrideCost: CREDIT_COST,
          overrideFeature: "AI Media Detection",
          body: form,
        });
      } else if (item.file) {
        const form = new FormData();
        form.append("file", item.file);
        res = await confirmedFetch("/api/detect/media", {
          method: "POST",
          overrideCost: CREDIT_COST,
          overrideFeature: "AI Media Detection",
          body: form,
        });
      } else {
        res = await confirmedFetch("/api/detect/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          overrideCost: CREDIT_COST,
          overrideFeature: "AI Media Detection",
          body: JSON.stringify({ mediaUrl: item.mediaUrl }),
        });
      }
      if (!res) {
        // user cancelled the credit confirmation
        return { ...item, status: "queued" };
      }
      const data = await res.json();
      if (!res.ok || !data.detection) {
        const msg =
          data.error === "out_of_credits"
            ? "Out of credits."
            : data.message || "Detection failed. Try again.";
        return { ...item, status: "error", error: msg };
      }
      return { ...item, status: "done", detection: data.detection as Detection, disclaimer: data.disclaimer };
    } catch (e) {
      return { ...item, status: "error", error: e instanceof Error ? e.message : "Detection failed." };
    }
  }

  const analyzeItem = useCallback(async (id: string) => {
    const item = queue.find((i) => i.id === id);
    if (!item || item.status === "analyzing") return;
    const updated = await analyzeOne(item);
    setQueue((q) => q.map((i) => (i.id === id ? updated : i)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, confirmedFetch]);

  const analyzeAll = useCallback(async () => {
    const pending = queue.filter((i) => i.status === "queued");
    if (!pending.length || batchRunning) return;
    setBatchRunning(true);
    for (const item of pending) {
      const updated = await analyzeOne(item);
      setQueue((q) => q.map((i) => (i.id === item.id ? updated : i)));
      if (updated.status === "queued") break; // user cancelled confirmation — stop the batch
    }
    setBatchRunning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, batchRunning, confirmedFetch]);

  const queuedCount = queue.filter((i) => i.status === "queued").length;
  const doneCount = queue.filter((i) => i.status === "done").length;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="max-w-5xl mx-auto px-4 pt-28 pb-20">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300 text-xs font-bold uppercase tracking-widest mb-4">
            <ScanSearch className="h-3.5 w-3.5" /> AI Media Detector
          </div>
          <h1 className="text-4xl md:text-5xl font-black mb-3">
            Real or <span className="text-amber-400">AI?</span> Know for sure.
          </h1>
          <p className="text-white/50 max-w-2xl mx-auto">
            Upload an image, video, or audio file — or paste a link — and get a forensic
            AI assessment: verdict, confidence score, and the exact tells it found.
            <span className="text-amber-300/80 font-semibold"> {CREDIT_COST} credits per check.</span>
          </p>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          className={`rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors mb-4 ${
            dragOver ? "border-amber-400/70 bg-amber-400/5" : "border-white/15 bg-white/[0.02] hover:border-amber-400/40"
          }`}
        >
          <UploadCloud className="h-10 w-10 mx-auto mb-3 text-amber-400/80" />
          <p className="font-bold text-lg">Drop files here or click to upload</p>
          <p className="text-white/40 text-sm mt-1">Images, video, audio — up to 25MB each. Batch supported.</p>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            multiple
            accept="image/*,video/*,audio/*"
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
          />
        </div>

        {/* URL paste */}
        <div className="flex gap-2 mb-8">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addUrl(); }}
              placeholder="…or paste an image URL"
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-sm placeholder:text-white/25 focus:outline-none focus:border-amber-400/50"
            />
          </div>
          <button
            type="button"
            onClick={addUrl}
            className="px-5 py-3 rounded-xl bg-amber-400 text-black text-sm font-black hover:bg-amber-300 transition-colors flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>

        {/* Batch controls */}
        {queue.length > 0 && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-white/50">
              {queue.length} file{queue.length === 1 ? "" : "s"} · {doneCount} checked
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setQueue([])}
                className="px-4 py-2 rounded-full text-sm font-bold border border-white/15 text-white/60 hover:text-white transition-colors"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={analyzeAll}
                disabled={queuedCount === 0 || batchRunning}
                className="px-5 py-2 rounded-full text-sm font-black bg-amber-400 text-black hover:bg-amber-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {batchRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                Check all ({queuedCount * CREDIT_COST} credits)
              </button>
            </div>
          </div>
        )}

        {/* Queue */}
        <div className="space-y-4">
          {queue.map((item) => {
            const KindIcon = kindIcon(item.kind);
            return (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <div className="flex items-start gap-4">
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt="" className="w-20 h-20 rounded-xl object-cover border border-white/10 shrink-0" />
                  ) : (
                    <div className="w-20 h-20 rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center shrink-0">
                      <KindIcon className="h-8 w-8 text-amber-400/70" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <KindIcon className="h-4 w-4 text-white/40 shrink-0" />
                      <p className="text-sm font-bold truncate">
                        {item.file ? item.file.name : item.mediaUrl}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="ml-auto text-white/30 hover:text-white transition-colors"
                        aria-label="Remove"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {item.status === "queued" && (
                      <button
                        type="button"
                        onClick={() => analyzeItem(item.id)}
                        className="mt-2 px-4 py-2 rounded-full text-sm font-black bg-amber-400 text-black hover:bg-amber-300 transition-colors inline-flex items-center gap-1.5"
                      >
                        <ScanSearch className="h-4 w-4" /> Analyze · {CREDIT_COST} credits
                      </button>
                    )}
                    {item.status === "analyzing" && (
                      <p className="mt-2 text-sm text-amber-300/80 flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {item.kind === "video" ? "Extracting frames, then analyzing…" : "Analyzing for AI tells…"}
                      </p>
                    )}
                    {item.status === "error" && (
                      <p className="mt-2 text-sm text-red-300 flex items-center gap-2">
                        <FileWarning className="h-4 w-4" /> {item.error}
                        <button
                          type="button"
                          onClick={() => analyzeItem(item.id)}
                          className="ml-2 underline underline-offset-2 hover:text-red-200"
                        >
                          Retry
                        </button>
                      </p>
                    )}
                    {item.status === "done" && item.detection && (
                      <DetectionResult detection={item.detection} />
                    )}
                  </div>
                </div>
                {item.status === "done" && item.disclaimer && (
                  <p className="mt-4 pt-3 border-t border-white/5 text-xs text-white/30 flex gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {item.disclaimer}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {queue.length === 0 && (
          <div className="text-center py-16 text-white/25">
            <ScanSearch className="h-12 w-12 mx-auto mb-4 opacity-40" />
            <p className="font-bold">Nothing to check yet</p>
            <p className="text-sm mt-1">Upload a file or paste a URL to run your first detection.</p>
          </div>
        )}

        <OutOfCredits user={user} />
      </main>
      <SiteFooter />
    </div>
  );
}

function DetectionResult({ detection }: { detection: Detection }) {
  const meta = verdictMeta(detection.verdict);
  const Icon = meta.icon;
  const conf = Math.max(0, Math.min(100, Math.round(detection.confidence)));
  return (
    <div className="mt-3">
      <div className={`rounded-xl border p-4 ${meta.ring}`}>
        <div className="flex items-center gap-3 mb-2">
          <Icon className={`h-6 w-6 ${meta.text}`} />
          <div className="flex-1">
            <p className={`font-black ${meta.text}`}>{meta.label}</p>
            <div className="mt-1.5 h-2 rounded-full bg-black/40 overflow-hidden">
              <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${conf}%` }} />
            </div>
          </div>
          <span className={`text-2xl font-black ${meta.text}`}>{conf}%</span>
        </div>
        <p className="text-sm text-white/70">{detection.summary}</p>
      </div>

      {detection.frameNotes && detection.frameNotes.length > 0 && (
        <div className="mt-3 text-xs text-white/45 space-y-1">
          {detection.frameNotes.map((n, i) => (
            <p key={i}>• {n}</p>
          ))}
        </div>
      )}

      {detection.signals && detection.signals.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 flex items-center gap-1">
            Detected signals <ChevronRight className="h-3 w-3" />
          </p>
          <div className="space-y-2">
            {detection.signals.map((s, i) => (
              <div key={i} className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-bold">{s.name}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${severityBadge(s.severity)}`}>
                    {s.severity}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    s.supportsAi
                      ? "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40"
                      : "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                  }`}>
                    {s.supportsAi ? "points to AI" : "points to human"}
                  </span>
                </div>
                <p className="text-sm text-white/60">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
