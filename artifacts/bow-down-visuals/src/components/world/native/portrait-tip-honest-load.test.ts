/**
 * PortraitTip (World native) — honest load standard
 * (deep-pins tranche 5). A four-state load: loading, ready,
 * none, failed. "None" is earned two honest ways — a 404
 * (this creator has no tip page) or a 200 whose body the
 * strict parser rejects (no usable page) — while a
 * transport failure or any other non-ok lands on failed,
 * and the two states render DIFFERENT copy (tipNone vs
 * tipFailed), so a broken read never claims the page
 * doesn't exist. The send follows the page's own order:
 * embedded secret mounts in-card, a hosted url opens the
 * tab, a non-503 refusal throws the server's line, and a
 * 503 (payments not configured) falls to recording the
 * intent — whose sent state is labelled "intent", never
 * dressed as money received.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PortraitTip.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the page load — none and failed are different truths", () => {
  it("404 and unparseable earn none; other non-ok and throws earn failed; ready needs a parsed page", () => {
    const body = slice(src, "useEffect(() => {", "const effective = custom.trim()");
    expect(body).toContain('if (res.status === 404) { if (!cancelled) setState("none"); return; }');
    expect(body).toContain('if (!res.ok) throw new Error("tip page");');
    expect(body).toContain("const parsed = parseTipPage(await res.json());");
    expect(body).toContain('if (!parsed) { setState("none"); return; }');
    expect(body).toContain("setPage(parsed);");
    expect(body).toContain('setState("ready");');
    expect(body.indexOf('if (!res.ok) throw new Error("tip page");')).toBeLessThan(body.indexOf("setPage(parsed);"));
    const catchPart = slice(body, "} catch {", "})();");
    expect(catchPart).toContain('if (!cancelled) setState("failed");');
    expect(catchPart).not.toContain("setPage");
  });

  it("render: loading first; none and failed share a shell but never the same copy", () => {
    expect(src).toContain('if (state === "loading") {');
    expect(src).toContain('if (state === "none" || state === "failed" || !page) {');
    expect(src).toContain('state === "failed"\n          ? t("worldIdentityMisc.tipFailed")\n          : t("worldIdentityMisc.tipNone")');
    expect(src.indexOf('if (state === "loading") {')).toBeLessThan(
      src.indexOf('if (state === "none" || state === "failed" || !page) {'),
    );
  });
});

describe("the send — each rail's outcome is named as what it is", () => {
  it("embedded secret returns in-card; hosted url earns checkout; non-503 refusal throws; 503 falls to the intent", () => {
    const body = slice(src, "const send = async () => {", "if (state === \"loading\") {");
    expect(body).toContain('if (typeof data["clientSecret"] === "string" && data["clientSecret"]) {');
    expect(body).toContain('setEmbeddedSecret(data["clientSecret"]);');
    expect(body).toContain('setSent("checkout");');
    expect(body).toContain("} else if (co.status !== 503) {");
    expect(body).toContain('throw new Error(apiErrorLine(data, t("worldIdentityMisc.tipErrorFallback")));');
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorLine(data, t("worldIdentityMisc.tipErrorFallback")));');
    expect(body).toContain('setSent("intent");');
    expect(body.indexOf('setSent("checkout");')).toBeLessThan(body.indexOf('setSent("intent");'));
    expect(body.indexOf('if (!res.ok) throw new Error(apiErrorLine(data, t("worldIdentityMisc.tipErrorFallback")));')).toBeLessThan(
      body.indexOf('setSent("intent");'),
    );
  });
});
