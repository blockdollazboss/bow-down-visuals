import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Mic, Loader2, Sparkles, CheckCircle2, XCircle, Undo2,
  Wand2, AlertTriangle, Scissors, Volume2, Trash2, Flag,
  ArrowLeftRight, MousePointer2,
} from "lucide-react";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import type { SceneData } from "@/lib/scene-parser";
import {
  computeSceneTimings, getSceneTiming, formatTimestampRange, formatClock,
} from "@/lib/scene-timing";
import {
  defaultClipEdit, getClipEdit, sanitizeVideoChapters,
  type EditorSettings,
} from "@/lib/editor-settings";

/* ─── Wave 9C — Voice-Directed Edits ─────────────────────────────────────────
   Tell the editor what to do in plain words ("make the chorus hit harder",
   "trim the first 5 seconds"). The server turns the command into a PLANNED
   op list against the compact timeline — nothing is ever applied blindly.
   The creator reviews "Here's what I'll change:", toggles each op, then
   Apply runs the confirmed ops client-side against scenes + settings.
   Undo restores the pre-apply snapshot.

   Docked in the video-editor "studio" tab, below the StudioEditorSection. */

type DirectOp =
  | { op: "split"; sceneId: string; atSec: number; reason: string }
  | { op: "trim"; sceneId: string; trimStart: number; trimEnd: number; reason: string }
  | { op: "delete-range"; startSec: number; endSec: number; reason: string }
  | { op: "add-marker"; title: string; atSec: number; durationSec: number; reason: string }
  | { op: "move-clip"; sceneId: string; toIndex: number; reason: string }
  | { op: "set-volume"; sceneId: string; volume: number; reason: string };

interface DirectEditPlan {
  planSummary: string;
  ops: DirectOp[];
}

interface VoiceDirectedEditsSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: React.Dispatch<React.SetStateAction<EditorSettings>>;
  setScenes?: React.Dispatch<React.SetStateAction<SceneData[]>>;
  audioDuration: number | null;
  projectTitle?: string;
}

const DIRECT_EDIT_COST = 150;

const OP_ICONS: Record<DirectOp["op"], React.ReactNode> = {
  split: <Scissors className="h-3.5 w-3.5" />,
  trim: <Scissors className="h-3.5 w-3.5" />,
  "delete-range": <Trash2 className="h-3.5 w-3.5" />,
  "add-marker": <Flag className="h-3.5 w-3.5" />,
  "move-clip": <ArrowLeftRight className="h-3.5 w-3.5" />,
  "set-volume": <Volume2 className="h-3.5 w-3.5" />,
};

function opLabel(op: DirectOp, clipLabel: (id: string) => string): string {
  switch (op.op) {
    case "split":
      return `Split ${clipLabel(op.sceneId)} at ${formatClock(op.atSec)}`;
    case "trim": {
      const bits: string[] = [];
      if (op.trimStart > 0) bits.push(`${op.trimStart}s off the start`);
      if (op.trimEnd > 0) bits.push(`${op.trimEnd}s off the end`);
      return `Trim ${clipLabel(op.sceneId)} — ${bits.join(" and ") || "no change"}`;
    }
    case "delete-range":
      return `Delete ${formatClock(op.startSec)} → ${formatClock(op.endSec)}`;
    case "add-marker":
      return `Marker "${op.title}" at ${formatClock(op.atSec)}`;
    case "move-clip":
      return `Move ${clipLabel(op.sceneId)} to position ${op.toIndex + 1}`;
    case "set-volume":
      return `Set ${clipLabel(op.sceneId)} volume to ${op.volume}`;
  }
}

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition as SpeechRecognitionCtor) ??
    (w.webkitSpeechRecognition as SpeechRecognitionCtor) ?? null;
}

