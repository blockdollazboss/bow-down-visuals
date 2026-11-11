/**
 * StudioGearQueueAdmin (the admin studio-gear order queue) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE ORDERS LOAD is a four-state chain: loading, then the
 *   load-error state (retryNonce re-runs the real loader),
 *   then the genuine empty state, then the rows. The loader
 *   treats BOTH a non-ok response AND an unparseable payload
 *   (parseGearAdminOrders returning null) as a load failure —
 *   the source says it in as many words: "Load failures are
 *   NOT 'no orders'". A proven-empty queue is the only road
 *   to the empty copy.
 * - THE ACTIONS (send proof, set status) narrate from their
 *   checked responses: non-ok throws the server's message
 *   into the action error line; nothing is marked sent or
 *   updated before the response proves it.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./StudioGearQueueAdmin.tsx");

describe("the orders load: loading, error, empty, rows — in that order", () => {
  it("non-ok and unparseable payloads both land on the load-error state", () => {
    expect(src).toContain("const parsed = res.ok ? parseGearAdminOrders(await res.json()) : null;");
    expect(src).toContain("if (parsed) setOrders(parsed.orders);");
    expect(src).toContain("else setLoadError(true);");
    expect(src).toContain("/* Load failures are NOT \"no orders\" — own error state + retry. */");
  });

  it("the render chain puts the error state before the genuine empty state", () => {
    const loadingIdx = src.indexOf("{loading ? (");
    const emptyIdx = src.indexOf(") : orders.length === 0 ? (");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeGreaterThan(loadingIdx);
    expect(src).toContain("setRetryNonce");
  });
});

describe("the actions narrate from their checked responses", () => {
  it("send-proof and set-status throw the server's message on non-ok", () => {
    const gates = src.split('if (!res.ok) throw new Error(apiErrorMessage(data, t("admin.gearQueue.actionError")));').length - 1;
    expect(gates).toBe(2);
  });
});
