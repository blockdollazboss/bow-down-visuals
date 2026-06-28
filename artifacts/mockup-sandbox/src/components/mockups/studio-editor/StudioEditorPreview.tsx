import { useState, useRef, useMemo, useCallback } from "react";
import {
  Play, Pause, SkipBack, Lock, Download, ZoomIn, ZoomOut,
  Film, ChevronDown, ChevronUp, Copy, Check, Volume2,
  AlertTriangle, RefreshCw, Wrench, Sparkles, ImageOff,
} from "lucide-react";

/* ─── Static clip config (no URLs — managed in state below) ─────── */
const CLIP_CONFIG = [
  { id: "s1",  section: "Intro",      dur: 15 },
  { id: "s2",  section: "Hook",       dur: 17 },
  { id: "s3",  section: "Verse 1",    dur: 22 },
  { id: "s4",  section: "Pre-Chorus", dur: 12 },
  { id: "s5",  section: "Chorus",     dur: 20 },
  { id: "s6",  section: "Verse 2",    dur: 22 },
  { id: "s7",  section: "Bridge",     dur: 16 },
  { id: "s8",  section: "Drop",       dur: 14 }, // ← starts with null URL
  { id: "s9",  section: "Chorus 2",   dur: 20 },
  { id: "s10", section: "Break",      dur: 10 },
  { id: "s11", section: "Outro A",    dur: 12 },
  { id: "s12", section: "Outro B",    dur: 8  },
];

const TOTAL_DUR = CLIP_CONFIG.reduce((s, c) => s + c.dur, 0);

const OFFSETS: number[] = [];
let _acc = 0;
for (const c of CLIP_CONFIG) { OFFSETS.push(_acc); _acc += c.dur; }

const COLORS = [
  "#7c3aed","#2563eb","#059669","#d97706","#dc2626",
  "#0891b2","#7e22ce","#1d4ed8","#047857","#b45309","#b91c1c","#0e7490",
];

const MOCK_PROJECT_AUDIO_URL = "https://storage.example.com/proj/audio-master.mp3";

/* ─── Mock project data used by repair search ──────────────────── */
const MOCK_PROJECT_DATA: Record<string, {
  videoUrl?: string; outputUrl?: string; generatedVideoUrl?: string;
  assetUrl?: string; generationJobId?: string; storagePath?: string;
  errorReason?: string;
}> = {
  s8: {
    generationJobId: "gen_7f3a9bc2",
    storagePath: "projects/proj-001/clips/drop/output.mp4",
    errorReason: "Generation job timed out — output.mp4 exists in storage but URL was not saved back to clip record",
  },
};

/* ─── Types ──────────────────────────────────────────────────────── */
type ClipUrls = Record<string, string | null>;

type RepairResult = {
  foundExisting: boolean;
  attachedUrl: boolean;
  placeholderCreated: boolean;
  regenerateStarted: boolean;
  savedToProject: boolean;
  allClipsNowValid: boolean;
  attachedUrlValue: string | null;
  lastError: string | null;
};

type ClipValidation = {
  clipNum: number; id: string; section: string;
  urlExists: boolean; urlValid: boolean; url: string | null;
  timelineStart: number; timelineEnd: number; timelineDur: number;
  trimStart: number; trimEnd: number; sourceDur: number; exportDur: number;
  ready: boolean; errors: string[];
};

type LockedTimeline = {
  id: string; version: number; lockedAt: string;
  projectAudioUrl: string; audioStartSec: number; totalSongDuration: number;
  clipCount: number;
  clips: { clipNum: number; id: string; section: string; timelineStart: number; timelineEnd: number; timelineDur: number; trimStart: number; trimEnd: number; sourceDur: number; exportDur: number; videoUrl: string }[];
};

