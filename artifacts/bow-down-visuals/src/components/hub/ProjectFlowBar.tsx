import { useState } from "react";
import { X, ArrowDownToLine } from "lucide-react";
import { useLocation } from "wouter";
import { useHubProject, type HubAsset, type HubAssetKind } from "@/lib/hub-project";
import { KIND_LABEL, AUDIO_KINDS } from "@/lib/hub-workflows";
import { ClipContextMenu } from "@/components/editor/ClipContextMenu";
import { buildAssetContextItems, downloadAsset } from "@/lib/asset-context-menu";
import { sendAssetToDesk } from "@/lib/asset-handoff";
import { useToast } from "@/hooks/use-toast";

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
  const { project, removeAsset, renameAsset } = useHubProject();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; assetId: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const matches = project.assets.filter((a) => kinds.includes(a.kind));

  /* "Send to desk": the real handoff — stash (ownership-validated
     against this project) and navigate to the receiving desk. */
  const sendToDesk = (asset: HubAsset, intentId: string) => {
    try {
      const route = sendAssetToDesk({
        intentId,
        asset: { hubAssetId: asset.id, kind: asset.kind, url: asset.url, label: asset.label, detail: asset.detail, meta: asset.meta },
        projectAssets: project.assets,
      });
      setLocation(route);
    } catch (err) {
      toast({ title: "Couldn't send that asset", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  const commitRename = (asset: HubAsset) => {
    renameAsset(asset.id, draft);
    setRenamingId(null);
  };

  if (dismissed || matches.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3 mb-6 flex items-center gap-3 flex-wrap">
      <p className="text-xs font-bold uppercase tracking-wider text-primary shrink-0">
        From your project
      </p>
      <div className="flex gap-2 flex-wrap flex-1">
        {matches.slice(0, 3).map((a) =>
          renamingId === a.id ? (
            <form
              key={a.id}
              onSubmit={(e) => { e.preventDefault(); commitRename(a); }}
              className="flex items-center gap-2 rounded-lg border border-primary/60 bg-black/40 pl-2 pr-2 py-1 max-w-[260px]"
            >
              <span className="text-[10px] font-bold uppercase tracking-wide text-primary/80 shrink-0">
                {KIND_LABEL[a.kind]}
              </span>
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setRenamingId(null); }}
                onBlur={() => commitRename(a)}
                aria-label="Rename asset"
                className="min-w-0 bg-transparent text-xs text-white/90 focus:outline-none"
              />
            </form>
          ) : (
            <button
              key={a.id}
              type="button"
              onClick={() => onPick(a)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, assetId: a.id });
              }}
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
          ),
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-white/30 hover:text-white/70 transition-colors"
        aria-label="Dismiss project assets"
      >
        <X className="w-4 h-4" />
      </button>
      {menu && (() => {
        const asset = project.assets.find((a) => a.id === menu.assetId);
        if (!asset) return null;
        return (
          <ClipContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            testId="project-asset-context-menu"
            items={buildAssetContextItems(asset, {
              onUse: onPick,
              onSendIntent: sendToDesk,
              onDownload: downloadAsset,
              onRename: (a) => { setDraft(a.label); setRenamingId(a.id); },
              onRemove: (a) => removeAsset(a.id),
            })}
          />
        );
      })()}
    </div>
  );
}
