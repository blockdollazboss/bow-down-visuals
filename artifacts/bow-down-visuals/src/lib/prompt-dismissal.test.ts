/**
 * Prompt-dismissal tests — owner ruling (stack1400 #16): a dismissal
 * of the install card or a push opt-in prompt lasts 30 days, then the
 * prompt may ask again.
 *
 * Covers: fresh dismissal hides, a 31-day-old dismissal re-shows, the
 * legacy bare "1" migrates to a timestamp at first read (30 fresh
 * days), and the push prompt's per-context keys stay independent.
 */
import { describe, expect, it } from "vitest";
import {
  PROMPT_DISMISSAL_WINDOW_MS,
  isPromptDismissed,
  recordPromptDismissal,
} from "./prompt-dismissal";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

/** Minimal localStorage stand-in for the node test environment. */
function mockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

const INSTALL_KEY = "bdv-pwa-dismissed";
const pushKey = (context: string) => `bdv_push_prompt_dismissed:${context}`;

describe("isPromptDismissed / recordPromptDismissal", () => {
  it("is not dismissed when nothing is stored", () => {
    expect(isPromptDismissed(INSTALL_KEY, mockStorage(), NOW)).toBe(false);
  });

  it("a fresh dismissal hides the prompt", () => {
    const s = mockStorage();
    recordPromptDismissal(INSTALL_KEY, s, NOW);
    expect(s.getItem(INSTALL_KEY)).toBe(String(NOW));
    expect(isPromptDismissed(INSTALL_KEY, s, NOW)).toBe(true);
    expect(isPromptDismissed(INSTALL_KEY, s, NOW + 29 * DAY_MS)).toBe(true);
  });

  it("a 31-day-old dismissal re-shows the prompt", () => {
    const s = mockStorage();
    s.setItem(INSTALL_KEY, String(NOW - 31 * DAY_MS));
    expect(isPromptDismissed(INSTALL_KEY, s, NOW)).toBe(false);
  });

  it("a dismissal exactly 30 days old has expired", () => {
    const s = mockStorage();
    s.setItem(INSTALL_KEY, String(NOW - PROMPT_DISMISSAL_WINDOW_MS));
    expect(isPromptDismissed(INSTALL_KEY, s, NOW)).toBe(false);
  });

  it("re-dismissing after expiry starts a fresh 30 days", () => {
    const s = mockStorage();
    s.setItem(INSTALL_KEY, String(NOW - 31 * DAY_MS));
    expect(isPromptDismissed(INSTALL_KEY, s, NOW)).toBe(false);
    recordPromptDismissal(INSTALL_KEY, s, NOW);
    expect(isPromptDismissed(INSTALL_KEY, s, NOW + 29 * DAY_MS)).toBe(true);
    expect(isPromptDismissed(INSTALL_KEY, s, NOW + 31 * DAY_MS)).toBe(false);
  });

  it("treats unrecognizable stored values as not dismissed", () => {
    const s = mockStorage();
    s.setItem(INSTALL_KEY, "yes-forever");
    expect(isPromptDismissed(INSTALL_KEY, s, NOW)).toBe(false);
    s.setItem(INSTALL_KEY, "");
    expect(isPromptDismissed(INSTALL_KEY, s, NOW)).toBe(false);
  });

  it("survives a throwing storage without throwing", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(isPromptDismissed(INSTALL_KEY, throwing, NOW)).toBe(false);
    expect(() => recordPromptDismissal(INSTALL_KEY, throwing, NOW)).not.toThrow();
  });
});

describe("legacy bare \"1\" migration", () => {
  it("migrates a legacy \"1\" to a timestamp at first read and hides", () => {
    const s = mockStorage();
    s.setItem(INSTALL_KEY, "1");
    expect(isPromptDismissed(INSTALL_KEY, s, NOW)).toBe(true);
    // The stored value is now a timestamp for the moment of first read.
    expect(s.getItem(INSTALL_KEY)).toBe(String(NOW));
  });

  it("a migrated legacy dismissal gets 30 fresh days, then re-asks", () => {
    const s = mockStorage();
    s.setItem(INSTALL_KEY, "1");
    expect(isPromptDismissed(INSTALL_KEY, s, NOW)).toBe(true);
    expect(isPromptDismissed(INSTALL_KEY, s, NOW + 29 * DAY_MS)).toBe(true);
    expect(isPromptDismissed(INSTALL_KEY, s, NOW + 31 * DAY_MS)).toBe(false);
  });

  it("still counts as dismissed when the migration write fails", () => {
    const readOnly = {
      getItem: () => "1",
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(isPromptDismissed(INSTALL_KEY, readOnly, NOW)).toBe(true);
  });
});

describe("push prompt per-context keys", () => {
  it("dismissing one context does not dismiss another", () => {
    const s = mockStorage();
    recordPromptDismissal(pushKey("store-sale"), s, NOW);
    expect(isPromptDismissed(pushKey("store-sale"), s, NOW)).toBe(true);
    expect(isPromptDismissed(pushKey("live-start"), s, NOW)).toBe(false);
  });

  it("each context expires on its own clock", () => {
    const s = mockStorage();
    s.setItem(pushKey("old-context"), String(NOW - 31 * DAY_MS));
    recordPromptDismissal(pushKey("fresh-context"), s, NOW);
    expect(isPromptDismissed(pushKey("old-context"), s, NOW)).toBe(false);
    expect(isPromptDismissed(pushKey("fresh-context"), s, NOW)).toBe(true);
  });

  it("a legacy \"1\" in one context migrates without touching the others", () => {
    const s = mockStorage();
    s.setItem(pushKey("legacy-context"), "1");
    expect(isPromptDismissed(pushKey("legacy-context"), s, NOW)).toBe(true);
    expect(s.getItem(pushKey("legacy-context"))).toBe(String(NOW));
    expect(s.getItem(pushKey("other-context"))).toBeNull();
    expect(isPromptDismissed(pushKey("other-context"), s, NOW)).toBe(false);
  });
});
