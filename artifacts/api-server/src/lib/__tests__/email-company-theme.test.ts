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
  EMAIL_LOGO_URL,
  EMAIL_LOGO_LIGHT_URL,
  EMAIL_MARBLE_URLS,
} from "../email";
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
