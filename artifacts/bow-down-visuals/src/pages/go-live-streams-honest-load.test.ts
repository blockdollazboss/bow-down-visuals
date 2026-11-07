/**
 * Go Live stream schedule — honest load states (Stack-200 hardening
 * D2, census section A item 14: the "empty lie" family).
 *
 * Before: loadStreams() acted only `if (stRes.ok)` and Promise.allSettled
 * swallowed the rest — there was NO streams loading or error state
 * anywhere, so the "No streams scheduled yet" panel rendered during
 * load AND on failure; a creator with scheduled streams could
 * double-schedule. After: a streamsState machine mirrors
 * broadcast.tsx's channelsState (loading | ready | error) — failure
 * keeps whatever is on screen and raises the error state; the schedule
 * renders loading, then error + retry, and the empty copy ONLY on a
 * confirmed-empty successful load.
 *
 * The FE suite runs in node (no DOM), so — like the sibling honest-load
 * pins — these tests pin the state machine in source: which setter each
 * load outcome calls, and which render branch each state reaches. The
 * new copy keys are English in en.json; the other nine catalogs carry
 * the English verbatim as UNREVIEWED placeholders (registered in the
 * goLive wave's legit-identical allowlists).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./go-live.tsx");
const loadAt = page.indexOf("const loadStreams = async () => {");
const loader = page.slice(loadAt, page.indexOf("await Promise.allSettled", loadAt));

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

describe("failure path — the schedule never reads as empty on a failed load", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(loader).toContain('if (!stRes.ok) throw new Error("streams load failed");');
    expect(loader).toContain('setStreamsState("error")');
  });

  it("a successful load records the ready state", () => {
    expect(loader).toContain('setStreamsState("ready")');
  });

  it("the state machine starts at loading, like broadcast's channelsState", () => {
    expect(page).toContain('useState<"loading" | "ready" | "error">("loading")');
  });

  it("failure with nothing loaded renders the error panel with a retry wired to the real load", () => {
    expect(page).toContain('data-testid="go-live-streams-load-error"');
    expect(page).toContain('t("goLive.streamsLoadError")');
    expect(page).toContain('t("goLive.streamsRetry")');
    /* the retry is wired to the page load, in both error branches */
    expect(page.match(/onClick=\{\(\) => void load\(\)\}/g)).toHaveLength(2);
  });

  it("a failed reload keeps the loaded schedule and shows the error banner over it", () => {
    expect(page).toContain('data-testid="go-live-streams-reload-error"');
    expect(page).toContain('streamsState === "error" && (');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the first load renders the pending state, not the empty panel", () => {
    expect(page).toContain('data-testid="go-live-streams-loading"');
    expect(page).toContain('t("goLive.streamsLoading")');
  });

  it("the empty panel renders only after the loading and failure branches", () => {
    const loadAt2 = page.indexOf('data-testid="go-live-streams-loading"');
    const errAt = page.indexOf('data-testid="go-live-streams-load-error"');
    const emptyAt = page.indexOf('t("goLive.noUpcomingTitle"');
    expect(loadAt2).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadAt2);
    expect(emptyAt).toBeGreaterThan(errAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the goLive honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["goLive.streamsLoading", "goLive.streamsLoadError", "goLive.streamsRetry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
