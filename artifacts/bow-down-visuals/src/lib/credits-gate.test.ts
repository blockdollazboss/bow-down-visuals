/**
 * credits-gate pins (QC-200 fix queue #2 — the false "Not Enough
 * Visual Bucs" family).
 *
 * Live defect being pinned shut: /detector and /contracts rendered the
 * insufficient-funds card AT LOAD for an account holding 87,795 VB
 * (checks cost 200 / 300). Two mechanisms: unconditional mounts of the
 * presentational card, and the spend-confirm dialog's
 * `profile?.credits ?? 0` fallback treating an unloaded/failed balance
 * read as a proven 0.
 *
 * These tests pin (a) the pure gate decision for every balance read,
 * (b) the three formerly-unconditional pages now proving through the
 * gate, and (c) a tree-wide guard: EVERY <OutOfCredits mount in src is
 * either gated by a caller-side proof state (server 402 state, ternary,
 * early return) or passes a `cost` through the gate. An unconditional,
 * cost-less mount fails this suite.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { balanceReadFromAuth, decideCreditsGate } from "./credits-gate";

const SRC = resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

describe("decideCreditsGate — the card renders only on a proven insufficient balance", () => {
  it("rich balance → no card (the live defect: 87,795 VB vs a 200 VB check)", () => {
    expect(decideCreditsGate({ status: "ready", balance: 87795 }, 200)).toBe("nothing");
    expect(decideCreditsGate({ status: "ready", balance: 87795 }, 300)).toBe("nothing");
  });

  it("balance still loading → no card, the checking state instead", () => {
    expect(decideCreditsGate({ status: "loading" }, 200)).toBe("checking");
  });

  it("balance read failed → no card, the honest error state instead", () => {
    expect(decideCreditsGate({ status: "failed" }, 200)).toBe("balance-error");
  });

  it("signed out → no card and no claim", () => {
    expect(decideCreditsGate({ status: "signed-out" }, 200)).toBe("nothing");
  });

  it("genuinely insufficient → the card shows", () => {
    expect(decideCreditsGate({ status: "ready", balance: 100 }, 200)).toBe("card");
    expect(decideCreditsGate({ status: "ready", balance: 0 }, 200)).toBe("card");
    expect(decideCreditsGate({ status: "ready", balance: 199 }, 200)).toBe("card");
  });

  it("balance exactly at the price is affordable → no card", () => {
    expect(decideCreditsGate({ status: "ready", balance: 200 }, 200)).toBe("nothing");
  });
});

describe("balanceReadFromAuth — an unknown balance is never a proven 0", () => {
  it("auth still loading → loading, whatever the profile holds", () => {
    expect(
      balanceReadFromAuth({ loading: true, hasUser: true, profileCredits: 87795 }),
    ).toEqual({ status: "loading" });
    expect(
      balanceReadFromAuth({ loading: true, hasUser: true, profileCredits: null }),
    ).toEqual({ status: "loading" });
  });

  it("signed in, load finished, profile never arrived → failed (not 0)", () => {
    expect(
      balanceReadFromAuth({ loading: false, hasUser: true, profileCredits: null }),
    ).toEqual({ status: "failed" });
  });

  it("no user → signed-out", () => {
    expect(
      balanceReadFromAuth({ loading: false, hasUser: false, profileCredits: null }),
    ).toEqual({ status: "signed-out" });
  });

  it("profile present → ready with the spendable balance, including a real 0", () => {
    expect(
      balanceReadFromAuth({ loading: false, hasUser: true, profileCredits: 87795 }),
    ).toEqual({ status: "ready", balance: 87795 });
    expect(
      balanceReadFromAuth({ loading: false, hasUser: true, profileCredits: 0 }),
    ).toEqual({ status: "ready", balance: 0 });
  });
});

describe("the named surfaces prove through the gate", () => {
  it("/detector mounts the notice with its check cost", () => {
    expect(read("pages/media-detector.tsx")).toContain("<OutOfCredits cost={CREDIT_COST} />");
  });

  it("/contracts mounts the notice with the analyzer cost", () => {
    expect(read("pages/contracts.tsx")).toContain("<OutOfCredits cost={CREDIT_COST} />");
  });

  it("/movies mounts the notice with its cheapest paid action's cost", () => {
    expect(read("pages/movies.tsx")).toContain("<OutOfCredits cost={CLIP_DETECT_CREDITS} />");
  });

  it("OutOfCredits renders the card behind the gate when a cost is given", () => {
    const src = read("components/OutOfCredits.tsx");
    expect(src).toContain("decideCreditsGate");
    expect(src).toContain('if (decision === "nothing") return null;');
    // The card itself renders exactly twice: the server-proven legacy
    // path (no cost) and the gate's proven-insufficient decision.
    expect(src.match(/<OutOfCreditsCard/g)?.length).toBe(2);
  });

  it("the spend-confirm dialog no longer treats an unknown balance as 0", () => {
    const src = read("contexts/CreditConfirmContext.tsx");
    expect(src).not.toMatch(/profile\?\.credits \?\? 0/);
    expect(src).toContain("balanceReadFromAuth");
    expect(src).toContain("provenBalance");
    // The Not-enough warning may only render on a proven balance.
    expect(src).toContain("provenBalance !== null && !affordable");
    // And Confirm stays disabled while the balance is unproven.
    expect(src).toContain("disabled={provenBalance === null || !affordable}");
  });
});

/* ------------------------------------------------------------------ */
/* Tree-wide guard: classify every <OutOfCredits mount. A mount is     */
/* lawful only if (a) it passes a cost through the gate, or (b) a      */
/* caller-side proof state gates it — a `state &&` on the same line,   */
/* an enclosing `&&` / ternary expression, or an early return on the   */
/* proof state. Anything else is the false-insufficiency defect.       */
/* ------------------------------------------------------------------ */

