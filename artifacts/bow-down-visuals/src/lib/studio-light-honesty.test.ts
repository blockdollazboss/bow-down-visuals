/**
 * Go Live studio light-theme + honesty pins (Oct 18, 2026, from the
 * owner's screenshots of the pushed build in light theme).
 *
 * The defects these pin:
 *  1. The World banner card on /go-live carried a never-themed dark
 *     gradient — in light theme the slab stayed black while its text
 *     remapped to dark ink (unreadable). It now has an isLight branch
 *     in the studio's panel idiom; dark rendering is unchanged.
 *  2. `bg-[#0d0a04]` escaped the §18 arbitrary-hex sweep in index.css,
 *     so the Moderators / Widgets / live Chat / stream Summary panels
 *     stayed black in light theme. The sweep line covers the class,
 *     and the four panels' own data-dark-lock attributes (which the
 *     sweep respects by construction) came off their roots — the
 *     components keep their authored classes and the panel pattern
 *     is untouched. The deck's lock stays: owner's call.
 *  3. "Phone remote link: connecting…" could hang forever — the
 *     controller clients exited silently on a missing token or a
 *     throwing socket open, and a stalled handshake had no deadline.
 *     Failures now climb the reconnect ladder, and past the ladder
 *     the label admits the link is unavailable (behavioral tests in
 *     stream-controller.test.ts; wiring pins here).
 *  4. The deck's mic tile read "Live" on load with NO mic anywhere:
 *     the snapshot's null-mixer fallback `?? false` fed a
 *     muted-or-live label. The readout now derives from micPresent
 *     via micReadout() — absent/off can only read "Off".
 *  5. The collapsed Cheat Code chip straddled the content panel's
 *     border (anchored to <main> at top-2/left-4 while the panel
 *     starts at mx-4/my-4). Its offsets now sit inside the panel
 *     origin with a matching inset at both breakpoints.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const moderators = readFileSync(new URL("../components/live/ChannelModerators.tsx", import.meta.url), "utf8");
const widgetsPanel = readFileSync(new URL("../components/live/StreamWidgetsPanel.tsx", import.meta.url), "utf8");
const chatPanel = readFileSync(new URL("../components/live/LiveChatPanel.tsx", import.meta.url), "utf8");
const summaryCard = readFileSync(new URL("../components/live/StreamSummaryCard.tsx", import.meta.url), "utf8");
const goLive = readFileSync(new URL("../pages/go-live.tsx", import.meta.url), "utf8");
const studio = readFileSync(new URL("../components/go-live/BroadcastStudio.tsx", import.meta.url), "utf8");
const deck = readFileSync(new URL("../components/live/StreamDeck.tsx", import.meta.url), "utf8");
const host = readFileSync(new URL("../components/ThyCheatCodeHost.tsx", import.meta.url), "utf8");
const controller = readFileSync(new URL("./stream-controller.ts", import.meta.url), "utf8");

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("§18 sweep covers bg-[#0d0a04]", () => {
  it("the hex joins the light repaint group with the dark-lock guards", () => {
    expect(css).toContain(".light .bg-\\[\\#0d0a04\\]:not([data-dark-lock]):not([data-dark-lock] *)");
  });

  it("its model entry (#0d0a02) is still there — the group is intact", () => {
    expect(css).toContain(".light .bg-\\[\\#0d0a02\\]:not([data-dark-lock]):not([data-dark-lock] *)");
  });

  it("the four bg-[#0d0a04] panels no longer dark-lock their roots (the sweep's guard would skip them)", () => {
    // The sweep respects [data-dark-lock] by construction; these
    // panels carried the attribute on the same root as the class,
    // which is why a sweep line alone could never repaint them.
    // (The Stream Controller deck's wrapper keeps its lock — that
    // one is the owner's call, pinned in the mic describe below.)
    for (const src of [moderators, widgetsPanel, chatPanel, summaryCard]) {
      // Bare JSX attribute line only — prose mentions in comments
      // (the chat panel's header explains the removal) don't count.
      expect(src).not.toMatch(/^\s+data-dark-lock\s*$/m);
      expect(src).toContain("bg-[#0d0a04]");
    }
  });
});

describe("World banner card themes with the page", () => {
  it("keeps the world-entry testid and the dark gradient verbatim", () => {
    expect(goLive).toContain('data-testid="world-entry"');
    expect(goLive).toContain("from-[#d4af37]/[0.13] via-[#0a0908] to-[#0a0908]");
  });

  it("has an isLight branch in the studio panel idiom (cream ground)", () => {
    expect(goLive).toContain("border-[#C9A84C]/40 bg-gradient-to-r from-[#FCF7EA] to-[#F4E7C3]");
  });

  it("title and body take bronze ink in light, white in dark", () => {
    expect(goLive).toContain('isLight ? "text-[#2A1E07]" : "text-white"');
    expect(goLive).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});

describe("phone remote link honesty wiring", () => {
  it("both clients expose linkUnavailable and arm a handshake deadline", () => {
    expect(occurrences(controller, "get linkUnavailable()")).toBe(2);
    expect(occurrences(controller, "}, HANDSHAKE_TIMEOUT_MS);")).toBe(2);
    expect(controller).toContain("export const HANDSHAKE_TIMEOUT_MS = 8000");
  });

  it("the studio reads the client's unavailable state into its label state", () => {
    expect(studio).toContain("setControllerLinkDown(client.linkUnavailable)");
    expect(studio).toContain("const [controllerLinkDown, setControllerLinkDown] = useState(false)");
  });

  it("the label has three honest states, in our words", () => {
    expect(studio).toContain('"Phone remote link: ready"');
    expect(studio).toContain('"Phone remote link: connecting…"');
    expect(studio).toContain("Phone remote link: unavailable — the controls on this screen still run your show");
  });
});

describe("mic readout truth wiring", () => {
  it("micReadout lives in the controller lib and gates on micPresent", () => {
    expect(controller).toContain("export function micReadout(");
    expect(controller).toContain("state.micPresent !== true");
  });

  it("the studio snapshot derives presence from a real input, never a fallback", () => {
    expect(studio).toContain("micPresent: micInput !== null");
    expect(studio).toContain('phase !== "off" ? (mixerRef.current?.getInputState("mic") ?? null) : null');
    // The lying fallback is gone: no more `?? false` on the mic line.
    expect(studio).not.toContain('getInputState("mic")?.muted ?? false');
  });

  it("the pre-render default snapshot claims no mic", () => {
    expect(studio).toContain("micPresent: false,");
  });

  it("the deck renders the readout, not a muted-or-live guess", () => {
    expect(deck).toContain("const mic = micReadout(state);");
    expect(deck).not.toContain('state?.micMuted ? "Muted" : "Live"');
  });

  it("camera and record readouts stay null-safe to Off (no affirmative defaults)", () => {
    expect(deck).toContain('state?.cameraOn ? "On" : "Off"');
    expect(deck).toContain('state?.recording ? "Recording" : "Off"');
  });

  it("the deck slab keeps its explicit dark lock (owner's call, untouched)", () => {
    expect(studio).toContain("data-dark-lock");
    expect(deck).toContain("data-dark-lock: the deck is a control surface");
  });
});

describe("Cheat Code chip sits inside the panel", () => {
  it("collapsed chip offsets match the panel origin plus a small inset", () => {
    // Panel: mx-4 my-4 (16px) / md:mx-6 md:my-6 (24px). Chip:
    // left-8 (32) top-6 (24) / md:left-10 (40) md:top-8 (32) —
    // a 16×8 inset inside the border at both breakpoints.
    expect(host).toContain("absolute top-6 left-8 md:top-8 md:left-10 z-[30]");
    expect(host).not.toContain("top-2 left-4 sm:left-6 lg:left-8");
  });
});
