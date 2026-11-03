/**
 * reserve-at-submit-intent-rails.test.ts — stack1400 ruling #43 Part A.
 *
 * The poll-charge family reverses to RESERVE-AT-SUBMIT (the stack1000
 * music-rail precedent): charge up front at submit; provider failure /
 * no-output / save failure refunds the reserve in full; success keeps
 * it. This suite pins the four intent-rail members — runway-clip
 * (Runway/Seedance/Veo), artist-image (async + sync variants),
 * intro-outro, logo — plus the shared lib's order contract:
 *
 *  Source-shape pins (per rail, spend-pacing style):
 *   - a reserve charge (chargeGenerationReserve) exists and its call
 *     site precedes the rail's first provider submission call;
 *   - the reserve is recorded (recordGenerationReserve) and the old
 *     awaiting-intent record call is gone;
 *   - polls branch on the reserve: confirmGenerationReserve on
 *     success, refundOrFailGenerationIntent on failure;
 *   - artist-image's old generate-then-charge helper (chargeForImage)
 *     is gone entirely.
 *
 *  Behavioral order pins (the shared helpers, event-log style):
 *   - success flow events are [charge, provider] and confirming the
 *     reserve moves NO money (no second charge);
 *   - a refused reserve means the provider stub is never invoked;
 *   - provider failure events are [charge, provider, refund] with
 *     exactly one full refund, and a repeat failure handling refunds
 *     nothing more.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import type { GenerationChargeIntentRow } from "@workspace/db";
import {
  chargeGenerationReserve,
  recordGenerationReserve,
  confirmGenerationReserve,
  refundGenerationReserve,
  resolvePendingCharge,
  generationChargeKey,
  type GenerationChargeIntentStore,
  type ChargeFn,
  type RefundFn,
} from "../../../lib/generation-charge-intents";
import { OutOfCreditsError } from "../../../lib/credits";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(path.join(here, "..", f), "utf8");

describe("source-shape pins — every intent rail reserves before its provider call", () => {
  const rails: Array<{ file: string; providerCalls: string[] }> = [
    {
      file: "runway-clip.ts",
      providerCalls: ["await submitVeoVideo({", "client.imageToVideo.create", "client.textToVideo.create"],
    },
    {
      file: "artist-image.ts",
      providerCalls: ["getOpenAI().images.generate", "await generateWithIdeogram(", "await generateWithNanoBanana({", "client.textToImage.create"],
    },
    { file: "intro-outro.ts", providerCalls: ["client.imageToVideo.create", "client.textToVideo.create"] },
    { file: "logo.ts", providerCalls: ["getOpenAI().images.generate", "client.textToImage.create"] },
  ];

  for (const rail of rails) {
    it(`${rail.file}: reserve precedes every provider submission site it guards`, () => {
      const src = read(rail.file);
      const reserveIdx = src.indexOf("await chargeGenerationReserve({");
      expect(reserveIdx, "a reserve charge call exists").toBeGreaterThan(-1);
      for (const call of rail.providerCalls) {
        const idx = src.indexOf(call);
        expect(idx, `${call} exists`).toBeGreaterThan(-1);
        /* A reserve charge precedes the provider call site: rails
           with one submit reserve (runway-clip, intro-outro) place it
           before every site; sync-variant rails reserve inside the
           helper/handlers that run before each call. */
        expect(idx, `${call} is preceded by a reserve`).toBeGreaterThan(reserveIdx);
      }
      expect(src).toContain("recordGenerationReserve");
      expect(src).not.toContain("recordGenerationChargeIntent");
      expect(src).toContain("confirmGenerationReserve");
      expect(src).toContain("refundOrFailGenerationIntent");
    });
  }

  it("runway-clip: the single submit reserve precedes both the Veo and the Runway submissions", () => {
    const src = read("runway-clip.ts");
    const reserveIdx = src.indexOf("await chargeGenerationReserve({");
    expect(src.indexOf("await submitVeoVideo({")).toBeGreaterThan(reserveIdx);
    expect(src.indexOf("await client.imageToVideo.create", reserveIdx)).toBeGreaterThan(reserveIdx);
    /* Veo's task id is minted BEFORE the reserve so its charge keeps
       the gen-charge:<taskId> key — the mint precedes the charge. */
    expect(src.indexOf("const veoTaskId = useVeo ?")).toBeGreaterThan(-1);
    expect(src.indexOf("const veoTaskId = useVeo ?")).toBeLessThan(reserveIdx);
  });

  it("artist-image: every sync variant reserves through reserveForImage before generating, and chargeForImage is gone", () => {
    const src = read("artist-image.ts");
    expect(src).not.toContain("chargeForImage");
    expect(src).toContain("await reserveForImage(req, creditCost");
    /* All three sync variants hold a reserve before the provider call. */
    expect(src.split("refundSyncImageReserve").length - 1).toBeGreaterThanOrEqual(3);
    expect(src).toContain("confirmSyncImageReserve");
  });

  it("logo: the premium sync path reserves before the GPT Image call; the standard path before textToImage", () => {
    const src = read("logo.ts");
    const premiumReserve = src.indexOf("await chargeGenerationReserve({");
    const imageCall = src.indexOf("getOpenAI().images.generate");
    expect(premiumReserve).toBeGreaterThan(-1);
    expect(imageCall).toBeGreaterThan(premiumReserve);
    const standardReserve = src.indexOf("await chargeGenerationReserve({", premiumReserve + 1);
    expect(standardReserve).toBeGreaterThan(premiumReserve);
    expect(src.indexOf("client.textToImage.create")).toBeGreaterThan(standardReserve);
  });

  it("no rail still describes the old timing as its design (no 'credits pending on SUCCEEDED' / 'charged on SUCCEEDED only')", () => {
    for (const f of ["runway-clip.ts", "artist-image.ts", "intro-outro.ts", "logo.ts"]) {
      const src = read(f);
      expect(src).not.toContain("credits pending on SUCCEEDED");
      expect(src).not.toContain("credits are only charged on SUCCEEDED");
    }
  });
});

