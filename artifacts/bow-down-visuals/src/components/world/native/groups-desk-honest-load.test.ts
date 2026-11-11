/**
 * GroupsDesk (the in-World groups desk) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A native desk on the shared states, with the retry done
 * right: the api helper throws on non-ok with its status in
 * the fallback; the desk's load failure renders
 * NativeErrorState WITH a working retry (onRetry bumps the
 * tick that re-runs the load) — an error the member can act
 * on, never a dead end; group-opening has its own loading
 * state (groupsOpeningGroup). Group lists and memberships
 * render only from proven payloads.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GroupsDesk.tsx");

describe("load failure renders an actionable error state", () => {
  it("the throw and the retry-wired error state are pinned", () => {
    expect(src).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, `Request failed (${res.status})`));");
    expect(src).toContain('<NativeErrorState isLight={isLight} message={t("worldSocialDesk.groupsLoadError")} onRetry={() => setTick((n) => n + 1)} />');
  });
});