function listTsx(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) listTsx(p, acc);
    else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) acc.push(p);
  }
  return acc;
}

function mountIsLawful(src: string, mountIdx: number): boolean {
  // (a) the tag itself carries a cost prop
  const tagEnd = src.indexOf(">", mountIdx);
  if (src.slice(mountIdx, tagEnd).includes("cost=")) return true;
  // (b1) same-line gate
  const lineStart = src.lastIndexOf("\n", mountIdx) + 1;
  const beforeOnLine = src.slice(lineStart, mountIdx);
  if (beforeOnLine.includes("&&") || beforeOnLine.includes("?")) return true;
  // The defect class this guard exists for: a file with NO proof state
  // at all mounting the card bare. Any mount in such a file is unlawful
  // regardless of surrounding shape. (The substring matches every
  // prefixed variant too: audioOutOfCredits, matchOutOfCredits, …)
  if (!/utOfCredits/.test(src)) return false;
  // (b4) a proof-state opener in the lines just above: an enclosing
  // `{state && (` block (possibly wrapping nested divs) or an
  // `if (outOfCredits) { return … }` early return.
  const above = src
    .slice(0, mountIdx)
    .split("\n")
    .slice(-14)
    .join("\n");
  if (/\{\s*\w*[Oo]utOfCredits\w*\s*&&/.test(above)) return true;
  if (/if\s*\([^)]*[Oo]utOfCredits[^)]*\)\s*\{/.test(above)) return true;
  // (b2) enclosing expression container carries && / ternary
  let i = mountIdx - 1;
  let depth = 0;
  let start = -1;
  while (i >= 0) {
    const c = src[i];
    if (c === "}") depth += 1;
    else if (c === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
    i -= 1;
  }
  if (start >= 0) {
    const tail = src.slice(start + 1, mountIdx).slice(-200);
    if (tail.includes("&&")) return true;
    if (/\?\s*$/.test(tail) || tail.includes("? (") || tail.includes("?\n")) return true;
    // (b3) early return on the proof state just above
    const prev = src
      .slice(Math.max(0, start - 600), start)
      .split("\n")
      .slice(-14)
      .join("\n");
    if (/if\s*\([^)]*(outOfCredits|OutOfCredits|insufficient|error|Error)[^)]*\)\s*\{?\s*return/.test(prev)) {
      return true;
    }
  }
  return false;
}

describe("tree-wide guard — no unproven OutOfCredits mount anywhere", () => {
  it("every mount is cost-gated or proof-state-gated", () => {
    const offenders: string[] = [];
    let mounts = 0;
    for (const file of listTsx(SRC)) {
      if (file.endsWith("components/OutOfCredits.tsx")) continue;
      const src = readFileSync(file, "utf8");
      const re = /<OutOfCredits(?=[\s/>])/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        mounts += 1;
        if (!mountIsLawful(src, m.index)) {
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${file.replace(SRC, "src")}:${line}`);
        }
      }
    }
    expect(mounts).toBeGreaterThan(100); // the sweep really covered the tree
    expect(offenders).toEqual([]);
  });
});
