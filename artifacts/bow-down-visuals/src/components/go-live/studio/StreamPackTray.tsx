/**
 * StreamPackTray — the stream-pack tray inside Scenes & sources.
 *
 * The graphics a member marked "Add to my studio" (in the Branding
 * Kit → Stream Pack library, or here) wait in this tray. Adding one
 * to the scene goes through the stage's own image-source path — the
 * same add + URL the Sources panel uses for a pasted image — so the
 * compositor never learns a second way to hold a picture. Removing a
 * graphic from the tray only clears its applied flag on the server
 * record; copies already placed in a scene keep their URL and stay.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Plus, X } from "lucide-react";
import type { Stage } from "@/lib/stream-kit/stage";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchMyStreamPackAssets,
  setStreamPackAssetApplied,
  streamPackTrayAssets,
  type StreamPackAssetRecord,
} from "@/lib/stream-pack";

export default function StreamPackTray({
  stage,
  isLight,
  onSelect,
  onNotify,
}: {
  stage: Stage;
  isLight: boolean;
  onSelect: (id: string | null) => void;
  onNotify: (msg: string) => void;
}) {
  const { getAccessToken } = useAuth();
  const [tray, setTray] = useState<StreamPackAssetRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const label = isLight ? "text-[#6B5B36]" : "text-zinc-400";

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const all = await fetchMyStreamPackAssets(getAccessToken);
      setTray(streamPackTrayAssets(all));
    } catch {
      setFailed(true);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const addToScene = (asset: StreamPackAssetRecord) => {
    const scene = stage.previewScene();
    const created = stage.addSource(scene.id, "image");
    if (!created) {
      onNotify("That scene couldn't take another source.");
      return;
    }
    stage.updateSource(scene.id, created.id, {
      name: asset.label,
      imageUrl: asset.url,
    });
    onSelect(created.id);
    onNotify(`${asset.label} added to ${scene.name} — size and place it on the preview.`);
  };

  const removeFromTray = async (asset: StreamPackAssetRecord) => {
    setBusyId(asset.id);
    try {
      await setStreamPackAssetApplied(getAccessToken, asset.id, false);
      setTray((list) => (list ?? []).filter((a) => a.id !== asset.id));
      onNotify(
        `${asset.label} removed from your studio tray — copies already in a scene stay put.`,
      );
    } catch {
      onNotify(`${asset.label} couldn't be removed — try again.`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mt-3" data-testid="stream-pack-tray">
      <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${label}`}>
        Stream pack tray
      </p>
      {tray === null && !failed && (
        <p className={`text-xs ${label}`}>Loading your stream pack…</p>
      )}
      {failed && (
        <p className={`text-xs ${label}`}>
          Your stream pack couldn&rsquo;t load.{" "}
          <button
            type="button"
            onClick={() => void load()}
            className="font-semibold text-[#8a6d1f] underline underline-offset-2 dark:text-[#e8cf8a]"
          >
            Retry
          </button>
        </p>
      )}
      {tray !== null && tray.length === 0 && (
        <p className={`text-xs leading-relaxed ${label}`}>
          No pack graphics in your tray yet. Make them in{" "}
          <Link
            href="/branding-kit?tab=stream"
            className="font-semibold text-[#8a6d1f] underline underline-offset-2 dark:text-[#e8cf8a]"
          >
            Branding Kit → Stream Pack
          </Link>
          , add them to your studio there, and they&rsquo;ll wait here — ready to
          drop into any scene.
        </p>
      )}
      <div className="space-y-1.5">
        {(tray ?? []).map((asset) => (
          <div
            key={asset.id}
            className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${
              isLight
                ? "border-[#C9A84C]/25 bg-white/40"
                : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <img
              src={asset.url}
              alt=""
              className="h-8 w-14 shrink-0 rounded bg-black object-cover"
              loading="lazy"
            />
            <span
              className={`min-w-0 flex-1 truncate font-medium ${
                isLight ? "text-[#2A1E07]" : "text-zinc-100"
              }`}
            >
              {asset.label}
            </span>
            <button
              type="button"
              onClick={() => addToScene(asset)}
              data-testid={`tray-add-${asset.id}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#C9A84C]/50 px-2 py-1 text-[11px] font-semibold text-[#8a6d1f] transition hover:bg-[#C9A84C]/10 dark:text-[#e8cf8a]"
            >
              <Plus className="h-3 w-3" /> Add to scene
            </button>
            <button
              type="button"
              title="Remove from tray"
              disabled={busyId === asset.id}
              onClick={() => void removeFromTray(asset)}
              className="shrink-0 rounded p-1 text-zinc-400 transition hover:text-red-400 disabled:opacity-50"
            >
              {busyId === asset.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
