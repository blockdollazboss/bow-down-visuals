/**
 * CameraMovePlanner — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The planner's deck is the server's
 * camera-preset catalog (GET /api/wave9d/camera/presets). Its load
 * contract is DISCLOSED FALLBACK: while the deck is in flight the
 * planner shows its loading line; on any failure (non-ok throws,
 * network throws) it falls back to the classic five moves — real,
 * functional presets the planner always had — sets the fallback
 * flag, and RENDERS THE DISCLOSURE ("The full deck couldn't load —
 * showing the classic five moves.") above the deck. The fallback is
 * a static catalog degraded with a label, never user data dressed
 * up as loaded, and the server deck replaces it wholesale on
 * success. The planner's two AI actions (enrich, design) record
 * their failures in their own error states, rendered in the panel.
 *
 * Copy rides i18n keys under wave9.cameraMovePlanner; the pin
 * carries the catalog block for the two deck keys. The FE suite
 * runs in node (no DOM), so these tests pin the machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const planner = read("./CameraMovePlanner.tsx");

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

describe("the deck load — failure degrades to a DISCLOSED fallback, never a fake catalog", () => {
  it("the deck starts null (not loaded) with the fallback flag down", () => {
    expect(planner).toContain("const [deck, setDeck] = useState<DeckPreset[] | null>(null);");
    expect(planner).toContain("const [deckFallback, setDeckFallback] = useState(false);");
  });

  it("the loader throws on a non-ok response", () => {
    expect(planner).toContain('const res = await fetch("/api/wave9d/camera/presets", {');
    expect(planner).toContain('if (!res.ok) throw new Error("deck unavailable");');
  });

  it("success records the server deck and its categories", () => {
    expect(planner).toContain("setDeck(data.presets);");
    expect(planner).toContain("setCategories(data.categories);");
  });

  it("failure installs the classic-five fallback AND raises the fallback flag", () => {
    expect(planner).toContain("setDeckFallback(true);");
    expect(planner).toContain("LEGACY_IDS.map((id) => ({");
  });

  it("the fallback is disclosed in the render, above the deck", () => {
    expect(planner).toContain("{deckFallback && (");
    expect(planner).toContain("t(`${ns}.deckFallback`)");
  });

  it("while the deck is in flight the planner shows its loading line, not an empty deck", () => {
    expect(planner).toContain("{!deck ? (");
    expect(planner).toContain("t(`${ns}.deckLoading`)");
  });
});

describe("the planner's AI actions record their failures", () => {
  it("the enrich action records the failure in its error state", () => {
    expect(planner).toContain("setError(plainErrorText(e, t(`${ns}.errorGeneric`)));");
  });

  it("the design action throws on a non-ok or proposal-less response and records its error", () => {
    expect(planner).toContain('if (!res.ok || !data.proposal) throw new Error(apiErrorMessage(data, "design failed"));');
    expect(planner).toContain("setDesignerError(t(`${ns}.designerError`));");
  });

  it("the recorded action error renders in the panel", () => {
    expect(planner).toContain("{error && (");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the camera-planner honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../../locales/${loc}.json`)));
    for (const k of [
      "wave9.cameraMovePlanner.deckFallback",
      "wave9.cameraMovePlanner.deckLoading",
    ]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
