/**
 * podcast-feed.test.ts — the feed validator for Lane F10.
 *
 * Pins three things:
 *  1. Well-formedness: the generated document parses under a strict
 *     stack checker (balanced tags, quoted attributes, no stray "<").
 *  2. Spec compliance: every tag Apple Podcasts / Spotify require is
 *     present with a legal value (channel identity, itunes owner /
 *     category / explicit / image; per-item guid uniqueness, pubDate,
 *     and enclosures with length > 0 and an audio/* type).
 *  3. Enclosure resolution: R2-proven objects get the direct CDN URL,
 *     others get the stable fallback door, and an episode whose byte
 *     size cannot be proven resolves to null (omitted, never length=0).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  APPLE_PODCAST_CATEGORIES,
  buildPodcastFeedXml,
  clearEnclosureCache,
  formatItunesDuration,
  mimeTypeForAudio,
  readPodcastFeedSettings,
  resolveEnclosure,
  writePodcastFeedSettings,
  type PodcastFeedEpisode,
  type PodcastFeedShow,
} from "../podcast-feed";

/* ── a small strict XML well-formedness checker (no parser dep) ────── */

function expectWellFormedXml(input: string): void {
  expect(input.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  const xml = input.slice(input.indexOf("?>") + 2);
  const stack: string[] = [];
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let sawRoot = false;
  while ((m = tagRe.exec(xml))) {
    const between = xml.slice(lastIndex, m.index);
    expect(between).not.toContain("<");
    lastIndex = tagRe.lastIndex;
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      expect(stack.pop()).toBe(name);
    } else if (!selfClosing) {
      stack.push(name!);
      sawRoot = true;
    }
  }
  expect(xml.slice(lastIndex)).not.toContain("<");
  expect(stack).toEqual([]);
  expect(sawRoot).toBe(true);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const SHOW: PodcastFeedShow = {
  title: "Creator Cheat Code",
  link: "https://bowdownvisuals.com/artist/creator-cheat-code",
  description: "How creators turn content into cash — weekly.",
  language: "en-us",
  author: "Alex Creator",
  ownerName: "Alex Creator",
  ownerEmail: "alex@example.com",
  artworkUrl: "https://cdn.example.com/art/show-3000.jpg",
  category: "Business",
  subcategory: "Entrepreneurship",
  explicit: false,
  feedUrl: "https://bowdownvisuals.com/api/podcast-feed/creator-cheat-code",
};

function episode(over: Partial<PodcastFeedEpisode> = {}): PodcastFeedEpisode {
  return {
    guid: "https://bowdownvisuals.com/track/11111111-1111-4111-8111-111111111111",
    title: "Ep 1 — The Hook",
    description: "Ep 1 — The Hook — Business",
    pubDate: new Date("2026-10-20T12:00:00Z"),
    durationSeconds: 754,
    explicit: false,
    enclosure: { url: "https://cdn.example.com/audio/ep1.mp3", length: 12_345_678, type: "audio/mpeg" },
    ...over,
  };
}

describe("buildPodcastFeedXml — well-formedness + spec shape", () => {
  const xml = buildPodcastFeedXml(SHOW, [episode(), episode({
    guid: "https://bowdownvisuals.com/track/22222222-2222-4222-8222-222222222222",
    title: "Ep 2 — Money & <Mistakes>",
    pubDate: new Date("2026-10-22T09:30:00Z"),
    durationSeconds: 3725,
    enclosure: { url: "https://bowdownvisuals.com/api/podcast-feed/creator-cheat-code/episodes/22222222-2222-4222-8222-222222222222.mp3", length: 59_876_543, type: "audio/mpeg" },
  })], new Date("2026-10-23T00:00:00Z"));

  it("is well-formed XML with rss 2.0 + itunes/atom namespaces", () => {
    expectWellFormedXml(xml);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"');
    expect(xml).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
  });

  it("carries every channel-level tag Apple requires, exactly once", () => {
    for (const tag of [
      "<title>Creator Cheat Code</title>",
      "<link>https://bowdownvisuals.com/artist/creator-cheat-code</link>",
      "<language>en-us</language>",
      "<itunes:author>Alex Creator</itunes:author>",
      "<itunes:explicit>false</itunes:explicit>",
      '<itunes:image href="https://cdn.example.com/art/show-3000.jpg"/>',
      "<itunes:email>alex@example.com</itunes:email>",
      'rel="self"',
    ]) {
      expect(xml).toContain(tag);
    }
    expect(countOccurrences(xml, "<channel>")).toBe(1);
    expect(countOccurrences(xml, "<itunes:owner>")).toBe(1);
    expect(countOccurrences(xml, "<title>")).toBe(4); // channel + image + 2 items
  });

  it("nests the subcategory inside its category", () => {
    expect(xml).toContain(
      '<itunes:category text="Business">\n      <itunes:category text="Entrepreneurship"/>',
    );
  });

  it("escapes XML in titles/descriptions (no raw < or & from user text)", () => {
    expect(xml).toContain("Ep 2 — Money &amp; &lt;Mistakes&gt;");
    expect(xml).not.toContain("Money & <Mistakes>");
  });

  it("every item has a unique permalink guid, an RFC-822 pubDate, and a valid enclosure", () => {
    const guids = [...xml.matchAll(/<guid isPermaLink="true">([^<]+)<\/guid>/g)].map((g) => g[1]);
    expect(guids.length).toBe(2);
    expect(new Set(guids).size).toBe(2);
    const pubDates = [...xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((g) => g[1]!);
    for (const d of pubDates) expect(Number.isNaN(Date.parse(d))).toBe(false);
    const enclosures = [...xml.matchAll(/<enclosure url="([^"]+)" length="(\d+)" type="([^"]+)"\/>/g)];
    expect(enclosures.length).toBe(2);
    for (const [, url, length, type] of enclosures) {
      expect(url).toMatch(/^https:\/\//);
      expect(Number(length)).toBeGreaterThan(0);
      expect(type).toMatch(/^audio\//);
    }
  });

  it("drops a subcategory that does not belong to the category", () => {
    const bad = buildPodcastFeedXml(
      { ...SHOW, category: "Technology", subcategory: "Entrepreneurship" },
      [episode()],
    );
    expect(bad).toContain('<itunes:category text="Technology"/>');
    expect(bad).not.toContain("Entrepreneurship");
  });

  it("escapes ampersands inside category attributes (Health & Fitness)", () => {
    const hf = buildPodcastFeedXml({ ...SHOW, category: "Health & Fitness", subcategory: "Mental Health" }, [episode()]);
    expectWellFormedXml(hf);
    expect(hf).toContain('<itunes:category text="Health &amp; Fitness">');
  });

  it("omits itunes:owner and itunes:image when their data is absent", () => {
    const bare = buildPodcastFeedXml(
      { ...SHOW, ownerEmail: undefined, artworkUrl: undefined },
      [episode()],
    );
    expectWellFormedXml(bare);
    expect(bare).not.toContain("<itunes:owner>");
    expect(bare).not.toContain("<itunes:image");
  });
});

describe("formatItunesDuration", () => {
  it("formats M:SS under an hour and H:MM:SS above it", () => {
    expect(formatItunesDuration(0)).toBe("0:00");
    expect(formatItunesDuration(65)).toBe("1:05");
    expect(formatItunesDuration(754)).toBe("12:34");
    expect(formatItunesDuration(3725)).toBe("1:02:05");
  });
});

describe("show settings in theme_config", () => {
  it("round-trips through write → read", () => {
    const theme = writePodcastFeedSettings({ colors: { bg: "#000" } }, {
      title: "My Show",
      category: "Comedy",
      subcategory: "Improv",
      explicit: true,
    });
    expect((theme as any)["colors"]).toEqual({ bg: "#000" });
    expect(readPodcastFeedSettings(theme)).toEqual({
      title: "My Show",
      category: "Comedy",
      subcategory: "Improv",
      explicit: true,
    });
  });

  it("drops an unknown category and non-boolean explicit on read", () => {
    const read = readPodcastFeedSettings({
      podcastFeed: { category: "Not A Category", explicit: "yes", title: "  T  " },
    });
    expect(read.category).toBeUndefined();
    expect(read.explicit).toBeUndefined();
    expect(read.title).toBe("T");
  });

  it("every default category exists in the Apple tree", () => {
    expect(APPLE_PODCAST_CATEGORIES["Arts"]).toBeDefined();
    expect(Object.keys(APPLE_PODCAST_CATEGORIES).length).toBeGreaterThanOrEqual(19);
  });
});

describe("mimeTypeForAudio", () => {
  it("prefers a real audio/* head type, else maps the extension", () => {
    expect(mimeTypeForAudio("r2://generated-clips/x/ep.mp3", "audio/mpeg")).toBe("audio/mpeg");
    expect(mimeTypeForAudio("https://x/ep.m4a?sig=1", null)).toBe("audio/x-m4a");
    expect(mimeTypeForAudio("https://x/ep.wav", "text/html")).toBe("audio/wav");
    expect(mimeTypeForAudio("https://x/ep", null)).toBe("audio/mpeg");
  });
});

describe("resolveEnclosure", () => {
  const track = { id: "t1", audioUrl: "r2://generated-clips/u1/podcast/ep1.mp3" };
  const fallback = "https://bowdownvisuals.com/api/podcast-feed/show/episodes/t1.mp3";

  beforeEach(() => clearEnclosureCache());

  it("uses the direct CDN URL when the object is proven in R2", async () => {
    const enc = await resolveEnclosure(track, fallback, {
      headR2: async () => ({ size: 999, contentType: "audio/mpeg" }),
      refreshUrl: async () => { throw new Error("must not be called"); },
      rangeProbe: async () => { throw new Error("must not be called"); },
      cdnBase: "https://cdn.example.com",
      isR2: true,
    });
    expect(enc).toEqual({
      url: "https://cdn.example.com/generated-clips/u1/podcast/ep1.mp3",
      length: 999,
      type: "audio/mpeg",
    });
  });

  it("falls back to the stable door when there is no CDN base", async () => {
    const enc = await resolveEnclosure(track, fallback, {
      headR2: async () => ({ size: 5, contentType: null }),
      refreshUrl: async (r) => r,
      rangeProbe: async () => null,
      cdnBase: "",
      isR2: true,
    });
    expect(enc?.url).toBe(fallback);
    expect(enc?.length).toBe(5);
  });

  it("probes via Range when the object is not in R2, and still uses the door (signed URLs expire)", async () => {
    const enc = await resolveEnclosure(track, fallback, {
      headR2: async () => null,
      refreshUrl: async () => "https://signed.example.com/ep1.mp3?token=abc",
      rangeProbe: async () => 4242,
      cdnBase: "https://cdn.example.com",
      isR2: true,
    });
    expect(enc).toEqual({ url: fallback, length: 4242, type: "audio/mpeg" });
  });

  it("resolves null when no truthful length exists", async () => {
    const enc = await resolveEnclosure(track, fallback, {
      headR2: async () => null,
      refreshUrl: async () => "supabase://generated-clips/u1/podcast/ep1.mp3",
      rangeProbe: async () => null,
      cdnBase: "",
      isR2: false,
    });
    expect(enc).toBeNull();
  });

  it("caches per track+ref (deps run once)", async () => {
    let heads = 0;
    const deps = {
      headR2: async () => { heads++; return { size: 7, contentType: null }; },
      refreshUrl: async (r: string) => r,
      rangeProbe: async () => null,
      cdnBase: "",
      isR2: true,
    };
    await resolveEnclosure(track, fallback, deps);
    await resolveEnclosure(track, fallback, deps);
    expect(heads).toBe(1);
  });
});
