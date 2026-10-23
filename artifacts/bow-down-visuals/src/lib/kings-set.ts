/* ─── The King's Set — the house starter theme pack ──────────────────────
   Owner-approved as a set on Oct 22–23, 2026 (three personal approvals):
   the King himself, subject-led, on the plaza / on his throne / on stage —
   every still carrying the FULL Bow Down Visuals logo lockup, whole and
   untouched, at emblem size, plus a 10-second living (looping) version of
   each. These pieces are the desk's quality bar for preset art: subject
   first, branded by default, logo whole and emblem-sized.

   The files ship in the app bundle under /wallpapers/ (public/); per the
   established media flow the local copies stay until the set is verified
   live, and the R2 mirror follows the same manifest flow as the rest of
   the site media. Paths, dimensions and the approved logo widths are
   pinned by kings-set.test.ts against the files on disk. */

export interface KingsSetPiece {
  id: "plaza" | "throne" | "stage";
  /** i18n leaf under wallpapers.kingset.* naming the piece. */
  titleKey: "plaza" | "throne" | "stage";
  stillUrl: string;
  loopUrl: string;
  orientation: "portrait" | "landscape";
  stillWidth: number;
  stillHeight: number;
  loopWidth: number;
  loopHeight: number;
  loopSeconds: number;
  /** The desk render preset this piece is made for. */
  presetKey: "phone-iphone" | "desktop-fhd";
  /** Width of the baked-in logo lockup as % of the still's width —
      the exact size the owner approved for each piece. */
  logoWidthPct: number;
}

export const KINGS_SET: KingsSetPiece[] = [
  {
    id: "plaza",
    titleKey: "plaza",
    stillUrl: "/wallpapers/kings-set-plaza-phone.webp",
    loopUrl: "/wallpapers/kings-set-plaza-loop.mp4",
    orientation: "portrait",
    stillWidth: 1152,
    stillHeight: 2048,
    loopWidth: 704,
    loopHeight: 1248,
    loopSeconds: 10,
    presetKey: "phone-iphone",
    logoWidthPct: 34,
  },
  {
    id: "throne",
    titleKey: "throne",
    stillUrl: "/wallpapers/kings-set-throne-phone.webp",
    loopUrl: "/wallpapers/kings-set-throne-loop.mp4",
    orientation: "portrait",
    stillWidth: 1152,
    stillHeight: 2048,
    loopWidth: 704,
    loopHeight: 1248,
    loopSeconds: 10,
    presetKey: "phone-iphone",
    logoWidthPct: 27,
  },
  {
    id: "stage",
    titleKey: "stage",
    stillUrl: "/wallpapers/kings-set-stage-desktop.webp",
    loopUrl: "/wallpapers/kings-set-stage-loop.mp4",
    orientation: "landscape",
    stillWidth: 2048,
    stillHeight: 1152,
    loopWidth: 1248,
    loopHeight: 704,
    loopSeconds: 10,
    presetKey: "desktop-fhd",
    logoWidthPct: 13,
  },
];
