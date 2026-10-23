/**
 * Stack-28 #53 (A5-M1) — the Video Editor's section registry: the SINGLE
 * source of truth for editor section ids and which panel side each section
 * lives on.
 *
 * Before this module, the id list was re-declared in five places inside
 * video-editor.tsx (the EditorTab union, the deep-link id list, the two
 * rail arrays, the two panel header maps and the panel render conditionals),
 * so a new section could be added to the rails and silently never render —
 * which is exactly what happened on mobile, where both panels are
 * `hidden md:block` and rail taps switched state to panels that never
 * appeared.
 *
 * Now the editor derives everything from EDITOR_SECTIONS:
 *  - the `EditorTab` type is `EditorSectionId` from here,
 *  - the right-panel routing set is `EDITOR_RIGHT_SECTION_IDS` from here,
 *  - the deep-link validator accepts exactly `EDITOR_SECTION_IDS`,
 *  - the desktop panel bodies and the mobile section sheet are the same
 *    render helpers, keyed by these ids.
 *
 * The pinning test (editor-mobile-sheet.test.ts) asserts every id here has
 * a panel render conditional in video-editor.tsx and a title entry, so the
 * registry cannot drift from the panels again.
 */
export const EDITOR_SECTIONS = [
  // ── 1. PLAN & SOURCE — left panel ──
  { id: "pre-production", side: "left" },
  { id: "clips", side: "left" },
  { id: "templates", side: "left" },
  { id: "music", side: "left" },
  // ── 2. BUILD — left panel ──
  { id: "copilot", side: "left" },
  { id: "timeline", side: "left" },
  { id: "beat-sync", side: "left" },
  { id: "captions", side: "left" },
  { id: "effects", side: "left" },
  { id: "motion", side: "left" },
  { id: "lip-sync", side: "left" },
  { id: "voice-edits", side: "left" },
  { id: "branding", side: "left" },
  // ── 3. STYLE & POLISH — left panel ──
  { id: "vibes", side: "left" },
  { id: "style-stealer", side: "left" },
  { id: "locations", side: "left" },
  { id: "upscale", side: "left" },
  { id: "cartoonize", side: "left" },
  // ── 4. CREATE MORE — right panel ──
  { id: "promo-clips", side: "right" },
  { id: "lyric-video", side: "right" },
  { id: "thumbnails", side: "right" },
  { id: "meme-machine", side: "right" },
  { id: "three-second-lab", side: "right" },
  { id: "translate", side: "right" },
  { id: "repurpose", side: "right" },
  // ── 5. FINISH — right panel ──
  { id: "edit-recipes", side: "right" },
  { id: "studio", side: "right" },
  { id: "pro-tools", side: "right" },
  { id: "export", side: "right" },
] as const;

export type EditorSectionId = (typeof EDITOR_SECTIONS)[number]["id"];
export type EditorSectionSide = (typeof EDITOR_SECTIONS)[number]["side"];

/** Every editor section id, in rail order. */
export const EDITOR_SECTION_IDS: EditorSectionId[] = EDITOR_SECTIONS.map((s) => s.id);

/** Sections rendered by the LEFT (build) panel. */
export const EDITOR_LEFT_SECTION_IDS: EditorSectionId[] = EDITOR_SECTIONS.filter(
  (s) => s.side === "left",
).map((s) => s.id);

/** Sections rendered by the RIGHT (create-more + finish) panel. */
export const EDITOR_RIGHT_SECTION_IDS: EditorSectionId[] = EDITOR_SECTIONS.filter(
  (s) => s.side === "right",
).map((s) => s.id);

export const EDITOR_RIGHT_SECTION_SET: ReadonlySet<string> = new Set(EDITOR_RIGHT_SECTION_IDS);

/** Which panel side a section belongs to — the mobile sheet routes by this. */
export function editorSectionSide(id: string): EditorSectionSide {
  return EDITOR_RIGHT_SECTION_SET.has(id) ? "right" : "left";
}
