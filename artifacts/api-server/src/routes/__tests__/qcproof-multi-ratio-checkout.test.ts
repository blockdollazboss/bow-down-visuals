import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAssContent, type CaptionBurnConfig } from "../../lib/caption-ass";
import { isEmbeddedCheckoutEnabled } from "../../lib/embedded-checkout";
import { isStripeTestModeKey } from "../../lib/stripe-client";

/**
 * QC-200 pre-proof — Q184 (multi-ratio + reframe + caption burn),
 * Q196 (checkout shape, code core) and the API half of Q178
 * (ExportDoctor superseded). "Subject kept in frame" on real footage
 * and phone-viewport live checkout completion stay OWNER-WALK /
 * Gate #5 — never claimed here.
 */

const readApi = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const readRoute = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const readFE = (p: string) =>
  readFileSync(new URL(`../../../../bow-down-visuals/src/${p}`, import.meta.url), "utf8");

describe("Q184 multi-ratio presets: exact dimensions + aspect math", () => {
  const src = readRoute("generate/export-multi-ratio.ts");
  const presets = [...src.matchAll(/"(\d+:\d+)":\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)/g)].map(
    (m) => [m[1], Number(m[2]), Number(m[3])] as const,
  );
  it("pins 9:16 720x1280, 1:1 1080x1080, 4:5 1080x1350 (and 16:9 1280x720)", () => {
    expect(Object.fromEntries(presets.map(([k, w, h]) => [k, [w, h]]))).toEqual({
      "16:9": [1280, 720],
      "9:16": [720, 1280],
      "1:1": [1080, 1080],
      "4:5": [1080, 1350],
    });
    for (const [key, w, h] of presets) {
      const [a, b] = key.split(":").map(Number);
      expect(w / h).toBeCloseTo(a / b, 10);
    }
  });
  it("pad filter: blurred full-bleed bg (increase+crop+boxblur) under a fit-inside fg (decrease), centred overlay", () => {
    expect(src).toContain("force_original_aspect_ratio=increase");
    expect(src).toContain("boxblur=20:1[bg]");
    expect(src).toContain("force_original_aspect_ratio=decrease,format=rgba[fg]");
    expect(src).toContain("[bg][fg]overlay=(W-w)/2:(H-h)/2");
  });
  it("crop filter: aspect-conditional centre crop then exact scale + setsar=1", () => {
    expect(src).toMatch(/crop='if\(gt\(iw\/ih,/);
    expect(src).toContain("scale=${width}:${height},setsar=1");
  });
  it("render dispatch picks crop vs pad from the job mode, default pad", () => {
    expect(src).toContain('job.mode === "crop"');
    expect(src).toContain('z.enum(["pad", "crop"]).optional().default("pad")');
  });
});

describe("Q184 auto-reframe endpoint + output canvases", () => {
  const src = readRoute("generate/auto-reframe.ts");
  it("POST /auto-reframe is auth-gated and outputs per-ratio canvases (not the old hard-coded 1080x1920)", () => {
    expect(src).toContain('router.post("/auto-reframe", requireAuth');
    expect(src).toContain('"9:16": [1080, 1920]');
    expect(src).toContain('"1:1": [1080, 1080]');
    expect(src).toContain('"4:5": [1080, 1350]');
    expect(src).toContain('"16:9": [1920, 1080]');
  });
  it("subject-tracked is only claimed when a tracked path actually rendered; otherwise honest centre-crop", () => {
    expect(src).toContain('"subject-tracked"');
    expect(src).toContain('"centre-crop"');
    expect(src).toContain("detectSubjectsInVideo");
  });
});

describe("Q184 caption burn rides the main export path", () => {
  it("export-video imports buildAssContent from lib/caption-ass, writes the .ass file and injects the subtitles filter", () => {
    const src = readRoute("generate/export-video.ts");
    expect(src).toContain('import { buildAssContent, type CaptionBurnConfig } from "../../lib/caption-ass"');
    expect(src).toContain("buildAssContent(captions!, TARGET_W, TARGET_H");
    expect(src).toContain("bdv-captions-${exportId}.ass");
    expect(src).toContain("[vout]subtitles='${escapedPath}'[vfinal]");
    // captions only burn when active (mode not none + lines/cards present)
    expect(src).toContain('captions.mode !== "none"');
  });
  it("buildAssContent produces a real ASS script: header, canvas, timed Dialogue for the line", () => {
    const cfg: CaptionBurnConfig = {
      mode: "burn", stylePreset: "classic", position: "bottom", fontSize: "medium",
      textColor: "#FFFFFF", outline: true, background: false,
      showArtistName: false, showSongTitle: false, artistNameText: "", songTitleText: "",
      lines: [{ startSec: 1, endSec: 3.5, text: "Hello creators" }],
    };
    const ass = buildAssContent(cfg, 720, 1280, 10);
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("PlayResX: 720");
    expect(ass).toContain("PlayResY: 1280");
    expect(ass).toContain("Dialogue: 0,0:00:01.00,0:00:03.50");
    expect(ass).toContain("Hello creators");
  });
});

