/**
 * PushSubscriptionRepair (the invisible push-subscription
 * self-heal) — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * A classification pin: this component renders null and does
 * exactly one job — once per signed-in user, it asks the
 * shared helper to repair a stale push subscription. Its
 * silence is BY DESIGN and honest: the source states that a
 * repair failure "must never surface as an app error; the
 * settings card shows real state" — the truthful surface for
 * push state is PushNotificationSettings (pinned in this
 * same tranche), and this upkeep claims nothing anywhere.
 * The once-per-user guard (repairedFor) keeps it from ever
 * becoming a retry loop.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PushSubscriptionRepair.tsx");

describe("the self-heal is silent by design and bounded to once per user", () => {
  it("failure never surfaces; the settings card owns the real state", () => {
    expect(src).toContain("repairPushSubscription(deps).catch(() => {");
    expect(src).toContain("the settings card shows real state");
    expect(src).toContain("if (!user || repairedFor.current === user.id) return;");
    expect(src).toContain("return null;");
  });
});
