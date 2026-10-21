/**
 * king-emoji.test.ts — the owner's custom emoji + GIF sets.
 *
 * Pins the wiring contract:
 *  (a) the manifest matches the shipped assets on disk, per theme —
 *      and the King Wave slot stays honestly empty (never generated);
 *  (b) the five server reaction keys map to the King's art in BOTH
 *      themes (keys/semantics are the server's contract, untouched);
 *  (c) :shortcode: parsing lights up known stickers/GIFs and passes
 *      unknown codes through as literal text, byte-for-byte;
 *  (d) tray insertion mechanics (kingToken + insertAtCursor) write the
 *      token into a draft at the caret, clamped to the host's cap;
 *  (e) GIF insert for the post Composer is an IMAGE ATTACHMENT
 *      descriptor — it rides the existing attachment path;
 *  (f) every named surface — and the shared renderer/tray components
 *      themselves — is wired by source contract. (The house vitest
 *      setup has no tsx transform, so components are pinned by source
 *      and the pure lib carries the behavior, per house convention.)
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  KING_EMOJI,
  KING_GIFS,
  REACTION_ART,
  REACTION_KEYS,
  gifImageAttachment,
  hasKingTokens,
  insertAtCursor,
  isReactionKey,
  kingEmojiUrl,
  kingGifUrl,
  kingToken,
  parseKingTokens,
  reactionArtUrl,
  type KingTokenPart,
} from "@/lib/king-emoji";

const pub = (rel: string) => new URL(`../../public/${rel}`, import.meta.url);
const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

function partsToText(parts: KingTokenPart[]): string {
  return parts
    .map((p) => (p.type === "text" ? p.value : `:${p.code}:`))
    .join("");
}

describe("manifest ↔ shipped assets", () => {
  it("has the full 12-sticker + 3-GIF sets, and NO wave anywhere", () => {
    expect(KING_EMOJI).toHaveLength(12);
    expect(KING_GIFS).toHaveLength(3);
    const allCodes = [...KING_EMOJI.map((e) => e.code), ...KING_GIFS.map((g) => g.code)];
    expect(allCodes.some((c) => c.includes("wave"))).toBe(false);
  });

  it("every manifest file exists under public/ in BOTH themes", () => {
    for (const theme of ["dark", "light"] as const) {
      for (const e of KING_EMOJI) {
        expect(existsSync(pub(`emoji/${theme}/${e.file}`)), `${theme}/${e.file}`).toBe(true);
      }
      for (const g of KING_GIFS) {
        expect(existsSync(pub(`gifs/${theme}/${g.file}`)), `${theme}/${g.file}`).toBe(true);
      }
    }
  });

  it("robe-free icons (and the coin-spin GIF) are byte-identical across themes — shared files", () => {
    for (const f of ["king-crown.webp", "king-coin.webp", "king-mic.webp", "king-fin.webp"]) {
      const dark = readFileSync(pub(`emoji/dark/${f}`));
      const light = readFileSync(pub(`emoji/light/${f}`));
      expect(dark.equals(light), f).toBe(true);
    }
    const darkGif = readFileSync(pub("gifs/dark/vb-coin-spin.gif"));
    const lightGif = readFileSync(pub("gifs/light/vb-coin-spin.gif"));
    expect(darkGif.equals(lightGif)).toBe(true);
  });

  it("the robed faces DIFFER across themes — light serves the cream-robed King", () => {
    for (const f of ["king-laugh.webp", "king-love.webp", "king-bow.webp"]) {
      const dark = readFileSync(pub(`emoji/dark/${f}`));
      const light = readFileSync(pub(`emoji/light/${f}`));
      expect(dark.equals(light), f).toBe(false);
    }
  });
});

describe("reaction art mapping (server keys unchanged)", () => {
  it("maps each of the five keys to its King sticker, per theme", () => {
    const expected: Record<string, string> = {
      like: "king-crown",
      love: "king-love",
      fire: "king-hype",
      clap: "king-bow",
      mindblown: "king-wow",
    };
    expect([...REACTION_KEYS].sort()).toEqual(Object.keys(expected).sort());
    for (const key of REACTION_KEYS) {
      expect(REACTION_ART[key].code).toBe(expected[key]);
      expect(reactionArtUrl(key, "dark")).toBe(`/emoji/dark/${expected[key]}.webp`);
      expect(reactionArtUrl(key, "light")).toBe(`/emoji/light/${expected[key]}.webp`);
    }
  });

  it("rejects unknown keys instead of inventing art", () => {
    expect(isReactionKey("wave")).toBe(false);
    expect(reactionArtUrl("wave", "dark")).toBeNull();
    expect(reactionArtUrl("", "light")).toBeNull();
  });

  it("ReactionSticker renders exactly reactionArtUrl's mapping (source contract)", () => {
    const king = src("components/social/KingEmoji.tsx");
    expect(king).toContain("REACTION_ART");
    expect(king).toContain("kingEmojiUrl(art.code");
    // every key's art is a real manifest sticker
    for (const key of REACTION_KEYS) {
      expect(KING_EMOJI.some((e) => e.code === REACTION_ART[key].code), key).toBe(true);
    }
  });
});

describe("shortcode parsing", () => {
  it("passes plain text through untouched", () => {
    const parts = parseKingTokens("just words, no tokens");
    expect(parts).toEqual([{ type: "text", value: "just words, no tokens" }]);
    expect(hasKingTokens("just words")).toBe(false);
  });

  it("splits a sticker out of running text", () => {
    const parts = parseKingTokens("that set was :king-laugh: fr");
    expect(parts).toEqual([
      { type: "text", value: "that set was " },
      { type: "emoji", code: "king-laugh" },
      { type: "text", value: " fr" },
    ]);
    expect(partsToText(parts)).toBe("that set was :king-laugh: fr");
  });

  it("splits a GIF token", () => {
    const parts = parseKingTokens(":gif-king-bow:");
    expect(parts).toEqual([{ type: "gif", code: "gif-king-bow" }]);
  });

  it("handles adjacent tokens and tokens at both ends", () => {
    const body = ":king-crown: mid :king-coin::gif-vb-coin-spin:";
    const parts = parseKingTokens(body);
    expect(parts.filter((p) => p.type !== "text")).toHaveLength(3);
    expect(partsToText(parts)).toBe(body);
  });

  it("unknown codes pass through byte-for-byte — incl. the never-generated wave", () => {
    for (const body of [
      "gg :wave: wp",
      ":king-wave:",
      "fire :fire: post",
      ":king-laugh", // unterminated
      "a:b c:d:",
      ":king-laugh: and :nope: mix",
    ]) {
      const parts = parseKingTokens(body);
      expect(partsToText(parts), body).toBe(body);
      if (!body.includes(":king-laugh:")) {
        expect(parts.every((p) => p.type === "text"), body).toBe(true);
      }
    }
    // the one real token in the mix still lights up; the fake stays text
    const mixed = parseKingTokens(":king-laugh: and :nope: mix");
    expect(mixed).toContainEqual({ type: "emoji", code: "king-laugh" });
    expect(mixed).toContainEqual({ type: "text", value: " and :nope: mix" });
  });

  it("the shared renderer maps parts to themed art; RichText runs bodies through it (source contracts)", () => {
    const king = src("components/social/KingEmoji.tsx");
    // KingTokenText: emoji parts → KingSticker, gif parts → themed GIF url
    expect(king).toContain("parseKingTokens(body)");
    expect(king).toContain("kingGifUrl(p.code, t)");
    // RichText pushes its plain-text runs through the same tokenizer
    const rich = src("components/social/RichText.tsx");
    expect(rich).toContain("parseKingTokens(text)");
    expect(rich).toContain("<KingSticker");
    expect(rich).toContain("kingGifUrl(p.kingGif, theme)");
    // theme resolution is the site switch, not a local guess
    expect(king).toContain("useIsLightTheme");
  });
});

describe("tray insertion mechanics", () => {
  it("kingToken writes the wire format", () => {
    expect(kingToken("king-laugh")).toBe(":king-laugh:");
    expect(kingToken("gif-king-bow")).toBe(":gif-king-bow:");
  });

  it("inserts at the caret and reports the new caret", () => {
    const r = insertAtCursor("hello world", ":king-cool:", 5, 5);
    expect(r.value).toBe("hello:king-cool: world");
    expect(r.caret).toBe(5 + ":king-cool:".length);
  });

  it("replaces a selection, and appends when no caret is known", () => {
    expect(insertAtCursor("hello world", ":king-fin:", 6, 11).value).toBe("hello :king-fin:");
    expect(insertAtCursor("hey", ":king-mic:", null, null).value).toBe("hey:king-mic:");
  });

  it("clamps to the host cap instead of overflowing it", () => {
    const r = insertAtCursor("x".repeat(495), ":king-laugh:", 495, 495, 500);
    expect(r.value).toHaveLength(500);
    expect(r.caret).toBe(500);
  });

  it("the tray hands picks to the host as tokens / GIF claims (source contract)", () => {
    const king = src("components/social/KingEmoji.tsx");
    expect(king).toContain('data-testid="king-emoji-tray-button"');
    expect(king).toContain('kingEmojiUrl("king-laugh", theme)');
    // sticker pick → token to the host; GIF pick → attachment claim first, token fallback
    expect(king).toContain("onPickToken(kingToken(e.code))");
    expect(king).toContain("if (onPickGif && onPickGif(gif))");
    expect(king).toContain("onPickToken(kingToken(gif.code))");
    // the tray is fed by the manifest, theme's set — not a hard-coded grid
    expect(king).toContain("KING_EMOJI.map");
    expect(king).toContain("KING_GIFS.map");
    expect(king).toContain("kingEmojiUrl(e.code, theme)");
    expect(king).toContain("kingGifUrl(g.code, theme)");
  });
});

describe("GIF insert rides the image-attachment path", () => {
  it("produces an image attachment descriptor with the themed URL", () => {
    expect(gifImageAttachment("gif-king-bow", "dark")).toEqual({
      kind: "image",
      url: "https://pub-424304b1e8d24fa28e3a072be022c74b.r2.dev/gifs/dark/king-bow.gif",
    });
    expect(gifImageAttachment("gif-vb-coin-spin", "light")).toEqual({
      kind: "image",
      url: "https://pub-424304b1e8d24fa28e3a072be022c74b.r2.dev/gifs/light/vb-coin-spin.gif",
    });
    expect(gifImageAttachment("gif-king-wave", "dark")).toBeNull();
  });

  it("URL resolvers refuse unknown codes", () => {
    expect(kingEmojiUrl("king-wave", "dark")).toBeNull();
    expect(kingGifUrl("gif-king-wave", "light")).toBeNull();
    expect(kingEmojiUrl("king-laugh", "light")).toBe("/emoji/light/king-laugh.webp");
    expect(kingGifUrl("gif-king-laugh", "dark")).toBe("https://pub-424304b1e8d24fa28e3a072be022c74b.r2.dev/gifs/dark/king-laugh.gif");
  });
});

describe("surface wiring (source contracts)", () => {
  it("PostCard renders King art for reactions — no stock glyphs remain", () => {
    const postCard = src("components/social/PostCard.tsx");
    expect(postCard).toContain("ReactionSticker");
    expect(postCard).toContain("REACTION_KEYS");
    for (const glyph of ["❤️", "😍", "🔥", "👏", "🤯", "🤍"]) {
      expect(postCard.includes(glyph), glyph).toBe(false);
    }
  });

  it("Composer carries the tray; GIFs claim the attachment path, replies fall back to tokens", () => {
    const composer = src("components/social/Composer.tsx");
    expect(composer).toContain("<EmojiTray");
    expect(composer).toContain("insertAtCursor");
    expect(composer).toContain("gifImageAttachment");
    expect(composer).toContain("addAttachment(att)");
    expect(composer).toContain("if (replyTo) return false");
  });

  it("stream chat renders tokens and carries the tray (dark set pinned)", () => {
    const chat = src("components/live/LiveChatPanel.tsx");
    expect(chat).toContain("<EmojiTray");
    expect(chat).toContain("KingTokenText");
    expect(chat).toContain('theme="dark"');
  });

  it("world say box + say log are wired", () => {
    const world = src("pages/world.tsx");
    expect(world).toContain("<EmojiTray");
    expect(world).toContain("KingTokenText");
    expect(world).toContain("insertSayToken");
  });

  it("DMs are wired on the messages page and at the palace Post Office desk", () => {
    const messages = src("pages/messages.tsx");
    expect(messages).toContain("<EmojiTray");
    expect(messages).toContain("KingTokenText");
    const desk = src("components/world/native/SocialDesk.tsx");
    expect(desk).toContain("<EmojiTray");
    expect(desk).toContain("KingTokenText");
    expect(desk).toContain("ReactionSticker");
  });

  it("the server reaction contract is untouched (api-server validates the same five keys)", () => {
    const social = readFileSync(
      new URL("../../../api-server/src/routes/social.ts", import.meta.url),
      "utf8",
    );
    for (const key of ["like", "love", "fire", "clap", "mindblown"]) {
      expect(social).toContain(`"${key}"`);
    }
  });
});