describe("Q196 checkout shape — embedded-first, hosted only as fallback, kill-switch gated", () => {
  it("kill switch: default ON; off/hosted/false/0 disable embedded", () => {
    expect(isEmbeddedCheckoutEnabled({})).toBe(true);
    for (const v of ["off", "hosted", "false", "0", " OFF "]) {
      expect(isEmbeddedCheckoutEnabled({ EMBEDDED_CHECKOUT: v })).toBe(false);
    }
    expect(isEmbeddedCheckoutEnabled({ EMBEDDED_CHECKOUT: "on" })).toBe(true);
  });
  it("test mode enforced in code: guarded key check accepts sk_test_ and refuses live/other keys", () => {
    expect(isStripeTestModeKey("sk_test_abc")).toBe(true);
    expect(isStripeTestModeKey("sk_live_abc")).toBe(false);
    expect(isStripeTestModeKey("rk_live_abc")).toBe(false);
    const client = readApi("lib/stripe-client.ts");
    expect(client).toContain('if (!key.startsWith("sk_test_"))');
    expect(client).toContain("Live payment keys are not enabled");
  });
  it("(1) credit pack on /pricing: FE posts the embedded intent and mounts PaymentElement on-page; it never assigns a hosted URL", () => {
    const pricing = readFE("pages/pricing.tsx");
    expect(pricing).toContain('fetch("/api/embedded-checkout/credit-pack/intent"');
    expect(pricing).toContain("EmbeddedPaymentForm");
    expect(pricing).not.toContain("window.location.href = data.url");
    const route = readRoute("embedded-checkout.ts");
    expect(route).toContain('router.post("/embedded-checkout/credit-pack/intent", requireAuth');
    expect(route).toContain("createGuardedStripeClient");
    // kill switch 404s the embedded route when off
    expect(route).toContain("if (embeddedOff(res)) return;");
    // amount resolved server-side from the Stripe Price, never the client
    expect(route).toContain("stripe.prices.retrieve(priceId)");
    // hosted legacy endpoint remains reachable as fallback only
    expect(route).toContain("stay reachable as fallback only");
  });
  it("(2) store item: FE asks uiMode embedded and mounts EmbeddedSessionCheckout on a clientSecret, never redirecting to a hosted url", () => {
    const buy = readFE("pages/store-buy.tsx");
    expect(buy).toContain('uiMode: "embedded"');
    expect(buy).toContain("EmbeddedSessionCheckout clientSecret={embeddedSecret}");
    expect(buy).not.toMatch(/window\.location\.href\s*=\s*body\.url/);
    const store = readRoute("store.ts");
    // embedded only when requested AND the kill switch is on; otherwise the legacy hosted shape
    expect(store).toContain('parsed.data.uiMode === "embedded" && isEmbeddedCheckoutEnabled()');
    expect(store).toContain('ui_mode: "embedded_page" as const');
    expect(store).toContain("/store/success?session_id={CHECKOUT_SESSION_ID}");
    // same session answers both shapes: url + clientSecret + the uiMode it actually used
    expect(store).toContain("clientSecret: session.client_secret ?? null");
    expect(store).toContain('? "embedded" : "hosted"');
  });
  it("amounts/splits unchanged by presentation: store split is the flat-5% fee split in the same session metadata", () => {
    const store = readRoute("store.ts");
    expect(store).toContain("Math.round((amountCents * PLATFORM_FEE_BPS) / 10_000)");
    expect(store).toContain('platform_fee_cents: String(feeCents)');
    expect(store).toContain('creator_amount_cents: String(creatorCents)');
    const shared = readApi("lib/stripe-checkout.ts");
    expect(shared).toContain('ui_mode: "embedded_page" as const');
    /* stack1300: amounts + metadata are unchanged by presentation,
       but the idempotency key fingerprints the exact request — the
       presentations no longer share one (Stripe refused that). */
    expect(shared).toContain("requestFingerprint: fingerprintStripeRequestParams(params)");
  });
});

describe("Q178 ExportDoctor — superseded (owner Oct 29 ruling), API residue check", () => {
  it("no export-doctor route file exists on this lineage and the generate route folder carries no reference", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const genDir = new URL("../generate/", import.meta.url).pathname;
    expect(fs.existsSync(path.join(genDir, "export-doctor.ts"))).toBe(false);
    const hits = fs.readdirSync(genDir).filter((f: string) => /export-?doctor/i.test(f));
    expect(hits).toEqual([]);
  });
});
