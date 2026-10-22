/* ─── The King's own emoji + GIF sets ───────────────────────────────────
   The owner's custom sets (built Oct 2026): 12 die-cut King stickers and
   3 animated GIFs, each in TWO themes — the black-robed King for dark,
   the cream-robed King for light (from the site's own light-authority
   art). Robe-free icons (crown, coin, mic, fin) are literally the same
   files in both themes.

   Assets ship under public/ at UI weight, downscaled from the verified
   512px / 288px masters (kept in ~/workspace/custom-emoji):
     stickers → public/emoji/{dark,light}/king-<name>.webp  (256px WebP)
     GIFs     → public/gifs/{dark,light}/<name>.gif        (160px, 12fps)

   The King Wave GIF slot is honestly empty — it was never generated,
   so there is no wave code anywhere in this manifest.

   Text travels as shortcode tokens (`:king-laugh:`, `:gif-king-bow:`)
   stored as plain text and rendered client-side — no protocol or
   schema change anywhere this module is used. */
import { mediaUrl } from "@/lib/media-cdn";

export type KingArtTheme = "dark" | "light";

export interface KingEmojiDef {
  /** Shortcode name, e.g. "king-laugh" → typed/rendered as `:king-laugh:`. */
  code: string;
  label: string;
  file: string;
}

export interface KingGifDef {
  /** Shortcode name, e.g. "gif-king-bow" → `:gif-king-bow:`. */
  code: string;
  label: string;
  file: string;
}

export const KING_EMOJI: readonly KingEmojiDef[] = [
  { code: "king-laugh", label: "King Laugh", file: "king-laugh.webp" },
  { code: "king-love", label: "King Love", file: "king-love.webp" },
  { code: "king-hype", label: "King Hype", file: "king-hype.webp" },
  { code: "king-cool", label: "King Cool", file: "king-cool.webp" },
  { code: "king-wow", label: "King Wow", file: "king-wow.webp" },
  { code: "king-angry", label: "King Angry", file: "king-angry.webp" },
  { code: "king-crown", label: "Crown", file: "king-crown.webp" },
  { code: "king-coin", label: "VB Coin", file: "king-coin.webp" },
  { code: "king-mic", label: "Gold Mic", file: "king-mic.webp" },
  { code: "king-fin", label: "Shark Fin", file: "king-fin.webp" },
  { code: "king-bow", label: "King Bow", file: "king-bow.webp" },
  { code: "king-money", label: "King Winner", file: "king-money.webp" },
];

export const KING_GIFS: readonly KingGifDef[] = [
  { code: "gif-king-bow", label: "King Bow GIF", file: "king-bow.gif" },
  { code: "gif-king-laugh", label: "King Laugh GIF", file: "king-laugh.gif" },
  { code: "gif-vb-coin-spin", label: "VB Coin Spin GIF", file: "vb-coin-spin.gif" },
];

const EMOJI_BY_CODE = new Map(KING_EMOJI.map((e) => [e.code, e]));
const GIF_BY_CODE = new Map(KING_GIFS.map((g) => [g.code, g]));

export function kingEmojiDef(code: string): KingEmojiDef | null {
  return EMOJI_BY_CODE.get(code) ?? null;
}

export function kingGifDef(code: string): KingGifDef | null {
  return GIF_BY_CODE.get(code) ?? null;
}

/** Public URL for a sticker in the given theme; null for unknown codes. */
export function kingEmojiUrl(code: string, theme: KingArtTheme): string | null {
  const def = EMOJI_BY_CODE.get(code);
  return def ? `/emoji/${theme}/${def.file}` : null;
}

/** Public URL for a GIF in the given theme; null for unknown codes. */
export function kingGifUrl(code: string, theme: KingArtTheme): string | null {
  const def = GIF_BY_CODE.get(code);
  return def ? mediaUrl(`/gifs/${theme}/${def.file}`) : null;
}