/* ─── Helpers ─────────────────────────────────────────────────── */
function fmt(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
function fmtMs(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s % 1) * 10)}`;
}
function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try { new URL(url); return url.startsWith("http"); } catch { return false; }
}
function activeClipIdx(t: number) {
  for (let i = CLIP_CONFIG.length - 1; i >= 0; i--) {
    if (t >= (OFFSETS[i] ?? 0)) return i;
  }
  return 0;
}

/* ─── Waveform ─────────────────────────────────────────────────── */
function Waveform({ progress }: { progress: number }) {
  const bars = useMemo(() => Array.from({ length: 220 }, (_, i) => {
    const t = i / 220;
    return Math.min(1, Math.max(0.06,
      0.25 * Math.abs(Math.sin(t * 13.1 + 0.4)) + 0.35 * Math.abs(Math.sin(t * 27.8 + 2.1)) +
      0.25 * Math.abs(Math.sin(t * 53.2 + 5.7)) + 0.15 * Math.abs(Math.sin(t * 91.0 + 8.3))
    ));
  }), []);
  const W = 1000, H = 36, bw = W / bars.length, played = Math.min(W, progress * W);
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <clipPath id="cp-p"><rect x={0} y={0} width={played} height={H} /></clipPath>
        <clipPath id="cp-u"><rect x={played} y={0} width={W - played} height={H} /></clipPath>
      </defs>
      {bars.map((h, i) => {
        const x = i * bw, bH = h * H, y = (H - bH) / 2;
        return (
          <g key={i}>
            <rect x={x} y={y} width={Math.max(1, bw - 0.8)} height={bH} fill="rgba(201,168,76,0.85)" clipPath="url(#cp-p)" />
            <rect x={x} y={y} width={Math.max(1, bw - 0.8)} height={bH} fill="rgba(201,168,76,0.22)" clipPath="url(#cp-u)" />
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Ruler ─────────────────────────────────────────────────────── */
function Ruler({ total, current }: { total: number; current: number }) {
  const step = total <= 120 ? 15 : total <= 240 ? 30 : 60;
  const ticks: number[] = [];
  for (let t = 0; t <= total + 0.01; t += step) ticks.push(Math.round(t));
  return (
    <div className="relative h-6 select-none" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.01)" }}>
      {ticks.map(t => (
        <div key={t} className="absolute top-0 flex flex-col items-center" style={{ left: `${(t / total) * 100}%`, transform: "translateX(-50%)" }}>
          <div style={{ width: 1, height: 8, background: "rgba(255,255,255,0.15)", marginTop: 2 }} />
          <span style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.25)" }}>{fmt(t)}</span>
        </div>
      ))}
      <div className="absolute top-0 bottom-0" style={{ width: 1, left: `${(current / total) * 100}%`, background: "rgba(201,168,76,0.7)", pointerEvents: "none" }} />
    </div>
  );
}

/* ─── Preview Player ────────────────────────────────────────────── */
function PreviewPlayer({ currentTime, isPlaying, clipIdx, urls, onTogglePlay, onRestart, onPrevClip, onNextClip, onSelectClip }: {
  currentTime: number; isPlaying: boolean; clipIdx: number; urls: ClipUrls;
  onTogglePlay: () => void; onRestart: () => void; onPrevClip: () => void; onNextClip: () => void;
  onSelectClip: (i: number) => void;
}) {
  const clip = CLIP_CONFIG[clipIdx]!;
  const url = urls[clip.id] ?? null;
  const color = COLORS[clipIdx % COLORS.length]!;
  const offset = OFFSETS[clipIdx] ?? 0;
  const clipProgress = clip.dur > 0 ? Math.max(0, Math.min(1, (currentTime - offset) / clip.dur)) : 0;
  const clipTime = Math.max(0, currentTime - offset);
  return (
    <div style={{ display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "#060606" }}>
      <div style={{ position: "relative", aspectRatio: "16/9", background: "#000", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: url ? `radial-gradient(ellipse at 30% 40%, ${color}28 0%, #000 70%), radial-gradient(ellipse at 70% 60%, ${color}18 0%, transparent 60%)` : "repeating-linear-gradient(45deg, #111 0px, #111 10px, #0a0a0a 10px, #0a0a0a 20px)" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0.12) 1px, transparent 1px, transparent 3px)", pointerEvents: "none" }} />
        {url ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", border: `2px solid ${color}66`, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Film size={18} style={{ color: `${color}cc` }} />
            </div>
            <p style={{ fontSize: 17, fontWeight: 900, color: "#fff", letterSpacing: "0.05em", textShadow: "0 2px 16px rgba(0,0,0,0.8)" }}>{clip.section}</p>
            <p style={{ fontSize: 9, color: `${color}aa`, fontFamily: "monospace" }}>Clip {clipIdx + 1} of {CLIP_CONFIG.length}</p>
          </div>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <AlertTriangle size={22} style={{ color: "#f59e0b" }} />
            <p style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700 }}>No clip URL — {clip.section}</p>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>Clip {clipIdx + 1} · click clip to repair</p>
          </div>
        )}
        <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 4 }}>
          <span style={{ fontSize: 8, fontWeight: 900, padding: "2px 7px", borderRadius: 99, background: `${color}cc`, color: "#fff", textTransform: "uppercase" }}>{clip.section}</span>
          {!url && <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: "rgba(251,191,36,0.9)", color: "#000" }}>⚠ NO URL</span>}
        </div>
        <div style={{ position: "absolute", top: 8, right: 8, fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.7)", background: "rgba(0,0,0,0.6)", borderRadius: 4, padding: "2px 6px" }}>{fmtMs(currentTime)}</div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(255,255,255,0.08)" }}>
          <div style={{ height: "100%", width: `${clipProgress * 100}%`, background: color, transition: "width 0.05s linear" }} />
        </div>
        {isPlaying && <div style={{ position: "absolute", top: 8, right: 60, width: 8, height: 8, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 6px #ef4444" }}><span style={{ fontSize: 7, color: "#fff", fontWeight: 900, position: "absolute", left: 12, top: -1, whiteSpace: "nowrap" }}>REC</span></div>}
      </div>
      <div style={{ background: "#0d0d0d", borderTop: "1px solid rgba(255,255,255,0.06)", padding: "7px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onRestart} style={{ padding: 5, background: "transparent", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer" }}><SkipBack size={12} /></button>
        <button onClick={onPrevClip} disabled={clipIdx === 0} style={{ padding: 5, background: "transparent", border: "none", color: clipIdx === 0 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.4)", cursor: clipIdx === 0 ? "not-allowed" : "pointer" }}>◀</button>
        <button onClick={onTogglePlay} style={{ width: 30, height: 30, borderRadius: "50%", border: `1px solid ${color}77`, background: `${color}22`, color, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {isPlaying ? <Pause size={12} /> : <Play size={12} style={{ marginLeft: 1 }} />}
        </button>
        <button onClick={onNextClip} disabled={clipIdx >= CLIP_CONFIG.length - 1} style={{ padding: 5, background: "transparent", border: "none", color: clipIdx >= CLIP_CONFIG.length - 1 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.4)", cursor: clipIdx >= CLIP_CONFIG.length - 1 ? "not-allowed" : "pointer" }}>▶</button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, marginLeft: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
            <span style={{ color }}>+{fmt(clipTime)}</span><span>{fmt(clip.dur)} clip</span>
          </div>
          <div style={{ height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 1, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${clipProgress * 100}%`, background: color }} />
          </div>
        </div>
        <Volume2 size={11} style={{ color: "rgba(255,255,255,0.2)", flexShrink: 0 }} />
      </div>
      <div style={{ background: "#0a0a0a", borderTop: "1px solid rgba(255,255,255,0.04)", padding: "5px 8px", display: "flex", gap: 3, overflowX: "auto" }}>
        {CLIP_CONFIG.map((c, i) => {
          const col = COLORS[i % COLORS.length]!;
          const isAct = i === clipIdx;
          const hasUrl = !!urls[c.id];
          return (
            <div key={c.id} title={c.section} onClick={() => onSelectClip(i)}
              style={{ flexShrink: 0, width: 26, height: 18, borderRadius: 4, background: isAct ? `${col}cc` : hasUrl ? `${col}33` : "rgba(251,191,36,0.25)", border: `1px solid ${isAct ? col : hasUrl ? `${col}44` : "rgba(251,191,36,0.5)"}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: isAct ? `0 0 8px ${col}55` : undefined }}>
              <span style={{ fontSize: 7, fontWeight: 900, color: isAct ? "#fff" : hasUrl ? "rgba(255,255,255,0.4)" : "#fbbf24" }}>{i + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Clip Validation Row ────────────────────────────────────────── */
function ClipValidRow({ v }: { v: ClipValidation }) {
  const [open, setOpen] = useState(!v.ready);
  return (
    <div style={{ borderRadius: 6, border: `1px solid ${v.ready ? "rgba(74,222,128,0.15)" : "rgba(251,191,36,0.3)"}`, background: v.ready ? "rgba(74,222,128,0.03)" : "rgba(251,191,36,0.04)", marginBottom: 4, overflow: "hidden" }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
        <span style={{ fontSize: 10, width: 18, textAlign: "center", flexShrink: 0 }}>{v.ready ? "✓" : "⚠"}</span>
        <span style={{ flex: 1, display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", flexShrink: 0 }}>#{v.clipNum}</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{v.section}</span>
        </span>
        <span style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>{fmt(v.timelineStart)}–{fmt(v.timelineEnd)}</span>
        <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 99, background: v.ready ? "rgba(74,222,128,0.15)" : "rgba(251,191,36,0.15)", color: v.ready ? "#4ade80" : "#fbbf24", fontWeight: 700, flexShrink: 0 }}>{v.ready ? "Ready" : "Not ready"}</span>
        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 10px 8px 10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {([["URL Exists", v.urlExists ? "yes" : "⚠ NO", v.urlExists], ["URL Valid", v.urlValid ? "yes" : "⚠ INVALID", v.urlValid], ["Timeline Start", fmt(v.timelineStart), true], ["Timeline End", fmt(v.timelineEnd), true], ["Timeline Dur", `${v.timelineDur}s`, true], ["Trim Start", `${v.trimStart.toFixed(1)}s`, true], ["Trim End", `${v.trimEnd.toFixed(1)}s`, true], ["Source Dur", `${v.sourceDur}s`, true], ["Export Dur", `${v.exportDur.toFixed(1)}s`, true]] as [string, string, boolean][]).map(([k, val, ok]) => (
            <div key={k} style={{ display: "flex", gap: 6, fontSize: 8, fontFamily: "monospace", alignItems: "baseline" }}>
              <span style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0, minWidth: 80 }}>{k}</span>
              <span style={{ color: ok ? "rgba(255,255,255,0.6)" : "#fbbf24", fontWeight: !ok ? 700 : undefined }}>{val}</span>
            </div>
          ))}
          {v.errors.length > 0 && (
            <div style={{ gridColumn: "1/-1", marginTop: 4 }}>
              {v.errors.map((e, i) => <div key={i} style={{ fontSize: 8, color: "#f87171", fontFamily: "monospace", display: "flex", gap: 5 }}><span>✕</span><span>{e}</span></div>)}
            </div>
          )}
          {v.url && <div style={{ gridColumn: "1/-1", marginTop: 2 }}><span style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", fontFamily: "monospace", wordBreak: "break-all" }}>{v.url}</span></div>}
        </div>
      )}
    </div>
  );
}

/* ─── Clip URL Repair Panel ─────────────────────────────────────── */
function ClipRepairPanel({ clipIdx, urls, onRepaired }: {
  clipIdx: number; urls: ClipUrls; onRepaired: (id: string, url: string) => void;
}) {
  const clip = CLIP_CONFIG[clipIdx]!;
  const projData = MOCK_PROJECT_DATA[clip.id] ?? {};
  const currentUrl = urls[clip.id] ?? null;
  const color = COLORS[clipIdx % COLORS.length]!;

  const [busy, setBusy] = useState<"repair" | "placeholder" | "regenerate" | null>(null);
  const [result, setResult] = useState<RepairResult | null>(null);
  const [regenJobId, setRegenJobId] = useState<string | null>(null);

  const runAction = async (action: "repair" | "placeholder" | "regenerate") => {
    setBusy(action);
    setResult(null);
    await new Promise(r => setTimeout(r, 900));

    let res: RepairResult = { foundExisting: false, attachedUrl: false, placeholderCreated: false, regenerateStarted: false, savedToProject: false, allClipsNowValid: false, attachedUrlValue: null, lastError: null };

    try {
      if (action === "repair") {
        // Simulate searching all URL fields
        const found =
          projData.videoUrl ?? projData.outputUrl ?? projData.generatedVideoUrl ??
          projData.assetUrl ??
          (projData.storagePath ? `https://storage.example.com/${projData.storagePath}` : null);
        if (found) {
          res.foundExisting = true;
          res.attachedUrl = true;
          res.savedToProject = true;
          res.attachedUrlValue = found;
          res.allClipsNowValid = true;
          onRepaired(clip.id, found);
        } else {
          res.lastError = "No existing URL found in clip.videoUrl, clip.url, clip.outputUrl, scene.videoUrl, scene.generatedVideoUrl, asset.url, generation.resultUrl, or storage public URL";
        }
      } else if (action === "placeholder") {
        const ph = `https://storage.example.com/placeholders/drop-${clip.dur}s-placeholder.mp4`;
        res.placeholderCreated = true;
        res.attachedUrl = true;
        res.savedToProject = true;
        res.attachedUrlValue = ph;
        res.allClipsNowValid = true;
        onRepaired(clip.id, ph);
      } else {
        const jobId = `gen_${Math.random().toString(36).slice(2, 10)}`;
        res.regenerateStarted = true;
        res.lastError = null;
        res.attachedUrlValue = null;
        res.allClipsNowValid = false;
        setRegenJobId(jobId);
      }
    } catch (e) {
      res.lastError = e instanceof Error ? e.message : "Unknown error";
    }

    setResult(res);
    setBusy(null);
  };

  const debugRows: [string, string, boolean][] = result ? [
    ["found existing URL", result.foundExisting ? "yes" : "no", result.foundExisting],
    ["attached URL", result.attachedUrl ? "yes" : "no", result.attachedUrl],
    ["placeholder created", result.placeholderCreated ? "yes" : "no", result.placeholderCreated],
    ["regenerate started", result.regenerateStarted ? "yes" : "no", result.regenerateStarted],
    ["saved to project", result.savedToProject ? "yes" : "no", result.savedToProject],
    ["all clips now valid", result.allClipsNowValid ? "yes" : "no", result.allClipsNowValid],
    ["last error", result.lastError ?? "none", !result.lastError],
  ] : [];

  return (
    <div style={{ borderRadius: 10, border: "1px solid rgba(251,191,36,0.35)", background: "rgba(251,191,36,0.04)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Header */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <Wrench size={13} style={{ color: "#fbbf24" }} />
          <p style={{ fontSize: 12, fontWeight: 900, color: "#fff", margin: 0 }}>Clip URL Repair</p>
          <span style={{ fontSize: 9, padding: "1px 7px", borderRadius: 99, background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }}>Clip {clipIdx + 1} · {clip.section}</span>
        </div>
        <p style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", margin: 0 }}>This clip is missing a video URL and is blocking Lock Timeline.</p>
      </div>

      {/* Info grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {([
          ["Clip Number",       `#${clipIdx + 1}`],
          ["Section Title",     clip.section],
          ["Current URL",       currentUrl ?? "⚠ null — not set"],
          ["Source/Original",   projData.videoUrl ?? projData.outputUrl ?? "not found"],
          ["Generated Asset",   projData.generatedVideoUrl ?? projData.assetUrl ?? "not found"],
          ["Storage Path",      projData.storagePath ?? "not found"],
          ["Last Job ID",       projData.generationJobId ?? "not found"],
          ["Error Reason",      projData.errorReason ?? "none recorded"],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} style={{ borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", padding: "5px 8px" }}>
            <p style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{k}</p>
            <p style={{ fontSize: 8, fontFamily: "monospace", color: v.startsWith("⚠") ? "#f87171" : v === "not found" || v === "none recorded" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.6)", wordBreak: "break-all", lineHeight: 1.4 }}>{v}</p>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          onClick={() => runAction("repair")}
          disabled={!!busy || !!currentUrl}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(59,130,246,0.4)", background: "rgba(59,130,246,0.08)", color: busy === "repair" ? "rgba(96,165,250,0.6)" : "#60a5fa", cursor: busy || currentUrl ? "not-allowed" : "pointer", opacity: currentUrl ? 0.4 : 1, textAlign: "left" }}>
          {busy === "repair" ? <RefreshCw size={13} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} /> : <Wrench size={13} style={{ flexShrink: 0 }} />}
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, margin: 0 }}>Repair Clip {clipIdx + 1} URL</p>
            <p style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", margin: 0 }}>Search clip.videoUrl, outputUrl, generatedVideoUrl, asset.url, generation.resultUrl, storage public URL</p>
          </div>
        </button>

        <button
          onClick={() => runAction("placeholder")}
          disabled={!!busy || !!currentUrl}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(251,191,36,0.35)", background: "rgba(251,191,36,0.06)", color: busy === "placeholder" ? "rgba(251,191,36,0.5)" : "#fbbf24", cursor: busy || currentUrl ? "not-allowed" : "pointer", opacity: currentUrl ? 0.4 : 1, textAlign: "left" }}>
          {busy === "placeholder" ? <RefreshCw size={13} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} /> : <ImageOff size={13} style={{ flexShrink: 0 }} />}
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, margin: 0 }}>Use Placeholder for Clip {clipIdx + 1}</p>
            <p style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", margin: 0 }}>Creates a {clip.dur}s dark Bow Down Visuals placeholder · text: {clip.section} · valid mp4 URL · for testing only</p>
          </div>
        </button>

        <button
          onClick={() => runAction("regenerate")}
          disabled={!!busy}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, border: `1px solid ${color}44`, background: `${color}08`, color: busy === "regenerate" ? `${color}66` : color, cursor: busy ? "not-allowed" : "pointer", textAlign: "left" }}>
          {busy === "regenerate" ? <RefreshCw size={13} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} /> : <Sparkles size={13} style={{ flexShrink: 0 }} />}
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, margin: 0 }}>Regenerate Clip {clipIdx + 1} {clip.section}</p>
            <p style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", margin: 0 }}>Start a new video generation job for this section only{regenJobId ? ` · Job: ${regenJobId}` : ""}</p>
          </div>
        </button>
      </div>

      {/* Result feedback */}
      {result && (
        <div style={{ borderRadius: 8, border: `1px solid ${result.allClipsNowValid ? "rgba(74,222,128,0.25)" : result.regenerateStarted ? "rgba(59,130,246,0.25)" : "rgba(248,113,113,0.25)"}`, background: result.allClipsNowValid ? "rgba(74,222,128,0.05)" : result.regenerateStarted ? "rgba(59,130,246,0.05)" : "rgba(248,113,113,0.05)", padding: "8px 10px" }}>
          <p style={{ fontSize: 9, fontWeight: 900, color: result.allClipsNowValid ? "#4ade80" : result.regenerateStarted ? "#60a5fa" : "#f87171", marginBottom: 6 }}>
            {result.allClipsNowValid ? "✓ URL attached — Clip is now valid" : result.regenerateStarted ? `◷ Regeneration queued · Job: ${regenJobId}` : "✕ Repair failed — see error below"}
          </p>
          {result.attachedUrlValue && (
            <p style={{ fontSize: 7, fontFamily: "monospace", color: "rgba(255,255,255,0.4)", wordBreak: "break-all", marginBottom: 6 }}>{result.attachedUrlValue}</p>
          )}
          <p style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Clip {clipIdx + 1} URL Repair Result</p>
          {debugRows.map(([k, v, ok]) => (
            <div key={k} style={{ display: "flex", gap: 8, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>
              <span style={{ color: ok ? "rgba(74,222,128,0.6)" : v === "none" ? "rgba(255,255,255,0.25)" : "#fbbf24", flexShrink: 0, width: 12 }}>{ok ? "✓" : "○"}</span>
              <span style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0, minWidth: 140 }}>{k}</span>
              <span style={{ color: ok ? "rgba(255,255,255,0.55)" : "#fbbf24", wordBreak: "break-all" }}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────── */
export function StudioEditorPreview() {
  // URLs in state so repairs update readiness live
  const [clipUrls, setClipUrls] = useState<ClipUrls>(() => {
    const init: ClipUrls = {};
    CLIP_CONFIG.forEach(c => {
      init[c.id] = c.id === "s8" ? null : `https://storage.example.com/proj/${c.section.toLowerCase().replace(/\s+/g, "-")}.mp4`;
    });
    return init;
  });

  const [currentTime, setCurrentTime] = useState(47);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [trims, setTrims] = useState<Record<string, { start: number; end: number }>>({});
  const [validating, setValidating] = useState(false);
  const [validationResults, setValidationResults] = useState<ClipValidation[] | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [lockedTimeline, setLockedTimeline] = useState<LockedTimeline | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trimDragRef = useRef<{ side: "start"|"end"; id: string; idx: number; startX: number; startVal: number; dur: number } | null>(null);

  const clipIdx = activeClipIdx(currentTime);

  /* ── Derived ── */
  const audioLoaded = true;
  const validUrlCount = CLIP_CONFIG.filter(c => isValidUrl(clipUrls[c.id])).length;
  const allClipsHaveUrls = validUrlCount === CLIP_CONFIG.length;
  const missingUrls = CLIP_CONFIG.filter(c => !clipUrls[c.id]).map((c, _, arr) => `#${CLIP_CONFIG.indexOf(c)+1} ${c.section}`);
  const isLocked = !!lockedTimeline;
  const exportReady = audioLoaded && allClipsHaveUrls && isLocked;

  /* ── Repair callback ── */
  const handleRepaired = useCallback((id: string, url: string) => {
    setClipUrls(prev => ({ ...prev, [id]: url }));
    setLockedTimeline(null); // unlock so user re-locks after repair
    setValidationResults(null);
    setValidationError(null);
  }, []);

  /* ── Playback ── */
  const togglePlay = () => {
    setIsPlaying(p => {
      if (!p) {
        timerRef.current = setInterval(() => {
          setCurrentTime(t => {
            if (t >= TOTAL_DUR - 0.1) { clearInterval(timerRef.current!); setIsPlaying(false); return 0; }
            return t + 0.1;
          });
        }, 100);
        return true;
      } else { clearInterval(timerRef.current!); return false; }
    });
  };
  const restart = () => { clearInterval(timerRef.current!); setIsPlaying(false); setCurrentTime(0); };
  const prevClip = () => { const i = Math.max(0, clipIdx - 1); setCurrentTime(OFFSETS[i] ?? 0); };
  const nextClip = () => { const i = Math.min(CLIP_CONFIG.length - 1, clipIdx + 1); setCurrentTime(OFFSETS[i] ?? 0); };

  /* ── Seek ── */
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = timelineRef.current;
    if (!el) return;
    setCurrentTime(Math.max(0, Math.min(TOTAL_DUR, ((e.clientX - el.getBoundingClientRect().left) / el.getBoundingClientRect().width) * TOTAL_DUR)));
  }, []);

  /* ── Trim ── */
  const startTrimDrag = (e: React.PointerEvent, side: "start"|"end", id: string, idx: number, dur: number) => {
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    const cur = trims[id] ?? { start: 0, end: 0 };
    trimDragRef.current = { side, id, idx, startX: e.clientX, startVal: side === "start" ? cur.start : cur.end, dur };
  };
  const onTrimMove = (e: React.PointerEvent) => {
    const d = trimDragRef.current;
    if (!d || !timelineRef.current) return;
    const pxPerSec = (timelineRef.current.getBoundingClientRect().width * zoom) / TOTAL_DUR;
    const delta = (e.clientX - d.startX) / pxPerSec;
    const val = Math.round(Math.max(0, Math.min(d.dur * 0.45, d.side === "start" ? d.startVal + delta : d.startVal - delta)) * 10) / 10;
    setTrims(t => ({ ...t, [d.id]: { ...(t[d.id] ?? { start: 0, end: 0 }), [d.side === "start" ? "start" : "end"]: val } }));
  };
  const onTrimUp = () => { trimDragRef.current = null; };

  /* ── Lock Timeline ── */
  const handleLockTimeline = async () => {
    setValidating(true);
    setValidationError(null);
    setValidationResults(null);
    setLockedTimeline(null);
    setShowValidation(true);
    await new Promise(r => setTimeout(r, 600));
    try {
      const results: ClipValidation[] = CLIP_CONFIG.map((clip, i) => {
        const offset = OFFSETS[i] ?? 0;
        const trim = trims[clip.id] ?? { start: 0, end: 0 };
        const url = clipUrls[clip.id] ?? null;
        const urlExists = !!url;
        const urlValid = isValidUrl(url);
        const exportDur = Math.max(0, clip.dur - trim.start - trim.end);
        const errors: string[] = [];
        if (!urlExists) errors.push(`Missing video URL: Clip #${i+1} ${clip.section}`);
        else if (!urlValid) errors.push(`Invalid URL format: Clip #${i+1} ${clip.section}`);
        if (exportDur <= 0) errors.push(`Trim removes entire clip: Clip #${i+1} ${clip.section}`);
        return { clipNum: i+1, id: clip.id, section: clip.section, urlExists, urlValid, url, timelineStart: offset, timelineEnd: offset + clip.dur, timelineDur: clip.dur, trimStart: trim.start, trimEnd: trim.end, sourceDur: clip.dur, exportDur, ready: urlExists && urlValid && exportDur > 0, errors };
      });
      setValidationResults(results);
      const failed = results.filter(r => !r.ready);
      if (failed.length > 0) {
        setValidationError(failed.map(r => r.errors.join(", ")).join(" | "));
        setValidating(false);
        return;
      }
      const id = `tl_${Math.random().toString(36).slice(2, 9)}`;
      setLockedTimeline({ id, version: 1, lockedAt: new Date().toISOString(), projectAudioUrl: MOCK_PROJECT_AUDIO_URL, audioStartSec: 0, totalSongDuration: TOTAL_DUR, clipCount: CLIP_CONFIG.length, clips: results.map(r => ({ clipNum: r.clipNum, id: r.id, section: r.section, timelineStart: r.timelineStart, timelineEnd: r.timelineEnd, timelineDur: r.timelineDur, trimStart: r.trimStart, trimEnd: r.trimEnd, sourceDur: r.sourceDur, exportDur: r.exportDur, videoUrl: r.url! })) });
    } catch (err) {
      setValidationError(`Failed to save timeline: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
    setValidating(false);
  };

  /* ── Inspector ── */
  const selClip = selectedIdx !== null ? CLIP_CONFIG[selectedIdx] : null;
  const selUrl = selClip ? (clipUrls[selClip.id] ?? null) : null;
  const selTrim = selClip ? (trims[selClip.id] ?? { start: 0, end: 0 }) : null;
  const selOffset = selectedIdx !== null ? (OFFSETS[selectedIdx] ?? 0) : 0;
  const selDur = selClip?.dur ?? 5;
  const selColor = selectedIdx !== null ? (COLORS[selectedIdx % COLORS.length] ?? "#7c3aed") : "#7c3aed";
  const selIsMissingUrl = selClip && !selUrl;

  return (
    <div style={{ minHeight: "100vh", padding: 12, background: "#0a0a0a", color: "#fff", fontFamily: "system-ui, sans-serif", display: "flex", flexDirection: "column", gap: 10 }}
      onPointerMove={onTrimMove} onPointerUp={onTrimUp}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 12, fontWeight: 900, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5, margin: 0 }}>
            <span style={{ color: "#C9A84C" }}>✦</span> Bow Down Studio Editor
          </h2>
          <p style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
            {CLIP_CONFIG.length} clips · {fmt(TOTAL_DUR)} · {isPlaying ? "▶ Playing" : "⏸ Paused"}
            {isLocked && <span style={{ marginLeft: 8, color: "rgba(201,168,76,0.6)" }}>· Locked: {lockedTimeline?.id}</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={handleLockTimeline} disabled={validating}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 8, border: `1px solid ${isLocked ? "rgba(74,222,128,0.4)" : "rgba(201,168,76,0.4)"}`, background: isLocked ? "rgba(74,222,128,0.08)" : "rgba(201,168,76,0.08)", color: isLocked ? "#4ade80" : "#C9A84C", fontSize: 11, fontWeight: 700, cursor: validating ? "wait" : "pointer", opacity: validating ? 0.7 : 1 }}>
            {validating ? <><RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} /> Validating…</> : isLocked ? <><Check size={11} /> Locked</> : <><Lock size={11} /> Lock Timeline</>}
          </button>
          <button disabled={!exportReady}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(74,222,128,0.35)", background: "rgba(74,222,128,0.06)", color: exportReady ? "#4ade80" : "rgba(74,222,128,0.25)", fontSize: 11, fontWeight: 700, cursor: exportReady ? "pointer" : "not-allowed" }}>
            <Download size={11} /> Export
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {validationError && (
        <div style={{ borderRadius: 8, border: "1px solid rgba(248,113,113,0.3)", background: "rgba(248,113,113,0.06)", padding: "8px 12px", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <AlertTriangle size={13} style={{ color: "#f87171", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 9, color: "#f87171", lineHeight: 1.5, margin: 0, fontFamily: "monospace" }}>{validationError}</p>
        </div>
      )}

      {/* ── Two-column ── */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 10 }}>

        {/* Left: Video preview */}
        <PreviewPlayer currentTime={currentTime} isPlaying={isPlaying} clipIdx={clipIdx} urls={clipUrls}
          onTogglePlay={togglePlay} onRestart={restart} onPrevClip={prevClip} onNextClip={nextClip}
          onSelectClip={setSelectedIdx} />

        {/* Right: Inspector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

          {/* Timecode */}
          <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", padding: "8px 10px" }}>
            <p style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5, fontWeight: 700 }}>Master Timecode</p>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 900, color: "#C9A84C", letterSpacing: "0.05em", lineHeight: 1 }}>{fmtMs(currentTime)}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 5, alignItems: "center" }}>
              <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(currentTime / TOTAL_DUR) * 100}%`, background: "rgba(201,168,76,0.65)" }} />
              </div>
              <span style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.3)" }}>{fmt(TOTAL_DUR)}</span>
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 8, alignItems: "center" }}>
              <button onClick={restart} style={{ padding: 4, background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, color: "rgba(255,255,255,0.4)", cursor: "pointer" }}><SkipBack size={10} /></button>
              <button onClick={togglePlay} style={{ flex: 1, padding: 5, background: isPlaying ? "rgba(239,68,68,0.15)" : "rgba(201,168,76,0.15)", border: `1px solid ${isPlaying ? "rgba(239,68,68,0.35)" : "rgba(201,168,76,0.35)"}`, borderRadius: 7, color: isPlaying ? "#ef4444" : "#C9A84C", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 10, fontWeight: 700 }}>
                {isPlaying ? <><Pause size={11} /> Pause</> : <><Play size={11} /> Play</>}
              </button>
              <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                <button onClick={() => setZoom(z => Math.max(1, z - 0.5))} disabled={zoom <= 1} style={{ padding: 4, background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, color: "rgba(255,255,255,0.3)", cursor: "pointer" }}><ZoomOut size={10} /></button>
                <span style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", width: 22, textAlign: "center" }}>{zoom}×</span>
                <button onClick={() => setZoom(z => Math.min(6, z + 0.5))} disabled={zoom >= 6} style={{ padding: 4, background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, color: "rgba(255,255,255,0.3)", cursor: "pointer" }}><ZoomIn size={10} /></button>
              </div>
            </div>
          </div>

          {/* Clip inspector / Repair panel */}
          {selClip ? (
            selIsMissingUrl ? (
              <ClipRepairPanel clipIdx={selectedIdx!} urls={clipUrls} onRepaired={handleRepaired} />
            ) : (
              <div style={{ borderRadius: 10, border: `1px solid ${selColor}44`, background: `${selColor}06`, padding: "8px 10px", flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#fff", margin: 0 }}>{selClip.section}</p>
                    <p style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", marginTop: 2 }}>Clip {(selectedIdx ?? 0) + 1} · {fmt(selOffset)}–{fmt(selOffset + selDur)}</p>
                  </div>
                  <button onClick={() => setSelectedIdx(null)} style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", background: "none", border: "none", cursor: "pointer" }}>✕</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 8 }}>
                  {[["Source", `${selDur.toFixed(1)}s`], ["Export", `${Math.max(0, selDur - (selTrim?.start ?? 0) - (selTrim?.end ?? 0)).toFixed(1)}s`], ["Offset", fmt(selOffset)]].map(([k, v]) => (
                    <div key={k} style={{ borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", padding: "4px 6px", textAlign: "center" }}>
                      <p style={{ fontSize: 7, color: "rgba(255,255,255,0.3)" }}>{k}</p>
                      <p style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, color: k === "Export" ? "#C9A84C" : "rgba(255,255,255,0.55)", marginTop: 1 }}>{v}</p>
                    </div>
                  ))}
                </div>
                {selTrim && (["start", "end"] as const).map(side => (
                  <div key={side} style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", fontWeight: 700, display: "block", marginBottom: 3 }}>
                      Trim {side === "start" ? "Start" : "End"}: {(side === "start" ? selTrim.start : selTrim.end).toFixed(1)}s
                    </label>
                    <input type="range" min={0} max={selDur * 0.45} step={0.1}
                      value={side === "start" ? selTrim.start : selTrim.end}
                      onChange={e => {
                        const v = Number(e.target.value);
                        setTrims(t => ({ ...t, [selClip.id]: { ...(t[selClip.id] ?? { start: 0, end: 0 }), [side === "start" ? "start" : "end"]: v } }));
                      }}
                      style={{ width: "100%", accentColor: selColor }} />
                  </div>
                ))}
                <button onClick={() => setCurrentTime(selOffset)} style={{ fontSize: 9, color: `${selColor}bb`, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Jump to {fmt(selOffset)} →</button>
              </div>
            )
          ) : (
            <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.01)", padding: "10px", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
              <Film size={18} style={{ color: "rgba(255,255,255,0.1)" }} />
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "center" }}>Click a clip on the timeline<br/>to inspect · <span style={{ color: "#fbbf24" }}>⚠ clips highlighted amber need repair</span></p>
            </div>
          )}

          {/* Readiness */}
          <div style={{ borderRadius: 10, border: `1px solid ${exportReady ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.07)"}`, background: exportReady ? "rgba(74,222,128,0.03)" : "rgba(255,255,255,0.01)", padding: "8px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <p style={{ fontSize: 8, fontWeight: 900, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Readiness</p>
              <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: exportReady ? "rgba(74,222,128,0.12)" : "rgba(251,191,36,0.1)", color: exportReady ? "#4ade80" : "#fbbf24", border: `1px solid ${exportReady ? "rgba(74,222,128,0.2)" : "rgba(251,191,36,0.2)"}` }}>
                {exportReady ? "✓ Ready to export" : "○ Not ready"}
              </span>
            </div>
            {[
              { label: "Audio is master clock", ok: audioLoaded,      detail: "song audio loaded ✓" },
              { label: "All clips have URLs",   ok: allClipsHaveUrls, detail: allClipsHaveUrls ? `${CLIP_CONFIG.length}/${CLIP_CONFIG.length} clips ✓` : `${validUrlCount}/${CLIP_CONFIG.length} — missing: ${missingUrls.join(", ")}` },
              { label: "Timeline locked",       ok: isLocked,         detail: isLocked ? `ID: ${lockedTimeline!.id}` : "click Lock Timeline" },
            ].map(c => (
              <div key={c.label} style={{ display: "flex", gap: 6, fontSize: 8, alignItems: "flex-start", marginBottom: 4 }}>
                <span style={{ color: c.ok ? "#4ade80" : "rgba(255,255,255,0.2)", flexShrink: 0, marginTop: 1 }}>{c.ok ? "✓" : "○"}</span>
                <span style={{ color: c.ok ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.3)", flex: 1 }}>{c.label}</span>
                <span style={{ color: c.ok ? "rgba(255,255,255,0.3)" : "#fbbf24", fontFamily: "monospace", fontSize: 7, textAlign: "right", maxWidth: 140 }}>{c.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Timeline ── */}
      <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "#090909", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
            <Ruler total={TOTAL_DUR} current={currentTime} />
            <div ref={timelineRef} style={{ position: "relative", height: 38, cursor: "crosshair" }} onClick={handleTimelineClick}>
              <Waveform progress={TOTAL_DUR > 0 ? currentTime / TOTAL_DUR : 0} />
              <div style={{ position: "absolute", top: 0, bottom: 0, width: 1, left: `${(currentTime / TOTAL_DUR) * 100}%`, background: "#C9A84C", pointerEvents: "none", zIndex: 10 }}>
                <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 7, height: 7, background: "#C9A84C", borderRadius: "50%" }} />
              </div>
            </div>
            <div style={{ position: "relative", height: 68, background: "rgba(0,0,0,0.4)", cursor: "crosshair" }} onClick={handleTimelineClick}>
              {CLIP_CONFIG.map((clip, i) => {
                const offset = OFFSETS[i] ?? 0;
                const color = COLORS[i % COLORS.length]!;
                const isSel = selectedIdx === i;
                const isAct = i === clipIdx;
                const hasUrl = !!clipUrls[clip.id];
                const trim = trims[clip.id] ?? { start: 0, end: 0 };
                const leftPct = (offset / TOTAL_DUR) * 100;
                const widthPct = (clip.dur / TOTAL_DUR) * 100;
                return (
                  <div key={clip.id}
                    style={{ position: "absolute", top: 5, bottom: 5, left: `${leftPct}%`, width: `calc(${widthPct}% - 2px)`,
                      background: !hasUrl ? "rgba(251,191,36,0.18)" : isSel ? `${color}cc` : isAct ? `${color}77` : `${color}38`,
                      border: `1px solid ${!hasUrl ? "rgba(251,191,36,0.55)" : isSel ? color : isAct ? `${color}99` : `${color}33`}`,
                      boxShadow: !hasUrl ? "0 0 6px rgba(251,191,36,0.1)" : isSel ? `0 0 0 1px ${color}44, 0 0 10px ${color}22` : undefined,
                      borderRadius: 5, cursor: "pointer", overflow: "hidden", display: "flex", alignItems: "center" }}
                    onClick={e => { e.stopPropagation(); setSelectedIdx(isSel ? null : i); }}>
                    {trim.start > 0 && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(48, (trim.start / clip.dur) * 100)}%`, background: "rgba(0,0,0,0.55)", borderRight: "1px dashed rgba(255,255,255,0.2)", pointerEvents: "none" }} />}
                    {trim.end > 0 && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${Math.min(48, (trim.end / clip.dur) * 100)}%`, background: "rgba(0,0,0,0.55)", borderLeft: "1px dashed rgba(255,255,255,0.2)", pointerEvents: "none" }} />}
                    <div style={{ padding: "0 5px", zIndex: 10, minWidth: 0, flex: 1, overflow: "hidden" }}>
                      <p style={{ fontSize: 7, fontWeight: 700, color: "#fff", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", lineHeight: 1.3 }}>{i + 1}. {clip.section}</p>
                      <p style={{ fontSize: 6, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>{fmt(offset)}–{fmt(offset + clip.dur)}</p>
                    </div>
                    {!hasUrl && <span style={{ fontSize: 8, color: "#fbbf24", marginRight: 3, flexShrink: 0 }}>⚠</span>}
                    {isSel && (<>
                      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center" }}
                        onPointerDown={e => startTrimDrag(e, "start", clip.id, i, clip.dur)} onClick={e => e.stopPropagation()}>
                        <div style={{ width: 2, height: "65%", background: "rgba(255,255,255,0.6)", borderRadius: 2 }} />
                      </div>
                      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center" }}
                        onPointerDown={e => startTrimDrag(e, "end", clip.id, i, clip.dur)} onClick={e => e.stopPropagation()}>
                        <div style={{ width: 2, height: "65%", background: "rgba(255,255,255,0.6)", borderRadius: 2 }} />
                      </div>
                    </>)}
                  </div>
                );
              })}
              <div style={{ position: "absolute", top: 0, bottom: 0, width: 1, left: `${(currentTime / TOTAL_DUR) * 100}%`, background: "rgba(201,168,76,0.65)", pointerEvents: "none", zIndex: 30 }} />
            </div>
          </div>
        </div>
        <div style={{ padding: "4px 10px", borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 7, color: "rgba(255,255,255,0.18)", display: "flex", gap: 12 }}>
          <span>Click waveform/track to seek</span><span>Click amber clip ⚠ to repair URL</span><span>Drag handles to trim</span>
        </div>
      </div>

      {/* ── Validation Results ── */}
      {showValidation && validationResults && (
        <div style={{ borderRadius: 10, border: `1px solid ${validationError ? "rgba(248,113,113,0.25)" : "rgba(74,222,128,0.2)"}`, background: validationError ? "rgba(248,113,113,0.03)" : "rgba(74,222,128,0.02)", overflow: "hidden" }}>
          <button onClick={() => setShowValidation(o => !o)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer", color: validationError ? "#f87171" : "#4ade80", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {validationError ? <AlertTriangle size={11} /> : <Check size={11} />}
              Clip Validation · {validationResults.filter(r => r.ready).length}/{validationResults.length} ready
              {validationError && <span style={{ color: "#f87171" }}>— {validationResults.filter(r => !r.ready).length} FAILED</span>}
            </span>
            <ChevronDown size={11} />
          </button>
          <div style={{ borderTop: `1px solid ${validationError ? "rgba(248,113,113,0.1)" : "rgba(74,222,128,0.08)"}`, padding: "8px 12px" }}>
            {validationResults.map(v => <ClipValidRow key={v.id} v={v} />)}
          </div>
        </div>
      )}

      {/* ── Locked JSON ── */}
      {lockedTimeline && (
        <div style={{ borderRadius: 10, border: "1px solid rgba(201,168,76,0.2)", background: "rgba(201,168,76,0.03)", overflow: "hidden" }}>
          <button onClick={() => setJsonOpen(o => !o)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer", color: "rgba(201,168,76,0.8)", fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Lock size={10} /> Locked Timeline · {lockedTimeline.id} · {lockedTimeline.clipCount} clips · {fmt(lockedTimeline.totalSongDuration)}</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={e => { e.stopPropagation(); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 8, color: "rgba(255,255,255,0.35)", background: "transparent", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontWeight: "normal", textTransform: "none", letterSpacing: "normal" }}>
                {copied ? <><Check size={9} style={{ color: "#4ade80" }} /> Copied!</> : <><Copy size={9} /> Copy JSON</>}
              </button>
              {jsonOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </div>
          </button>
          {jsonOpen && (
            <div style={{ borderTop: "1px solid rgba(201,168,76,0.1)", padding: "8px 12px 10px" }}>
              <pre style={{ fontSize: 7, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", overflow: "auto", maxHeight: 200, padding: 8, background: "rgba(0,0,0,0.3)", borderRadius: 6, lineHeight: 1.5, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {JSON.stringify(lockedTimeline, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Debug ── */}
      <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.01)", overflow: "hidden" }}>
        <button onClick={() => setDebugOpen(o => !o)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.25)", fontSize: 8, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          <span>Studio Editor Readiness — Debug</span>
          {debugOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
        {debugOpen && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", padding: "8px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
            {([
              ["audio loaded",          audioLoaded ? "yes" : "no",                    audioLoaded],
              ["clip count",            String(CLIP_CONFIG.length),                    true],
              ["valid clip URLs",       `${validUrlCount} / ${CLIP_CONFIG.length}`,    validUrlCount === CLIP_CONFIG.length],
              ["missing clip URLs",     missingUrls.length > 0 ? missingUrls.join(", ") : "none", missingUrls.length === 0],
              ["timeline locked",       isLocked ? "yes" : "no",                       isLocked],
              ["locked timeline id",    isLocked ? lockedTimeline!.id : "—",           isLocked],
              ["export ready",          exportReady ? "yes" : "no",                    exportReady],
              ["last error",            validationError ?? "none",                     !validationError],
            ] as [string, string, boolean][]).map(([k, v, ok]) => (
              <div key={k} style={{ display: "flex", gap: 8, fontSize: 8, fontFamily: "monospace", alignItems: "flex-start" }}>
                <span style={{ color: ok ? "rgba(74,222,128,0.6)" : "#fbbf24", flexShrink: 0, minWidth: 12 }}>{ok ? "✓" : "○"}</span>
                <span style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0, minWidth: 130 }}>{k}</span>
                <span style={{ color: ok ? "rgba(255,255,255,0.5)" : "#fbbf24", wordBreak: "break-all" }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
