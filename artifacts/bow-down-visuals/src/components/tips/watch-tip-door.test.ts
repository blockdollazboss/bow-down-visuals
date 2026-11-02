/**
 * watch-tip-door.test.ts — N4 (stack1300): the canonical tip jar's
 * watch-page door.
 *
 * Scoping (stack1300-program-scoping-report.md, N4): the jar had one
 * canonical address and doors on the profile + Shorts, but NO door on
 * non-Shorts video/watch pages. These pins hold the door to the house
 * rules the other doors already obey:
 * - the door exists only when the creator actually has a jar (the
 *   Shorts probe — no dead buttons);
 * - signed-out fans get the sign-in door, not a dead button;
 * - the panel is the tip page's own flow — same rail endpoints, same
 *   embedded-checkout ask, same tipPage words — in a house modal, so
 *   the fan never leaves the watch page to tip;
 * - failures are shown plainly and Send stays retryable;
 * - no fee is invented: tips carry no platform fee on this rail and
 *   the door's copy must never claim one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "WatchTipDoor.tsx"), "utf8");
const watchSrc = readFileSync(join(__dirname, "../../pages/stream/watch.tsx"), "utf8");

const sendStart = src.indexOf("async function sendTip()");
const sendRegion = src.slice(sendStart);

describe("watch-page tip door — existence follows the jar (Shorts probe)", () => {
  it("probes the canonical jar endpoint with the creator's slug/handle", () => {
    expect(src).toContain("fetch(`/api/tips/page/${encodeURIComponent(handleOrSlug)}`)");
  });

  it("renders nothing until a jar handle comes back — no dead door", () => {
    expect(src).toContain("json?.page?.handle");
    expect(src).toContain("if (!data) return null");
  });
});

describe("watch-page tip door — guests get the sign-in door", () => {
  it("signed-out fans get a login link back to this watch page", () => {
    expect(src).toContain("if (!user)");
    expect(src).toContain("href={`/login?next=${encodeURIComponent(signInNext)}`}");
    expect(src).toContain('data-testid="watch-tip-signin-door"');
  });

  it("the guest branch returns before the panel door is offered", () => {
    const guest = src.indexOf('data-testid="watch-tip-signin-door"');
    const door = src.indexOf('data-testid="watch-tip-door"');
    expect(guest).toBeGreaterThan(-1);
    expect(door).toBeGreaterThan(guest);
  });
});

describe("watch-page tip door — the panel is the tip page's own flow", () => {
  it("is a house modal: a11y hook, dialog contract, named close", () => {
    expect(src).toContain('from "@/hooks/use-modal-a11y"');
    expect(src).toContain("useModalA11y");
    expect(src).toContain('role="dialog"');
    expect(src).toContain('aria-modal="true"');
    expect(src).toContain('aria-label="Close"');
  });

  it("speaks the tip page's words — the tipPage locale keys, not new copy", () => {
    for (const key of [
      "tipPage.tipHeading",
      "tipPage.chooseAmount",
      "tipPage.customAmountPlaceholder",
      "tipPage.fanNamePlaceholder",
      "tipPage.messagePlaceholder",
      "tipPage.sendTipButton",
      "tipPage.tipStats",
      "tipPage.amountRequired",
      "tipPage.recordFailed",
      "tipPage.genericError",
      "tipPage.recordedTitle",
      "tipPage.recordedBody",
    ]) {
      expect(src).toContain(`t("${key}"`);
    }
  });

  it("amounts come from the jar itself — the page's suggested amounts", () => {
    expect(src).toContain("data.page.suggestedAmounts.map");
    expect(src).toContain("data.page.suggestedAmounts[0]");
  });

  it("sends on the tip rail: checkout first, embedded when the key is configured", () => {
    expect(sendRegion).toContain("fetch(`/api/tips/${encodeURIComponent(handle)}/checkout`");
    expect(sendRegion).toContain('hasStripePublishableKey() ? "embedded" : undefined');
    expect(src).toContain("EmbeddedSessionCheckout");
    expect(src).toContain('data-testid="watch-tip-embedded-checkout"');
  });

  it("mounts the embedded form on a client secret — before any hosted fallback", () => {
    const secretBranch = sendRegion.indexOf("coJson.clientSecret");
    const redirectBranch = sendRegion.indexOf("window.location.href = coJson.checkoutUrl");
    expect(secretBranch).toBeGreaterThan(-1);
    expect(redirectBranch).toBeGreaterThan(secretBranch);
    expect(sendRegion).toContain("setEmbeddedSecret(coJson.clientSecret as string)");
  });

  it("a 503 falls back to recording the tip intent, like the tip page", () => {
    expect(sendRegion).toContain("co.status !== 503");
    expect(sendRegion).toContain("fetch(`/api/tips/${encodeURIComponent(handle)}/tip`");
    expect(sendRegion).toContain("setSent(true)");
  });

  it("the API's own honesty notice rides along, verbatim from the jar data", () => {
    expect(src).toContain("{data.notice}");
  });
});

describe("watch-page tip door — failure is honest and retryable", () => {
  it("errors render in an alert region with the rail's own message", () => {
    expect(src).toContain('role="alert"');
    expect(sendRegion).toContain("apiErrorMessage(coJson, t(\"tipPage.recordFailed\"))");
    expect(sendRegion).toContain('setError(t("tipPage.genericError"))');
  });

  it("Send disables only while sending — a failure leaves it live to retry", () => {
    expect(src).toContain("disabled={sending}");
    expect(sendRegion).toContain("setSending(false)");
  });
});

describe("watch-page tip door — no invented fee", () => {
  it("never states a percentage fee or a platform cut", () => {
    expect(src).not.toMatch(/\d+\s*%\s*(fee|platform|cut)/i);
    expect(src).not.toContain("service fee");
  });
});

describe("watch page — the door is mounted in the action row", () => {
  it("mounts beside MediaActions with the artist slug and a return path", () => {
    expect(watchSrc).toContain('import { WatchTipDoor } from "@/components/tips/WatchTipDoor"');
    expect(watchSrc).toContain("handleOrSlug={artist?.slug}");
    expect(watchSrc).toContain("signInNext={`/watch/${video.id}`}");
  });
});
