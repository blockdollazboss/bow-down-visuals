import { describe, expect, it } from "vitest";
import { previewUrlFor, relinkForExport, proxyStatusLabel, EXPORT_HONESTY_LINE, type ProxyRowLike } from "./proxy-editing";

const ready: ProxyRowLike = { original_url: "https://x/orig.mp4", proxy_url: "https://cdn/proxy.mp4", status: "ready" };

describe("proxy editing — editor honesty helpers (board 184)", () => {
  it("ready + enabled: preview plays the proxy and badges it as a proxy", () => {
    const p = previewUrlFor("https://x/orig.mp4", ready, true);
    expect(p.isProxy).toBe(true);
    expect(p.url).toBe("https://cdn/proxy.mp4");
    expect(p.badge).toContain("Proxy");
  });
  it("disabled, generating, or no row: preview plays the original and says so", () => {
    expect(previewUrlFor("https://x/orig.mp4", ready, false).isProxy).toBe(false);
    expect(previewUrlFor("https://x/orig.mp4", { ...ready, status: "generating", proxy_url: null }, true).url).toBe("https://x/orig.mp4");
    expect(previewUrlFor("https://x/orig.mp4", null, true).badge).toContain("Original");
  });
  it("export relink swaps proxies back to originals and counts them", () => {
    const out = relinkForExport(["https://cdn/proxy.mp4", "https://x/other.mp4"], [ready]);
    expect(out).toEqual({ urls: ["https://x/orig.mp4", "https://x/other.mp4"], relinked: 1 });
  });
  it("status labels never claim a proxy that does not exist", () => {
    expect(proxyStatusLabel(null)).toContain("no proxy");
    expect(proxyStatusLabel({ ...ready, status: "failed" })).toContain("original");
    expect(proxyStatusLabel(ready)).toContain("export uses the original");
    expect(EXPORT_HONESTY_LINE).toContain("never from a proxy");
  });
});
