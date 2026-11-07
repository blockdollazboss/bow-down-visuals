/**
 * Messages in-thread call history — honest load states (Stack-200
 * hardening D2, census section A item 13: the "empty lie" family).
 *
 * Before: loadCalls()'s catch did setCalls([]) with no signal, and
 * calls merge into the thread timeline — a failed read made past
 * video-call entries simply not exist, indistinguishable from "you
 * never called". After: failure leaves the entries alone and raises
 * callsFailed; the timeline shows a one-line honest note with a retry
 * (hidden while searching, where calls are out of scope by design);
 * a successful load clears the flag, and opening a thread resets it.
 *
 * The FE suite runs in node (no DOM), so — like the sibling honest-load
 * pins — these tests pin the state machine in source: which setter each
 * load outcome calls, and which render branch each state reaches. The
 * new copy keys are English in en.json; the other nine catalogs carry
 * the English verbatim as UNREVIEWED placeholders.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./messages.tsx");
const loadAt = page.indexOf("async function loadCalls(");
const loader = page.slice(loadAt, page.indexOf("async function loadThread(", loadAt));

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

describe("failure path — call history never silently empties on a failed load", () => {
  it("the load catch raises the failed flag (after the stale-request guard) and never writes the empty array", () => {
    expect(loader).toContain("setCallsFailed(true)");
    /* setCalls([]) survives exactly once in the file: loadThread's
       deliberate reset when a new thread opens */
    expect(page.match(/setCalls\(\[\]\)/g)).toHaveLength(1);
    expect(page).toContain("setMsgs([]); setCalls([]); setCallsFailed(false);");
  });

  it("a successful load clears the failed flag", () => {
    expect(loader).toContain("setCallsFailed(false)");
  });

  it("failure renders the one-line note with a retry wired to the real loader", () => {
    expect(page).toContain('data-testid="thread-calls-load-error"');
    expect(page).toContain('t("threadCalls.loadError")');
    expect(page).toContain('t("threadCalls.retry")');
    expect(page).toContain("void loadCalls(activeId)");
  });

  it("the note stays out of the way of loading, thread errors, and search", () => {
    expect(page).toContain("{callsFailed && !threadLoading && !threadError && !threadQuery.trim() && (");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the threadCalls honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["threadCalls.loadError", "threadCalls.retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