/* ─── Reactions ──────────────────────────────────────────────────────────
   The five reaction keys are a server contract (routes/social.ts
   validates like/love/fire/clap/mindblown and stores the KEY) — the
   keys and semantics do not change. Only the art is ours now:

     like      → king-crown  the royal seal — Bow Down's mark of approval,
                             and the one glyph that reads at 20px in the
                             default (un-reacted) button.
     love      → king-love   heart-eyes King; the set's literal love face.
     fire      → king-hype   roaring King ringed in flames; the set's fire.
     clap      → king-bow    applause in this house is a bow — the King's
                             ovation, and the brand's own gesture.
     mindblown → king-wow    stunned, jaw-dropped King; the set's wow. */

export const REACTION_KEYS = ["like", "love", "fire", "clap", "mindblown"] as const;
export type ReactionKey = (typeof REACTION_KEYS)[number];

export const REACTION_ART: Readonly<Record<ReactionKey, { code: string; label: string }>> = {
  like: { code: "king-crown", label: "Like" },
  love: { code: "king-love", label: "Love" },
  fire: { code: "king-hype", label: "Fire" },
  clap: { code: "king-bow", label: "Clap" },
  mindblown: { code: "king-wow", label: "Mindblown" },
};

export function isReactionKey(key: string): key is ReactionKey {
  return (REACTION_KEYS as readonly string[]).includes(key);
}

/** Public URL of the custom art for a reaction key; null for unknown keys. */
export function reactionArtUrl(key: string, theme: KingArtTheme): string | null {
  if (!isReactionKey(key)) return null;
  return kingEmojiUrl(REACTION_ART[key].code, theme);
}

/* ─── Shortcode tokens ───────────────────────────────────────────────────
   `:king-laugh:` renders the sticker inline at text height;
   `:gif-king-bow:` renders the animated GIF. Unknown `:codes:` are
   NOT tokens — they pass through as literal text, untouched. */

export type KingTokenPart =
  | { type: "text"; value: string }
  | { type: "emoji"; code: string }
  | { type: "gif"; code: string };

const TOKEN_RE = new RegExp(
  `:(${[...KING_EMOJI.map((e) => e.code), ...KING_GIFS.map((g) => g.code)].join("|")}):`,
  "g",
);

/** Split a message body into text / sticker / GIF parts. */
export function parseKingTokens(body: string): KingTokenPart[] {
  const parts: KingTokenPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(body)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: body.slice(last, m.index) });
    const code = m[1];
    if (GIF_BY_CODE.has(code)) parts.push({ type: "gif", code });
    else parts.push({ type: "emoji", code });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ type: "text", value: body.slice(last) });
  if (parts.length === 0) parts.push({ type: "text", value: "" });
  return parts;
}

/** True when the body carries at least one live King/GIF token. */
export function hasKingTokens(body: string): boolean {
  return parseKingTokens(body).some((p) => p.type !== "text");
}

/** The token text for a manifest code, e.g. "king-laugh" → ":king-laugh:". */
export function kingToken(code: string): string {
  return `:${code}:`;
}

/**
 * Insert text (a token) at the caret of a controlled input/textarea value.
 * Pure — the caller applies the result and restores focus/caret.
 * `maxLength` clamps the way the hosts' own maxLength attributes do:
 * text is dropped rather than silently overflowing the cap.
 */
export function insertAtCursor(
  value: string,
  insert: string,
  selStart: number | null,
  selEnd: number | null,
  maxLength?: number,
): { value: string; caret: number } {
  const start = selStart ?? value.length;
  const end = selEnd ?? start;
  let next = value.slice(0, start) + insert + value.slice(end);
  let caret = start + insert.length;
  if (maxLength !== undefined && next.length > maxLength) {
    next = next.slice(0, maxLength);
    caret = Math.min(caret, maxLength);
  }
  return { value: next, caret };
}

/**
 * The Composer attachment a GIF insert produces — GIFs ride the site's
 * existing image-attachment path (the attach pipeline renders image
 * URLs end-to-end), never a bespoke upload.
 */
export function gifImageAttachment(
  code: string,
  theme: KingArtTheme,
): { kind: "image"; url: string } | null {
  const url = kingGifUrl(code, theme);
  return url ? { kind: "image", url } : null;
}
