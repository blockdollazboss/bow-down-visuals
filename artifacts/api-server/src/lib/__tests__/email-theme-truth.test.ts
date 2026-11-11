/**
 * Email theme truth — company law LIGHT AND DARK FOR EVERYTHING reaches
 * the inbox, in the company-theme design (owner-approved Nov 7, 2026,
 * re-approved Nov 11, 2026; artifact "automatic-emails-company-theme").
 *
 * The design is a THEMED PAIR of sends, not a client-mode inversion:
 * the dark send (black marble splash, charcoal panel) and the light
 * send (golden marble splash, ivory panel), alternating per customer
 * (lib/email-theme-rotation.ts). These pins hold, for BOTH themes:
 *  1. The shell renders its marble header band + foot strip, the
 *     theme's own lockup in the crest AND the closing signature, and
 *     explicit bgcolor surfaces — never naked text on a client canvas
 *     (the pre-shell digest/campaign failure shape: invisible text in
 *     one inbox mode or the other).
 *  2. Every shell text token clears WCAG AA (≥4.5:1) on the surface
 *     it actually sits on — panel, signature plate, page, gold button.
 *  3. Call-site bodies stay on the shared EMAIL_COLORS tokens (the
 *     literal guard at the bottom) so a palette correction reaches
 *     every inbox at once.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMAIL_COLORS,
  EMAIL_THEME_COLORS,
  emailButton,
  emailDetailBox,
  emailLogoUrlForTheme,
  emailMarbleUrlForTheme,
  emailShell,
  type EmailTheme,
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

/* Every colour allowed in a rendered house email: the shared body
   palette, both themed shell palettes, and the button ink. Anything
   else in the output is an un-audited colour — fail here, not in an
   inbox. */
const PALETTE = new Set(
  [
    ...Object.values(EMAIL_COLORS),
    EMAIL_THEME_COLORS.goldHairline,
    EMAIL_THEME_COLORS.goldButton,
    EMAIL_THEME_COLORS.buttonInk,
    ...Object.values(EMAIL_THEME_COLORS.dark),
    ...Object.values(EMAIL_THEME_COLORS.light),
  ].map((c) => c.toLowerCase()),
);

function expectPaletteOnly(html: string) {
  const hexes = html.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  expect(hexes.length).toBeGreaterThan(0);
  for (const h of hexes) {
    expect(PALETTE.has(h.toLowerCase()), `off-palette colour ${h}`).toBe(true);
  }
}

function expectShellTruth(html: string, theme: EmailTheme) {
  const t = EMAIL_THEME_COLORS[theme];
  expect(html).toContain("<!DOCTYPE html>");
  expect(html).toContain('<meta name="color-scheme" content="light dark">');
  expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
  /* The theme's lockup rides in the header crest AND the signature. */
  expect(html).toContain(`<img src="${emailLogoUrlForTheme(theme)}"`);
  /* The marble splash: header band + foot strip, this theme's stone. */
  expect(html.split(emailMarbleUrlForTheme(theme)).length - 1).toBeGreaterThanOrEqual(2);
  /* Text surfaces are explicit: the panel cell carries bgcolor. */
  expect(html).toContain(`bgcolor="${t.panel}"`);
  expectPaletteOnly(html);
}

describe("email palette — shared body tokens clear AA on their surfaces", () => {
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
  it("button label on the gold fill ≥ 4.5", () => {
    const btn = emailButton("https://bowdownvisuals.com/x", "Go");
    const bg = btn.match(/bgcolor="(#[0-9a-f]{6})"/i)?.[1];
    const fg = btn.match(/color:(#[0-9a-f]{6});text-decoration/)?.[1];
    expect(bg).toBe(EMAIL_THEME_COLORS.goldButton);
    expect(fg).toBeTruthy();
    expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("email palette — every themed shell token clears AA on its surface", () => {
  for (const theme of ["dark", "light"] as const) {
    const t = EMAIL_THEME_COLORS[theme];
    for (const [name, fg] of [
      ["ink", t.ink],
      ["body", t.body],
      ["muted", t.muted],
      ["goldText", t.goldText],
    ] as Array<[string, string]>) {
      it(`${theme}: ${name} on panel ≥ 4.5`, () => {
        expect(contrastRatio(fg, t.panel)).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const [name, fg] of [
      ["sigName", t.sigName],
      ["sigInk", t.sigInk],
      ["sigSub", t.sigSub],
    ] as Array<[string, string]>) {
      it(`${theme}: ${name} on signature plate ≥ 4.5`, () => {
        expect(contrastRatio(fg, t.sigBg)).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`${theme}: footer gold + muted on the page ground ≥ 4.5`, () => {
      expect(contrastRatio(t.goldText, t.page)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.muted, t.page)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("emailShell document — both themes of the pair", () => {
  for (const theme of ["dark", "light"] as const) {
    it(`${theme}: dual-theme meta pair, themed lockup + marble, explicit surfaces, palette only`, () => {
      const html = emailShell(
        "Your receipt",
        `<p>Body copy</p>${emailButton("https://bowdownvisuals.com/purchases", "View")}${emailDetailBox("<div>CODE-42</div>")}`,
        { theme },
      );
      expectShellTruth(html, theme);
    });
  }
  it("defaults to the light member when no theme is passed", () => {
    const html = emailShell("Your receipt", "<p>Body copy</p>");
    expectShellTruth(html, "light");
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
  it("renders inside the shell — lockup, panel, headline — never naked text", () => {
    expectShellTruth(html, "light");
    expect(html).toContain("The drop is live");
    expect(html).not.toContain("#eeeeee");
    expect(html).not.toContain("#2a2a2a");
    expect(html).not.toContain('color:#888');
  });
  it("renders in the dark member when the rotation assigns dark", () => {
    const dark = renderTrackedCampaignHtml({
      body: "Big news.",
      deliveryToken: "tok123",
      wrappedLinks: new Map(),
      baseUrl: "https://bowdownvisuals.com",
      title: "The drop is live",
      theme: "dark",
    });
    expectShellTruth(dark, "dark");
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
    expectShellTruth(html, "light");
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
    it(`${t.file}: the pair's LIGHT member — meta pair, light lockup, palette only`, () => {
      expectShellTruth(t.html, "light");
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
