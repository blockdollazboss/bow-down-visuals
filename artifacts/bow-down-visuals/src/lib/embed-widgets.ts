/* ─── Embed widgets — the desk's shared math ─────────────────────────────
   Pure helpers for the Widgets Desk in Promote (pages/promote.tsx →
   components/promote/WidgetsDeskPanel.tsx). The widgets themselves are
   the tiny standalone /embed/* pages served by the API (routes/embed.ts):
   a creator pastes the iframe on their own site, blog or link page, and
   it renders on phones, tablets and desktops alike — the code below is
   the ONLY place the desk's sizes live, so the preview frames and the
   copied code can never disagree.

   Sizes are honest pixels: the width/height in the copied code are
   exactly the preset's numbers (with a max-width:100% guard so a
   narrower host page shrinks the frame instead of breaking its layout).
   Inside the frame the widget is fluid — designed at phone width
   (320px, no sideways scroll), tablet and desktop widths alike.

   Stack1000 M2 — the ORIGINAL embed kinds (track, video, playlist)
   joined the desk: their pages predate the desk but ride the same
   shell, so the desk's kinds, sizes and code-building cover them too. */

export type EmbedWidgetKind =
  | "profile"
  | "latest"
  | "tips"
  | "live"
  | "product"
  | "track"
  | "video"
  | "playlist";
export type EmbedTheme = "dark" | "light";
export type EmbedSizeKey = "phone" | "tablet" | "desktop";

export const EMBED_SIZE_KEYS: EmbedSizeKey[] = ["phone", "tablet", "desktop"];

export const EMBED_SIZE_LABELS: Record<EmbedSizeKey, string> = {
  phone: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
};

/** Preset box (CSS pixels) per widget per device class. The classic
 *  kinds' heights follow their pages: the track player is a fixed
 *  artwork row + audio bar (it only widens), the video box tracks the
 *  16:9 frame plus its caption, the playlist is a scrolling list. */
export const WIDGET_DIMS: Record<EmbedWidgetKind, Record<EmbedSizeKey, { w: number; h: number }>> = {
  profile: { phone: { w: 320, h: 460 }, tablet: { w: 420, h: 500 }, desktop: { w: 520, h: 540 } },
  latest: { phone: { w: 320, h: 320 }, tablet: { w: 480, h: 400 }, desktop: { w: 640, h: 460 } },
  tips: { phone: { w: 320, h: 300 }, tablet: { w: 420, h: 320 }, desktop: { w: 520, h: 340 } },
  live: { phone: { w: 320, h: 150 }, tablet: { w: 420, h: 150 }, desktop: { w: 560, h: 160 } },
  product: { phone: { w: 320, h: 400 }, tablet: { w: 420, h: 440 }, desktop: { w: 520, h: 480 } },
  track: { phone: { w: 320, h: 230 }, tablet: { w: 420, h: 240 }, desktop: { w: 520, h: 250 } },
  video: { phone: { w: 320, h: 290 }, tablet: { w: 480, h: 380 }, desktop: { w: 640, h: 470 } },
  playlist: { phone: { w: 320, h: 430 }, tablet: { w: 420, h: 470 }, desktop: { w: 520, h: 520 } },
};

interface WidgetTarget {
  /** profile/latest/live → the creator's profile slug; tips → the tip
   *  page's real handle; product → the product id; track/video/
   *  playlist → the item's own id. */
  target: string;
  /** The creator's referral code, when known — carried so embed views
   *  can become referred signups, exactly like the Embed button. */
  refCode?: string | null;
}

/** The iframe src for a widget: /embed/<kind>/<target>, with the theme
 *  only when it isn't the default and the ref code when we have one. */
export function embedWidgetSrc(
  origin: string,
  kind: EmbedWidgetKind,
  { target, refCode }: WidgetTarget,
  theme: EmbedTheme,
): string {
  const params = new URLSearchParams();
  if (theme === "light") params.set("theme", "light");
  if (refCode) params.set("ref", refCode);
  const qs = params.toString();
  return `${origin}/embed/${kind}/${encodeURIComponent(target)}${qs ? `?${qs}` : ""}`;
}

/** The copy-paste iframe code for one widget at one preset size. */
export function buildEmbedCode(
  origin: string,
  kind: EmbedWidgetKind,
  target: WidgetTarget,
  theme: EmbedTheme,
  size: EmbedSizeKey,
  title: string,
): string {
  const { w, h } = WIDGET_DIMS[kind][size];
  const src = embedWidgetSrc(origin, kind, target, theme);
  const label = `${title.replace(/"/g, "&quot;")} — Bow Down Visuals`;
  return `<iframe src="${src}" width="${w}" height="${h}" style="max-width:100%;border:0;border-radius:16px" allow="autoplay; encrypted-media; fullscreen" loading="lazy" title="${label}"></iframe>`;
}
