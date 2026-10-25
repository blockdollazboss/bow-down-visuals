/**
 * Transactional email redesign (Oct 24, 2026) — presentation rebuild pins.
 *
 * The owner ruled the old activation email "horrible": bare heading, one
 * line, one naked link, no brand. The redesigned family must keep, for
 * EVERY template:
 *  - the real logo lockup reference (logo-email.png — never the app icon,
 *    never an emoji mark),
 *  - its action URL / token variable byte-identical (a presentation
 *    rebuild may never break a confirm/reset/invite link),
 *  - a real gold button carrying the action (no naked primary link),
 *  - the brand line "The Content Creator's Cheat Code" and the house
 *    colors, and zero emoji.
 * The Resend shell bodies are pinned the same way; the Supabase dashboard
 * files are pinned to their builders so the two can never drift apart.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  emailShell,
  emailButton,
  emailDetailBox,
  EMAIL_LOGO_URL,
} from "../email";
import { AUTH_EMAIL_TEMPLATES } from "../email-templates";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(HERE, "..", "email-templates");

const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

function expectBranded(html: string) {
  expect(html).toContain(`<img src="${EMAIL_LOGO_URL}"`);
  expect(EMAIL_LOGO_URL).toContain("logo-email.png");
  expect(html).not.toMatch(/icon-\d+\.png/);
  expect(html).toContain("The Content Creator's Cheat Code");
  expect(html).toContain("BOW DOWN VISUALS");
  expect(html).toContain("#faf7f0"); // golden-marble card
  expect(html).toContain("#d4af37"); // house gold
  expect(html).not.toMatch(EMOJI);
}

describe("emailShell (Resend family)", () => {
  it("renders the branded system: lockup band, ivory card, brand line, King sign-off", () => {
    const html = emailShell("Your receipt", "<p>Body copy</p>");
    expectBranded(html);
    expect(html).toContain("THY CHEAT CODE");
    expect(html).toContain("— Thy Cheat Code");
    expect(html).toContain("Your receipt");
  });

  it("internal mail can opt out of the King sign-off", () => {
    const html = emailShell("Admin alert", "<p>x</p>", { signoff: false });
    expect(html).not.toContain("Your host at Bow Down Visuals");
  });

  it("emailButton carries the href verbatim in a gold pill", () => {
    const href = "https://bowdownvisuals.com/distribution?splitInvite=tok123";
    const btn = emailButton(href, "Review my split");
    expect(btn).toContain(`href="${href}"`);
    expect(btn).toContain("Review my split");
    expect(btn).toContain("#d4af37");
  });

  it("emailDetailBox renders its contents inside the gold-bordered box", () => {
    const box = emailDetailBox("<div>CODE-42</div>");
    expect(box).toContain("CODE-42");
    expect(box).toContain("#d9c68d");
  });
});

describe("Supabase auth templates", () => {
  it("covers the full auth family", () => {
    expect(AUTH_EMAIL_TEMPLATES.map((t) => t.file).sort()).toEqual([
      "change-email.html",
      "confirm-signup.html",
      "invite.html",
      "magic-link.html",
      "reset-password.html",
    ]);
  });

  for (const t of AUTH_EMAIL_TEMPLATES) {
    it(`${t.file} is branded and keeps its action variable behind a gold button`, () => {
      expectBranded(t.html);
      expect(t.html).toContain("{{ .ConfirmationURL }}");
      // the action rides a real button, not a naked link
      expect(t.html).toMatch(
        /<a href="\{\{ \.ConfirmationURL \}\}" style="display:inline-block;padding:13px 32px/,
      );
      expect(t.subject.length).toBeGreaterThan(0);
      expect(t.subject).not.toMatch(EMOJI);
    });

    it(`${t.file} on disk matches its builder exactly (no drift)`, () => {
      const onDisk = readFileSync(join(TEMPLATES_DIR, t.file), "utf8");
      expect(onDisk).toBe(t.html + "\n");
    });
  }

  it("magic-link keeps the one-time code variable", () => {
    const magic = AUTH_EMAIL_TEMPLATES.find((t) => t.file === "magic-link.html");
    expect(magic?.html).toContain("{{ .Token }}");
  });

  it("change-email keeps the new-address variable", () => {
    const change = AUTH_EMAIL_TEMPLATES.find(
      (t) => t.file === "change-email.html",
    );
    expect(change?.html).toContain("{{ .NewEmail }}");
  });
});
