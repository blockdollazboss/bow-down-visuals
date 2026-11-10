/**
 * DailyDropCard — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The day's drop card on the
 * dashboard is quiet-by-design: a non-ok response returns early, a
 * network failure is swallowed, and a payload without an enabled
 * drop sets nothing — the card renders ONLY from a loaded, enabled
 * drop, so a failed read can never dress up as a drop, an empty
 * state, or invented template copy. The copy it does render is
 * keyed off the loaded drop itself.
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const card = read("./DailyDropCard.tsx");

describe("failure path — a failed drop read never invents a card", () => {
  it("a non-ok response returns before any state is set", () => {
    expect(card).toContain('fetch("/api/retention/daily-drop", {');
    expect(card).toContain("if (!res.ok) return;");
  });

  it("a network failure is swallowed with the dashboard-never-breaks note", () => {
    expect(card).toContain("/* silent — the dashboard must never break over a drop */");
  });

  it("a payload without an enabled drop sets nothing", () => {
    expect(card).toContain("if (cancelled || !d.enabled || !d.drop) return;");
  });

  it("the drop state starts null and is only set from the loaded payload", () => {
    expect(card).toContain("const [drop, setDrop] = useState<Drop | null>(null);");
    expect(card).toContain("setDrop(d.drop);");
  });
});

describe("the card renders only from a successful load", () => {
  it("dismissed and not-loaded both render nothing — the same honest absence", () => {
    expect(card).toContain("if (dismissed || !drop) return null;");
  });

  it("the rendered title and description are keyed off the loaded drop, never literals", () => {
    expect(card).toContain("t(`retention.drops.${drop.key}.title`)");
    expect(card).toContain("t(`retention.drops.${drop.key}.description`)");
  });
});
