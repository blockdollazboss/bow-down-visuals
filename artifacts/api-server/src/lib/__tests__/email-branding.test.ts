/**
 * Email branding fixes — the owner's inbox is the spec:
 *
 * 1. The email header rendered a raw 🦈 emoji, which mail clients show
 *    as a STOCK cartoon shark — not the owner's logo. The shell must
 *    render the real logo — the full illustrated lockup
 *    (public/logo-email.png, exported from public/logo-static.webp).
 *    The app icon (public/icon-*.png) is NOT the logo and must never
 *    stand in for it. Zero emoji anywhere in the shell.
 * 2. Sends arrived from a bare address with no display name. House
 *    sends must read "Thy Cheat Code" — houseFromAddress composes it
 *    when the configured From is bare and respects an env value that
 *    already carries a name.
 * 3. Welcome deliveries prepended "Hi," above templates that open
 *    with their own greeting ("Yo — welcome to the cheat code."),
 *    producing a double greeting. withWelcomeGreeting skips the
 *    prepend for self-greeted bodies.
 */
import { describe, expect, it } from "vitest";
import { emailShell, houseFromAddress, EMAIL_LOGO_URL, EMAIL_FROM_NAME } from "../email";
import { withWelcomeGreeting } from "../email-campaign-sender";

describe("email shell brand mark", () => {
  it("renders the real logo lockup as an image, not an emoji or the app icon", () => {
    const html = emailShell("Subject line", "<p>Body</p>");
    expect(html).toContain(`<img src="${EMAIL_LOGO_URL}"`);
    expect(EMAIL_LOGO_URL).toContain("logo-email.png");
    expect(EMAIL_LOGO_URL).not.toMatch(/icon-\d+\.png/);
    expect(html).not.toContain("🦈");
  });

  it("keeps the gold-on-black THY CHEAT CODE / BOW DOWN VISUALS header text", () => {
    const html = emailShell("Subject line", "<p>Body</p>");
    expect(html).toContain("THY CHEAT CODE");
    expect(html).toContain("BOW DOWN VISUALS");
  });
});

describe("houseFromAddress", () => {
  it("adds the Thy Cheat Code display name to a bare address", () => {
    expect(houseFromAddress("noreply@bowdownvisuals.com")).toBe(
      `${EMAIL_FROM_NAME} <noreply@bowdownvisuals.com>`,
    );
    expect(EMAIL_FROM_NAME).toBe("Thy Cheat Code");
  });

  it("respects a configured value that already carries a display name", () => {
    expect(houseFromAddress("Studio Desk <desk@example.com>")).toBe(
      "Studio Desk <desk@example.com>",
    );
  });
});

describe("withWelcomeGreeting", () => {
  it("never double-greets a body that opens with its own greeting", () => {
    const body = "Yo — welcome to the cheat code.\n\nYour pack is here.";
    expect(withWelcomeGreeting("Fan", body)).toBe(body);
    expect(withWelcomeGreeting(null, "Hello there — big news.")).toBe(
      "Hello there — big news.",
    );
    expect(withWelcomeGreeting("Fan", "Welcome in. Start here.")).toBe(
      "Welcome in. Start here.",
    );
  });

  it("still greets a body that opens cold", () => {
    expect(withWelcomeGreeting("Fan", "Your pack is ready.")).toBe(
      "Hi Fan,\n\nYour pack is ready.",
    );
    expect(withWelcomeGreeting(null, "Your pack is ready.")).toBe(
      "Hi,\n\nYour pack is ready.",
    );
  });
});
