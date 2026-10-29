/**
 * world-parity-server-desks — source-contract pins for the desk side
 * of the World money-parity SERVER lane. Once the beats and tip-jar
 * rails learned to answer an embedded clientSecret, the two desks
 * that were stopped on hosted-only rails (Lane 6 §3a/§3c) must:
 * - ask for the embedded presentation whenever a publishable key is
 *   present (the device can mount the form);
 * - branch on the clientSecret BEFORE the hosted-tab fallback, and
 *   mount the shared EmbeddedSessionCheckout in-panel;
 * - keep the hosted new tab strictly as the fallback (no-key /
 *   hosted answer / kill switch), never a same-tab walk-out.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const beats = read("../../components/world/native/BeatsDesk.tsx");
const portraitTip = read("../../components/world/native/PortraitTip.tsx");

describe("BeatsDesk embedded checkout (Lane 6 §3a unblock)", () => {
  it("mounts the shared embedded checkout and asks for it when a key is present", () => {
    expect(beats).toContain("EmbeddedSessionCheckout");
    expect(beats).toContain("hasStripePublishableKey");
    expect(beats).toContain('uiMode: hasStripePublishableKey() ? "embedded" : undefined');
    expect(beats).toContain('data-testid="world-beats-embedded-checkout"');
    expect(beats).toContain("<EmbeddedSessionCheckout clientSecret={licenseSecret} />");
  });

  it("branches on the clientSecret before the hosted-tab fallback", () => {
    const secretBranch = beats.indexOf('data["clientSecret"]');
    const tabFallback = beats.indexOf('window.open(url, "_blank", "noopener,noreferrer")');
    expect(secretBranch).toBeGreaterThan(-1);
    expect(tabFallback).toBeGreaterThan(-1);
    expect(secretBranch).toBeLessThan(tabFallback);
    /* The fallback survives, and there is still no same-tab walk-out. */
    expect(beats).not.toContain("window.location.href = ");
  });
});

describe("PortraitTip embedded checkout (Lane 6 §3c unblock)", () => {
  it("mounts the shared embedded checkout and asks for it when a key is present", () => {
    expect(portraitTip).toContain("EmbeddedSessionCheckout");
    expect(portraitTip).toContain("hasStripePublishableKey");
    expect(portraitTip).toContain('uiMode: hasStripePublishableKey() ? "embedded" : undefined');
    expect(portraitTip).toContain('data-testid="world-portrait-tip-embedded-checkout"');
    expect(portraitTip).toContain("<EmbeddedSessionCheckout clientSecret={embeddedSecret} />");
  });

  it("branches on the clientSecret before the hosted-tab fallback; 503 intent fallback intact", () => {
    const secretBranch = portraitTip.indexOf('data["clientSecret"]');
    const tabFallback = portraitTip.indexOf('window.open(url, "_blank", "noopener,noreferrer")');
    expect(secretBranch).toBeGreaterThan(-1);
    expect(tabFallback).toBeGreaterThan(-1);
    expect(secretBranch).toBeLessThan(tabFallback);
    expect(portraitTip).toContain("co.status !== 503");
    expect(portraitTip).toContain("tipIntentPath(page.handle)");
    expect(portraitTip).not.toContain("window.location.href = ");
  });
});
