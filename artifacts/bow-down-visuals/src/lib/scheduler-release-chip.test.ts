/**
 * scheduler-release-chip.test.ts — Stack-30 Lane E (E7).
 *
 * Migration 0143 (Lane D) stamps scheduled_posts.release_id from the
 * scheduler-from-release flow and the API DTO exposes it as
 * `releaseId: string | null` on ScheduledPostShape. The scheduler post
 * list now renders a small "From release" chip for stamped posts.
 *
 * This branch predates the DTO field, so the chip reads the field
 * TOLERANTLY through postReleaseId (lib/scheduler.ts): a post whose
 * serialized shape lacks releaseId entirely (pre-0143 rows) or carries
 * null (scheduled any other way) renders no chip and nothing breaks.
 * INTEGRATOR: post-merge (Lane D landed), ScheduledPostShape carries
 * releaseId as a required field — postReleaseId keeps working
 * unchanged, and the chip lights up on real stamped rows.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { postReleaseId } from "./scheduler";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const schedulerPageSource = read("../pages/scheduler.tsx");
const en = JSON.parse(read("../locales/en.json")) as {
  scheduler: Record<string, unknown>;
};

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("postReleaseId — the tolerant DTO read", () => {
  it("returns the id when the post carries one", () => {
    expect(postReleaseId({ releaseId: UUID })).toBe(UUID);
  });

  it("returns null for an explicit null (scheduled any other way)", () => {
    expect(postReleaseId({ releaseId: null })).toBeNull();
  });

  it("returns null when the field is absent entirely (pre-0143 shape)", () => {
    expect(postReleaseId({ id: "post_1", caption: "hello" })).toBeNull();
    expect(postReleaseId({ releaseId: undefined })).toBeNull();
  });

  it("returns null for empty or non-string junk instead of rendering it", () => {
    expect(postReleaseId({ releaseId: "" })).toBeNull();
    expect(postReleaseId({ releaseId: 42 })).toBeNull();
    expect(postReleaseId({ releaseId: { id: UUID } })).toBeNull();
  });
});

describe("the From release chip in the scheduler post list", () => {
  it("is defined once, gated on the tolerant read, and links to the release's home", () => {
    expect(schedulerPageSource).toContain("function FromReleaseChip");
    expect(schedulerPageSource).toContain("if (!postReleaseId(post)) return null;");
    expect(schedulerPageSource).toContain('href="/distribute"');
    expect(schedulerPageSource).toContain('t("scheduler.fromRelease")');
  });

  it("renders in all three post-list surfaces (queue, drafts, posted)", () => {
    const renders = schedulerPageSource.match(/<FromReleaseChip post=\{p\} \/>/g) ?? [];
    expect(renders).toHaveLength(3);
  });

  it("the chip's label exists in the english catalog", () => {
    expect(en.scheduler["fromRelease"]).toBe("From release");
  });
});
