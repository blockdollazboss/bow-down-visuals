/**
 * Company-theme automatic emails (owner-approved Nov 7, 2026,
 * re-approved Nov 11, 2026 — artifact "automatic-emails-company-theme"):
 *
 *  1. The shell is a themed PAIR: marble splash header band + foot
 *     strip in the theme's stone, the theme's lockup as crest, and a
 *     closing signature whose lockup FOLLOWS the send's theme.
 *  2. Rotation: automatic emails alternate theme BY CUSTOMER in
 *     strict rotation (dark, light, dark, light). Resolving a theme
 *     never advances it — only a VERIFIED sent email flips it, so a
 *     failed send or a retry keeps its assigned theme.
 *  3. The gift-card delivery email's CTA is ABSOLUTE (base URL +
 *     store path): a site-relative href cannot resolve in an inbox.
 *     (Pinned at the source: the route's email is built inline in the
 *     settle path, whose full harness lives in the gift-card suites.)
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  emailShell,
  emailShellForRecipient,
  emailSignatureHtml,
  EMAIL_COLORS,
  EMAIL_LOGO_URL,
  EMAIL_LOGO_LIGHT_URL,
  EMAIL_MARBLE_URLS,
  EMAIL_THEME_COLORS,
} from "../email";
import { buildEmailHtml } from "../email-campaign-sender";
import { renderTrackedCampaignHtml } from "../email-tracking";
import { buildDigestEmailHtml } from "../group-digest";
import { buildPresaveReleaseEmail } from "../presave-release-notify";
import { buildProductDropEmail } from "../product-drop-notify";
import { buildRestockEmail } from "../stock-alerts";
import { buildTempBucsExpiryEmail } from "../temp-bucs-expiry-warning";
import {
  resolveEmailThemeForRecipient,
  recordEmailThemeSent,
  resetEmailThemeRotationForTests,
  setEmailThemeRotationStore,
  type EmailThemeRotationStore,
} from "../email-theme-rotation";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("company-theme shell — the pair", () => {
  it("dark send: black marble splash top + foot, dark lockup crest, dark signature", () => {
    const html = emailShell("Hello", "<p>Body</p>", { theme: "dark" });
    expect(html.split(EMAIL_MARBLE_URLS.dark).length - 1).toBeGreaterThanOrEqual(4); // band + strip, background attr + style each
    expect(html).not.toContain(EMAIL_MARBLE_URLS.light);
    /* crest + signature both carry the dark lockup */
    expect(html.split(EMAIL_LOGO_URL).length - 1).toBe(2);
    expect(html).not.toContain(EMAIL_LOGO_LIGHT_URL);
    expect(html).toContain('height="30"'); // the foot strip
    expect(html).toContain("border-bottom:2px solid #c9a227"); // gold line under the band
  });

  it("light send: golden marble splash top + foot, light lockup crest, light signature", () => {
    const html = emailShell("Hello", "<p>Body</p>", { theme: "light" });
    expect(html.split(EMAIL_MARBLE_URLS.light).length - 1).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain(EMAIL_MARBLE_URLS.dark);
    expect(html.split(EMAIL_LOGO_LIGHT_URL).length - 1).toBe(2);
    expect(html).not.toContain(EMAIL_LOGO_URL);
    expect(html).toContain('height="30"');
  });

  it("the signature follows the theme it rides in", () => {
    const dark = emailSignatureHtml("dark");
    expect(dark).toContain(EMAIL_LOGO_URL);
    expect(dark).not.toContain(EMAIL_LOGO_LIGHT_URL);
    expect(dark).toContain("THY CHEAT CODE");
    expect(dark).toContain("hello@bowdownvisuals.com");
    const light = emailSignatureHtml("light");
    expect(light).toContain(EMAIL_LOGO_LIGHT_URL);
    expect(light).not.toContain(EMAIL_LOGO_URL);
    /* the King at the ruled modest signature size, never boxed */
    expect(dark).toContain('width="160"');
    expect(light).toContain('width="160"');
  });

  it("internal mail (signoff: false) carries no sign-off and no signature", () => {
    const html = emailShell("Admin alert", "<p>x</p>", { signoff: false, theme: "dark" });
    expect(html).not.toContain("THY CHEAT CODE");
    expect(html).not.toContain("Your host at Bow Down Visuals");
  });
});

