/**
 * pitch-fix-wiring.test.ts — UPGRADES 196 + 180 source contracts.
 *
 * Pins the shape the approved preview + board items demand:
 * - the section docks INSIDE the shell: a /pitch-fix route in
 *   AuthedLayout's Switch + a sidebar door with the real name;
 * - two doors, two boards, the shipped strip, and the review-first
 *   copy all exist on the page;
 * - NO prices and NO Visual Bucs reward anywhere in the section's
 *   surfaces (page, host, settings card, admin bench) — the reward
 *   question was never ruled;
 * - the admin bench talks to the admin queue/patch endpoints;
 * - the feedback host only listens for qualifying-moment events and
 *   stamps a showing through the server — it has no load-time show
 *   path; the Settings toggle card is mounted in Settings;
 * - qualifying moments are announced from real success paths only
 *   (export completion, hum-to-song completion).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const page = read("pages/pitch-fix.tsx");
const app = read("App.tsx");
const sidebar = read("components/layout/app-sidebar.tsx");
const settings = read("pages/settings.tsx");
const admin = read("pages/admin.tsx");
const host = read("components/FeedbackPromptHost.tsx");
const settingsCard = read("components/FeedbackPromptSettings.tsx");
const finalExport = read("components/FinalVideoExport.tsx");
const humToSong = read("components/HumToSong.tsx");

describe("pitch & fix section wiring", () => {
  it("docks inside the shell with a real-name sidebar door", () => {
    expect(app).toContain('<Route path="/pitch-fix">');
    expect(app).toContain('import("@/pages/pitch-fix")');
    expect(sidebar).toContain('href: "/pitch-fix"');
    expect(sidebar).toContain('labelKey: "nav.pitchFix"');
  });

  it("the page carries both doors, both boards, sort, votes, and the shipped strip", () => {
    for (const id of ["pitch-door", "fix-door", "pitch-board", "fix-board", "pitch-fix-shipped"]) {
      expect(page).toContain(`data-testid="${id}"`);
    }
    expect(page).toContain('"/api/pitch-fix/pitches"');
    expect(page).toContain('"/api/pitch-fix/fixes"');
    expect(page).toContain('"/api/pitch-fix/board"');
    expect(page).toContain("/vote`");
    expect(page).toContain("sortPitches");
  });

  it("door copy is review-first — nothing claims a submission posts publicly at once", () => {
    // The success notes use the pitchSent/fixSent locale keys, whose
    // English copy (pinned in the locale files) says team review.
    expect(page).toContain('t("pitchFix.pitchSent")');
    expect(page).toContain('t("pitchFix.fixSent")');
  });

  it("NO prices and NO Visual Bucs reward anywhere in the section", () => {
    // The admin bench slice only — the rest of admin.tsx runs other
    // benches (credit grants etc.) that are not this section.
    const adminStart = admin.indexOf("function PitchFixInbox");
    const adminSlice = admin.slice(adminStart, admin.indexOf("/* ─── Content Reports", adminStart));
    expect(adminSlice.length).toBeGreaterThan(500);
    for (const [name, src] of Object.entries({ page, host, settingsCard, adminBench: adminSlice })) {
      expect(src, name).not.toMatch(/Visual Bucs|visualBucs|chargeCredits|grantCredits/);
      expect(src, name).not.toMatch(/\$\d|\bprice\b/i);
    }
  });

  it("the admin bench is the moderation surface for the same intake", () => {
    expect(admin).toContain("PitchFixInbox");
    expect(admin).toContain('"/api/admin/pitch-fix/queue"');
    expect(admin).toContain("/api/admin/pitch-fix/${id}");
    expect(admin).toContain('moderation: "approved"');
    expect(admin).toContain('moderation: "rejected"');
  });
});

describe("feedback pop-up wiring", () => {
  it("the host mounts in the signed-in shell and the toggle card in Settings", () => {
    expect(app).toContain("<FeedbackPromptHost />");
    expect(settings).toContain("<FeedbackPromptSettings />");
    expect(settingsCard).toContain('"/api/pitch-fix/feedback-prefs"');
    expect(settingsCard).toContain('method: "PATCH"');
  });

  it("the host only listens — there is no load-time show path", () => {
    expect(host).toContain("FEEDBACK_MOMENT_EVENT");
    expect(host).toContain("addEventListener(FEEDBACK_MOMENT_EVENT");
    expect(host).toContain("decideFeedbackPrompt");
    expect(host).toContain('"/api/pitch-fix/feedback-prompt/eligibility"');
    expect(host).toContain('"/api/pitch-fix/feedback-prompt/shown"');
    expect(host).toContain('"/api/pitch-fix/feedback"');
    // One-tap dismiss, twice over (X and the dismiss button), and no
    // guilt copy anywhere in the host.
    expect(host).not.toMatch(/are you sure|sad|miss you|don't go/i);
  });

  it("qualifying moments are announced from real success paths", () => {
    expect(finalExport).toContain('notifyQualifyingMoment("export_finished")');
    expect(humToSong).toContain('notifyQualifyingMoment("creation_succeeded")');
    expect(host).toContain('notifyQualifyingMoment("session_milestone")');
  });
});
