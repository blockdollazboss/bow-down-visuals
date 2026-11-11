/**
 * DeveloperApiSettings (API keys + docked WebhooksSettings) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 3). Every load in this security surface already
 * meets the standard; the pin records the machines:
 *
 * - KEYS LOAD: three distinct outcomes, never conflated — a 503 is
 *   the plain "aren't switched on yet" state (unavailable); any
 *   other failure before the first successful load is the error
 *   line + Retry; success keys the loaded shape. A failed REFRESH
 *   after a good load keeps the loaded keys on screen instead of
 *   blanking the surface (loadedRef guards the error branch). The
 *   genuine empty ("No keys yet") renders only after a successful
 *   load, inside the loaded arm of unavailable → error → loading →
 *   content.
 * - KEY WRITES: create throws a non-ok (the 409 cap refusal surfaces
 *   the server's own words via apiErrorMessage) before the fresh key
 *   is shown — the shown-once block is reachable only from a real
 *   ok; revoke throws on non-ok before claiming the revocation, and
 *   its failure toast says it couldn't.
 * - WEBHOOKS: independent of the keys load (its own failure says
 *   "aren't switched on yet" plainly instead of taking the keys UI
 *   down); create / pause / delete all throw on non-ok before the
 *   reload; the delivery-history read carries the family's own
 *   empty-lie fix — a failed read renders the loadError line +
 *   retry (webhook-deliveries-load-error), never "No deliveries
 *   yet", which is gated on a successful empty read.
 *
 * NO FIX in this lane — the surface already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const s = read("./DeveloperApiSettings.tsx");
const keysPart = s.slice(0, s.indexOf("/* ─── Webhooks"));
const hooksPart = s.slice(s.indexOf("/* ─── Webhooks"));

describe("keys load: unavailable, first-load error, and loaded are never conflated", () => {
  it("a 503 lands in unavailable; other failures throw; the error only shows pre-first-load", () => {
    const load = keysPart.slice(keysPart.indexOf("async function load() {"), keysPart.indexOf("useEffect(() => { load(); }, []);"));
    expect(load).toContain("if (res.status === 503) {");
    expect(load).toContain("setUnavailable(true);");
    expect(load).toContain('if (!res.ok) throw new Error("load failed");');
    expect(load).toContain("loadedRef.current = true;");
    expect(load).toContain("if (!loadedRef.current) setLoadError(true);");
  });

  it("render order: unavailable, error + retry, loading, then content with the gated empty", () => {
    const unIdx = keysPart.indexOf("{unavailable ? (");
    const errIdx = keysPart.indexOf(") : loadError ? (", unIdx);
    const loadIdx = keysPart.indexOf(") : keys === null ? (", errIdx);
    const emptyIdx = keysPart.indexOf("No keys yet. Create one above to start building.");
    expect(unIdx).toBeGreaterThan(-1);
    expect(errIdx).toBeGreaterThan(unIdx);
    expect(loadIdx).toBeGreaterThan(errIdx);
    expect(emptyIdx).toBeGreaterThan(loadIdx);
    expect(keysPart).toContain("API keys aren't switched on for this site yet — check back soon.");
    expect(keysPart).toContain("Couldn't load your API keys.");
    expect(keysPart).toContain("onClick={() => { void load(); }}");
  });
});

describe("key writes check their answers", () => {
  it("create: the cap refusal surfaces the server's words; the shown-once key only follows an ok", () => {
    const create = keysPart.slice(keysPart.indexOf("async function createKey() {"), keysPart.indexOf("async function revoke("));
    expect(create).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "create failed"));');
    expect(create.indexOf("if (!res.ok) throw")).toBeLessThan(create.indexOf("setFreshKey(data.plaintext ?? null);"));
    expect(keysPart).toContain("Copy this key now — it is shown only once.");
  });

  it("revoke: success is toasted only after the ok; failure says it couldn't", () => {
    const revoke = keysPart.slice(keysPart.indexOf("async function revoke("), keysPart.indexOf("const activeKeyCount"));
    expect(revoke).toContain('if (!res.ok) throw new Error("revoke failed");');
    expect(revoke.indexOf("if (!res.ok) throw")).toBeLessThan(revoke.indexOf('toast({ title: "Key revoked"'));
    expect(revoke).toContain("Couldn't revoke that key");
  });
});

describe("webhooks: an independent load, checked writes, an honest history", () => {
  it("the hooks load fails into its own plain unavailable line, not the keys error", () => {
    const load = hooksPart.slice(hooksPart.indexOf("async function loadHooks() {"), hooksPart.indexOf("useEffect(() => { void loadHooks(); }, []);"));
    expect(load).toContain('if (!res.ok) throw new Error("load failed");');
    expect(load).toContain("setUnavailable(true);");
    expect(hooksPart).toContain("Webhooks aren't switched on yet — check back soon.");
    const emptyIdx = hooksPart.indexOf("No endpoints yet. Register one above to start receiving events.");
    expect(emptyIdx).toBeGreaterThan(hooksPart.indexOf(") : hooks === null ? ("));
  });

  it("create / status / delete throw on non-ok before claiming anything", () => {
    expect(hooksPart).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "create failed"));');
    expect(hooksPart).toContain('if (!res.ok) throw new Error("update failed");');
    expect(hooksPart).toContain('if (!res.ok) throw new Error("delete failed");');
    expect(hooksPart).toContain("Copy this signing secret now — it is shown only once.");
  });

  it("delivery history: a failed read is the error line + retry, never 'no deliveries'", () => {
    expect(hooksPart).toContain("setDeliveriesFailed(true);");
    expect(hooksPart).toContain('data-testid="webhook-deliveries-load-error"');
    expect(hooksPart).toContain('t("webhookDeliveries.loadError")');
    expect(hooksPart).toContain("onClick={() => void loadDeliveries(h.id)}");
    const failIdx = hooksPart.indexOf("{deliveriesFailed ? (");
    const emptyIdx = hooksPart.indexOf("No deliveries yet for this endpoint.");
    expect(failIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeGreaterThan(failIdx);
  });
});
