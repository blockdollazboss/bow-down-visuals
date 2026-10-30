/**
 * api-error-guard.test.ts — the error-truth guard (stack900 Lane L1).
 *
 * The Gate #3 lesson: a customer was shown the raw server code
 * `credits_disabled`. Every API failure body must pass through the
 * translator in `api-error.ts` before it can reach a render. These pins
 * scan the whole frontend source so the raw-render shapes cannot creep
 * back in:
 *
 *  - no `throw new Error(body.error / body.message …)` chains,
 *  - no direct `setX(body.error ?? …)` / `setX(body.message || …)` sets,
 *  - no old catch idiom `setX(err instanceof Error ? err.message : …)`,
 *  - no `(err as Error).message || …` or `x.reason … .message` renders.
 *
 * Toast descriptions fed `err.message` are covered centrally by the
 * toast funnel in `hooks/use-toast.ts` (pinned below). A tiny allowlist
 * covers values that are NOT server bodies: locally composed validation
 * strings (`built.error`, `clean.error`) and results whose `error` is
 * already built through the translator at the source
 * (live-captions-client, dmca-report).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC).filter(
  (p) => !p.endsWith(join("lib", "api-error.ts")) && !p.endsWith(join("hooks", "use-toast.ts")),
);

const FORBIDDEN: Array<[string, RegExp]> = [
  ["direct-field-throw", /throw new Error\(\s*\(?\s*[A-Za-z_$][\w$]*(?:\s+as\s+[^)]*?)?\)?\??\.(error|message)\b/],
  ["typeof-throw", /throw new Error\(\s*typeof [A-Za-z_$][\w$]*\.(error|message) === "string" \? [A-Za-z_$][\w$]*\.(error|message)/],
  ["direct-field-set", /\bset[A-Z][\w$]*\(\s*\(?\s*[A-Za-z_$][\w$]*(?:\s+as\s+[^)]*?)?\)?\??\.(error|message)\s*(\?\?|\|\|)/],
  ["setter-catch-idiom", /\bset[A-Z][\w$]*\(\s*(?:err|e|error) instanceof Error \? (?:err|e|error)\.message :/],
  ["cast-render", /\(\s*(?:err|e|error) as Error\s*\)\.message\s*\|\|/],
  ["reason-render", /[A-Za-z_$][\w$]*\.reason instanceof Error \? [A-Za-z_$][\w$]*\.reason\.message :/],
];

/** Bare `setX(v.error)` / `throw new Error(v.error)` sites whose value is
 *  locally composed copy or already translator-built at the source. */
const BARE_ALLOWLIST: Array<[string, string]> = [
  ["GroupProfileSettings.tsx", "setError(built.error)"],
  ["StationPanel.tsx", "setError(built.error)"],
  ["CreatorRooms.tsx", "setFormError(built.error)"],
  ["LiveCaptionsStudioPanel.tsx", "setNote(r.error)"],
  ["copyright.tsx", "setError(result.error)"],
  ["ThemeKitPanel.tsx", "throw new Error(clean.error)"],
];

describe("error truth: no raw server error reaches a render", () => {
  it("no file throws or sets a raw API body field", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const base = file.split("/").pop() ?? file;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // allowlisted local-copy sites (see BARE_ALLOWLIST) are exempt
        if (BARE_ALLOWLIST.some(([f, s]) => f === base && line.replace(/\s+/g, "").includes(s.replace(/\s+/g, "")))) return;
        for (const [name, re] of FORBIDDEN) {
          if (re.test(line)) offenders.push(`${name} ${file.slice(SRC.length)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("bare .error renders exist only at the allowlisted local-copy sites", () => {
    const offenders: string[] = [];
    const bare = /\bset[A-Z][\w$]*\(\s*[A-Za-z_$][\w$]*\.error\s*\)|throw new Error\(\s*[A-Za-z_$][\w$]*\.error\s*\)/g;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(bare)) {
        const base = file.split("/").pop() ?? file;
        const ok = BARE_ALLOWLIST.some(
          ([f, s]) => f === base && m[0].replace(/\s+/g, "") === s.replace(/\s+/g, ""),
        );
        if (!ok) offenders.push(`${file.slice(SRC.length)} :: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the toast funnel sanitizes through the translator", () => {
    const toast = readFileSync(join(SRC, "hooks", "use-toast.ts"), "utf8");
    expect(toast).toContain('from "@/lib/api-error"');
    expect(toast).toContain("function toastText");
    expect(toast).toContain("messageForErrorCode(");
  });

  it("the out-of-credits signal protocol is preserved verbatim", () => {
    const helper = readFileSync(join(SRC, "lib", "api-error.ts"), "utf8");
    expect(helper).toContain('return "out_of_credits";');
    const music = readFileSync(join(SRC, "lib", "generate-music-audio.ts"), "utf8");
    expect(music).toContain('throw new Error("out_of_credits")');
  });
});
