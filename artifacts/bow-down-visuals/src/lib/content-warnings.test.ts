/**
 * Content warnings (Wave 4 #40) — the client-side contract.
 *
 * The label set must match the server's exactly (a label the client
 * can pick but the server rejects — or vice versa — is a silent
 * no-op at publish time), and the reveal registry is per item, per
 * session: memory only, keyed by post, with no persistence and no
 * global switch.
 */
import { describe, it, expect } from "vitest";
import {
  CONTENT_WARNING_LABELS,
  CONTENT_WARNING_DISPLAY_NAMES,
  contentWarningNames,
  revealedMediaThisSession,
  markRevealedThisSession,
} from "./content-warnings";

describe("the label set", () => {
  it("is the fixed server set, in canonical order", () => {
    expect(CONTENT_WARNING_LABELS).toEqual([
      "sensitive",
      "flashing_lights",
      "mature_themes",
      "strong_language",
    ]);
  });

  it("every label has a fan-facing name", () => {
    for (const l of CONTENT_WARNING_LABELS) {
      expect(CONTENT_WARNING_DISPLAY_NAMES[l]).toBeTruthy();
    }
    expect(CONTENT_WARNING_DISPLAY_NAMES.flashing_lights).toBe("Flashing lights");
  });

  it("names join in canonical order regardless of input order, and unknown labels drop out", () => {
    expect(contentWarningNames(["strong_language", "sensitive"])).toBe("Sensitive content · Strong language");
    expect(contentWarningNames(["bogus"])).toBe("");
    expect(contentWarningNames([])).toBe("");
  });
});

describe("the reveal registry — per item, per session", () => {
  it("remembers a reveal for that post only", () => {
    const media = [{ kind: "image", url: "https://cdn.example.com/a.jpg" }];
    expect(revealedMediaThisSession("post-a")).toBeNull();
    markRevealedThisSession("post-a", media);
    expect(revealedMediaThisSession("post-a")).toEqual(media);
    // Another post is untouched — there is no global reveal.
    expect(revealedMediaThisSession("post-b")).toBeNull();
  });
});
