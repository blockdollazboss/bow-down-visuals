/**
 * Terms-model unit tests for custom beat license templates (0188):
 * the fixed tiers' standing terms must match what their marketplace
 * blurbs have always promised, and the patch schema must never reset
 * a field the producer didn't name.
 */
import { describe, expect, it } from "vitest";

import {
  beatLicenseTemplatePatchSchema,
  beatLicenseTemplateSchema,
  defaultTermsForTier,
  termsFromTemplateInput,
} from "../beats-pricing";

describe("fixed tier standing terms (from the tier blurbs)", () => {
  it("basic: MP3 lease · 1 music video · 50k streams", () => {
    const terms = defaultTermsForTier("basic");
    expect(terms.format).toBe("mp3");
    expect(terms.musicVideosCap).toBe(1);
    expect(terms.streamsCap).toBe(50_000);
    expect(terms.isExclusive).toBe(false);
  });

  it("premium: WAV + MP3 · 2 music videos · 500k streams", () => {
    const terms = defaultTermsForTier("premium");
    expect(terms.format).toBe("wav_mp3");
    expect(terms.musicVideosCap).toBe(2);
    expect(terms.streamsCap).toBe(500_000);
    expect(terms.isExclusive).toBe(false);
  });

  it("exclusive: full ownership · stems · unlimited", () => {
    const terms = defaultTermsForTier("exclusive");
    expect(terms.format).toBe("ownership_stems");
    expect(terms.streamsCap).toBeNull();
    expect(terms.musicVideosCap).toBeNull();
    expect(terms.isExclusive).toBe(true);
  });
});

describe("template schemas", () => {
  it("create applies honest defaults; caps left unset mean unlimited (null)", () => {
    const parsed = beatLicenseTemplateSchema.safeParse({ name: "Lease", priceCents: 5000 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.format).toBe("mp3");
      expect(parsed.data.territory).toBe("Worldwide");
      expect(parsed.data.isExclusive).toBe(false);
      const terms = termsFromTemplateInput(parsed.data);
      expect(terms.streamsCap).toBeNull();
      expect(terms.salesCap).toBeNull();
      expect(terms.termYears).toBeNull();
    }
  });

  it("patch schema has no defaults to clobber stored values with", () => {
    const parsed = beatLicenseTemplatePatchSchema.safeParse({ priceCents: 7000 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data)).toEqual(["priceCents"]);
    }
  });
});
