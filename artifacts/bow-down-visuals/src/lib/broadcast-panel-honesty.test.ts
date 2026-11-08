/**
 * broadcast-panel-honesty.test.ts — Stack 300 broadcast-panel lane
 * (manifest items 72/119 + 75/114; Lane D Failure #2/#5 ≡ Lane C #13/#8).
 *
 * Two builds on BroadcastChannelsPanel, pinned here:
 *
 *  1. Action honesty (72/119): Join / Leave / Post used to swallow
 *     failures with `.catch(() => undefined)` — and Post then cleared
 *     the draft unconditionally, so a failed broadcast deleted the
 *     owner's words while looking sent. Now each action surfaces a
 *     per-channel error through the api-error translator
 *     (`plainErrorText` with a catalog fallback — never a raw server
 *     string), and the draft clears ONLY on confirmed success.
 *
 *  2. Full keying (75/114): the panel rendered hard-coded English
 *     inside the catalog-keyed Go Live page. Every user-visible string
 *     now renders from the `broadcast.*` namespace. The namespace is
 *     English-source; the 9 non-en catalogs carry it English-verbatim
 *     UNREVIEWED (house rule — no agent-drafted translations), pinned
 *     byte-identical below until real translations land, at which
 *     point this pin is revisited key by key.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("../", import.meta.url).pathname;
const panel = readFileSync(join(SRC, "components/go-live/BroadcastChannelsPanel.tsx"), "utf8");

const LOCALES = ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"] as const;
type Flat = Map<string, string>;
function flatten(obj: Record<string, unknown>, prefix = "", out: Flat = new Map()): Flat {
  for (const [k, v] of Object.entries(obj)) {
    const q = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Record<string, unknown>, q, out);
    else out.set(q, v as string);
  }
  return out;
}
const CATS: Record<string, Flat> = {};
for (const l of LOCALES) {
  CATS[l] = flatten(JSON.parse(readFileSync(join(SRC, "locales", `${l}.json`), "utf8")));
}

describe("broadcast panel — channel actions are honest (items 72/119)", () => {
  it("no action swallows its failure anymore", () => {
    expect(panel).not.toContain(".catch(() => undefined)");
    expect(panel).not.toContain("catch(() => undefined)");
  });

  it("join and leave failures surface through the api-error translator with catalog fallbacks", () => {
    expect(panel).toContain('plainErrorText(err, t("broadcast.joinFailed"))');
    expect(panel).toContain('plainErrorText(err, t("broadcast.leaveFailed"))');
    expect(panel).toContain('data-testid="broadcast-action-error"');
  });

  it("a failed post keeps the draft — the clear happens only after a confirmed post, before the catch", () => {
    expect(panel).toContain('plainErrorText(err, t("broadcast.postFailed"))');
    const postAt = panel.indexOf("await reachApi.postBroadcast");
    expect(postAt).toBeGreaterThan(-1);
    const window = panel.slice(postAt, postAt + 900);
    const clearAt = window.indexOf('setDrafts((d) => ({ ...d, [c.id]: "" }))');
    const catchAt = window.indexOf("catch (err)");
    expect(clearAt).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(clearAt);
    /* The catch branch itself must never clear the draft. */
    const catchBlock = window.slice(catchAt, catchAt + 300);
    expect(catchBlock).not.toContain("setDrafts");
    expect(catchBlock).toContain("broadcast.postFailed");
  });

  it("the create form keeps its honest error path, now with a catalog fallback", () => {
    expect(panel).toContain('plainErrorText(err, t("broadcast.createFailed"))');
  });
});

describe("broadcast panel — fully catalog-keyed (items 75/114)", () => {
  it("the panel renders through useTranslation", () => {
    expect(panel).toContain('import { useTranslation } from "react-i18next"');
    expect(panel).toContain("const { t } = useTranslation();");
  });

  it("the former hard-coded literals are gone from the panel", () => {
    for (const literal of [
      "Sign in to use broadcast channels.",
      "Your one-to-many channel",
      "Loading your channels",
      "Your channels couldn't load.",
      "Open your broadcast channel",
      "Open channel",
      "Your broadcast inbox",
      "Your inbox couldn't load.",
      "Loading your inbox",
      "Nothing here yet",
      "Broadcast something to your members",
    ]) {
      expect(panel, literal).not.toContain(literal);
    }
  });

  it("every broadcast.* key the panel calls resolves in en", () => {
    const used = new Set([...panel.matchAll(/t\("(broadcast\.[A-Za-z]+)"/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThanOrEqual(25);
    for (const k of used) {
      const v = CATS.en!.get(k);
      expect(typeof v === "string" && v.trim() !== "", k).toBe(true);
    }
  });

  it("the broadcast namespace exists, identical key-for-key, in all 10 catalogs", () => {
    const enKeys = [...CATS.en!.keys()].filter((k) => k.startsWith("broadcast."));
    expect(enKeys.length).toBe(29);
    for (const l of LOCALES) {
      const keys = [...CATS[l]!.keys()].filter((k) => k.startsWith("broadcast."));
      expect(keys.sort(), l).toEqual([...enKeys].sort());
    }
  });

  it("non-en catalogs carry the namespace English-verbatim UNREVIEWED (house rule)", () => {
    for (const l of LOCALES) {
      if (l === "en") continue;
      for (const [k, v] of CATS.en!) {
        if (!k.startsWith("broadcast.")) continue;
        expect(CATS[l]!.get(k), `${l}: ${k}`).toBe(v);
      }
    }
  });
});
