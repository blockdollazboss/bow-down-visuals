import { useRef, useState } from "react";
import { Bot, FileSearch, HelpCircle, Link2, Loader2, Upload, UserCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage } from "../../../lib/api-error";
import { DeskTextField } from "./CreateDeskLeaf";
import type { CreateDeskProps } from "./CreateDesks";
import {
  DETECTOR_COST_VISUAL_BUCS,
  DETECTOR_FEATURE,
  DETECTOR_FRAME_COUNT,
  DETECTOR_MAX_FILE_BYTES,
  DETECTOR_PATH,
  DETECTOR_VERDICT_LABELS,
  buildDetectAudioForm,
  buildDetectFramesPayload,
  buildDetectImageForm,
  buildDetectUrlPayload,
  detectionResultOfResponse,
  detectorKindOfFile,
  detectorUrlReady,
  pushDetectorHistory,
  type DetectorHistoryEntry,
  type DetectorMediaKind,
  type DetectorResult,
  type DetectorVerdict,
} from "@/lib/world/detector-desk";

/* ─── The Detector Desk (stack1500 world parity wave #3, item 12) ──
   The AI Media Detector, native in the Create Wing: check an
   image, a video, or an audio file for AI-generation tells on
   the /detector page's own rail (POST /api/detect/media,
   200 Visual Bucs — the registry row mirrors the route's
   DETECTION_CREDITS and the page's CREDIT_COST badge).
   All four of the page's payload variants ride here: image URL,
   image file, audio file (with its client-read duration), and
   video file (frames extracted in the panel exactly the way the
   page extracts them — 3 JPEG frames, start/middle/end).
   Every run rides confirmedFetch with the registry cost as the
   explicit override, the price is printed on the desk before the
   run, a failed analysis is refunded server-side, and a 402
   reads as out-of-Visual-Bucs. The page's batch queue is a
   page-scale extra; the desk checks one piece at a time and
   keeps this sitting's verdicts in a session strip, labelled
   as such. Results render IN the panel — nothing ejects to the
   website. Members only, exactly the 2D boundary. */

type DetectorMode = "url" | "file";

const MODES: ReadonlyArray<{ key: DetectorMode; label: string; icon: LucideIcon }> = [
  { key: "url", label: "Image URL", icon: Link2 },
  { key: "file", label: "Upload a file", icon: Upload },
];

const VERDICT_ICONS: Record<DetectorVerdict, LucideIcon> = {
  likely_ai: Bot,
  likely_human: UserCheck,
  uncertain: HelpCircle,
};

/** The page's frame extraction (media-detector.tsx), ported
 *  verbatim in behaviour: 3 evenly-spaced JPEG frames at 640px
 *  wide, seeked at (i+1)/(count+1) of the duration. */
function extractVideoFrames(file: File, count = DETECTOR_FRAME_COUNT): Promise<string[]> {
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
      if (!ctx) {
        cleanup();
        reject(new Error("Canvas unavailable"));
        return;
      }
      try {
        for (let i = 0; i < count; i++) {
          const t = duration * ((i + 1) / (count + 1));
          await new Promise<void>((res, rej) => {
            const onSeek = () => {
              video.removeEventListener("seeked", onSeek);
              res();
            };
            const onErr = () => {
              video.removeEventListener("error", onErr);
              rej(new Error("Frame seek failed"));
            };
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
        reject(e instanceof Error ? e : new Error("Frame extraction failed"));
      }
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Could not read video file"));
    };
    setTimeout(() => {
      cleanup();
      reject(new Error("Video load timed out"));
    }, 30000);
  });
}

/** The page's audio metadata reader: duration only — the one
 *  field its client-side read produces for the rail. */
function readAudioDuration(file: File): Promise<{ durationSec?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ durationSec: Number.isFinite(audio.duration) ? Math.round(audio.duration * 10) / 10 : undefined });
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({});
    };
    setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve({});
    }, 15000);
  });
}