export function VoiceDirectedEditsSection({
  scenes, settings, setSettings, setScenes, audioDuration, projectTitle,
}: VoiceDirectedEditsSectionProps) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  const [command, setCommand] = useState("");
  const [listening, setListening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<DirectEditPlan | null>(null);
  const [confirmed, setConfirmed] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ scenes: SceneData[]; settings: EditorSettings } | null>(null);
  const [appliedAt, setAppliedAt] = useState<string | null>(null);
  const recognizerRef = useRef<SpeechRecognitionCtor["prototype"] | null>(null);
  const micSupported = useMemo(() => getSpeechRecognition() !== null, []);

  const timings = useMemo(
    () => computeSceneTimings(scenes, audioDuration),
    [scenes, audioDuration]
  );

  const clipLabel = (id: string): string => {
    const idx = scenes.findIndex((s) => s.id === id);
    return idx >= 0 ? `Clip ${idx + 1}` : "Clip";
  };

  function toggleMic() {
    if (listening) {
      recognizerRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      const results = e.results as unknown as ArrayLike<ArrayLike<{ transcript: string }>>;
      for (let i = 0; i < results.length; i++) text += results[i]?.[0]?.transcript ?? "";
      if (text.trim()) setCommand(text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setListening(false);
      toast({ title: t("wave9.directEdit.micError"), variant: "destructive" });
    };
    recognizerRef.current = rec;
    rec.start();
    setListening(true);
  }

  async function handleDirect() {
    const cmd = command.trim();
    if (!cmd || loading) return;
    if (scenes.length === 0) {
      setError(t("wave9.directEdit.noScenes"));
      return;
    }
    setLoading(true);
    setError(null);
    setPlan(null);
    setSnapshot(null);
    setAppliedAt(null);
    try {
      const timeline = scenes.map((s, index) => {
        const tm = timings[index] ?? { startSec: 0, endSec: 0, durationSec: 0 };
        return {
          id: s.id,
          index,
          section: s.section ?? "",
          startSec: Math.round(tm.startSec * 10) / 10,
          endSec: Math.round(tm.endSec * 10) / 10,
          volume: getClipEdit(settings, s.id).volume,
        };
      });
      const totalDurationSec = timings.length > 0 ? timings[timings.length - 1]!.endSec : 0;
      const res = await confirmedFetch("/api/wave9c/direct/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: cmd,
          timeline,
          totalDurationSec,
          projectTitle: projectTitle ?? "",
        }),
        overrideCost: DIRECT_EDIT_COST,
        overrideFeature: "Voice-Directed Edits",
      });
      if (!res) {
        /* User cancelled the credit confirmation. */
        setLoading(false);
        return;
      }
      if (res.status === 402) {
        setError(t("wave9.directEdit.outOfCredits"));
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DirectEditPlan;
      if (!Array.isArray(data.ops) || data.ops.length === 0) {
        throw new Error("Empty plan");
      }
      setPlan(data);
      setConfirmed(data.ops.map(() => true));
    } catch (err) {
      setError(t("wave9.directEdit.errorGeneric"));
      console.error("[voice-directed-edits]", err);
    } finally {
      setLoading(false);
    }
  }

  function toggleOp(i: number) {
    setConfirmed((prev) => prev.map((v, j) => (j === i ? !v : v)));
  }

  function handleApply() {
    if (!plan) return;
    const active = plan.ops.filter((_, i) => confirmed[i]);
    if (active.length === 0) {
      toast({ title: t("wave9.directEdit.nothingSelected"), variant: "destructive" });
      return;
    }
    if (!setScenes) {
      toast({ title: t("wave9.directEdit.timelineLocked"), variant: "destructive" });
      return;
    }

    /* Snapshot for Undo before touching anything. */
    setSnapshot({
      scenes: JSON.parse(JSON.stringify(scenes)) as SceneData[],
      settings: JSON.parse(JSON.stringify(settings)) as EditorSettings,
    });

    let nextScenes = [...scenes];
    let nextSettings = settings;
    let applied = 0;
    const skipped: string[] = [];

    const sceneIdx = (id: string) => nextScenes.findIndex((s) => s.id === id);
    const sceneTiming = (idx: number) =>
      computeSceneTimings(nextScenes, audioDuration)[idx] ?? { startSec: 0, endSec: 0, durationSec: 0 };

    for (const op of active) {
      try {
        switch (op.op) {
          case "split": {
            const idx = sceneIdx(op.sceneId);
            if (idx < 0) { skipped.push(opLabel(op, clipLabel)); break; }
            const tm = sceneTiming(idx);
            const at = Math.min(Math.max(op.atSec, tm.startSec + 0.25), tm.endSec - 0.25);
            if (at <= tm.startSec + 0.24 || at >= tm.endSec - 0.24) {
              skipped.push(opLabel(op, clipLabel)); break;
            }
            const src = nextScenes[idx]!;
            const mkPart = (suffix: "a" | "b", start: number, end: number): SceneData => ({
              ...src,
              id: `${src.id}__${suffix}`,
              timestamp: formatTimestampRange(start, end),
            });
            nextScenes = [
              ...nextScenes.slice(0, idx),
              mkPart("a", tm.startSec, at),
              mkPart("b", at, tm.endSec),
              ...nextScenes.slice(idx + 1),
            ];
            applied++;
            break;
          }
          case "trim": {
            const idx = sceneIdx(op.sceneId);
            if (idx < 0) { skipped.push(opLabel(op, clipLabel)); break; }
            const tm = sceneTiming(idx);
            if (op.trimStart + op.trimEnd >= tm.durationSec - 0.25) {
              skipped.push(opLabel(op, clipLabel)); break;
            }
            const id = nextScenes[idx]!.id;
            const prev = getClipEdit(nextSettings, id);
            const clips = {
              ...nextSettings.clips,
              [id]: {
                ...defaultClipEdit(),
                ...prev,
                trimStart: Math.max(0, prev.trimStart + op.trimStart),
                trimEnd: Math.max(0, prev.trimEnd + op.trimEnd),
              },
            };
            nextSettings = { ...nextSettings, clips };
            applied++;
            break;
          }
          case "delete-range": {
            const before = nextScenes.length;
            const cur = computeSceneTimings(nextScenes, audioDuration);
            nextScenes = nextScenes.filter((_, i) => {
              const tm = cur[i]!;
              const mid = (tm.startSec + tm.endSec) / 2;
              return mid < op.startSec || mid > op.endSec;
            });
            if (nextScenes.length < before) applied++;
            else skipped.push(opLabel(op, clipLabel));
            break;
          }
          case "add-marker": {
            const at = Math.max(0, op.atSec);
            const chapters = sanitizeVideoChapters([
              ...(nextSettings.chapters ?? []),
              { title: op.title, startSec: at, endSec: at + op.durationSec },
            ]);
            nextSettings = { ...nextSettings, chapters };
            applied++;
            break;
          }
          case "move-clip": {
            const idx = sceneIdx(op.sceneId);
            if (idx < 0) { skipped.push(opLabel(op, clipLabel)); break; }
            const to = Math.min(Math.max(op.toIndex, 0), nextScenes.length - 1);
            const [moved] = nextScenes.splice(idx, 1);
            nextScenes.splice(to, 0, moved!);
            applied++;
            break;
          }
          case "set-volume": {
            const idx = sceneIdx(op.sceneId);
            if (idx < 0) { skipped.push(opLabel(op, clipLabel)); break; }
            const id = nextScenes[idx]!.id;
            const prev = getClipEdit(nextSettings, id);
            const clips = {
              ...nextSettings.clips,
              [id]: { ...defaultClipEdit(), ...prev, volume: op.volume },
            };
            nextSettings = { ...nextSettings, clips };
            applied++;
            break;
          }
        }
      } catch {
        skipped.push(opLabel(op, clipLabel));
      }
    }

    if (applied > 0) {
      setScenes(nextScenes);
      setSettings(nextSettings);
      setAppliedAt(new Date().toISOString());
      toast({
        title: t("wave9.directEdit.appliedTitle", { count: applied }),
        description: skipped.length > 0
          ? t("wave9.directEdit.appliedSkipped", { count: skipped.length })
          : undefined,
      });
    } else {
      setSnapshot(null);
      toast({ title: t("wave9.directEdit.nothingApplied"), variant: "destructive" });
    }
  }

  function handleUndo() {
    if (!snapshot) return;
    setScenes?.(snapshot.scenes);
    setSettings(snapshot.settings);
    setSnapshot(null);
    setAppliedAt(null);
    toast({ title: t("wave9.directEdit.undone") });
  }

  return (
    <EditorCard
      title={t("wave9.directEdit.title")}
      subtitle={t("wave9.directEdit.subtitle")}
      icon={<Wand2 className="h-3.5 w-3.5" />}
      right={
        <span className="text-[10px] font-bold text-primary/80 border border-primary/30 bg-primary/10 rounded-full px-2 py-0.5">
          150 VB
        </span>
      }
      className="border-primary/15"
    >
      <div className="flex flex-col gap-4">
        <p className="text-[11px] text-white/40 leading-relaxed">
          {t("wave9.directEdit.intro")}
        </p>

        {/* Command input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleDirect(); }}
              placeholder={t("wave9.directEdit.placeholder")}
              className="w-full h-11 rounded-xl bg-black/40 border border-white/10 focus:border-primary/60 focus:ring-1 focus:ring-primary/40 outline-none text-sm text-white placeholder:text-white/25 pl-4 pr-11"
              disabled={loading}
            />
            {micSupported && (
              <button
                type="button"
                onClick={toggleMic}
                title={t("wave9.directEdit.micTitle")}
                className={`absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
                  listening
                    ? "bg-red-500/20 text-red-400 animate-pulse"
                    : "text-white/40 hover:text-primary hover:bg-white/5"
                }`}
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleDirect}
            disabled={loading || !command.trim() || scenes.length === 0}
            className="h-11 px-5 rounded-xl bg-primary text-black text-sm font-black tracking-wide hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? t("wave9.directEdit.planning") : t("wave9.directEdit.direct")}
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/[0.07] border border-red-500/20">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[12px] text-red-200/90">{error}</p>
          </div>
        )}

        {/* Planned ops — review, toggle, then apply. Never applies blindly. */}
        {plan && !appliedAt && (
          <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
            <div className="flex items-center gap-2 mb-1">
              <MousePointer2 className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-black text-white tracking-wide">
                {t("wave9.directEdit.reviewTitle")}
              </h4>
            </div>
            <p className="text-[12px] text-white/50 mb-3 leading-relaxed">{plan.planSummary}</p>
            <div className="flex flex-col gap-2">
              {plan.ops.map((op, i) => {
                const on = confirmed[i];
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleOp(i)}
                    className={`flex items-start gap-3 text-left rounded-lg border px-3 py-2.5 transition-colors ${
                      on
                        ? "border-primary/40 bg-primary/[0.08]"
                        : "border-white/10 bg-white/[0.02] opacity-55"
                    }`}
                  >
                    <span className={`mt-0.5 h-5 w-5 rounded-md border flex items-center justify-center shrink-0 ${
                      on ? "bg-primary border-primary text-black" : "border-white/25 text-transparent"
                    }`}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-primary/80 mt-0.5 shrink-0">{OP_ICONS[op.op]}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold text-white">{opLabel(op, clipLabel)}</span>
                      <span className="block text-[11px] text-white/45 leading-relaxed">{op.reason}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-4">
              <button
                type="button"
                onClick={handleApply}
                disabled={!confirmed.some(Boolean)}
                className="h-10 px-5 rounded-xl bg-primary text-black text-sm font-black tracking-wide hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {t("wave9.directEdit.applySelected", { count: confirmed.filter(Boolean).length })}
              </button>
              <button
                type="button"
                onClick={() => { setPlan(null); setConfirmed([]); }}
                className="h-10 px-4 rounded-xl border border-white/15 text-white/70 text-sm font-bold hover:bg-white/5 transition-colors"
              >
                {t("wave9.directEdit.discard")}
              </button>
            </div>
          </div>
        )}

        {/* Post-apply: undo */}
        {appliedAt && snapshot && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
            <div className="flex items-center gap-2 text-[12px] text-white/60">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              {t("wave9.directEdit.appliedNote")}
            </div>
            <button
              type="button"
              onClick={handleUndo}
              className="h-9 px-4 rounded-xl border border-white/15 text-white/80 text-[13px] font-bold hover:bg-white/5 flex items-center gap-2 transition-colors"
            >
              <Undo2 className="h-4 w-4" />
              {t("wave9.directEdit.undo")}
            </button>
          </div>
        )}

        {appliedAt && !snapshot && (
          <div className="flex items-center gap-2 text-[12px] text-white/40">
            <XCircle className="h-4 w-4" />
            {t("wave9.directEdit.noUndo")}
          </div>
        )}
      </div>
    </EditorCard>
  );
}
