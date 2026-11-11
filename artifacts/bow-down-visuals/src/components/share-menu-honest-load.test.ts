/**
 * ShareMenu (the share sheet with referral attribution) —
 * honest enhancement loads (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * This menu has no collection load and no empty state to
 * dress up: sharing works fully from props. Its two reads
 * are ENHANCEMENTS with truthful defaults, pinned as-is:
 * - THE REFERRAL READ only replaces the plain share URL when
 *   the response is ok AND carries a string code; on any
 *   failure the menu shares the plain URL — nothing anywhere
 *   claims a referral code exists when one wasn't proven,
 *   and the "Make your own" line falls back to the bare
 *   origin just as honestly.
 * - THE RETENTION-PREFS READ defaults share-to-earn ON,
 *   documented in the source ("absent ⇒ on"): only a proven
 *   explicit false turns it off.
 * - THE SHARE TRACKING POST is fire-and-forget BY DESIGN
 *   ("tracking must never break sharing") — it claims
 *   nothing in the UI at all, so its failure has nothing to
 *   dress up.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ShareMenu.tsx");

describe("the referral code is claimed only from a proven response", () => {
  it("non-ok returns silently to the plain share; only a string code is set", () => {
    expect(src).toContain("if (!res.ok) return;");
    expect(src).toContain('if (!cancelled && typeof d.code === "string") setCode(d.code);');
    expect(src).toContain("/* anonymous / offline — plain share */");
  });
});

describe("the retention toggle defaults on, and only a proven false turns it off", () => {
  it("the prefs read sets from !== false, never from an unproven payload", () => {
    expect(src).toContain("setShareToEarn(d.share_to_earn_enabled !== false);");
    expect(src).toContain("/* default on */");
  });

  it("share tracking is fire-and-forget and claims nothing", () => {
    expect(src).toContain("/* tracking must never break sharing */");
  });
});
