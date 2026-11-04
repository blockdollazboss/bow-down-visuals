import { useState } from "react";
import { ArrowRight, LayoutTemplate, Search } from "lucide-react";
import {
  TEMPLATE_GALLERIES,
  filterTemplateCards,
  templateCategories,
  templateUseTarget,
  videoTemplateApplyCost,
  type TemplateCard,
  type TemplateGalleryId,
} from "@/lib/world/templates-desk";
import type { PanelPayload } from "@/lib/world/panel-payload";

/* ─── Templates Desk (Stack-100 wave 4, item 27 / desk #100) ────────
   The Templates hub's browse half, native in the World: the four
   galleries the website's Templates hub reads (videos, hooks,
   captions, thumbnails), folded from the SAME data libraries
   (lib/world/templates-desk.ts) — the same catalog, not a
   World-curated subset. A card's Use rides the panel payload
   channel to the owning desk (hooks + captions → the Hook Desk,
   thumbnails → the Thumbnail Desk, videos → the Video Desk's
   template bench), the in-world form of the 2D galleries'
   deep links.

   Browsing here is free, like the hub: nothing on this desk
   charges. The one priced act in the family — applying a video
   template — happens at the Video Desk through the registry-
   priced rail with the standing spend confirmation, and the
   line under the gallery tabs says so before anyone taps Use.
   The browse reads bundled libraries (exactly like the 2D
   gallery pages), so there is no fetch to fail; a search or
   category with no matches says so plainly instead of dressing
   an empty shelf up as the hub. */

export function TemplatesDesk({
  isLight,
  onOpenStation,
}: {
  isLight: boolean;
  onOpenStation?: (stationId: string, payload?: PanelPayload | null) => void;
}) {
  const [gallery, setGallery] = useState<TemplateGalleryId>("videos");
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const cards = filterTemplateCards(gallery, category, query);
  const categories = templateCategories(gallery);
  const applyCost = videoTemplateApplyCost();

  const text = isLight ? "text-[#2A2118]" : "text-[#F3E9D2]";
  const muted = isLight ? "text-[#2A2118]/60" : "text-[#F3E9D2]/55";
  const chipCls = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
      active
        ? "border-transparent bg-[#C9A227] text-black"
        : isLight
          ? "border-black/15 text-[#2A2118]/70 hover:border-black/30"
          : "border-white/15 text-[#F3E9D2]/70 hover:border-white/30"
    }`;
  const cardCls = isLight
    ? "rounded-xl border border-black/10 bg-white/60 p-3"
    : "rounded-xl border border-white/10 bg-white/[0.04] p-3";

  const pickGallery = (id: TemplateGalleryId) => {
    setGallery(id);
    setCategory("All");
  };

  const use = (card: TemplateCard) => {
    if (!onOpenStation) return;
    const target = templateUseTarget(card);
    onOpenStation(target.stationId, target.payload);
  };

  return (
    <div className="space-y-3" data-testid="world-templates-desk">
      <div>
        <h3 className={`flex items-center gap-2 text-base font-bold ${text}`}>
          <LayoutTemplate className="h-4 w-4 text-[#C9A227]" /> Templates
        </h3>
        <p className={`mt-0.5 text-xs ${muted}`}>
          Every template gallery on the site, in one place. Pick a template and it opens at its own desk,
          already loaded — videos at the Video Desk, hooks and captions at the Hook Desk, thumbnails at the
          Thumbnail Desk.
        </p>
        {gallery === "videos" ? (
          <p className={`mt-1 text-xs ${muted}`} data-testid="world-templates-desk-video-price">
            Browsing is free. Applying a video template costs {applyCost} Visual Bucs — you're asked to
            confirm before anything is charged, and a render that fails is refunded.
          </p>
        ) : (
          <p className={`mt-1 text-xs ${muted}`}>Browsing and opening are free — each desk prices its own makes.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="world-templates-desk-galleries">
        {TEMPLATE_GALLERIES.map((g) => (
          <button
            key={g.id}
            type="button"
            className={chipCls(gallery === g.id)}
            onClick={() => pickGallery(g.id)}
            data-testid={`world-templates-desk-gallery-${g.id}`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <label
        className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
          isLight ? "border-black/15 bg-white/70" : "border-white/15 bg-white/[0.04]"
        }`}
      >
        <Search className={`h-3.5 w-3.5 shrink-0 ${muted}`} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates…"
          className={`w-full bg-transparent text-sm outline-none ${text} placeholder:opacity-50`}
          data-testid="world-templates-desk-search"
        />
      </label>

      <div className="flex flex-wrap gap-1.5" data-testid="world-templates-desk-categories">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={chipCls(category === c)}
            onClick={() => setCategory(c)}
            data-testid={`world-templates-desk-category-${c}`}
          >
            {c}
          </button>
        ))}
      </div>

      {cards.length === 0 ? (
        <p className={`text-sm ${muted}`} data-testid="world-templates-desk-no-matches">
          Nothing in this gallery matches that — try a different search or category. The full gallery is
          still here behind the filters.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2" data-testid="world-templates-desk-cards">
          {cards.map((card) => (
            <div key={`${card.gallery}-${card.slug}`} className={cardCls} data-testid={`world-templates-desk-card-${card.slug}`}>
              <div className="flex items-start justify-between gap-2">
                <p className={`text-sm font-semibold ${text}`}>
                  {card.emoji ? <span className="mr-1.5">{card.emoji}</span> : null}
                  {card.title}
                </p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    isLight ? "bg-[#C9A227]/15 text-[#7A5A12]" : "bg-[#C9A227]/15 text-[#e8c86a]"
                  }`}
                >
                  {card.category}
                </span>
              </div>
              <p className={`mt-1 text-xs ${muted}`}>{card.blurb}</p>
              {card.detail ? <p className={`mt-1 text-xs ${muted}`}>{card.detail}</p> : null}
              {card.meta ? <p className={`mt-1 text-[11px] font-medium ${muted}`}>{card.meta}</p> : null}
              {onOpenStation ? (
                <button
                  type="button"
                  onClick={() => use(card)}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[#C9A227] px-3 py-1.5 text-xs font-bold text-black transition hover:bg-[#dbb52f]"
                  data-testid={`world-templates-desk-use-${card.slug}`}
                >
                  Use this template <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
