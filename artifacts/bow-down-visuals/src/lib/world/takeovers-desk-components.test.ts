/**
 * takeovers-desk-components — stack1500 world parity wave #3
 * item 33 source-contract pins. The Takeovers desk must sit
 * in the Charts board stack as a ({ isLight }) desk (public
 * rails — guests inquire in full), with:
 * - both offers loaded from their rails and rendered whole
 *   (price, duration, surfaces, specs) with an inquiry form
 *   under each;
 * - the inquiry framed honestly everywhere: a request, not
 *   a purchase — the "no charge" line under the form and
 *   the "nothing was charged, nothing booked" confirmation;
 * - no auth or spend path anywhere;
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/TakeoversDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the desk shape + the Charts mount", () => {
  it("is a named ({ isLight }) desk rooted at its testid", () => {
    expect(desk).toContain("export function TakeoversDesk({ isLight }: { isLight: boolean })");
    expect(desk).toContain('data-testid="world-takeovers-desk"');
  });

  it("StationPanel stacks it at the Charts board behind a DeskDoor", () => {
    expect(panel).toContain('const TakeoversDesk = lazy(() => import("@/components/world/native/TakeoversDesk")');
    expect(panel).toContain("<TakeoversDesk isLight={isLight} />");
  });
});

describe("both offers + the honest inquiry", () => {
  it("both offer rails load; both blocks render with forms", () => {
    expect(desk).toContain("fetch(path)");
    expect(desk).toContain("SPOTLIGHT_OFFER_PATH");
    expect(desk).toContain("LOADING_OFFER_PATH");
    expect(desk).toContain("inquirePath={SPOTLIGHT_INQUIRE_PATH}");
    expect(desk).toContain("inquirePath={LOADING_INQUIRE_PATH}");
    expect(desk).toContain("buildTakeoverInquiryPayload(form)");
    expect(desk).toContain("takeoverInquiryOk(data)");
  });

  it("the framing is honest: a request, not a purchase", () => {
    expect(desk).toContain("An inquiry is a request, not a purchase — no charge is taken when you send it.");
    expect(desk).toContain("Nothing was charged");
    expect(desk).toContain("nothing is booked yet");
  });

  it("public rails: no auth headers, no spend path", () => {
    expect(desk).not.toContain("useDeskAuthHeaders");
    expect(desk).not.toContain("confirmedFetch");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
