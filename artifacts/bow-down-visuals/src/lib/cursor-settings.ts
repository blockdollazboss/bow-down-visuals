/* ─── Cursor settings ───
   Permanent per-visitor cursor choice, stored in localStorage.
   The site-wide CustomCursor component reads this. */

export type CursorId =
  | "shark-fin"
  | "bucs-coin"
  | "crown"
  | "gold-trail"
  | "lightning"
  | "pixel-shark"
  | "flame"
  | "diamond"
  | "star"
  | "money-bag"
  | "gold-key"
  | "trophy"
  | "rocket"
  | "crosshair"
  | "music-note"
  | "gamepad"
  | "camera";

const KEY = "bdv-cursor-choice";

export const CURSOR_OPTIONS: { id: CursorId; name: string; description: string }[] = [
  {
    id: "shark-fin",
    name: "Shark Fin",
    description: "A sleek gold shark fin that cuts through the page. Bites on click.",
  },
  {
    id: "crown",
    name: "King's Crown",
    description: "A tiny gold crown — you're the Kingpin. Royal glow on hover.",
  },
  {
    id: "bucs-coin",
    name: "Visual Bucs Coin",
    description: "A spinning Visual Bucs coin follows your cursor. Bursts on click.",
  },
  {
    id: "gold-trail",
    name: "Gold Trail",
    description: "Minimal dot with a luxurious gold particle trail. Subtle, premium.",
  },
  {
    id: "lightning",
    name: "Lightning Bolt",
    description: "A crackling gold bolt — fast, electric, viral energy. Strikes on click.",
  },
  {
    id: "pixel-shark",
    name: "8-Bit Shark",
    description: "Retro pixel-art shark. Nostalgic cheat-code vibes. Chomps on click.",
  },
  {
    id: "flame",
    name: "Fire Flame",
    description: "Your content is fire. A flickering gold flame that flares on click.",
  },
  {
    id: "diamond",
    name: "Diamond",
    description: "Premium luxury. A sparkling diamond that glints on hover.",
  },
  {
    id: "star",
    name: "Gold Star",
    description: "Creator star power. A slowly spinning gold star. Bursts on click.",
  },
  {
    id: "money-bag",
    name: "Money Bag",
    description: "Get to the bag. A gold money bag that rains coins on click.",
  },
  { id: "gold-key", name: "Gold Key", description: "Unlock the cheat code. A golden key that turns on click." },
  { id: "trophy", name: "Trophy", description: "Winner's cursor. A gold trophy that shines on hover." },
  { id: "rocket", name: "Rocket", description: "Take off. A gold rocket that launches on click." },
  { id: "crosshair", name: "Crosshair", description: "Target your goals. Precision crosshair, locks on hover." },
  { id: "music-note", name: "Music Note", description: "For the hitmakers. A gold note that plays on click." },
  { id: "gamepad", name: "Game Controller", description: "Cheat code gaming. A retro controller that rumbles on click." },
  { id: "camera", name: "Camera", description: "Content creator. A gold camera that flashes on click." },
];

export function getCursorChoice(): CursorId {
  try {
    const v = localStorage.getItem(KEY);
    if (v && CURSOR_OPTIONS.some((o) => o.id === v)) return v as CursorId;
  } catch {
    /* private mode */
  }
  return "shark-fin";
}

export function setCursorChoice(id: CursorId): void {
  try {
    localStorage.setItem(KEY, id);
    window.dispatchEvent(new Event("bdv-cursor-changed"));
  } catch {
    /* private mode */
  }
}
