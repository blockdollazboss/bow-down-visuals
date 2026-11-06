/**
 * RemixDesk — the Create Wing's native Remix Trends desk
 * (stack200 world parity lane B1, census item 2), stacked at
 * the My Studio board beside the Library and Templates desks.
 *
 * The Trending Remix Feed, in the room: the page's own preset
 * catalog (data/trending-presets — imported, never copied),
 * the page's category filter and trend-score order. Tapping
 * Remix hands the preset through the panel-payload channel
 * into the Visual Vibes editor step-through, carrying the
 * SAME param the preset's 2D deep link carries — the editor
 * opens in-world with the look applied, and the bar at the
 * top is the way back. Nothing leaves the palace, nothing is
 * charged, and no rail is fetched: the feed is the catalog.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Flame, Sparkles } from "lucide-react";
import type { TrendingPreset } from "@/data/trending-presets";
import type { PanelPayload } from "@/lib/world/panel-payload";
import {
  REMIX_CATEGORIES,
  REMIX_EDITOR_STATION_ID,
  remixPayloadFor,
  remixPresetsFor,
  type RemixCategory,
} from "@/lib/world/remix-desk";

/** The page's own category accents (-600 text shades read on
 *  both the dark cards and the ivory light theme). */
const CATEGORY_ACCENT: Record<string, string> = {
  Motion: "border-sky-400/30 bg-sky-400/10 text-sky-600",
  Style: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-600",
  Transition: "border-emerald-400/30 bg-emerald-400/10 text-emerald-600",
  Effect: "border-amber-400/30 bg-amber-400/10 text-amber-600",
};

export function RemixDesk({
  isLight,
  onOpenStation,
}: {
  isLight: boolean;
  onOpenStation?: (stationId: string, payload?: PanelPayload | null) => void;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<RemixCategory>("All");
  const presets = remixPresetsFor(category);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;

  function remix(preset: TrendingPreset) {
    const payload = remixPayloadFor(preset);
    if (!payload) return;
    onOpenStation?.(REMIX_EDITOR_STATION_ID, payload);
  }

  return (
    <div className="space-y-4" data-testid="world-remix-desk">
      <div>
        <p className={`inline-flex items-center gap-2 text-base font-black ${strong}`}>
          <Flame className="h-4 w-4 text-[#d4af37]" /> {t("worldRemixDesk.title")}
        </p>
        <p className={`text-xs ${muted}`}>{t("worldRemixDesk.subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="world-remix-desk-categories">
        {REMIX_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={chipCls(category === c)}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {presets.length === 0 ? (
        <p className={`py-6 text-center text-sm ${muted}`}>{t("worldRemixDesk.empty")}</p>
      ) : (
        <div className="space-y-2.5" data-testid="world-remix-desk-feed">
          {presets.map((p) => (
            <article key={p.slug} className={`rounded-xl border p-3 ${cardCls}`}>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                    CATEGORY_ACCENT[p.category] ?? "border-white/10 text-white/50"
                  }`}
                >
                  {p.category}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-black text-[#d4af37]">
                  <Flame className="h-3 w-3" /> {p.trendScore}
                </span>
              </div>
              <p className={`mt-2 text-sm font-black ${strong}`}>{p.name}</p>
              <p className={`mt-0.5 text-xs leading-relaxed ${muted}`}>{p.description}</p>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="flex flex-wrap gap-1">
                  {p.platform.map((pl) => (
                    <span
                      key={pl}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        isLight ? "bg-[#C9A84C]/15 text-[#6B5B36]" : "bg-white/[0.05] text-white/40"
                      }`}
                    >
                      {pl}
                    </span>
                  ))}
                </span>
                <button
                  type="button"
                  data-testid={`world-remix-desk-use-${p.slug}`}
                  className="bdv-touch-target inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-3.5 py-2 text-xs font-black text-black transition hover:brightness-110"
                  onClick={() => remix(p)}
                >
                  <Sparkles className="h-3.5 w-3.5" /> {t("worldRemixDesk.remix")}{" "}
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
