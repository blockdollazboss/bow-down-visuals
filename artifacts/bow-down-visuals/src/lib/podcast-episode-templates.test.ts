/**
 * podcast-episode-templates.test.ts — Stack-100 A7: the Podcast desk
 * had NO templates at all while every sibling creation surface got
 * starters in the org/design waves. The registry in lib/podcast.ts is
 * the truth: the six named episode templates, each carrying a complete
 * segment structure (intro/hook/segments/outro with per-segment
 * guidance). The page renders the shelf FROM the registry and applies
 * through podcastTemplatePrefill — a pure prefill that never charges,
 * never submits, and never touches title/description/voices/music bed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PODCAST_EPISODE_TEMPLATES,
  PODCAST_SEGMENT_KIND_LABELS,
  buildPodcastTemplateScript,
  countUntaggedDialogueLines,
  estimatePodcastCost,
  getPodcastEpisodeTemplate,
  parseDialogueSpeakers,
  podcastTemplateMinutes,
  podcastTemplatePrefill,
  podcastTemplateSummary,
  type PodcastEpisodeTemplate,
} from "./podcast";

function readFe(rel: string): string {
  const url = new URL(`../${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

const page = readFe("components/audio-studio/PodcastStudio.tsx");
const lib = readFe("lib/podcast.ts");

const EXPECTED_IDS = [
  "interview",
  "solo-commentary",
  "news-roundup",
  "story-episode",
  "panel-discussion",
  "listener-qa",
] as const;

describe("A7 — podcast episode template registry", () => {
  it("carries exactly the six named templates, in shelf order, with unique ids", () => {
    expect(PODCAST_EPISODE_TEMPLATES.map((t) => t.id)).toEqual([...EXPECTED_IDS]);
    expect(new Set(PODCAST_EPISODE_TEMPLATES.map((t) => t.id)).size).toBe(6);
    for (const tpl of PODCAST_EPISODE_TEMPLATES) {
      expect(getPodcastEpisodeTemplate(tpl.id)).toBe(tpl);
      expect(tpl.name.length).toBeGreaterThan(0);
      expect(tpl.tagline.length).toBeGreaterThan(0);
      expect(tpl.description.length).toBeGreaterThan(0);
    }
    expect(getPodcastEpisodeTemplate("no-such-template")).toBeNull();
  });

  it("every template carries a complete segment structure: opens intro/hook, closes outro, has a body", () => {
    for (const tpl of PODCAST_EPISODE_TEMPLATES) {
      expect(tpl.segments.length, tpl.id).toBeGreaterThanOrEqual(5);
      expect(["intro", "hook"], tpl.id).toContain(tpl.segments[0]!.kind);
      expect(tpl.segments[tpl.segments.length - 1]!.kind, tpl.id).toBe("outro");
      expect(
        tpl.segments.some((s) => s.kind === "segment" || s.kind === "interview"),
        tpl.id,
      ).toBe(true);
      // Segment titles are chapter headings — unique within a template.
      const titles = tpl.segments.map((s) => s.title);
      expect(new Set(titles).size, tpl.id).toBe(titles.length);
    }
  });

  it("every segment carries real guidance, a positive minute guide, and a spoken starter line", () => {
    for (const tpl of PODCAST_EPISODE_TEMPLATES) {
      for (const seg of tpl.segments) {
        expect(seg.title.length, `${tpl.id}/${seg.title}`).toBeGreaterThan(0);
        expect(seg.guidance.length, `${tpl.id}/${seg.title}`).toBeGreaterThanOrEqual(30);
        expect(seg.minutes, `${tpl.id}/${seg.title}`).toBeGreaterThan(0);
        expect(PODCAST_SEGMENT_KIND_LABELS[seg.kind], `${tpl.id}/${seg.title}`).toBeTruthy();
        expect(seg.starterLines.length, `${tpl.id}/${seg.title}`).toBeGreaterThanOrEqual(1);
        for (const l of seg.starterLines) {
          expect(l.line.trim().length, `${tpl.id}/${seg.title}`).toBeGreaterThan(0);
          expect(l.line, `${tpl.id}/${seg.title}`).not.toMatch(/https?:\/\//);
        }
      }
    }
  });

  it("the registry between all templates uses every segment kind", () => {
    const kinds = new Set(PODCAST_EPISODE_TEMPLATES.flatMap((t) => t.segments.map((s) => s.kind)));
    expect([...kinds].sort()).toEqual(["hook", "interview", "intro", "outro", "segment"]);
  });
});

describe("A7 — template shapes match the form they prefill", () => {
  it("script templates are solo-host: format single, no speaker tags", () => {
    const scriptTpls = PODCAST_EPISODE_TEMPLATES.filter((t) => t.mode === "script");
    expect(scriptTpls.map((t) => t.id)).toEqual([
      "solo-commentary",
      "news-roundup",
      "story-episode",
      "listener-qa",
    ]);
    for (const tpl of scriptTpls) {
      expect(tpl.format).toBe("single");
      expect(tpl.speakers).toEqual([]);
      for (const seg of tpl.segments) {
        for (const l of seg.starterLines) expect(l.speaker).toBe("HOST");
      }
    }
  });

  it("dialogue templates carry 2+ speakers and leave the format control alone", () => {
    const dialogueTpls = PODCAST_EPISODE_TEMPLATES.filter((t) => t.mode === "dialogue");
    expect(dialogueTpls.map((t) => t.id)).toEqual(["interview", "panel-discussion"]);
    for (const tpl of dialogueTpls) {
      expect(tpl.format).toBeNull();
      expect(tpl.speakers.length).toBeGreaterThanOrEqual(2);
      // Every seeded speaker is declared, and every declared speaker speaks.
      const used = new Set(tpl.segments.flatMap((s) => s.starterLines.map((l) => l.speaker)));
      expect([...used].sort()).toEqual([...tpl.speakers].sort());
    }
  });
});

describe("A7 — the seeded script is the structure, in the rails' own format", () => {
  it("script templates seed one '# Heading' chapter per segment plus the spoken starter lines", () => {
    for (const tpl of PODCAST_EPISODE_TEMPLATES.filter((t) => t.mode === "script")) {
      const built = buildPodcastTemplateScript(tpl);
      const lines = built.split("\n").filter((l) => l.trim());
      const headings = lines.filter((l) => /^#{1,3}\s+/.test(l));
      expect(headings, tpl.id).toEqual(tpl.segments.map((s) => `# ${s.title}`));
      const spoken = lines.filter((l) => !/^#{1,3}\s+/.test(l));
      expect(spoken, tpl.id).toEqual(tpl.segments.flatMap((s) => s.starterLines.map((l) => l.line)));
      // The estimate the desk shows prices the seed like any script.
      expect(estimatePodcastCost(built).wordCount, tpl.id).toBeGreaterThan(0);
    }
  });

  it("dialogue templates seed a script the real dialogue parser reads back exactly", () => {
    for (const tpl of PODCAST_EPISODE_TEMPLATES.filter((t) => t.mode === "dialogue")) {
      const built = buildPodcastTemplateScript(tpl);
      // Speaker detection round-trips: same speakers, same order.
      expect(parseDialogueSpeakers(built), tpl.id).toEqual(tpl.speakers);
      // No dropped lines: headings are structure, every other line is tagged.
      expect(countUntaggedDialogueLines(built), tpl.id).toBe(0);
      const headings = built.split("\n").filter((l) => /^#{1,3}\s+/.test(l));
      expect(headings, tpl.id).toEqual(tpl.segments.map((s) => `# ${s.title}`));
    }
  });

  it("guidance is shelf-only — it never enters the seeded script (nothing instructional can be read aloud)", () => {
    for (const tpl of PODCAST_EPISODE_TEMPLATES) {
      const built = buildPodcastTemplateScript(tpl);
      for (const seg of tpl.segments) {
        expect(built, `${tpl.id}/${seg.title}`).not.toContain(seg.guidance);
      }
    }
  });
});

describe("A7 — prefill + summary are derived from the registry, never hand-copied", () => {
  it("podcastTemplatePrefill returns exactly the fields apply sets, per mode", () => {
    for (const tpl of PODCAST_EPISODE_TEMPLATES) {
      const prefill = podcastTemplatePrefill(tpl);
      const seeded = buildPodcastTemplateScript(tpl);
      expect(prefill.mode, tpl.id).toBe(tpl.mode);
      expect(prefill.format, tpl.id).toBe(tpl.format);
      if (tpl.mode === "script") {
        expect(prefill.script, tpl.id).toBe(seeded);
        expect(prefill.dialogueScript, tpl.id).toBeNull();
      } else {
        expect(prefill.script, tpl.id).toBeNull();
        expect(prefill.dialogueScript, tpl.id).toBe(seeded);
      }
    }
  });

  it("minutes and summary are computed from the segment list", () => {
    for (const tpl of PODCAST_EPISODE_TEMPLATES) {
      const minutes = tpl.segments.reduce((sum, s) => sum + s.minutes, 0);
      expect(podcastTemplateMinutes(tpl), tpl.id).toBe(minutes);
      expect(podcastTemplateSummary(tpl), tpl.id).toContain(`${tpl.segments.length} segments`);
      expect(podcastTemplateSummary(tpl), tpl.id).toContain(`~${minutes} min of structure`);
    }
    const interview = getPodcastEpisodeTemplate("interview")!;
    expect(podcastTemplateSummary(interview)).toBe("6 segments · ~30 min of structure · 2 voices");
    const solo = getPodcastEpisodeTemplate("solo-commentary")!;
    expect(podcastTemplateSummary(solo)).toContain("Solo host");
  });

  it("the registry module itself performs no fetch, charge, or submit", () => {
    expect(lib).not.toContain("fetch(");
    expect(lib).not.toContain("confirmedFetch");
  });
});

describe("A7 — the Podcast page renders the shelf from the registry", () => {
  it("imports the registry and renders one card per template from it", () => {
    expect(page).toContain("PODCAST_EPISODE_TEMPLATES");
    expect(page).toContain("PODCAST_EPISODE_TEMPLATES.map(");
    expect(page).toContain("podcast-template-shelf");
    expect(page).toContain("podcastTemplateSummary(template)");
    expect(page).toContain("PODCAST_SEGMENT_KIND_LABELS[segment.kind]");
  });

  it("apply routes through podcastTemplatePrefill and sets only the prefill fields", () => {
    expect(page).toContain("podcastTemplatePrefill(template)");
    expect(page).toContain("setMode(prefill.mode)");
    expect(page).toContain("setScript(prefill.script)");
    expect(page).toContain("setDialogueScript(prefill.dialogueScript)");
  });

  it("the shelf chrome speaks through the podcast.templates locale keys", () => {
    for (const key of ["title", "note", "apply", "applied"]) {
      expect(page).toContain(`podcast.templates.${key}`);
    }
  });

  it("carries no page-local copies of registry content", () => {
    // Segment titles and starter lines live ONLY in the registry.
    for (const copy of [
      "The Deep Dive",
      "Cold Open",
      "Rapid Fire",
      "Nobody is telling you the truth",
      "Hot Takes",
    ]) {
      expect(page).not.toContain(copy);
    }
  });
});
