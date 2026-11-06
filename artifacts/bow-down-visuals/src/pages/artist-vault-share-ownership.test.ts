/**
 * artist-vault-share-ownership.test.ts — Stack 200 Lane E1, item E-1.
 *
 * GET /artist-vaults returns the caller's own vaults PLUS every vault a
 * teammate shared with their team, but VaultCard rendered Share / Edit /
 * Delete on every card while the manage rail is owner-only server-side
 * (POST /artist-vaults/:id/share looks the vault up scoped by user_id —
 * a non-owner gets 404). A non-owner was shown controls that can only
 * fail, including a "Shared" button that tried to unshare someone
 * else's vault.
 *
 * The fix threads an explicit `isOwner` flag into VaultCard: the page
 * computes it from the record's own user_id against the signed-in user;
 * on a shared-with-me card the manage buttons are not rendered at all
 * and a "Shared with your team" badge stands in their place. Use
 * actions (Open / Set Active / Lock Consistency) stay — they are
 * legitimate for an accessible vault and Lock Consistency performs no
 * server write to the vault (it builds a prompt locally).
 *
 * House FE idiom: source pins (node harness, no DOM) + catalog pins.
 * The badge copy is UNREVIEWED English verbatim in the non-en catalogs
 * (house locale practice), pinned identical below so a real translation
 * is a deliberate one-line change per catalog.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(new URL(".", import.meta.url).pathname, "..");
const page = readFileSync(join(SRC, "pages", "artist-vault.tsx"), "utf8");

const LOCALES = ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"] as const;
function catalog(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SRC, "locales", `${locale}.json`), "utf8")) as Record<string, unknown>;
}

/** The VaultCard function body, from its declaration to the PAGE marker. */
const cardStart = page.indexOf("function VaultCard(");
const cardEnd = page.indexOf("/* ─────────────────────────── PAGE", cardStart);
const card = page.slice(cardStart, cardEnd);

describe("E-1 — VaultCard ownership flag", () => {
  it("VaultCard declares an explicit isOwner prop", () => {
    expect(cardStart).toBeGreaterThan(-1);
    expect(card).toContain("isOwner: boolean;");
    expect(card).toContain("isOwner }: {");
  });

  it("the page computes isOwner from the record's user_id against the signed-in user", () => {
    expect(page).toContain("isOwner={!user?.id || vault.user_id === user.id}");
  });

  it("a non-owner card renders NO manage buttons (share / edit / delete)", () => {
    // Edit only joins the row-action list under the isOwner branch.
    expect(card).toContain("...(isOwner");
    expect(card).toContain('label: t("artistVault.editButton")');
    // Share renders only in the isOwner arm of the ternary; the other
    // arm is the badge.
    expect(card).toContain("{isOwner ? (");
    expect(card).toContain("onClick={onShare}");
    // Delete renders only under the isOwner guard.
    expect(card).toContain("{isOwner && (");
    expect(card).toContain("onClick={onDelete}");
  });

  it("a non-owner card shows the 'Shared with your team' badge instead", () => {
    expect(card).toContain('t("artistVault.sharedWithTeam")');
    // The badge is a span, not a button — nothing clickable to fail.
    const badgeAt = card.indexOf('t("artistVault.sharedWithTeam")');
    const spanOpen = card.lastIndexOf("<span", badgeAt);
    expect(spanOpen).toBeGreaterThan(-1);
    expect(card.slice(spanOpen, badgeAt)).not.toContain("onClick");
  });

  it("use actions stay unconditional (Open / Set Active / Lock Consistency)", () => {
    expect(card).toContain("onClick={onSetActive}");
    expect(card).toContain("onClick={onLock}");
    expect(card).toContain('label: t("artistVault.openButton")');
    // None of the use actions sit inside an isOwner conditional.
    const lockAt = card.indexOf("onClick={onLock}");
    expect(card.slice(Math.max(0, lockAt - 400), lockAt)).not.toContain("isOwner");
  });

  it("the owner path is unchanged — share button keeps its shared/unshared label flip", () => {
    expect(card).toContain('vault.team_id ? t("artistVault.sharedLabel") : t("artistVault.shareLabel")');
    expect(card).toContain('vault.team_id ? t("artistVault.unshareTitle") : t("artistVault.shareTitle")');
  });
});

describe("E-1 — badge copy in all 10 catalogs", () => {
  it("artistVault.sharedWithTeam resolves in en and is present in every catalog", () => {
    for (const locale of LOCALES) {
      const ns = catalog(locale)["artistVault"] as Record<string, unknown>;
      expect(ns["sharedWithTeam"], locale).toBe("Shared with your team");
    }
  });
});
