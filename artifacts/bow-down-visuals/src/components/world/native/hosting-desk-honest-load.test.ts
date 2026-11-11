/**
 * HostingDesk (World native) — honest load standard
 * (deep-pins tranche 5). A phase machine over two legs
 * (plan + me): the me leg's 404 is the named no-profile
 * phase (hosting needs a creator profile to anchor to —
 * and a parsed plan still shows), any other me non-ok or
 * an unparseable me body is failed, and ready requires the
 * parsed me DTO. The plan leg is carried, not load-bearing:
 * if it alone fails, the desk still readies on the me leg
 * (whose DTO carries the same plan) — a designed tolerance,
 * pinned as such. Checkout: the embedded form mounts only
 * on ok + a clientSecret in the answer; anything else is
 * the didn't-start error. The portal tab claims "opened"
 * only past ok + url.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./HostingDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the load — the me leg decides, by name", () => {
  it("404 → no-profile (plan still lands); other !ok → failed; unparseable me → failed; ready needs the parsed DTO", () => {
    const body = slice(src, "const load = useCallback(async () => {", "async function startCheckout() {");
    expect(body).toContain('setPhase("loading");');
    expect(body).toContain("const planDto = planRes.ok ? parseHostingPlan(await planRes.json().catch(() => null)) : null;");
    expect(body).toContain("if (meRes.status === 404) {");
    expect(body).toContain('setPhase("no-profile");');
    expect(body).toContain("if (!meRes.ok) {");
    expect(body).toContain("const meDto = parseHostingMe(await meRes.json().catch(() => null));");
    expect(body).toContain("if (!meDto) {");
    expect(body).toContain("setMe(meDto);");
    expect(body).toContain("setPlan(planDto ?? meDto.plan);");
    expect(body).toContain('setPhase("ready");');
    expect(body.indexOf("if (!meDto) {")).toBeLessThan(body.indexOf('setPhase("ready");'));
    const catchPart = slice(body, "} catch {", "}, [authHeaders]);");
    expect(catchPart).toContain('setPhase("failed");');
    expect(catchPart).not.toContain("setMe");
    // the 404 branch returns with the plan applied but never claims ready
    const s404 = slice(body, "if (meRes.status === 404) {", "if (!meRes.ok) {");
    expect(s404).toContain("if (planDto) setPlan(planDto);");
    expect(s404).not.toContain('setPhase("ready")');
  });
});

describe("checkout + portal — claimed only from real answers", () => {
  it("the embedded secret mounts only on ok + clientSecret; otherwise the didn't-start error", () => {
    const body = slice(src, "async function startCheckout() {", "/* Manage / cancel:");
    expect(body).toContain("if (!result.ok || !payload.clientSecret) {");
    expect(body).toContain('setError(apiErrorMessage(payload, t("profileHosting.checkoutDidntStart")) || t("profileHosting.checkoutDidntStart"));');
    expect(body).toContain("setClientSecret(payload.clientSecret);");
    expect(body.indexOf("if (!result.ok || !payload.clientSecret) {")).toBeLessThan(
      body.indexOf("setClientSecret(payload.clientSecret);"),
    );
  });

  it("the portal opens only on ok + url", () => {
    const body = slice(src, "const res = await fetch(\"/api/creator-tiers/portal\", {", "if (phase === \"loading\") {");
    expect(body).toContain("if (!res.ok || !payload.url) {");
    expect(body).toContain('setPortalError(apiErrorMessage(payload, t("worldHostingDesk.portalOpenFailed")) || t("worldHostingDesk.portalOpenFailed"));');
  });
});
