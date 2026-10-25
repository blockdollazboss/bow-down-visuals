/* Thy Library tab resolution (Stack-200 lane 2, board item 8).
   Pure + framework-free so the ?tab= contract is unit-testable:
   ?tab= wins when it names a real tab; the ?tool=video context hint
   falls back to presets; anything else asks for nothing and the page
   applies its own default. */

export type LibraryTab = "templates" | "presets" | "fonts" | "wishlist";

export function libraryTabFromParams(params: URLSearchParams): LibraryTab | null {
  const tab = params.get("tab");
  if (tab === "presets" || tab === "fonts" || tab === "templates" || tab === "wishlist") return tab;
  if (params.get("tool") === "video") return "presets";
  return null;
}
