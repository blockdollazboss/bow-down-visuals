/**
 * reports.test.ts — pins the member content-report seam (Stack-4 #3).
 *
 * The behavior half (filing, resolution, idempotency, the admin
 * workflow) is pinned over HTTP by the api-server's
 * content-reports.test.ts. This file pins the client half:
 *
 *  - REPORT_REASONS is EXACTLY the server's fixed vocabulary
 *    (CONTENT_REPORT_REASONS in lib/db/src/schema/content-reports.ts)
 *    — the route 400s anything else, so drift here means every
 *    filing from a drifted dialog fails;
 *  - submitReport speaks the rail's wire shape (snake_case
 *    target_type/target_id), omits a blank note, returns the
 *    duplicate flag, and throws the SERVER's error message — the
 *    dialog shows it verbatim and never claims success on a throw;
 *  - canSubmitReport gates the dialog's submit (reason chosen, not
 *    already sending/filed, retry allowed from the error phase);
 *  - the dialog is docked in the four existing surfaces — PostCard's
 *    action row (post vs comment keyed on kind), the media comment
 *    rows, the Shout Wall, the profile action row — and the admin
 *    queue sits beside the DMCA inbox with the same load-honesty
 *    (error card + retry, never a fake-empty list).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  canSubmitReport,
  submitReport,
} from "./reports";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const getToken = async () => "test-token";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("REPORT_REASONS — the server's vocabulary, mirrored exactly", () => {
  it("matches the route's fixed category list in order", () => {
    expect([...REPORT_REASONS]).toEqual([
      "spam",
      "harassment",
      "hate_speech",
      "violence",
      "sexual_content",
      "copyright",
      "scam",
      "other",
    ]);
  });

  it("gives every reason a plain-language label", () => {
    for (const reason of REPORT_REASONS) {
      expect(REPORT_REASON_LABELS[reason]?.length).toBeGreaterThan(0);
    }
  });
});

describe("canSubmitReport — the dialog's submit gate", () => {
  it("needs a reason and a submittable phase", () => {
    expect(canSubmitReport(null, "form")).toBe(false);
    expect(canSubmitReport("spam", "form")).toBe(true);
    expect(canSubmitReport("spam", "submitting")).toBe(false);
    expect(canSubmitReport("spam", "success")).toBe(false);
  });

  it("allows a retry from the error phase (failure never locks the form)", () => {
    expect(canSubmitReport("spam", "error")).toBe(true);
    expect(canSubmitReport(null, "error")).toBe(false);
  });
});

describe("submitReport — the wire contract", () => {
  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts snake_case fields to /api/reports and returns the filed report", async () => {
    const fetchMock = stubFetch(201, {
      report: { id: "r1", status: "new", targetType: "post" },
    });
    const result = await submitReport(getToken, {
      targetType: "post",
      targetId: "00000000-0000-4000-8000-0000000000c1",
      reason: "spam",
      note: "  third time today  ",
    });
    expect(result.duplicate).toBe(false);
    expect(result.report.id).toBe("r1");
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/reports");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      target_type: "post",
      target_id: "00000000-0000-4000-8000-0000000000c1",
      reason: "spam",
      note: "third time today",
    });
  });

  it("omits a blank note entirely", async () => {
    const fetchMock = stubFetch(201, { report: { id: "r1", status: "new" } });
    await submitReport(getToken, { targetType: "comment", targetId: "x", reason: "scam", note: "   " });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("note");
  });

  it("surfaces the duplicate flag when the server returns the open report", async () => {
    stubFetch(200, { report: { id: "r1", status: "new" }, duplicate: true });
    const result = await submitReport(getToken, { targetType: "profile", targetId: "x", reason: "other" });
    expect(result.duplicate).toBe(true);
  });

  it("throws the SERVER's error message on failure — never a generic success-shaped lie", async () => {
    stubFetch(400, { error: "You can't report your own content." });
    await expect(
      submitReport(getToken, { targetType: "post", targetId: "x", reason: "spam" }),
    ).rejects.toThrow("You can't report your own content.");
  });

  it("throws on a 200-shaped response with no report in it", async () => {
    stubFetch(200, {});
    await expect(
      submitReport(getToken, { targetType: "post", targetId: "x", reason: "spam" }),
    ).rejects.toThrow(/Could not file your report/);
  });
});

describe("the docks — Report action lives in the existing surfaces", () => {
  const dialog = read("../components/social/ReportButton.tsx");
  const postCard = read("../components/social/PostCard.tsx");
  const commentThread = read("../components/player/CommentThread.tsx");
  const profileSections = read("../components/artist/profile-sections.tsx");
  const admin = read("../pages/admin.tsx");
  const en = JSON.parse(read("../locales/en.json")) as {
    admin: { reports: Record<string, unknown> };
  };

  it("the dialog is members-only and keeps success and failure in separate phases", () => {
    expect(dialog).toContain("if (!user) return null");
    expect(dialog).toContain('data-testid="report-dialog"');
    expect(dialog).toContain('data-testid="report-success"');
    expect(dialog).toContain('data-testid="report-error"');
    expect(dialog).toContain('setPhase("success")');
    expect(dialog).toContain('setPhase("error")');
    /* the copy promises a human review and no automatic action */
    expect(dialog).toContain("never hides or bans anything by itself");
  });

  it("PostCard docks it in the action row, keyed post vs comment on kind", () => {
    expect(postCard).toContain("<ReportButton");
    expect(postCard).toContain('post.kind === "thread_reply" ? "comment" : "post"');
  });

  it("media comment rows dock it, hidden on your own comments", () => {
    expect(commentThread).toContain("<ReportButton");
    expect(commentThread).toContain('targetType="comment"');
    expect(commentThread).toContain("c.user_id !== user.id");
  });

  it("the Shout Wall docks it on comments and the profile row docks the profile report, hidden on your own profile", () => {
    expect(profileSections).toContain('targetType="comment"');
    expect(profileSections).toContain('targetType="profile"');
    expect(profileSections).toContain("profile.user_id !== user.id");
  });

  it("the admin queue sits beside the DMCA inbox with load-error honesty", () => {
    expect(admin).toContain("function ContentReportsInbox");
    expect(admin).toContain('fetch("/api/admin/reports"');
    expect(admin).toContain("<ContentReportsInbox");
    expect(admin).toContain("Couldn't load content reports.");
    expect(admin).toContain("setLoadError(true)");
  });

  it("the English catalog carries the admin.reports strings", () => {
    expect(en.admin.reports).toMatchObject({
      title: "Content Reports",
      empty: "No content reports yet.",
    });
    expect((en.admin.reports as { status: Record<string, string> }).status).toEqual({
      new: "New",
      reviewing: "Reviewing",
      actioned: "Actioned",
      dismissed: "Dismissed",
    });
    expect((en.admin.reports as { target: Record<string, string> }).target).toEqual({
      post: "Post",
      comment: "Comment",
      profile: "Profile",
    });
  });
});
