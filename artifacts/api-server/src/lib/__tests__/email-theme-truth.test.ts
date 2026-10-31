/**
 * Email theme truth — company law LIGHT AND DARK FOR EVERYTHING reaches
 * the inbox (stack1000/email-theme-truth).
 *
 * The audit behind these pins found three failure shapes:
 *  1. Two families rendered OUTSIDE the house shell on NO background:
 *     the group digest set #1a1a1a text on transparent (1.21:1 in a dark
 *     inbox — invisible) and the tracked campaign dispatch set #eee on
 *     transparent (1.16:1 in a light inbox — invisible). Both now render
 *     inside emailShell; these pins keep any future template from ever
 *     shipping text without an explicit, contrast-proven surface again.
 *  2. The shell's own small-print tokens failed WCAG AA on their
 *     surfaces (muted 3.83:1, goldDeep 3.56:1 on the card; footer legal
 *     3.27:1 on the canvas). The tokens were darkened/lightened; the
 *     pair table below pins every text token ≥4.5:1 on every surface it
 *     can land on.
 *  3. Call sites hard-coded the old hexes, which would have silently
 *     kept the failing values in inboxes even with corrected tokens.
 *     The literal guard below keeps email bodies on EMAIL_COLORS.
 *
 * "Both modes" for the shell family means: every text run sits on an
 * explicit background whose colour is in the pinned palette, and every
 * foreground/background pair in that palette clears AA — so the mail
 * reads identically whether the client's canvas is light or dark.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMAIL_COLORS,
  EMAIL_LOGO_URL,
  emailButton,
  emailDetailBox,
  emailShell,
} from "../email";
import { AUTH_EMAIL_TEMPLATES } from "../email-templates";
import { renderTrackedCampaignHtml } from "../email-tracking";
import { buildDigestEmailHtml } from "../group-digest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..");

/* ── WCAG contrast ───────────────────────────────────────────────────── */
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const v = [0, 2, 4]
    .map((i) => parseInt(c.substr(i, 2), 16) / 255)
    .map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* Every colour allowed in a rendered house email: the palette, the
   button's ink, and the gold hairline under the band. Anything else in
   the output is an un-audited colour — fail here, not in an inbox. */
const PALETTE = new Set(
  [
    ...Object.values(EMAIL_COLORS),
    "#171204", // button label ink
    "#57441a", // hairline under the header band
  ].map((c) => c.toLowerCase()),
);

function expectPaletteOnly(html: string) {
  const hexes = html.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  expect(hexes.length).toBeGreaterThan(0);
  for (const h of hexes) {
    expect(PALETTE.has(h.toLowerCase()), `off-palette colour ${h}`).toBe(true);
  }
}

function expectShellTruth(html: string) {
  expect(html).toContain("<!DOCTYPE html>");
  expect(html).toContain('<meta name="color-scheme" content="light dark">');
  expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
  expect(html).toContain(`<img src="${EMAIL_LOGO_URL}"`);
  /* Text surfaces are explicit: band + card cells carry bgcolor. */
  expect(html).toContain(`bgcolor="${EMAIL_COLORS.band}"`);
  expect(html).toContain(`bgcolor="${EMAIL_COLORS.card}"`);
  expectPaletteOnly(html);
}