describe("theme rotation — by customer, strict, flip only on verified send", () => {
  beforeEach(() => {
    resetEmailThemeRotationForTests();
  });

  it("a customer's sequence is dark, light, dark, light", async () => {
    const email = "fan@example.com";
    expect(await resolveEmailThemeForRecipient(email)).toBe("dark");
    await recordEmailThemeSent(email, "dark");
    expect(await resolveEmailThemeForRecipient(email)).toBe("light");
    await recordEmailThemeSent(email, "light");
    expect(await resolveEmailThemeForRecipient(email)).toBe("dark");
    await recordEmailThemeSent(email, "dark");
    expect(await resolveEmailThemeForRecipient(email)).toBe("light");
  });

  it("resolving (rendering) never advances the rotation — a retry keeps its theme", async () => {
    const email = "fan@example.com";
    expect(await resolveEmailThemeForRecipient(email)).toBe("dark");
    expect(await resolveEmailThemeForRecipient(email)).toBe("dark");
    const { theme } = await emailShellForRecipient(email, "Hi", "<p>x</p>");
    expect(theme).toBe("dark");
    expect(await resolveEmailThemeForRecipient(email)).toBe("dark");
  });

  it("a send recorded with a stale theme does not disturb the sequence", async () => {
    const email = "fan@example.com";
    await recordEmailThemeSent(email, "light"); // not the assigned theme
    expect(await resolveEmailThemeForRecipient(email)).toBe("dark");
  });

  it("customers rotate independently, keyed case-insensitively", async () => {
    await recordEmailThemeSent("Fan@Example.com", "dark");
    expect(await resolveEmailThemeForRecipient("fan@example.com")).toBe("light");
    expect(await resolveEmailThemeForRecipient("other@example.com")).toBe("dark");
  });

  it("emailShellForRecipient renders the assigned theme, lockup included", async () => {
    const email = "fan@example.com";
    const first = await emailShellForRecipient(email, "Hi", "<p>x</p>");
    expect(first.html).toContain(EMAIL_LOGO_URL); // dark first
    await recordEmailThemeSent(email, first.theme);
    const second = await emailShellForRecipient(email, "Hi", "<p>x</p>");
    expect(second.theme).toBe("light");
    expect(second.html).toContain(EMAIL_LOGO_LIGHT_URL);
  });

  it("a failing store fails open to the safe default and never throws", async () => {
    const broken: EmailThemeRotationStore = {
      get: async () => {
        throw new Error("store down");
      },
      set: async () => {
        throw new Error("store down");
      },
    };
    setEmailThemeRotationStore(broken);
    await expect(resolveEmailThemeForRecipient("fan@example.com")).resolves.toBe("dark");
    await expect(recordEmailThemeSent("fan@example.com", "dark")).resolves.toBeUndefined();
    setEmailThemeRotationStore(null);
  });
});

describe("follow-on (email-company-theme-2) — the remaining sends are recipient-aware (source pins)", () => {
  const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), "utf8");
  /* A converted file renders through emailShellForRecipient and
     never falls back to a plain emailShell( call (the strip removes
     the ForRecipient name before checking). */
  const expectConverted = (src: string) => {
    expect(src).toContain("emailShellForRecipient(");
    expect(src.split("emailShellForRecipient").join("")).not.toContain("emailShell(");
    expect(src).toContain("themeRecipient:");
  };

  it("store purchase receipt", () => {
    expectConverted(read("..", "..", "routes", "store.ts"));
  });
  it("team-seats invite", () => {
    expectConverted(read("..", "..", "routes", "team-seats.ts"));
  });
  it("teams invite", () => {
    expectConverted(read("..", "..", "routes", "teams.ts"));
  });
  it("distribution split invite", () => {
    expectConverted(read("..", "..", "routes", "generate", "distribution.ts"));
  });
  it("royalties payout notice", () => {
    expectConverted(read("..", "..", "routes", "generate", "royalties.ts"));
  });

  it("shoutout fan emails carry the fan's rotation theme through the mailer seam", () => {
    const src = read("..", "..", "routes", "generate", "shoutouts.ts");
    expect(src).toContain("resolveEmailThemeForRecipient(");
    expect(src).toContain("themeRecipient: input.fanEmail");
    expect(src).toContain("{ theme: input.theme }");
  });

  it("creator-tier confirmation resolves the buyer's theme before building its body", () => {
    const src = read("..", "creator-tier-sync.ts");
    expect(src).toContain("resolveEmailThemeForRecipient(buyerEmail)");
    /* its on-panel accents ride themed tokens — no light-surface
       EMAIL_COLORS accent remains anywhere in the file */
    expect(src).not.toContain("EMAIL_COLORS.");
  });

  it("the DMCA operator alert stays internal mail (signoff: false) by design", () => {
    const src = read("..", "..", "routes", "creator-platform.ts");
    expect(src).toContain("{ signoff: false }");
  });
});

