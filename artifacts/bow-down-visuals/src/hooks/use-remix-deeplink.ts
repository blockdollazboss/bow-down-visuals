import { useEffect } from "react";
import { getTrendingPreset } from "@/data/trending-presets";

/* ─── useRemixDeeplink — `?remix=<slug>` deep-link for the Trending Remix Feed ───
   Resolves the slug against the trending preset catalog (src/data/trending-presets.ts)
   and applies it to the video editor, mirroring the existing ?fx= / ?textstyle= /
   ?transition= deep-links in video-editor.tsx:
     - preset.editorEffect → appends the effect to settings.effects (deduped),
       opens the Effects tab.
     - preset.editorMotion → EditorSettings has no motion field (motion graphics in
       this editor live in settings.overlayItems with motionCss, and no motion-preset
       catalog exists yet), so it falls back to settings.effects (deduped) and opens
       the Motion tab.
     - neither → opens the Effects tab as a sensible default.
   Unknown slugs, missing catalog, or malformed URLs are ignored — never throws,
   never blocks the editor. The coordinator wires this into video-editor.tsx. */

export function useRemixDeeplink(opts: {
  setSettings: (updater: (prev: any) => any) => void;
  setTab: (tab: string) => void;
}) {
  const { setSettings, setTab } = opts;

  useEffect(() => {
    try {
      const slug = new URLSearchParams(window.location.search).get("remix");
      if (!slug) return;
      const preset = getTrendingPreset(slug);
      if (!preset) return; // unknown slug — ignore, never throw

      if (preset.editorEffect) {
        const effectName = preset.editorEffect;
        setSettings((prev: any) => ({
          ...prev,
          effects: (prev?.effects ?? []).includes(effectName)
            ? prev.effects
            : [...(prev?.effects ?? []), effectName],
        }));
        setTab("effects");
      } else if (preset.editorMotion) {
        // No dedicated motion field exists on EditorSettings — fall back to
        // settings.effects (deduped), per the motion-section mapping note.
        const motionName = preset.editorMotion;
        setSettings((prev: any) => ({
          ...prev,
          effects: (prev?.effects ?? []).includes(motionName)
            ? prev.effects
            : [...(prev?.effects ?? []), motionName],
        }));
        setTab("motion");
      } else {
        setTab("effects");
      }
    } catch {
      /* malformed URL or catalog lookup failure — never break the editor */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