describe("email palette — every text token clears AA on its surface", () => {
  const onCard: Array<[string, string]> = [
    ["ink", EMAIL_COLORS.ink],
    ["body", EMAIL_COLORS.body],
    ["muted", EMAIL_COLORS.muted],
    ["goldDeep", EMAIL_COLORS.goldDeep],
  ];
  for (const [name, fg] of onCard) {
    it(`${name} on card ≥ 4.5`, () => {
      expect(contrastRatio(fg, EMAIL_COLORS.card)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name} on detail box ≥ 4.5`, () => {
      expect(contrastRatio(fg, EMAIL_COLORS.box)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("band + footer text on the dark surfaces ≥ 4.5", () => {
    expect(contrastRatio(EMAIL_COLORS.gold, EMAIL_COLORS.band)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(EMAIL_COLORS.gold, EMAIL_COLORS.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(EMAIL_COLORS.goldDim, EMAIL_COLORS.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(EMAIL_COLORS.footerInk, EMAIL_COLORS.canvas)).toBeGreaterThanOrEqual(4.5);
  });
  it("button label on the gold fill ≥ 4.5", () => {
    const btn = emailButton("https://bowdownvisuals.com/x", "Go");
    const bg = btn.match(/bgcolor="(#[0-9a-f]{6})"/i)?.[1];
    const fg = btn.match(/color:(#[0-9a-f]{6});text-decoration/)?.[1];
    expect(bg).toBe(EMAIL_COLORS.gold);
    expect(fg).toBeTruthy();
    expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("emailShell document", () => {
  it("carries the dual-theme meta pair, the lockup, explicit surfaces, palette only", () => {
    const html = emailShell(
      "Your receipt",
      `<p>Body copy</p>${emailButton("https://bowdownvisuals.com/purchases", "View")}${emailDetailBox("<div>CODE-42</div>")}`,
    );
    expectShellTruth(html);
  });
});

describe("tracked campaign dispatch (email-campaign-send path)", () => {
  const html = renderTrackedCampaignHtml({
    body: "Big news.\n\nGet it at https://example.com/drop today.",
    deliveryToken: "tok123",
    wrappedLinks: new Map([
      ["https://example.com/drop", "https://bowdownvisuals.com/api/email-track/c/link1"],
    ]),
    baseUrl: "https://bowdownvisuals.com",
    title: "The drop is live",
  });
  it("renders inside the shell — lockup, card, headline — never naked text", () => {
    expectShellTruth(html);
    expect(html).toContain("The drop is live");
    expect(html).not.toContain("#eeeeee");
    expect(html).not.toContain("#2a2a2a");
    expect(html).not.toContain('color:#888');
  });
  it("keeps the wrapped link, the honest footer and the pixel", () => {
    expect(html).toContain('href="https://bowdownvisuals.com/api/email-track/c/link1"');
    expect(html).toContain(`style="color:${EMAIL_COLORS.goldDeep};"`);
    expect(html).toContain("Unsubscribe in one click");
    expect(html).toContain("Opens and link clicks on this email are tracked");
    expect(html).toContain("https://bowdownvisuals.com/api/email-track/o/tok123.gif");
    expect(html).toContain("https://bowdownvisuals.com/api/email-track/u/tok123");
  });
});

describe("group digest", () => {
  const html = buildDigestEmailHtml("Your group moved", "3 new posts in The Lab.", "/groups/the-lab");
  it("renders inside the shell with the house button — never naked dark text", () => {
    expectShellTruth(html);
    expect(html).not.toContain("#1a1a1a");
    expect(html).not.toContain("#C9A84C");
    expect(html).toContain("Open the group");
    expect(html).toContain("https://bowdownvisuals.com/groups/the-lab");
    expect(html).toContain("Turn them off any time in Settings");
  });
});

describe("Supabase auth family (repo-side source of truth)", () => {
  const readme = readFileSync(join(HERE, "..", "email-templates", "README.md"), "utf8");
  for (const t of AUTH_EMAIL_TEMPLATES) {
    it(`${t.file}: dual-theme meta pair, lockup, palette only`, () => {
      expectShellTruth(t.html);
    });
    it(`${t.file}: subject matches the dashboard table in the README`, () => {
      expect(readme).toContain(t.subject);
    });
  }
});

describe("call-site literal guard", () => {
  /* The pre-fix hexes must never come back as literals in an email
     body — bodies interpolate EMAIL_COLORS so a palette correction
     reaches every inbox at once. */
  const FILES = [
    "lib/creator-tier-sync.ts",
    "lib/presave-release-notify.ts",
    "lib/product-drop-notify.ts",
    "lib/stock-alerts.ts",
    "lib/email-campaign-sender.ts",
    "lib/email-tracking.ts",
    "lib/group-digest.ts",
    "routes/store.ts",
    "routes/gift-cards.ts",
    "routes/generate/royalties.ts",
    "routes/generate/distribution.ts",
    "routes/teams.ts",
    "routes/team-seats.ts",
    "routes/creator-platform.ts",
  ];
  for (const f of FILES) {
    it(`${f} carries no stale palette literals`, () => {
      const src = readFileSync(join(SRC, f), "utf8");
      expect(src).not.toContain("#a67c1a");
      expect(src).not.toContain("#8a7c5c");
      expect(src).not.toContain("#6f6450");
    });
  }
});