/* ── Behavioral order pins over the shared helpers ────────────────── */

function makeStore() {
  const rows = new Map<string, GenerationChargeIntentRow>();
  let seq = 0;
  const store = {
    async recordIntent(input: any) {
      if (rows.has(input.taskId)) return;
      rows.set(input.taskId, {
        id: `intent-${++seq}`,
        task_id: input.taskId,
        rail: input.rail,
        user_id: input.userId,
        credits: input.credits,
        project_id: input.projectId ?? null,
        action: input.action,
        extra: input.extra ?? null,
        status: input.status ?? "awaiting",
        delivered_at: null,
        created_at: new Date(),
        resolved_at: null,
      } as GenerationChargeIntentRow);
    },
    async getIntent(taskId: string) { return rows.get(taskId) ?? null; },
    async markCharged() { return false; },
    async markFailed(taskId: string) {
      const r = rows.get(taskId);
      if (!r || r.status !== "awaiting") return false;
      r.status = "failed"; return true;
    },
    async markDelivered() {},
    async listDeliveredUncharged() { return []; },
    async expireUndelivered() { return []; },
    async confirmReserve(taskId: string) {
      const r = rows.get(taskId);
      if (!r || r.status !== "reserved") return false;
      r.status = "charged"; r.resolved_at = new Date(); return true;
    },
    async claimReserveRefund(taskId: string) {
      const r = rows.get(taskId);
      if (!r || r.status !== "reserved") return null;
      r.status = "refunded"; r.resolved_at = new Date(); return r;
    },
    async releaseReserveRefundClaim(taskId: string) {
      const r = rows.get(taskId);
      if (!r || r.status !== "refunded") return false;
      r.status = "reserved"; r.resolved_at = null; return true;
    },
    async listDeliveredReserves() { return []; },
    async listStaleReserves() { return []; },
  } as unknown as GenerationChargeIntentStore;
  return { store, rows };
}

describe("behavioral order pins — charge precedes provider; failure refunds once; success keeps", () => {
  it("success: events [charge, provider]; confirm moves no money", async () => {
    const { store, rows } = makeStore();
    const events: string[] = [];
    const chargeFn: ChargeFn = async () => { events.push("charge"); return 995; };
    const refundFn: RefundFn = async () => { events.push("refund"); };
    const provider = async () => { events.push("provider"); return "task-9"; };

    const reserve = await chargeGenerationReserve(
      { userId: "u1", credits: 5, action: "Runway Video Clip", chargeKey: generationChargeKey("job-9") },
      chargeFn,
    );
    expect(reserve.ok).toBe(true);
    const taskId = await provider();
    await recordGenerationReserve(store, {
      taskId, rail: "runway-clip", userId: "u1", credits: 5, action: "Runway Video Clip",
      chargeKey: generationChargeKey("job-9"),
    });
    const resolved = await resolvePendingCharge(store, taskId, null);
    expect(await confirmGenerationReserve(store, taskId, resolved!)).toBe("confirmed");
    expect(events).toEqual(["charge", "provider"]);
    expect(rows.get(taskId)!.status).toBe("charged");
    void refundFn;
  });

  it("insufficient: the provider stub is never invoked when the reserve is refused", async () => {
    const events: string[] = [];
    const failing: ChargeFn = async () => { events.push("charge"); throw new OutOfCreditsError(); };
    const provider = async () => { events.push("provider"); };
    const reserve = await chargeGenerationReserve(
      { userId: "u1", credits: 5, action: "X", chargeKey: generationChargeKey("job-10") },
      failing,
    );
    if (reserve.ok) await provider();
    expect(reserve).toMatchObject({ ok: false, reason: "insufficient" });
    expect(events).toEqual(["charge"]);
  });

  it("provider failure: events [charge, provider, refund] — exactly one full refund across repeat handling", async () => {
    const { store, rows } = makeStore();
    const events: string[] = [];
    const refunded: number[] = [];
    const chargeFn: ChargeFn = async () => { events.push("charge"); return 995; };
    const refundFn: RefundFn = async (_u, amount) => { events.push("refund"); refunded.push(amount); };
    await chargeGenerationReserve(
      { userId: "u1", credits: 5, action: "Runway Video Clip", chargeKey: generationChargeKey("job-11") },
      chargeFn,
    );
    events.push("provider"); /* the provider call that then fails at poll */
    await recordGenerationReserve(store, {
      taskId: "task-11", rail: "runway-clip", userId: "u1", credits: 5, action: "Runway Video Clip",
      chargeKey: generationChargeKey("job-11"),
    });
    const resolved = await resolvePendingCharge(store, "task-11", null);
    expect(await refundGenerationReserve(store, "task-11", resolved!, "provider failed", refundFn)).toBe("refunded");
    const again = await resolvePendingCharge(store, "task-11", null);
    expect(await refundGenerationReserve(store, "task-11", again!, "provider failed", refundFn)).toBe("already");
    expect(events).toEqual(["charge", "provider", "refund"]);
    expect(refunded).toEqual([5]);
    expect(rows.get("task-11")!.status).toBe("refunded");
  });
});
