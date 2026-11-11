/**
 * DiscordWebhookSettings (the Discord Live card in settings) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE STATUS LOAD has THREE honest outcomes, rendered in
 *   order: the 503 "not switched on yet" state (plainly an
 *   unavailable card, never an error and never a fake form),
 *   the load-error card (a failed first load says the webhook
 *   "may already be connected, this card just couldn't check"
 *   and offers a retry wired to the real loader), then the
 *   form itself. A failed RE-load after a successful one keeps
 *   the last proven state instead of erroring over it
 *   (statusLoadedRef).
 * - THE SAVE narrates from the checked response: non-ok
 *   throws the server's message into a destructive toast.
 * - THE REMOVE checks res.ok both ways: success reloads,
 *   failure toasts that announcements are still on — a failed
 *   disconnect never reads as a disconnect.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./DiscordWebhookSettings.tsx");

describe("the status load: unavailable, error, form — in that order", () => {
  it("a 503 lands on the plainly-unavailable state, never the error card", () => {
    expect(src).toContain("if (res.status === 503) {");
    expect(src).toContain("setUnavailable(true);");
    expect(src).toContain("if (!res.ok) throw new Error(\"load failed\");");
    expect(src).toContain("aren't switched on for this site yet");
  });

  it("a failed first load errors honestly; a failed re-load keeps the proven state", () => {
    expect(src).toContain("if (!statusLoadedRef.current) setLoadError(true);");
    expect(src).toContain("Couldn't load your Discord settings.");
    expect(src).toContain("onClick={() => void load()}");
    const unavailableIdx = src.indexOf("{unavailable ? (");
    const errorIdx = src.indexOf(") : loadError ? (");
    expect(unavailableIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(unavailableIdx);
  });
});

describe("save and remove narrate from their checked responses", () => {
  it("save throws the server's message into the failure toast", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn\'t save."));');
    expect(src).toContain('toast({ title: "Discord connected 🎉"');
  });

  it("remove toasts the still-connected truth on failure", () => {
    expect(src).toContain('toast({ title: "Couldn\'t disconnect", description: "Discord announcements are still on — try again.", variant: "destructive" });');
  });
});
