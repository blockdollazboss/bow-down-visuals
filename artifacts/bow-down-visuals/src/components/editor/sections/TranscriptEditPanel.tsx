import { ArrowDown, ArrowUp, FileText, Trash2 } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { CaptionLine, EditorSettings } from "@/lib/editor-settings";
import { buildTextSegments, applyTextReorder, applyTextDelete } from "@/lib/text-edit";
import { EditorCard } from "@/components/editor/controls";

/* ── Text-based editing v1 (Stack 5 #7) ───────────────────────────────────
 * Docks inside the Timeline tab under the lanes. Each transcript segment
 * is one clip segment: move it and the clip moves; delete it and the clip
 * (and its captions) go. Segment-level only — the panel says so. After an
 * edit the scenes array is rewritten, so the timeline stays the source of
 * truth; caption lines are re-timed with their scenes. */

export function TranscriptEditPanel({ scenes, settings, totalDuration, onTextEdit }: {
  scenes: SceneData[];
  settings: EditorSettings;
  totalDuration: number;
  /** Apply a text edit: new scene order + re-timed caption lines. */
  onTextEdit?: (nextScenes: SceneData[], nextCaptionLines: CaptionLine[]) => void;
}) {
  const approved = scenes.filter((s) => s.approved && s.demoClipUrl);
  const each = approved.length > 0 && totalDuration > 0 ? totalDuration / approved.length : 5;
  const durations: Record<string, number> = Object.fromEntries(approved.map((s) => [s.id, each]));
  const segments = buildTextSegments(approved, settings.captions.lines, durations);
  const hasTranscript = settings.captions.lines.length > 0;

  function move(index: number, dir: -1 | 1) {
    if (!onTextEdit) return;
    const ids = segments.map((s) => s.sceneId);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    const { scenes: nextScenes, captionLines } = applyTextReorder(approved, settings.captions.lines, ids, durations);
    // Preserve non-approved scenes at the end in their original order.
    const rest = scenes.filter((s) => !(s.approved && s.demoClipUrl));
    onTextEdit([...nextScenes, ...rest], captionLines);
  }

  function remove(sceneId: string) {
    if (!onTextEdit) return;
    const { scenes: nextApproved, captionLines } = applyTextDelete(approved, settings.captions.lines, sceneId, durations);
    const rest = scenes.filter((s) => !(s.approved && s.demoClipUrl));
    onTextEdit([...nextApproved, ...rest], captionLines);
  }

  return (
    <EditorCard title="Edit by Transcript" subtitle="Reorder or cut the video by moving text — segment level in v1"
      icon={<FileText className="h-4 w-4" />} className="!bg-black !border-white/10">
      {!hasTranscript && (
        <p className="text-[11px] text-amber-200/80 mb-2">
          No timed transcript yet — segments below use each scene's lyric text. Generate captions in the Captions tab to edit against the real transcript.
        </p>
      )}
      {!onTextEdit && (
        <p className="text-[11px] text-white/35 mb-2">Connect this panel to the scene list to apply edits.</p>
      )}
      {segments.length === 0 ? (
        <p className="text-[11px] text-white/30">No approved clips yet — nothing to edit by text.</p>
      ) : (
        <div className="space-y-1.5">
          {segments.map((seg, i) => (
            <div key={seg.sceneId} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
              <span className="text-[10px] font-mono text-white/35 w-14 shrink-0">
                {seg.startSec.toFixed(1)}–{seg.endSec.toFixed(1)}s
              </span>
              <p className="flex-1 min-w-0 text-[11px] text-white/80 truncate" title={seg.text}>
                {seg.text || <span className="text-white/30">(no text for this segment)</span>}
              </p>
              <button type="button" disabled={!onTextEdit || i === 0} onClick={() => move(i, -1)}
                className="inline-flex items-center text-[10px] font-bold text-white/50 hover:text-white border border-white/10 rounded px-1.5 py-1 disabled:opacity-30" title="Move segment earlier">
                <ArrowUp className="h-3 w-3" />
              </button>
              <button type="button" disabled={!onTextEdit || i === segments.length - 1} onClick={() => move(i, 1)}
                className="inline-flex items-center text-[10px] font-bold text-white/50 hover:text-white border border-white/10 rounded px-1.5 py-1 disabled:opacity-30" title="Move segment later">
                <ArrowDown className="h-3 w-3" />
              </button>
              <button type="button" disabled={!onTextEdit} onClick={() => remove(seg.sceneId)}
                className="inline-flex items-center text-[10px] font-bold text-white/50 hover:text-red-300 border border-white/10 rounded px-1.5 py-1 disabled:opacity-30" title="Delete segment and its clip">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-white/30 mt-2">
        Moving a segment moves its clip and re-times its captions. Word-level edits aren't in v1 — trim inside a segment on the timeline lanes.
      </p>
    </EditorCard>
  );
}
