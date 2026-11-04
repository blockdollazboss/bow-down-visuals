/**
 * embed-brand-identity.test.ts — brand-identity sweep (Nov 4, 2026).
 *
 * The law (owner, Nov 4): the shark portrait / mascot glyph is NOT the
 * logo and must never pose as a person's photo. A creator with no
 * avatar photo got a 🦈 emoji disc in the profile + live embeds; at
 * 48–72px that emoji renders as a shark medallion that reads as the
 * King's face standing in for the creator — the exact confusion the
 * owner flagged on the testcreator card. The photoless fallback is
 * now the neutral initial monogram, the same pattern the site's own
 * Avatar component and the World's portrait cards already use.
 *
 * The embed OG image fallback stays the real logo lockup
 * (/og-fallback.png — the full illustrated lockup on the dark ground,
 * opened and verified in the sweep) — pinned here so it never drifts
 * to the app icon.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const embed = readFileSync(join(__dirname, "../embed.ts"), "utf8");

describe("embed photoless-creator fallback — brand identity", () => {
  it("no shark-emoji avatar disc remains in any embed renderer", () => {
    expect(embed).not.toContain(">🦈</div>");
  });

  it("profile + live fallbacks render the creator's escaped first initial", () => {
    const sites = embed.match(/charAt\(0\)\.toUpperCase\(\)/g) ?? [];
    // one per photoless-avatar renderer (profile card + live badge)
    expect(sites.length).toBe(2);
    expect(embed).toContain('esc((d.display_name||"?").charAt(0).toUpperCase())');
  });

  it("a real avatar_url still renders the creator's own photo", () => {
    expect(embed).toContain("d.avatar_url?'<img");
  });

  it("the OG share fallback is the logo lockup, never the app icon", () => {
    expect(embed).toContain("/og-fallback.png");
    expect(embed).not.toContain("/icon-192.png");
    expect(embed).not.toContain("/icon-512.png");
  });
});
