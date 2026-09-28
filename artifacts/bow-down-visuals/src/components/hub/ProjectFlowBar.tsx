import { useState } from "react";
import { X, ArrowDownToLine } from "lucide-react";
import { useHubProject, type HubAsset, type HubAssetKind } from "@/lib/hub-project";
import { KIND_LABEL, AUDIO_KINDS } from "@/lib/hub-workflows";

/* ─── ProjectFlowBar ────────────────────────────────────────────────────────
   Mount this on any tool page. When the active hub project holds assets of
   the given kinds, it shows a slim strip: "From your project: [beat chip]".
   Clicking a chip hands the asset to the page via onPick — that's how a beat
   made in the hub walks into the song studio with its context intact. */

export function ProjectFlowBar({
  kinds,
  onPick,
  actionLabel = "Use",
}: {
  kinds: HubAssetKind[];
  onPick: (asset: HubAsset) => void;
  actionLabel?: string;
}) {
  const { project } = useHubProject();
  const [dismissed, setDismissed] = useState(false);
  const matches = project.assets.filter((a) => kinds.includes(a.kind));

  if (dismissed || matches.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3 mb-6 flex items-center gap-3 flex-wrap">
      <p className="text-xs font-bold uppercase tracking-wider text-primary shrink-0">
        From your project
      </p>
      <div className="flex gap-2 flex-wrap flex-1">
        {matches.slice(0, 3).map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onPick(a)}
            title={`${a.label}${a.detail ? ` — ${a.detail}` : ""}`}
            className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/40 pl-2 pr-3 py-1.5 hover:border-primary/60 transition-colors max-w-[260px]"
          >
            {AUDIO_KINDS.includes(a.kind) ? (
              <audio src={a.url} className="hidden" />
            ) : null}
            <span className="text-[10px] font-bold uppercase tracking-wide text-primary/80 shrink-0">
              {KIND_LABEL[a.kind]}
            </span>
            <span className="text-xs text-white/80 truncate">{a.label}</span>
            <span className="flex items-center gap-1 text-[11px] font-semibold text-black bg-primary rounded px-1.5 py-0.5 shrink-0">
              <ArrowDownToLine className="w-3 h-3" /> {actionLabel}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-white/30 hover:text-white/70 transition-colors"
        aria-label="Dismiss project assets"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
