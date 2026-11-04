/**
 * llc-desk — the seam behind the Get Paid room's native LLC
 * Guide desk (stack1500 world parity wave #3, census item 24;
 * the census counted /llc-guide PARTIAL — reachable only as a
 * door before this wave).
 *
 * Source of truth: artifacts/api-server/src/routes/generate/
 * llc-guide.ts.
 *   POST /api/llc-guide/ask  { question (1–1000 chars), state?
 *     (2-letter code), history (≤10 of {role, content}) }
 *     → { answer, creditsUsed, creditsRemaining }
 *   POST /api/llc-guide/plan { state (2-letter, required),
 *     creatorType, businessName? (≤120) }
 *     → { plan: FilingPlan, creditsUsed, creditsRemaining }
 *   FilingPlan = { title, steps: [{ title, detail, estCost,
 *     timeline }] (route keeps ≤8, title+detail required),
 *     totalEstimate, notes (≤5) }.
 *
 * PRICE: both rails are 100 Visual Bucs, pinned from the
 * registry rows ("/api/llc-guide/ask" = "LLC Guide Answer",
 * "/api/llc-guide/plan" = "LLC Guide Plan") — matching
 * the route's LLC_GUIDE_CREDIT_COST and the page's badges. The
 * desk runs both through the World's confirmed-spend seam
 * (the page's unconfirmed post is NOT copied): a decline runs
 * nothing; a 402 lands in the out-of-Bucs state.
 *
 * The disclaimer is the page's own (locales en llcGuide):
 * "Not legal advice." + the informational-purposes body —
 * rendered in the desk verbatim. The plan guard mirrors the
 * route's parsePlanJson bar: a plan with zero usable steps is
 * a failure verdict, never a dressed-up empty plan.
 */
import { getCreditCost } from "../credit-costs";

export const LLC_ASK_PATH = "/api/llc-guide/ask";
export const LLC_PLAN_PATH = "/api/llc-guide/plan";
export const LLC_FEATURE_ASK = "LLC Guide Answer";
export const LLC_FEATURE_PLAN = "LLC Guide Plan";

function registryCost(path: string): number {
  const row = getCreditCost(path);
  if (!row) throw new Error(`llc-desk: no credit-cost registry row for ${path}`);
  return row.cost;
}

export const LLC_ASK_COST = registryCost(LLC_ASK_PATH);
export const LLC_PLAN_COST = registryCost(LLC_PLAN_PATH);

export const LLC_DISCLAIMER_TITLE = "Not legal advice.";
export const LLC_DISCLAIMER_BODY =
  "This guide (including AI answers) is for informational purposes only and doesn't create an attorney–client relationship. LLC rules, fees, and tax treatment vary by state and change over time — verify everything with your Secretary of State and consult a licensed business attorney or CPA for your situation.";

export const LLC_CREATOR_TYPES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "musician", label: "Musician / artist" },
  { key: "streamer", label: "Streamer" },
  { key: "youtuber", label: "YouTuber" },
  { key: "podcaster", label: "Podcaster" },
  { key: "designer", label: "Designer / freelancer" },
  { key: "other", label: "Creator (other)" },
];

export interface LlcChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function buildLlcAskPayload(
  question: string,
  state: string,
  history: LlcChatMessage[],
): { question: string; state?: string; history: LlcChatMessage[] } {
  const code = state.trim().toUpperCase();
  return {
    question: question.trim(),
    ...(code.length === 2 ? { state: code } : {}),
    history: history.slice(-10),
  };
}

export function buildLlcPlanPayload(
  state: string,
  creatorType: string,
  businessName: string,
): { state: string; creatorType: string; businessName: string } | null {
  const code = state.trim().toUpperCase();
  if (code.length !== 2) return null;
  if (!LLC_CREATOR_TYPES.some((t) => t.key === creatorType)) return null;
  return { state: code, creatorType, businessName: businessName.trim().slice(0, 120) };
}

export interface LlcPlanStep {
  title: string;
  detail: string;
  estCost: string;
  timeline: string;
}

export interface LlcPlan {
  title: string;
  steps: LlcPlanStep[];
  totalEstimate: string;
  notes: string[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/* ─── display strings (i18n seam, stack100 locale unit 46) ────────
   llcPlanOf takes an optional strings bundle whose default is the
   original English, byte-identical; the desk builds the bundle
   from the worldTeamLegal catalog keys. */

export interface LlcPlanStrings {
  fallbackTitle: string;
}

export const LLC_PLAN_STRINGS_EN: LlcPlanStrings = {
  fallbackTitle: "Your LLC filing plan",
};

/** Build the bundle from a translate function (the desk's `t`). */
export function llcPlanStrings(translate: (key: string) => string): LlcPlanStrings {
  return { fallbackTitle: translate("worldTeamLegal.llcPlanFallbackTitle") };
}

/** The route's parsePlanJson bar, mirrored: steps need a title
 *  AND a detail; zero usable steps = no plan. */
export function llcPlanOf(data: unknown, strings: LlcPlanStrings = LLC_PLAN_STRINGS_EN): LlcPlan | null {
  if (!data || typeof data !== "object") return null;
  const plan = (data as Record<string, unknown>)["plan"];
  if (!plan || typeof plan !== "object") return null;
  const o = plan as Record<string, unknown>;
  const steps: LlcPlanStep[] = [];
  for (const raw of Array.isArray(o["steps"]) ? o["steps"] : []) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const title = str(s["title"]);
    const detail = str(s["detail"]);
    if (!title || !detail) continue;
    steps.push({ title, detail, estCost: str(s["estCost"]), timeline: str(s["timeline"]) });
    if (steps.length >= 8) break;
  }
  if (steps.length === 0) return null;
  return {
    title: str(o["title"]) || strings.fallbackTitle,
    steps,
    totalEstimate: str(o["totalEstimate"]),
    notes: (Array.isArray(o["notes"]) ? o["notes"] : [])
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      .map((n) => n.trim())
      .slice(0, 5),
  };
}

/** The ask response guard: a non-empty answer string or null. */
export function llcAnswerOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const answer = (data as Record<string, unknown>)["answer"];
  return typeof answer === "string" && answer.trim().length > 0 ? answer : null;
}