export function DetectorDesk(props: CreateDeskProps) {
  const { isLight } = props;
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<DetectorMode>("url");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [mediaUrl, setMediaUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKind, setFileKind] = useState<DetectorMediaKind | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [result, setResult] = useState<DetectorResult | null>(null);
  const [history, setHistory] = useState<DetectorHistoryEntry[]>([]);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const ready = mode === "url" ? detectorUrlReady(mediaUrl) : file !== null;

  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;

  const switchMode = (next: DetectorMode) => {
    setMode(next);
    setNote(null);
    setOutOfCredits(false);
  };

  const pickFile = (picked: File | null) => {
    setFileError(null);
    if (!picked) {
      setFile(null);
      setFileKind(null);
      return;
    }
    const kind = detectorKindOfFile(picked);
    if (!kind) {
      setFile(null);
      setFileKind(null);
      setFileError("That file isn't an image, video, or audio file — the detector reads those three.");
      return;
    }
    if (picked.size > DETECTOR_MAX_FILE_BYTES) {
      setFile(null);
      setFileKind(null);
      setFileError("That file is over the detector's 25 MB limit — the same limit the website sets.");
      return;
    }
    setFile(picked);
    setFileKind(kind);
  };

  const run = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setNote(null);
    setOutOfCredits(false);
    try {
      let res: Response | null;
      let label = mediaUrl.trim();
      if (mode === "file" && file && fileKind === "video") {
        const frames = await extractVideoFrames(file);
        label = file.name;
        res = await confirmedFetch(DETECTOR_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          overrideCost: DETECTOR_COST_VISUAL_BUCS,
          overrideFeature: DETECTOR_FEATURE,
          body: JSON.stringify(buildDetectFramesPayload({ frames, fileName: file.name })),
        });
      } else if (mode === "file" && file && fileKind === "audio") {
        const meta = await readAudioDuration(file);
        label = file.name;
        res = await confirmedFetch(DETECTOR_PATH, {
          method: "POST",
          overrideCost: DETECTOR_COST_VISUAL_BUCS,
          overrideFeature: DETECTOR_FEATURE,
          body: buildDetectAudioForm(file, meta),
        });
      } else if (mode === "file" && file) {
        label = file.name;
        res = await confirmedFetch(DETECTOR_PATH, {
          method: "POST",
          overrideCost: DETECTOR_COST_VISUAL_BUCS,
          overrideFeature: DETECTOR_FEATURE,
          body: buildDetectImageForm(file),
        });
      } else {
        res = await confirmedFetch(DETECTOR_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          overrideCost: DETECTOR_COST_VISUAL_BUCS,
          overrideFeature: DETECTOR_FEATURE,
          body: JSON.stringify(buildDetectUrlPayload(mediaUrl)),
        });
      }
      if (!res) return; // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) {
        const d = data as { message?: string; error?: string };
        setNote(apiErrorMessage(d, "The check didn't go through — a failed check is refunded. Try again."));
        return;
      }
      const parsed = detectionResultOfResponse(data);
      if (!parsed) {
        setNote("The verdict came back unreadable — a failed check is refunded. Try again.");
        return;
      }
      setResult(parsed);
      setHistory((h) => pushDetectorHistory(h, { label: parsed.label || label, kind: parsed.mediaKind, result: parsed }));
      refreshProfile();
    } catch {
      setNote("The check didn't go through — a failed check is refunded. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const VerdictIcon = result ? VERDICT_ICONS[result.verdict] : FileSearch;
  const barCls = result
    ? result.verdict === "likely_ai"
      ? "bg-fuchsia-500"
      : result.verdict === "likely_human"
        ? "bg-emerald-500"
        : "bg-amber-500"
    : "";

  return (
    <div className="space-y-3" data-testid="world-create-detector-desk">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Detector Desk tools">
        {MODES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            data-testid={`world-detector-desk-mode-${key}`}
            onClick={() => switchMode(key)}
            className={chipCls(mode === key)}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {mode === "url" && (
        <div className="space-y-2">
          <DeskTextField
            isLight={isLight}
            label="Image URL"
            value={mediaUrl}
            onChange={setMediaUrl}
            placeholder="https://…/image.png — a direct link to the image"
          />
          <p className={`text-xs ${muted}`}>
            The URL check reads images — for video or audio, upload the file instead.
          </p>
        </div>
      )}

      {mode === "file" && (
        <div className="space-y-2">
          <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            Image, video, or audio file (25 MB max)
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*,audio/*"
            className="hidden"
            data-testid="world-detector-desk-file-input"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            data-testid="world-detector-desk-pick"
            onClick={() => fileRef.current?.click()}
            className={chipCls(false)}
          >
            <Upload className="h-3.5 w-3.5" /> {file ? "Choose a different file" : "Choose a file"}
          </button>
          {file && (
            <p className={`text-xs ${muted}`}>
              {file.name} — {fileKind} · {(file.size / 1024 / 1024).toFixed(1)} MB
              {fileKind === "video" ? " · 3 frames are pulled from the video here in the panel, like the website does" : ""}
              {fileKind === "audio" ? " · audio is judged on its file fingerprint, not a listen — the verdict says so" : ""}
            </p>
          )}
          {fileError && (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{fileError}</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="world-detector-desk-cost" className={`text-xs font-semibold ${muted}`}>
          Costs {DETECTOR_COST_VISUAL_BUCS.toLocaleString("en-US")} Visual Bucs — shown before anything runs.
        </span>
        <button
          type="button"
          data-testid="world-detector-desk-run"
          onClick={() => void run()}
          disabled={busy || !ready}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
          {busy ? "Checking…" : "Run the check"}
        </button>
      </div>
      {!ready && (
        <p className={`text-xs ${muted}`}>
          {mode === "url"
            ? "Paste a direct image URL first — the check stays shut (and uncharged) until it looks like one."
            : "Choose a file first — the check stays shut (and uncharged) until one is picked."}
        </p>
      )}
      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          You&rsquo;re out of Visual Bucs — top up at the Visual Buc Packs desk in the Treasury and the Detector Desk is ready again.
        </p>
      )}
      {note && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}

      {result && (
        <div data-testid="world-detector-desk-result" className="space-y-3">
          <div className={`rounded-xl border px-3 py-2 ${cardCls}`}>
            <div className="flex flex-wrap items-center gap-2">
              <VerdictIcon className="h-5 w-5" />
              <p className={`text-lg font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {DETECTOR_VERDICT_LABELS[result.verdict]}
              </p>
              <span className={`ml-auto text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {result.confidence}% confidence
              </span>
            </div>
            <div className={`mt-2 h-2 overflow-hidden rounded-full ${isLight ? "bg-black/10" : "bg-white/10"}`}>
              <div className={`h-full rounded-full ${barCls}`} style={{ width: `${result.confidence}%` }} />
            </div>
            <p className={`mt-2 text-sm ${muted}`}>{result.summary}</p>
            {result.label && <p className={`mt-1 text-xs ${muted}`}>Checked: {result.label}</p>}
          </div>
          {result.signals.length > 0 && (
            <div className="space-y-2">
              <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                What the check found ({result.signals.length})
              </p>
              {result.signals.map((s, i) => (
                <div key={`${s.name}-${i}`} className={`rounded-xl border px-3 py-2 text-sm ${cardCls}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{s.name}</p>
                    <span className={chipCls(false)}>{s.severity}</span>
                    <span className={`text-xs font-bold ${muted}`}>{s.supportsAi ? "points to AI" : "points to human"}</span>
                  </div>
                  {s.description && <p className={`mt-1 ${muted}`}>{s.description}</p>}
                </div>
              ))}
            </div>
          )}
          {result.frameNotes.length > 0 && (
            <div className={`rounded-xl border px-3 py-2 text-sm ${cardCls}`}>
              <p className="font-bold">Frame notes</p>
              {result.frameNotes.map((n, i) => (
                <p key={i} className={muted}>
                  {n}
                </p>
              ))}
            </div>
          )}
          {result.disclaimer && <p className={`text-xs italic ${muted}`}>{result.disclaimer}</p>}
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setMediaUrl("");
              setFile(null);
              setFileKind(null);
            }}
            className={chipCls(false)}
          >
            Check another piece
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            This session
          </p>
          <div className="flex flex-wrap gap-1.5">
            {history.map((entry, i) => (
              <button
                key={`${entry.label}-${i}`}
                type="button"
                onClick={() => setResult(entry.result)}
                className={chipCls(result === entry.result)}
              >
                {DETECTOR_VERDICT_LABELS[entry.result.verdict]}: {entry.label || "check"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
