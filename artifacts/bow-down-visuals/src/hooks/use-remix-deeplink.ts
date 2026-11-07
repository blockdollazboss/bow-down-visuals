import { useEffect, useRef } from "react";
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
   never blocks the editor. The coordinator wires this into video-editor.tsx.

   Search source (stack200 lane B1): the editor passes its router
   search (wouter useSearch) so the SAME deep link lands inside
   the World's step-through, where the editor mounts under a
   memory router and there is no real /video-editor URL for
   window.location to carry. window.location remains the
   fallback when no router search is supplied. Each slug is
   applied once — a re-render never re-applies a consumed link. */

export function useRemixDeeplink(opts: {
  setSettings: (updater: (prev: any) => any) => void;
  setTab: (tab: string) => void;
  /** The router search string (wouter useSearch), when the
   *  editor has one — the step-through's seeded search rides it. */
  search?: string;
}) {
  const { setSettings, setTab, search } = opts;
  const consumedRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const fromRouter = search ? new URLSearchParams(search).get("remix") : null;
      const slug =
        fromRouter ??
        (typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("remix")
          : null);
      if (!slug) return;
      if (consumedRef.current === slug) return;
      const preset = getTrendingPreset(slug);
      if (!preset) return; // unknown slug — ignore, never throw
      consumedRef.current = slug;

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
  }, [search]);
}
