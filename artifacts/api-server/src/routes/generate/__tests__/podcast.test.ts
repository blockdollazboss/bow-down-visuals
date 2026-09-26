/**
 * Money-integrity and logic tests for the AI Podcast Studio.
 *
 * Covers: per-10-minute pricing, word-count duration estimates, script
 * parsing (dual-host speaker prefixes + chapter extraction), TTS chunking
 * at sentence boundaries, RSS feed generation, and timestamp formatting.
 */
import { describe, expect, it } from "vitest";
import {
  PODCAST_CREDITS_PER_10MIN,
  SECONDS_PER_BLOCK,
  WORDS_PER_MINUTE,
  MAX_SCRIPT_CHARS,
  estimatePodcastCost,
  estimatePodcastCostFromSeconds,
  parseScript,
  chunkText,
  buildPodcastRss,
  formatTimestamp,
  synthMusicBed,
} from "../podcast";

describe("PODCAST_CREDITS_PER_10MIN", () => {
  it("charges 3 credits per 10 minutes of audio", () => {
    expect(PODCAST_CREDITS_PER_10MIN).toBe(3);
    expect(SECONDS_PER_BLOCK).toBe(600);
  });
});

describe("estimatePodcastCost", () => {
  it("estimates 1500 words as 10 minutes = 1 block = 3 credits", () => {
    const words = new Array(1500).fill("word").join(" ");
    const est = estimatePodcastCost(words);
    expect(est.wordCount).toBe(1500);
    expect(est.estimatedSeconds).toBe(600);
    expect(est.billableBlocks).toBe(1);
    expect(est.credits).toBe(3);
  });

  it("rounds partial blocks up (1501 words = 2 blocks = 6 credits)", () => {
    const words = new Array(1501).fill("word").join(" ");
    const est = estimatePodcastCost(words);
    expect(est.billableBlocks).toBe(2);
    expect(est.credits).toBe(6);
  });

  it("enforces a 1-block minimum charge for tiny scripts", () => {
    const est = estimatePodcastCost("Hello world");
    expect(est.billableBlocks).toBe(1);
    expect(est.credits).toBe(PODCAST_CREDITS_PER_10MIN);
  });

  it("scales for long scripts (4500 words = 30 min = 3 blocks = 9 credits)", () => {
    const words = new Array(4500).fill("word").join(" ");
    const est = estimatePodcastCost(words);
    expect(est.billableBlocks).toBe(3);
    expect(est.credits).toBe(9);
  });

  it("handles empty scripts", () => {
    const est = estimatePodcastCost("   ");
    expect(est.wordCount).toBe(0);
    expect(est.billableBlocks).toBe(1);
  });
});

describe("estimatePodcastCostFromSeconds", () => {
  it("bills a 5-minute video as 1 block", () => {
    const est = estimatePodcastCostFromSeconds(300);
    expect(est.billableBlocks).toBe(1);
    expect(est.credits).toBe(3);
  });

  it("bills a 25-minute video as 3 blocks", () => {
    const est = estimatePodcastCostFromSeconds(1500);
    expect(est.billableBlocks).toBe(3);
    expect(est.credits).toBe(9);
  });
});

describe("parseScript", () => {
  it("parses HOST:/COHOST: prefixes in dual format", () => {
    const { segments } = parseScript(
      "HOST: Welcome to the show.\n\nCOHOST: Thanks for having me.",
      "dual",
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ speaker: "host", text: "Welcome to the show." });
    expect(segments[1]).toEqual({ speaker: "cohost", text: "Thanks for having me." });
  });

  it("alternates paragraphs by speaker in dual format without prefixes", () => {
    const { segments } = parseScript("First para.\n\nSecond para.", "dual");
    expect(segments).toHaveLength(2);
    expect(segments[0]!.speaker).toBe("host");
    expect(segments[1]!.speaker).toBe("cohost");
  });

  it("forces everything to host in single format", () => {
    const { segments } = parseScript(
      "HOST: Hello.\n\nCOHOST: Hi there.",
      "single",
    );
    expect(segments.every((s) => s.speaker === "host")).toBe(true);
  });

  it("extracts # headings as chapters with estimated timestamps", () => {
    const script = `# Intro\n\n${new Array(150).fill("word").join(" ")}\n\n# Main topic\n\nMore words here.`;
    const { chapters } = parseScript(script, "single");
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.title).toBe("Intro");
    expect(chapters[0]!.startSeconds).toBe(0);
    // 150 words at 150wpm ≈ 60s
    expect(chapters[1]!.title).toBe("Main topic");
    expect(chapters[1]!.startSeconds).toBe(60);
  });

  it("supports GUEST: as a co-host alias", () => {
    const { segments } = parseScript("GUEST: Great to be here.", "dual");
    expect(segments[0]).toEqual({ speaker: "cohost", text: "Great to be here." });
  });
});

describe("chunkText", () => {
  it("returns short text unchanged", () => {
    expect(chunkText("Hello world.")).toEqual(["Hello world."]);
  });

  it("splits long text at sentence boundaries under the limit", () => {
    const sentence = "This is a sentence. ";
    const long = sentence.repeat(200); // ~4000 chars
    const chunks = chunkText(long, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(2000);
    }
    // no words lost
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toBe(
      long.replace(/\s+/g, " ").trim(),
    );
  });
});

describe("buildPodcastRss", () => {
  it("produces valid RSS 2.0 with the episode enclosure", () => {
    const rss = buildPodcastRss({
      title: "Episode 1",
      description: "Our first episode",
      audioUrl: "https://example.com/ep1.mp3",
      durationSeconds: 600,
      pubDate: new Date("2026-09-25T12:00:00Z"),
      chapters: [{ title: "Intro", startSeconds: 0 }],
    });
    expect(rss).toContain('<rss version="2.0"');
    expect(rss).toContain("<title>Episode 1</title>");
    expect(rss).toContain('url="https://example.com/ep1.mp3"');
    expect(rss).toContain("<itunes:duration>600</itunes:duration>");
    expect(rss).toContain("0:00 — Intro");
  });

  it("escapes XML special characters", () => {
    const rss = buildPodcastRss({
      title: 'Fish & "Chips" <yum>',
      description: "",
      audioUrl: "https://example.com/ep.mp3",
      durationSeconds: 60,
      pubDate: new Date(),
      chapters: [],
    });
    expect(rss).toContain("Fish &amp; &quot;Chips&quot; &lt;yum&gt;");
  });
});

describe("formatTimestamp", () => {
  it("formats seconds as m:ss", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(600)).toBe("10:00");
  });
});

describe("MAX_SCRIPT_CHARS", () => {
  it("caps scripts at roughly 40 minutes of audio", () => {
    expect(MAX_SCRIPT_CHARS).toBe(36_000);
    expect(WORDS_PER_MINUTE).toBe(150);
  });
});

// synthMusicBed is intentionally not unit-tested here — it shells out to
// ffmpeg and is covered by the manual integration path, not vitest.
void synthMusicBed;
