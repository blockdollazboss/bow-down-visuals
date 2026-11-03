/**
 * llc-desk — stack1500 world parity wave #3 item 24 pins.
 *
 * The LLC Guide desk is the guide's native form. These pins
 * hold: both prices come from the registry at 100 and match
 * the API route's LLC_GUIDE_CREDIT_COST constant; the ask
 * payload trims the question, uppercases the optional state
 * only when it's a real 2-letter code, and caps history at
 * the schema's 10; the plan payload refuses a missing state
 * or an unknown creator type; the plan guard mirrors the
 * route's parsePlanJson bar (steps need title AND detail,
 * zero usable steps = no plan, caps 8 steps / 5 notes); the
 * disclaimer is the page's own words.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  LLC_ASK_COST,
  LLC_ASK_PATH,
  LLC_CREATOR_TYPES,
  LLC_DISCLAIMER_BODY,
  LLC_DISCLAIMER_TITLE,
  LLC_PLAN_COST,
  LLC_PLAN_PATH,
  buildLlcAskPayload,
  buildLlcPlanPayload,
  llcAnswerOf,
  llcPlanOf,
} from "./llc-desk";
import { getCreditCost } from "../credit-costs";

const apiSrc = (rel: string) =>
  readFileSync(new URL(`../../../../api-server/src/${rel}`, import.meta.url), "utf8");

describe("prices — registry-pinned, route-matched", () => {
  it("ask and plan are both 100 from the registry", () => {
    expect(getCreditCost(LLC_ASK_PATH)).toMatchObject({ feature: "LLC Guide Answer", cost: 100 });
    expect(getCreditCost(LLC_PLAN_PATH)).toMatchObject({ feature: "LLC Guide Plan", cost: 100 });
    expect(LLC_ASK_COST).toBe(100);
    expect(LLC_PLAN_COST).toBe(100);
    const route = apiSrc("routes/generate/llc-guide.ts");
    const constant = route.match(/LLC_GUIDE_CREDIT_COST\s*=\s*\n?\s*Number\(process\.env\["LLC_GUIDE_CREDIT_COST"\]\) \|\| (\d+)/);
    expect(constant).not.toBeNull();
    expect(LLC_ASK_COST).toBe(Number(constant![1]));
  });
});

describe("payloads", () => {
  it("ask trims, normalizes the state, caps history at 10", () => {
    const history = Array.from({ length: 14 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${i}`,
    }));
    const body = buildLlcAskPayload("  Do I need an EIN? ", " ga ", history);
    expect(body.question).toBe("Do I need an EIN?");
    expect(body.state).toBe("GA");
    expect(body.history).toHaveLength(10);
    expect(body.history[0]!.content).toBe("m4");
    expect(buildLlcAskPayload("Q", "", []).state).toBeUndefined();
    expect(buildLlcAskPayload("Q", "Georgia", []).state).toBeUndefined();
  });

  it("plan refuses a missing state or unknown creator type", () => {
    expect(buildLlcPlanPayload("", "musician", "")).toBeNull();
    expect(buildLlcPlanPayload("GA", "astronaut", "")).toBeNull();
    expect(buildLlcPlanPayload(" ga ", "musician", "  My Label LLC ")).toEqual({
      state: "GA",
      creatorType: "musician",
      businessName: "My Label LLC",
    });
    expect(LLC_CREATOR_TYPES.map((t) => t.key)).toEqual([
      "musician",
      "streamer",
      "youtuber",
      "podcaster",
      "designer",
      "other",
    ]);
  });
});

describe("response guards", () => {
  it("the plan guard enforces the route's bar", () => {
    const plan = llcPlanOf({
      plan: {
        title: "Georgia LLC plan",
        totalEstimate: "$130–$230",
        steps: [
          { title: "File Articles", detail: "With the Secretary of State.", estCost: "$100", timeline: "1 day" },
          { title: "", detail: "No title — dropped." },
          { title: "No detail", detail: "" },
        ],
        notes: ["Keep your registered agent current.", ""],
      },
    })!;
    expect(plan.title).toBe("Georgia LLC plan");
    expect(plan.steps).toHaveLength(1);
    expect(plan.notes).toEqual(["Keep your registered agent current."]);
    expect(llcPlanOf({ plan: { steps: [] } })).toBeNull();
    expect(llcPlanOf({})).toBeNull();
    expect(llcAnswerOf({ answer: "Yes — file first." })).toBe("Yes — file first.");
    expect(llcAnswerOf({ answer: "  " })).toBeNull();
  });

  it("the disclaimer is the page's own words", () => {
    expect(LLC_DISCLAIMER_TITLE).toBe("Not legal advice.");
    expect(LLC_DISCLAIMER_BODY).toContain("doesn't create an attorney–client relationship");
    expect(LLC_DISCLAIMER_BODY).toContain("Secretary of State");
  });
});
