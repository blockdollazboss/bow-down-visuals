/* ─── Creation finale seam (org wave #2, rank 6a) ─────────────────────
   Every creation surface ends in the Get Paid chain:
   CREATE → PUBLISH → PRICE → PROMOTE → EARN. The player-side
   GetPaidFinale covers finished drops; this seam covers the desks
   where the work is MADE. It is pure so the wiring is pinnable:
   the publish href speaks the /publish deep-link protocol that
   publish.tsx already consumes (?from=&fromLabel=&type= prefill),
   and the surface registry is the single list the source-contract
   tests check page by page. */

export interface CreationSurface {
  id: string;
  /** The surface's own route — handed to /publish as the `from` door. */
  path: string;
  /** Human label shown in the finale and as publish's fromLabel. */
  label: string;
  /** Media kind the surface mostly makes; pre-selects publish's type. */
  publishType?: "audio" | "video";
}

export const CREATION_FINALE_SURFACES = [
  { id: "create", path: "/create", label: "Create desk" },
  { id: "video-editor", path: "/video-editor", label: "Video Editor", publishType: "video" },
  { id: "audio-studio", path: "/audio-studio", label: "Audio Studio", publishType: "audio" },
  { id: "thumbnail-studio", path: "/thumbnail-studio", label: "Thumbnail Studio" },
  { id: "carousel-maker", path: "/carousel-maker", label: "Carousel Maker" },
  { id: "books", path: "/books", label: "Books Studio" },
  { id: "movies", path: "/movies", label: "Movie Studio", publishType: "video" },
  { id: "hooks", path: "/hooks", label: "Hook Studio", publishType: "video" },
  { id: "go-live", path: "/go-live", label: "Go Live" },
] as const satisfies readonly CreationSurface[];

export type CreationSurfaceId = (typeof CREATION_FINALE_SURFACES)[number]["id"];

export function creationSurface(id: CreationSurfaceId): CreationSurface {
  const found = CREATION_FINALE_SURFACES.find((s) => s.id === id);
  if (!found) throw new Error(`unknown creation surface: ${id}`);
  return found;
}

/**
 * The pre-wired publish door for a surface. publish.tsx's deep-link
 * prefill consumes `from` (must be a local path), `fromLabel`, and
 * `type` — so the door lands the creator on the publish desk with
 * the way back named, never on a bare form.
 */
export function buildCreationPublishHref(surface: CreationSurface): string {
  const params = new URLSearchParams();
  params.set("from", surface.path);
  params.set("fromLabel", surface.label);
  if (surface.publishType) params.set("type", surface.publishType);
  return `/publish?${params.toString()}`;
}

export interface CreationFinaleStep {
  key: "publish" | "price" | "promote" | "earn";
  title: string;
  body: string;
  href: string;
  cta: string;
}

/** The four doors of the finale, in chain order. */
export function creationFinaleSteps(surface: CreationSurface): CreationFinaleStep[] {
  return [
    {
      key: "publish",
      title: "Publish it",
      body: "Send what you just made out the door — the publish desk opens pre-wired from here.",
      href: buildCreationPublishHref(surface),
      cta: "Open the publish desk",
    },
    {
      key: "price",
      title: "Price it",
      body: "Put a price on the download in your store so every play can become a sale.",
      href: "/store/dashboard?view=digital",
      cta: "Set your prices",
    },
    {
      key: "promote",
      title: "Promote it",
      body: "Promo copy, drop-day kit and your referral link — push the drop where fans live.",
      href: "/promote",
      cta: "Open Promote",
    },
    {
      key: "earn",
      title: "Watch it earn",
      body: "Sales, tips and payouts land in Earnings — check what this drop is making you.",
      href: "/earnings",
      cta: "See Earnings",
    },
  ];
}
