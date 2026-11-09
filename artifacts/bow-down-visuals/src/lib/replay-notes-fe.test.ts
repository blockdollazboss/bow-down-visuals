/**
 * replay-notes-fe.test.ts — the replay-note surfacing contract
 * (follow-on lane f-replay-notes-fe).
 *
 * The CA-KEY + stored-results rails (join15) answer an identical
 * re-ask with the STORED result plus { replayed: true, replayNote } —
 * the server's own explanation that no second charge happened. Until
 * this lane, no screen read those fields: the same result simply
 * appeared again, unexplained.
 *
 * The contract pinned here, per surface:
 *  (a) the surface reads replayed/replayNote from ITS rail's response
 *      (through the seam reader where the surface has one);
 *  (b) the note renders verbatim from state in the surface's result
 *      area, under a stable testid;
 *  (c) every fresh run clears the note first, so a stale note can
 *      never dress up a fresh generation;
 *  (d) the note's words exist NOWHERE in the FE sources — server copy
 *      is the single source; the FE passes it through, never writes
 *      its own version.
 *
 * Queue verification (this lane): the bio-generator rail
 * (POST /api/generate-bio) has NO FE screen consumer — its callers
 * are the public API (/api/v1/generate/bio, documented in
 * DeveloperApiSettings) and the operator, both server-side, so there
 * is no bio surface to wire. The press-kit bio refresh is a different
 * rail (/api/press-kit/:id/regenerate-bio) and carries no replay
 * fields. Post Assist already surfaces its own replay note
 * (Composer + parsePostAssistReplayed) and is untouched.
 *
 * How this suite tests: vitest runs in node with no DOM harness, so
 * the reader behavior is unit-tested in the seam suites
 * (photo-desk.test.ts, create-desks.test.ts) and the component
 * wiring is pinned by source — the pattern enter-world-button.test.ts
 * and site-mode-theme.test.ts established.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const photoDesk = read("../lib/world/photo-desk.ts");
const createDesks = read("../lib/world/create-desks.ts");
const photoBenches = read("../components/world/native/PhotoBenches.tsx");
const thumbnailBenches = read("../components/world/native/ThumbnailBenches.tsx");
const bgSection = read("../components/editor/sections/BackgroundReplaceSection.tsx");
const thumbnailStudio = read("../pages/thumbnail-studio.tsx");

describe("the seam readers pass the server's note through, verbatim-only", () => {
  it("photo-desk exposes bgGenerateReplayNoteOf gated on the replayed flag", () => {
    expect(photoDesk).toContain("export function bgGenerateReplayNoteOf(data: unknown): string | null");
    expect(photoDesk).toContain("if (d.replayed !== true) return null;");
  });

  it("create-desks exposes thumbnailReplayNoteOfResponse gated on the replayed flag", () => {
    expect(createDesks).toContain(
      "export function thumbnailReplayNoteOfResponse(json: unknown): string | null",
    );
    expect(createDesks).toContain("if (d.replayed !== true) return null;");
  });
});

describe("World — the Photo Desk's Background Plate bench (bg-generate)", () => {
  it("reads the note through the seam reader on success", () => {
    expect(photoBenches).toContain("bgGenerateReplayNoteOf,");
    expect(photoBenches).toContain("setReplayNote(bgGenerateReplayNoteOf(data));");
  });

  it("clears the note at the start of every run", () => {
    expect(photoBenches).toContain("setReplayNote(null);");
  });

  it("renders the note verbatim in the result area", () => {
    expect(photoBenches).toContain('data-testid="world-photo-plate-replay-note"');
    expect(photoBenches).toContain(">{replayNote}</p>");
  });
});

describe("World — the Thumbnail Desk's maker bench (thumbnail-generator)", () => {
  it("reads the note through the seam reader on success", () => {
    expect(thumbnailBenches).toContain("thumbnailReplayNoteOfResponse,");
    expect(thumbnailBenches).toContain("setReplayNote(thumbnailReplayNoteOfResponse(data));");
  });

  it("clears the note at the start of every maker run", () => {
    expect(thumbnailBenches).toContain("setReplayNote(null);");
  });

  it("renders the note verbatim beside the batch note, in the result area", () => {
    expect(thumbnailBenches).toContain('data-testid="world-thumbnail-replay-note"');
    expect(thumbnailBenches).toContain(">{replayNote}</p>");
  });
});

describe("2D — the video editor's AI background panel (bg-generate)", () => {
  it("parses replayed + replayNote off the rail's response", () => {
    expect(bgSection).toContain("replayed?: boolean; replayNote?: string");
    expect(bgSection).toContain("if (data.replayed && data.replayNote) setAiReplayNote(data.replayNote);");
  });

  it("clears the note at the start of every generate attempt", () => {
    expect(bgSection).toContain("setAiReplayNote(null);");
  });

  it("renders the note verbatim in the AI panel's result area", () => {
    expect(bgSection).toContain('data-testid="wave9b-bg-ai-replay-note"');
    expect(bgSection).toContain("{aiReplayNote}");
  });
});

describe("2D — Thumbnail Studio's maker (thumbnail-generator)", () => {
  it("parses replayed + replayNote off the rail's response", () => {
    expect(thumbnailStudio).toContain("replayed?: boolean;");
    expect(thumbnailStudio).toContain("replayNote?: string;");
    expect(thumbnailStudio).toContain(
      "setReplayNote(data.replayed && data.replayNote ? data.replayNote : null);",
    );
  });

  it("clears the note at the start of every generate run", () => {
    expect(thumbnailStudio).toContain("setReplayNote(null);");
  });

  it("renders the note verbatim at the head of the results block", () => {
    expect(thumbnailStudio).toContain('data-testid="tg-replay-note"');
    expect(thumbnailStudio).toContain("{replayNote}");
  });
});

describe("server copy is the single source — the FE never writes the note", () => {
  /* The shared sentence every rail's note is built on. It must exist
     in the API rails only; any FE file carrying it has hard-coded a
     paraphrase source of truth. (This test file asserts on the
     sentence's fragments, never the sentence itself.) */
  const fragments = ["already made", "for this request — tweak"];
  const feSources: Array<[string, string]> = [
    ["photo-desk.ts", photoDesk],
    ["create-desks.ts", createDesks],
    ["PhotoBenches.tsx", photoBenches],
    ["ThumbnailBenches.tsx", thumbnailBenches],
    ["BackgroundReplaceSection.tsx", bgSection],
    ["thumbnail-studio.tsx", thumbnailStudio],
  ];
  for (const [name, src] of feSources) {
    it(`${name} carries no hard-coded replay-note words`, () => {
      for (const fragment of fragments) {
        expect(src).not.toContain(fragment);
      }
    });
  }
});
