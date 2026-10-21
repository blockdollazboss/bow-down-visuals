/**
 * Move Home draft building — pure logic pins. The honesty rules:
 * only connected accounts exist; only real priced content becomes
 * priced products; an existing profile keeps its slug; a step that
 * can't be drafted says why instead of faking content.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, db: {} };
});
vi.mock("../ai-clients", () => ({
  getOpenAI: () => { throw new Error("no ai in tests"); },
  getTextModel: () => "test-model",
  getPlainTranscribeModel: () => "test-model",
}));

import { buildDrafts, slugify, type MoveHomeContext } from "../move-home";

const EMPTY: MoveHomeContext = { profile: null, accounts: [], tracks: [], videos: [] };

describe("slugify", () => {
  it("makes url-safe handles and never returns an unusable one", () => {
    expect(slugify("Nova Reign!")).toBe("nova-reign");
    expect(slugify("  --DJ  Wave-- ")).toBe("dj-wave");
    expect(slugify("ab")).toBe("creator");
    expect(slugify("")).toBe("creator");
  });
});

describe("buildDrafts — honesty rules", () => {
  it("no connected accounts → no launch drafts, no derived links, honest blocker", () => {
    const { drafts, blocked } = buildDrafts(
      { displayName: "Nova Reign", socialLinks: { youtube: "https://youtube.com/@nova" } },
      EMPTY,
    );
    expect(drafts.launch_posts?.posts).toEqual([]);
    expect(blocked.launch_posts).toBe("no_connected_accounts");
    /* The creator's own typed link survives; nothing else appears */
    expect(drafts.profile?.socialLinks).toEqual({ youtube: "https://youtube.com/@nova" });
  });

  it("connected accounts derive links and launch drafts — and only those", () => {
    const ctx: MoveHomeContext = {
      ...EMPTY,
      accounts: [
        {
          platform: "tiktok",
          accountId: "11111111-1111-1111-1111-111111111111",
          username: "@novareign",
          pageId: null,
          pageName: null,
          label: "TikTok · @novareign",
          profileUrl: "https://www.tiktok.com/@novareign",
        },
      ],
      videos: [{ id: "v1", title: "Intro", videoUrl: "https://files.example/i.mp4", thumbnailUrl: null }],
    };
    const { drafts, blocked } = buildDrafts({ displayName: "Nova Reign" }, ctx);
    expect(drafts.profile?.socialLinks).toEqual({ tiktok: "https://www.tiktok.com/@novareign" });
    expect(drafts.launch_posts?.posts).toHaveLength(1);
    expect(drafts.launch_posts?.posts[0].mediaUrl).toBe("https://files.example/i.mp4");
    expect(blocked.launch_posts).toBeUndefined();
  });

  it("accounts but no media anywhere → needs_media, media stays null (never fabricated)", () => {
    const ctx: MoveHomeContext = {
      ...EMPTY,
      accounts: [
        {
          platform: "instagram",
          accountId: "22222222-2222-2222-2222-222222222222",
          username: "novareign",
          pageId: null,
          pageName: null,
          label: "Instagram · @novareign",
          profileUrl: "https://instagram.com/novareign",
        },
      ],
    };
    const { drafts, blocked } = buildDrafts({ displayName: "Nova Reign" }, ctx);
    expect(blocked.launch_posts).toBe("needs_media");
    expect(drafts.launch_posts?.posts[0].mediaUrl).toBeNull();
  });

  it("priced tracks become real products at their real prices; free tracks don't sell", () => {
    const ctx: MoveHomeContext = {
      ...EMPTY,
      profile: {
        id: "p1", slug: "nova-reign", displayName: "Nova Reign", bio: "", vertical: "music",
        socialLinks: {}, avatarUrl: null, bannerUrl: null,
      },
      tracks: [
        { id: "t1", title: "Midnight Run", audioUrl: "https://f/a.mp3", artworkUrl: null, downloadPriceCents: 199, isPublished: true },
        { id: "t2", title: "Freebie", audioUrl: "https://f/b.mp3", artworkUrl: null, downloadPriceCents: 0, isPublished: true },
      ],
    };
    const { drafts } = buildDrafts({}, ctx);
    expect(drafts.store?.products).toHaveLength(1);
    expect(drafts.store?.products[0]).toMatchObject({
      title: "Midnight Run", priceCents: 199, suggestedPrice: false, sourceTrackId: "t1",
    });
  });

  it("no priced content → one starter product, clearly a suggestion", () => {
    const { drafts } = buildDrafts({ displayName: "Nova Reign" }, EMPTY);
    expect(drafts.store?.products).toHaveLength(1);
    expect(drafts.store?.products[0].suggestedPrice).toBe(true);
    expect(drafts.store?.products[0].description).toContain("edit this description");
  });

  it("an existing profile keeps its slug even when answers ask for another", () => {
    const ctx: MoveHomeContext = {
      ...EMPTY,
      profile: {
        id: "p1", slug: "nova-reign", displayName: "Nova Reign", bio: "old", vertical: "music",
        socialLinks: {}, avatarUrl: null, bannerUrl: null,
      },
    };
    const { drafts, blocked } = buildDrafts({ handle: "brand-new-name" }, ctx);
    expect(drafts.profile?.slug).toBe("nova-reign");
    expect(drafts.profile?.updatesExisting).toBe(true);
    expect(blocked.store).toBeUndefined();
  });

  it("no profile → the store step says it needs the profile first", () => {
    const { blocked } = buildDrafts({ displayName: "Nova Reign" }, EMPTY);
    expect(blocked.store).toBe("needs_profile");
  });

  it("press kit top tracks come from the real catalog only", () => {
    const ctx: MoveHomeContext = {
      ...EMPTY,
      tracks: [
        { id: "t1", title: "One", audioUrl: "https://f/1.mp3", artworkUrl: null, downloadPriceCents: 0, isPublished: true },
      ],
    };
    const { drafts } = buildDrafts({ displayName: "Nova Reign" }, ctx);
    expect(drafts.press_kit?.topTracks).toEqual([{ title: "One", url: "https://f/1.mp3" }]);
  });
});

