import type { ReactNode } from "react";
import { Info, Film } from "lucide-react";

export const EDIT_PLAN_NOTE =
  "Trims, transitions, effects, captions and overlays are saved as an edit plan — they're applied when final rendering is enabled, not burned into clips yet.";

export function PlanNote({ text = EDIT_PLAN_NOTE }: { text?: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/[0.06] border border-blue-500/15">
      <Info className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
      <p className="text-[11px] text-blue-200/80 leading-relaxed">{text}</p>
    </div>
  );
}

export function EmptyScenes() {
  return (
    <div className="text-center py-10">
      <Film className="h-8 w-8 text-white/15 mx-auto mb-3" />
      <p className="text-sm text-white/40">No scenes in this project yet.</p>
    </div>
  );
}

export function IconBtn({
  children, onClick, title, disabled, danger, testId,
}: {
  children: ReactNode; onClick: () => void; title: string; disabled?: boolean; danger?: boolean; testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-colors disabled:opacity-25 disabled:cursor-not-allowed ${
        danger
          ? "border-red-500/20 bg-red-500/5 text-red-400/70 hover:text-red-400 hover:bg-red-500/10"
          : "border-white/10 bg-white/5 text-white/50 hover:text-white hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}