describe("follow-on (email-company-theme-2) — on-panel small print is themed (render pins)", () => {
  const darkMuted = `color:${EMAIL_THEME_COLORS.dark.muted}`;
  const darkGold = `color:${EMAIL_THEME_COLORS.dark.goldText}`;
  const lightAccent = `color:${EMAIL_COLORS.muted}`;
  const lightGold = `color:${EMAIL_COLORS.goldDeep}`;

  /* In a dark render the light-surface accents must never sit
     directly on the panel; the themed tokens take their place. */
  const expectDarkAccents = (html: string, gold: boolean) => {
    expect(html).toContain(darkMuted);
    if (gold) expect(html).toContain(darkGold);
    expect(html).not.toContain(lightAccent);
    expect(html).not.toContain(lightGold);
  };

  it("campaign sender footer (dark)", () => {
    const html = buildEmailHtml("Hi", "Body text", "https://x.test/u", "dark");
    expectDarkAccents(html, true);
  });
  it("campaign sender footer (light) keeps the designed light accents", () => {
    const html = buildEmailHtml("Hi", "Body text", "https://x.test/u", "light");
    expect(html).toContain(lightAccent);
    expect(html).toContain(lightGold);
  });
  it("tracked campaign links + footer (dark)", () => {
    const html = renderTrackedCampaignHtml({
      body: "Read more at https://example.com/post today",
      deliveryToken: "tok",
      wrappedLinks: new Map([["https://example.com/post", "https://x.test/c/1"]]),
      theme: "dark",
    });
    expectDarkAccents(html, true);
  });
  it("group digest footer (dark)", () => {
    expectDarkAccents(buildDigestEmailHtml("T", "B", "/groups/x", "dark"), false);
  });
  it("presave release links + footer (dark)", () => {
    const mail = buildPresaveReleaseEmail(
      {
        id: "r1",
        title: "Song",
        artistName: "Artist",
        presaveSlug: "song",
        releaseDate: "2026-01-01",
        platformLinks: { spotify: "https://open.spotify.com/album/1" },
      },
      { email: "fan@example.com", name: "Fan" },
      "dark",
    );
    expectDarkAccents(mail.html, true);
    expect(mail.themeRecipient).toBe("fan@example.com");
  });
  it("product drop footer (dark)", () => {
    const mail = buildProductDropEmail(
      {
        id: "d1",
        productId: "p1",
        title: "Hoodie",
        creatorName: "Creator",
        creatorSlug: "creator",
        dropAt: new Date("2026-01-01T00:00:00Z"),
      },
      { email: "fan@example.com", name: null },
      "dark",
    );
    expectDarkAccents(mail.html, false);
  });
  it("restock alert footer (dark)", () => {
    const mail = buildRestockEmail(
      {
        id: "p1",
        profileId: "pr1",
        sellerUserId: "u1",
        title: "Hoodie",
        inventory: 3,
        isActive: true,
        creatorName: "Creator",
        creatorSlug: "creator",
      },
      "dark",
    );
    expectDarkAccents(mail.html, false);
  });
  it("temp-bucs expiry footer (dark)", () => {
    const mail = buildTempBucsExpiryEmail({
      email: "fan@example.com",
      amount: 500,
      expiresAt: "2026-12-01T00:00:00Z",
      theme: "dark",
    });
    expectDarkAccents(mail.html, false);
    expect(mail.themeRecipient).toBe("fan@example.com");
  });
});

describe("gift-card delivery email — absolute CTA (source pin)", () => {
  const src = readFileSync(join(HERE, "..", "..", "routes", "gift-cards.ts"), "utf8");
  it("builds the email store URL from the site base and sends the CTA through it", () => {
    expect(src).toContain("const storeEmailUrl = `${baseUrlForEmail()}${storeUrl}`;");
    expect(src).toContain("emailButton(storeEmailUrl,");
    /* the relative storeUrl may ride the JSON response, never the email CTA */
    expect(src).not.toContain("emailButton(storeUrl,");
  });
  it("the gift-product email CTA is absolute too", () => {
    const gp = readFileSync(join(HERE, "..", "..", "routes", "gift-product.ts"), "utf8");
    expect(gp).toContain("emailButton(`${baseUrlForEmail()}${claimUrl}`,");
  });
});
