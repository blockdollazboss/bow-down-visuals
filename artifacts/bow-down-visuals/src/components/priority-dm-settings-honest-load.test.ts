/**
 * PriorityDmSettingsCard — honest load states (Stack-200 hardening
 * D1, census section A item 2 — the worst of the "empty lie" family:
 * the FABRICATED variant).
 *
 * Before: the settings GET's rejection handler invented a settings
 * object — { platform_enabled: false, opted_in: false, price_vb: 100,
 * reply_window_hours: 48 } — so a network failure told the creator
 * priority DMs were off platform-wide and they were opted out, with a
 * live save form sitting on the invented state (a save would have
 * written the fabrication over their real settings).
 *
 * After: failure sets ONLY an error flag. The card renders an error
 * state with retry — no settings values, no opt-in/opt-out buttons,
 * no save path. The genuine settings form renders only from a real
 * successful load; a distinct pending state covers the first load.
 *
 * The FE suite runs in node (no DOM), so — like the sibling pins —
 * these tests pin the state machine in source: what the rejection
 * handler writes, and which branches are reachable from the error
 * state. Copy keys are English in en.json; the other nine catalogs
 * carry the English verbatim as UNREVIEWED placeholders.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panel = read("./PriorityDmPanel.tsx");
/* Isolate the settings-card component (up to the lane component). */
const card = panel.slice(
  panel.indexOf("export function PriorityDmSettingsCard"),
  panel.indexOf("export function PriorityDmLane"),
);

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

describe("failure path — no fabricated settings, no save", () => {
  it("the rejection handler sets only the error flag", () => {
    expect(card).toContain("() => setLoadError(true)");
  });

  it("no code path seeds an invented settings object", () => {
    expect(card).not.toContain("platform_enabled: false, opted_in: false");
    expect(card).not.toMatch(/setSettings\(\{/);
    /* settings are only ever written from a real response or a real save */
    expect(card).toContain("setSettings(s)");
    expect(card).toContain("setSettings(d)");
  });

  it("the gate-off copy can only render from a real loaded settings object", () => {
    /* PRIORITY_DM_GATE_OFF_COPY still exists for a genuinely-off
       platform — but it sits behind the loaded-settings render, which
       the error branch returns before reaching. */
    const errorAt = card.indexOf('data-testid="priority-dm-settings-error"');
    const gateOffAt = card.indexOf('data-testid="priority-dm-gate-off"');
    expect(errorAt).toBeGreaterThan(-1);
    expect(gateOffAt).toBeGreaterThan(errorAt);
  });

  it("the error state renders an error and a retry — and no form controls at all", () => {
    const errorBranch = card.slice(
      card.indexOf("if (loadError)"),
      card.indexOf("if (!settings)"),
    );
    expect(errorBranch).toContain('t("priorityDm.settingsLoadError")');
    expect(errorBranch).toContain('data-testid="priority-dm-settings-retry"');
    expect(errorBranch).toContain("onClick={load}");
    /* nothing in the error branch can save or toggle anything */
    expect(errorBranch).not.toContain("save(");
    expect(errorBranch).not.toContain("priority-dm-opt-in");
    expect(errorBranch).not.toContain("priority-dm-opt-out");
    expect(errorBranch).not.toContain("priority-dm-save");
    expect(errorBranch).not.toContain("priority-dm-window");
    expect(errorBranch).not.toContain("priority-dm-price");
  });

  it("retry re-runs the real load and clears the error first", () => {
    expect(card).toContain("setLoadError(false)");
    expect(card).toContain('api.get("/api/priority-dms/my-settings")');
  });
});

describe("loading and genuine paths stay distinct from failure", () => {
  it("the first load shows a pending state instead of nothing", () => {
    expect(card).toContain('data-testid="priority-dm-settings-loading"');
    expect(card).toContain('t("priorityDm.settingsLoading")');
  });

  it("the real settings form (price, window, opt-in/out, save) renders only after a successful load", () => {
    const formAt = card.indexOf('data-testid="priority-dm-settings"');
    const loadingAt = card.indexOf('data-testid="priority-dm-settings-loading"');
    expect(formAt).toBeGreaterThan(loadingAt);
    expect(card).toContain('data-testid="priority-dm-window"');
    expect(card).toContain('data-testid="priority-dm-price"');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the priorityDm honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["priorityDm.settingsLoading", "priorityDm.settingsLoadError", "priorityDm.retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
