/**
 * C-48 safety pin — guard suite for the GPT-6.1 Sol merge.
 *
 * Two invariants, both enforced by source census (the same ruler the
 * classification was made with), because the failure mode is silent: a
 * route that forgets the pin doesn't break, it just quietly costs more,
 * and a route that sends a rejected sampling param only 400s at runtime
 * against the paid provider.
 *
 *  1. REASONING PIN — GPT-6.1 Sol defaults to medium reasoning and
 *     reasoning tokens bill as output. Trivial routes (enumerated in
 *     TRIVIAL_TEXT_CALL_FILES / TRIVIAL_TEXT_CALL_SITES in lib/ai-clients)
 *     must spread LOW_REASONING_PARAMS at every pinned create call, and
 *     NO other file may use the constant — a substantive route pinned by
 *     accident is exactly the bug this prevents. Adding a create call to
 *     a registered file (or a pin anywhere new) fails here until the
 *     classification in ai-clients.ts is updated on purpose.
 *
 *  2. REJECTED PARAMS — 6.1 Sol rejects temperature / top_p / logprobs /
 *     top_logprobs on Chat Completions. Those keys may survive ONLY in
 *     the acquitted allowlist below, where they are provably not 6.1
 *     call params (photo color-grading fields/schemas, prompt text
 *     describing those fields, and the Groq free-chat raw fetch, which
 *     is a different provider and model). Anywhere else, the key fails
 *     this suite — classify consciously before allowlisting.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOW_REASONING_PARAMS,
  TRIVIAL_TEXT_CALL_FILES,
  TRIVIAL_TEXT_CALL_SITES,
  getTextModel,
} from "../ai-clients";

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const ALL_FILES = walk(SRC_ROOT);
const rel = (full: string) => path.relative(SRC_ROOT, full).split(path.sep).join("/");
const byRel = new Map(ALL_FILES.map((f) => [rel(f), f]));
const read = (r: string) => fs.readFileSync(byRel.get(r)!, "utf8");
const count = (src: string, needle: string) => src.split(needle).length - 1;

/** Pin usages = LOW_REASONING_PARAMS occurrences outside the import statement. */
function pinUsages(src: string): number {
  const importBlock = src.match(/import\s*\{[^}]*\}\s*from\s*["'][^"']*ai-clients["']/s)?.[0] ?? "";
  return count(src, "LOW_REASONING_PARAMS") - count(importBlock, "LOW_REASONING_PARAMS");
}

const REJECTED_PARAM_ALLOWLIST: Record<string, string> = {
  "lib/photo-render.ts": "photo develop settings struct/defaults (color temperature field)",
  "routes/free-chat.ts": "Groq free-chat raw fetch — different provider, model openai/gpt-oss-120b",
  "routes/generate/lane-export.ts": "photo grade default settings object",
  "routes/generate/photo-editor.ts": "zod schema for photo develop settings",
  "routes/generate/pro-tools-ai.ts": "prompt text naming the photo settings fields",
  "routes/generate/pro-tools-ffmpeg.ts": "photo develop settings interface",
};
const REJECTED_RE = /\btemperature\s*:|\btop_p\s*:|\btop_logprobs\s*:|\blogprobs\s*:/;

describe("C-48 safety pin", () => {
  it("the pin is exactly reasoning_effort low — one key, no other value", () => {
    expect(LOW_REASONING_PARAMS).toEqual({ reasoning_effort: "low" });
    expect(Object.keys(LOW_REASONING_PARAMS)).toEqual(["reasoning_effort"]);
  });

  it("the centralized text model defaults to gpt-6.1-sol and stays env-overridable", () => {
    const saved = process.env["OPENAI_TEXT_MODEL"];
    delete process.env["OPENAI_TEXT_MODEL"];
    try {
      expect(getTextModel()).toBe("gpt-6.1-sol");
      process.env["OPENAI_TEXT_MODEL"] = "gpt-6-astra";
      expect(getTextModel()).toBe("gpt-6-astra");
    } finally {
      if (saved === undefined) delete process.env["OPENAI_TEXT_MODEL"];
      else process.env["OPENAI_TEXT_MODEL"] = saved;
    }
  });

  it("every registered trivial file exists and pins EVERY create call", () => {
    for (const file of TRIVIAL_TEXT_CALL_FILES) {
      expect(byRel.has(file), `${file} is registered but missing`).toBe(true);
      const src = read(file);
      const creates = count(src, "completions.create");
      expect(creates, `${file} registered as trivial but has no create call`).toBeGreaterThan(0);
      expect(pinUsages(src), `${file}: every create call must spread LOW_REASONING_PARAMS`).toBe(creates);
    }
  });

  it("mixed files pin exactly the registered subset of their create calls", () => {
    for (const site of TRIVIAL_TEXT_CALL_SITES) {
      expect(byRel.has(site.file), `${site.file} is registered but missing`).toBe(true);
      const src = read(site.file);
      expect(count(src, "completions.create"), `${site.file}: create-call count drifted from the registry`).toBe(
        site.totalCreateCalls,
      );
      expect(pinUsages(src), `${site.file}: pinned-call count drifted from the registry`).toBe(site.pinnedCreateCalls);
    }
  });

  it("no unregistered file uses the pin (no substantive route pinned by accident)", () => {
    const registered = new Set<string>([
      ...TRIVIAL_TEXT_CALL_FILES,
      ...TRIVIAL_TEXT_CALL_SITES.map((s) => s.file),
    ]);
    const offenders: string[] = [];
    for (const [r, full] of byRel) {
      if (r === "lib/ai-clients.ts" || registered.has(r)) continue;
      const src = fs.readFileSync(full, "utf8");
      if (pinUsages(src) > 0) offenders.push(r);
    }
    expect(offenders).toEqual([]);
  });

  it("rejected sampling params survive only in the acquitted allowlist", () => {
    const offenders: string[] = [];
    for (const [r, full] of byRel) {
      if (r === "lib/ai-clients.ts") continue; // the doc comment naming the rule
      const src = fs.readFileSync(full, "utf8");
      if (REJECTED_RE.test(src) && !(r in REJECTED_PARAM_ALLOWLIST)) offenders.push(r);
    }
    expect(offenders).toEqual([]);
    // and the allowlist must not rot: every entry still carries its acquitted key
    for (const r of Object.keys(REJECTED_PARAM_ALLOWLIST)) {
      expect(byRel.has(r), `allowlisted ${r} is missing`).toBe(true);
      expect(REJECTED_RE.test(read(r)), `allowlisted ${r} no longer matches — drop it from the allowlist`).toBe(true);
    }
  });
});
