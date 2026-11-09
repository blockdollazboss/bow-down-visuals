/**
 * Team — honest load states (Stack 400 C-28: the honest-load pin
 * layer completing the "empty lie" audit).
 *
 * Two load shapes live on this page:
 *  - The teams/invites load is HONEST-WITH-CO-RENDER: the shared
 *    api() helper throws on a non-ok answer, load()'s catch records
 *    the error text in the page's message line, and that line
 *    renders above the lists — a failure is announced in words,
 *    never silently an empty team list.
 *  - The owner/admin spending read is the explicit shape: its own
 *    try/catch raises spendingFailed, and the failure renders as a
 *    named error card (data-testid="team-spending-error") gated on
 *    the failure flag, apart from the spending rows themselves.
 * This file pins those shapes in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./team.tsx");
const loadAt = page.indexOf("async function load(): Promise<boolean> {");
const loader = page.slice(loadAt, page.indexOf("useEffect(() => {", loadAt));

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}
const KEYS = ["team.errorLoad"];

describe("teams/invites load — honest-with-co-render", () => {
  it("the api helper throws on a non-ok answer and load()'s catch records the message", () => {
    expect(page).toContain("if (!res.ok) throw new Error(apiErrorMessage(data,");
    expect(loader).toContain('setMsg(plainErrorText(e, t("team.errorLoad")));');
    expect(loader).toContain("setTeams(data.teams ?? []);");
    expect(loader).toContain("setInvites(data.invites ?? []);");
    expect(loader).toContain("setLoading(false);");
  });

  it("the message line renders on the page, so a failed load is announced in words", () => {
    expect(page).toContain("{msg && (");
  });
});

describe("spending read — the explicit failure card", () => {
  it("the spending catch raises its own failed flag and clears it on success", () => {
    expect(loader).toContain("setSpendingFailed(true);");
    expect(loader).toContain("setSpendingFailed(false);");
  });

  it("the failure renders as a named error card, gated on the failure flag", () => {
    expect(page).toContain("{spendingFailed && spending.length === 0 && (activeTeam.myRole === \"owner\" || activeTeam.myRole === \"admin\") && (");
    expect(page).toContain('data-testid="team-spending-error"');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the team load key", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of KEYS) expect(typeof cat[k] === "string" && cat[k].length > 0).toBe(true);
  });
});
