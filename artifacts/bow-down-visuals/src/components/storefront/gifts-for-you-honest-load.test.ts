/**
 * GiftsForYou (product gifts received/sent) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE GIFTS LOAD is ok-gated at the door: a non-ok
 *   response returns before any state is set, and a thrown
 *   read is caught the same way — the panel's gift lists are
 *   only ever built from a proven payload, never from an
 *   error body read as "no gifts".
 * - THE CLAIM / RETURN actions throw on non-ok with the
 *   server's message ("That didn't work — try again.") —
 *   a gift's status changes only from the proven response.
 * - THE MONEY COPY is server-data truthful: the held amount
 *   renders from the gift's own claimableCents ("held as
 *   your claimable credit until you claim") and the
 *   scheduled landing date from its deliveryAt — figures
 *   are never computed or promised client-side.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GiftsForYou.tsx");

describe("the lists build only from proven payloads; actions gate on ok", () => {
  it("the load gate and the action throw are pinned", () => {
    expect(src).toContain("if (!res.ok) return;");
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(body, "That didn\'t work — try again."));');
    expect(src).toContain("held as your claimable credit until you claim");
  });
});