describe("buildDrafts — locale path", () => {
  it("composes the templates in the requested locale; the creator's data rides through untranslated", () => {
    const ctx: MoveHomeContext = {
      ...EMPTY,
      tracks: [
        { id: "t1", title: "Midnight Run", audioUrl: "https://f/a.mp3", artworkUrl: null, downloadPriceCents: 199, isPublished: true },
      ],
    };
    const { drafts } = buildDrafts(
      { displayName: "Nova Reign", genre: "soul trap", location: "Atlanta" },
      ctx,
      "es",
    );
    expect(drafts.profile?.bio).toContain("Nova Reign es un soul trap artista");
    expect(drafts.profile?.bio).toContain("con base en Atlanta");
    expect(drafts.store?.products[0].description).toBe(
      "Descarga oficial de \"Midnight Run\" de Nova Reign: tuya, directo de la fuente.",
    );
    expect(drafts.press_kit?.tagline).toBe("soul trap artista — kit de prensa oficial");
    expect(drafts.email_list?.name).toBe("Nova Reign — Círculo interno");
    expect(drafts.email_list?.welcomeSubject).toBe(
      "Ya estás dentro: bienvenido al círculo interno de Nova Reign",
    );
    expect(drafts.email_list?.welcomeBody).toContain("soul trap música");
    expect(drafts.email_list?.welcomeBody).toContain("bowdownvisuals.com/artist/nova-reign");
  });

  it("the creator's own words are never translated, in any locale", () => {
    const { drafts } = buildDrafts(
      {
        displayName: "Nova Reign",
        bioSeed: "I make soul trap for late-night drivers.",
        tagline: "Nova forever.",
        starterProductTitle: "Nova's Vault",
      },
      EMPTY,
      "ja",
    );
    expect(drafts.profile?.bio).toBe("I make soul trap for late-night drivers.");
    expect(drafts.press_kit?.tagline).toBe("Nova forever.");
    expect(drafts.store?.products[0].title).toBe("Nova's Vault");
  });

  it("the fallback creator name and lane noun come from the catalog", () => {
    const { drafts } = buildDrafts({}, EMPTY, "fr");
    expect(drafts.email_list?.name).toBe("Nouveau créateur — Cercle privé");
    expect(drafts.profile?.bio).toContain("Nouveau créateur est un artiste");
  });

  it("explicit en matches the default build exactly", () => {
    const answers = { displayName: "Nova Reign", genre: "soul trap", location: "Atlanta" };
    expect(buildDrafts(answers, EMPTY, "en")).toEqual(buildDrafts(answers, EMPTY));
  });

  it("launch captions compose in the drafting locale, hashtags stay the same tags", () => {
    const ctx: MoveHomeContext = {
      ...EMPTY,
      accounts: [
        {
          platform: "instagram",
          accountId: "22222222-2222-2222-2222-222222222222",
          username: "novareign",
          pageId: null,
          pageName: null,
          label: "Instagram · @novareign",
          profileUrl: "https://instagram.com/novareign",
        },
      ],
      videos: [{ id: "v1", title: "Intro", videoUrl: "https://files.example/i.mp4", thumbnailUrl: null }],
    };
    const { drafts } = buildDrafts({ displayName: "Nova Reign", genre: "soul trap" }, ctx, "de");
    const caption = drafts.launch_posts?.posts[0].caption ?? "";
    expect(caption).toContain("Ich bin umgezogen.");
    expect(caption).toContain("bowdownvisuals.com/artist/nova-reign");
    expect(drafts.launch_posts?.posts[0].hashtags).toBe("#MovedHome #IndependentCreator #soultrap");
  });
});
