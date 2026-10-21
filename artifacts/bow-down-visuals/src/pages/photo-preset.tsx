import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import type { DevelopSettings } from "@/lib/photo-canvas";

/**
 * Public preset page (Stack 7 #8) — a shared photo look. Anyone with
 * the link can see the recipe; creators apply it from the Photo desk
 * editor's Preset packs panel. Only presets the owner made public are
 * served (GET /api/photo-presets/public/:slug).
 */
interface PublicPreset {
  id: string; name: string;
  recipe: { develop: DevelopSettings };
  isPublic: boolean; shareSlug: string | null; storeProductId: string | null;
}

const ROWS: { key: keyof DevelopSettings; label: string }[] = [
  { key: "exposure", label: "Exposure" }, { key: "brightness", label: "Brightness" },
  { key: "contrast", label: "Contrast" }, { key: "temperature", label: "White balance" },
  { key: "hue", label: "Hue" }, { key: "saturation", label: "Saturation" },
  { key: "lightness", label: "Lightness" }, { key: "rotateDeg", label: "Rotate" },
];

export default function PhotoPresetPage() {
  const [, params] = useRoute("/photo-preset/:slug");
  const slug = params?.slug ?? "";
  const [preset, setPreset] = useState<PublicPreset | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/photo-presets/public/${encodeURIComponent(slug)}`);
        if (!res.ok) { if (alive) setState("missing"); return; }
        const data = (await res.json()) as { preset: PublicPreset };
        if (alive) { setPreset(data.preset); setState("ok"); }
      } catch { if (alive) setState("missing"); }
    })();
    return () => { alive = false; };
  }, [slug]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-2xl px-5 py-14">
        <Link href="/thumbnail-studio?tab=editor" className="text-sm text-white/40 hover:text-white">← Photo desk</Link>
        {state === "loading" && <p className="mt-10 text-white/50">Loading preset…</p>}
        {state === "missing" && (
          <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h1 className="text-xl font-bold">This preset isn't public</h1>
            <p className="mt-2 text-sm text-white/50">The owner may have made it private, or the link is wrong. Nothing was hidden from you — public presets only are served here.</p>
          </div>
        )}
        {state === "ok" && preset && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <p className="text-xs font-bold uppercase tracking-widest text-amber-300">Shared photo preset</p>
            <h1 className="mt-2 text-3xl font-black">{preset.name}</h1>
            <p className="mt-2 text-sm text-white/50">A develop look for photos. Open the Photo desk editor, add a photo, and apply looks from the Preset packs panel.</p>
            <dl className="mt-6 grid grid-cols-2 gap-3">
              {ROWS.map((r) => (
                <div key={r.key} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-white/35">{r.label}</dt>
                  <dd className="text-sm font-semibold">{String(preset.recipe.develop[r.key] ?? 0)}</dd>
                </div>
              ))}
            </dl>
            <Link href="/thumbnail-studio?tab=editor" className="mt-6 inline-block rounded-xl bg-gradient-to-r from-[#fbbf24] to-[#d4a017] px-4 py-2 text-sm font-bold text-black">Open the Photo desk editor</Link>
          </div>
        )}
      </div>
    </div>
  );
}
